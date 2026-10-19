// Team gateway data: engineers, monthly limits, manager credits and an audit trail
// (team.json), plus one usage line per relayed request (usage.jsonl). No dependencies.
// All money is USD at API list prices, priced by the proxy from the usage it relays.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const MODES = ["downgrade", "block"]; // what happens once an engineer passes the limit
export const CAPS = [null, "sonnet", "haiku"]; // highest model tier an engineer may use

const hash = (key) => crypto.createHash("sha256").update(key).digest("hex");
export const newKey = () => "tsk_" + crypto.randomBytes(18).toString("base64url");
export const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "engineer";

export function openStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const teamFile = path.join(dir, "team.json");
  const usageFile = path.join(dir, "usage.jsonl");
  const turnsFile = path.join(dir, "turns.jsonl"); // prompt shape + cost per turn; never prompt text
  const state = fs.existsSync(teamFile) ? JSON.parse(fs.readFileSync(teamFile, "utf8")) : { engineers: {}, audit: [] };
  const events = fs.existsSync(usageFile)
    ? fs.readFileSync(usageFile, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    : [];
  const turns = fs.existsSync(turnsFile)
    ? fs.readFileSync(turnsFile, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    : [];
  const byKey = new Map(Object.values(state.engineers).map((e) => [e.keyHash, e]));
  // Month-to-date spend per engineer, kept incrementally so budget checks stay O(1).
  let month = monthStart();
  const spend = new Map();
  const recount = () => { spend.clear(); for (const ev of events) if (ev.ts >= month) spend.set(ev.user, (spend.get(ev.user) || 0) + (ev.cost || 0)); };
  recount();

  const save = () => {
    const tmp = teamFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, teamFile);
  };
  const audit = (engineer, action, detail = {}) => { state.audit.push({ at: new Date().toISOString(), engineer, action, ...detail }); save(); };

  const store = {
    dir, events, turns,
    recordTurn(t) { turns.push(t); fs.appendFileSync(turnsFile, JSON.stringify(t) + "\n"); },
    engineers: () => Object.values(state.engineers),
    get: (id) => state.engineers[id],
    byKey: (key) => (key ? byKey.get(hash(key)) : undefined),
    audit: () => state.audit,

    monthSpend(id) {
      if (monthStart() !== month) { month = monthStart(); recount(); }
      return spend.get(id) || 0;
    },
    credits(id, since = monthStart()) {
      return state.audit.filter((a) => a.engineer === id && a.action === "credit" && a.at >= since).reduce((s, a) => s + a.amount, 0);
    },
    // The limit that applies right now: the monthly limit plus this month's manager credits. 0 = no limit.
    effectiveLimit(id) {
      const e = state.engineers[id];
      return e?.monthlyLimit > 0 ? Math.max(0, e.monthlyLimit + store.credits(id)) : 0;
    },

    record(ev) {
      events.push(ev);
      if (ev.ts >= month) spend.set(ev.user, (spend.get(ev.user) || 0) + (ev.cost || 0));
      fs.appendFileSync(usageFile, JSON.stringify(ev) + "\n");
    },

    create({ name, team = "", monthlyLimit = 0, overLimit = "downgrade", modelCap = null }, by = "manager") {
      if (!name) throw new Error("name is required");
      let id = slug(name), i = 2;
      while (state.engineers[id]) id = `${slug(name)}-${i++}`;
      const key = newKey();
      const e = { id, name: String(name), team: String(team), monthlyLimit: Number(monthlyLimit) || 0, overLimit, modelCap, active: true, hints: true, keyHash: hash(key), keyHint: key.slice(-4), createdAt: new Date().toISOString() };
      check(e);
      state.engineers[id] = e; byKey.set(e.keyHash, e);
      audit(id, "create", { by, to: { monthlyLimit: e.monthlyLimit, overLimit, modelCap } });
      return { engineer: e, key };
    },
    update(id, patch, by = "manager") {
      const e = state.engineers[id];
      if (!e) throw new Error("no such engineer");
      const fields = ["name", "team", "monthlyLimit", "overLimit", "modelCap", "active", "hints"];
      const next = { ...e };
      for (const f of fields) if (f in patch) next[f] = f === "monthlyLimit" ? Number(patch[f]) || 0 : patch[f];
      check(next);
      const from = {}, to = {};
      for (const f of fields) if (next[f] !== e[f]) { from[f] = e[f]; to[f] = next[f]; }
      if (!Object.keys(to).length) return e;
      Object.assign(e, next);
      audit(id, "update", { by, from, to, ...(patch.note && { note: String(patch.note) }) });
      return e;
    },
    credit(id, amount, note = "", by = "manager") {
      if (!state.engineers[id]) throw new Error("no such engineer");
      amount = Math.round(Number(amount) * 100) / 100;
      if (!amount || !Number.isFinite(amount)) throw new Error("amount must be a non-zero number");
      audit(id, "credit", { by, amount, note: String(note) });
      return store.effectiveLimit(id);
    },
    rotateKey(id, by = "manager") {
      const e = state.engineers[id];
      if (!e) throw new Error("no such engineer");
      byKey.delete(e.keyHash);
      const key = newKey();
      e.keyHash = hash(key); e.keyHint = key.slice(-4); byKey.set(e.keyHash, e);
      audit(id, "rotate-key", { by });
      return key;
    },
  };
  return store;
}

function check(e) {
  if (!MODES.includes(e.overLimit)) throw new Error(`overLimit must be one of ${MODES.join(", ")}`);
  if (!CAPS.includes(e.modelCap)) throw new Error("modelCap must be null, \"sonnet\" or \"haiku\"");
  if (!(e.monthlyLimit >= 0)) throw new Error("monthlyLimit must be >= 0");
  if (typeof e.active !== "boolean") throw new Error("active must be true or false");
  if (e.hints !== undefined && typeof e.hints !== "boolean") throw new Error("hints must be true or false");
}
