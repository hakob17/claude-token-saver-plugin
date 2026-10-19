#!/usr/bin/env node
// EXPERIMENTAL. Team gateway: the routing proxy (smart policy by default) shared by a team,
// with a key, a monthly limit and an over-limit rule per engineer, and a manager dashboard.
//
//   TOKEN_SAVER_ADMIN_TOKEN=... TOKEN_SAVER_TEAM_API_KEY=sk-ant-... node plugins/token-saver/team/gateway.mjs
//   open http://127.0.0.1:8790/admin
//
// Engineers point Claude Code at it with their gateway key (see bench/TEAM-GATEWAY.md):
//   ANTHROPIC_BASE_URL=http://gateway:8790 ANTHROPIC_API_KEY=tsk_... claude          (team API key upstream)
//   ANTHROPIC_BASE_URL=http://gateway:8790 ANTHROPIC_CUSTOM_HEADERS="x-token-saver-key: tsk_..." claude   (own login)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { openStore } from "./store.mjs";
import { promptSignals, hintFor, patternStats, HINTS } from "./prompt-hints.mjs";

const env = process.env;
export const TEAM = {
  port: Number(env.TOKEN_SAVER_TEAM_PORT || 8790),
  host: env.TOKEN_SAVER_TEAM_HOST || "127.0.0.1",
  dir: env.TOKEN_SAVER_TEAM_DIR || path.join(os.homedir(), ".claude", "token-saver", "team"),
  apiKey: env.TOKEN_SAVER_TEAM_API_KEY || "", // upstream key used for engineers who authenticate with their tsk_ key
  adminToken: env.TOKEN_SAVER_ADMIN_TOKEN || "",
};
// The proxy reads its config at import time: default to the smart policy and keep its log with the team data.
env.TOKEN_SAVER_PROXY_POLICY ||= "smart";
env.TOKEN_SAVER_PROXY_LOG ||= path.join(TEAM.dir, "proxy-log.jsonl");
const { start, priceUsage } = await import("../proxy/router-proxy.mjs");

const CAP_MODEL = { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" };
const rank = (m = "") => (/haiku/i.test(m) ? 0 : /sonnet/i.test(m) ? 1 : 2);
const family = (m = "") => (/haiku/i.test(m) ? "haiku" : /sonnet/i.test(m) ? "sonnet" : /opus/i.test(m) ? "opus" : /fable|mythos/i.test(m) ? "fable" : "other");
const DAY = 86_400_000;

// What the router did with a request, in words a manager can read.
export function category(reason = "", requested = "", routed = "") {
  if (reason === "blocked") return "Blocked: over limit or disabled";
  if (reason.startsWith("manager cap")) return "Manager model cap";
  if (reason === "fail-open") return "Fail-open (kept requested model)";
  if (reason.startsWith("side request")) return "Side request → Haiku";
  if (reason.startsWith("subagent")) return "Subagent";
  if (reason.startsWith("mid-turn")) return "Mid-turn: kept the turn's model";
  if (/held: context/.test(reason)) return "Held: context too large to switch";
  if (reason.startsWith("turn: simple")) return "Simple turn → Haiku";
  if (reason.startsWith("turn: standard")) return /over budget/.test(reason) ? "Over limit → Sonnet" : "Standard turn → Sonnet";
  if (reason.startsWith("turn: hard")) return "Hard turn → requested model";
  if (reason.startsWith("budget")) return "Over limit → Sonnet";
  if (reason === "not-expensive") return "Cheaper model requested";
  return routed && routed !== requested ? "Rerouted" : "Requested model";
}

export function gatewayHooks(store, team = TEAM) {
  const userOf = (req) => {
    const h = req.headers;
    const bearer = String(h.authorization || "").replace(/^Bearer\s+/i, "");
    const key = h["x-token-saver-key"] || (String(h["x-api-key"] || "").startsWith("tsk_") ? h["x-api-key"] : "") || (bearer.startsWith("tsk_") ? bearer : "");
    return store.byKey(String(key));
  };
  const isAdmin = (req) => {
    const t = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    return team.adminToken && t.length === team.adminToken.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(team.adminToken));
  };
  // Turns: one open turn per engineer and session, closed when the next user message arrives.
  const open = new Map(); // "user|session" -> turn
  const lastHint = new Map(); // user -> number of finished turns when the last hint was given
  const sessionOfKey = (key) => String(key).split("|").slice(1).join("|").split(":")[0];
  const close = (k, corrected) => {
    const t = open.get(k);
    if (!t) return;
    open.delete(k);
    store.recordTurn({ ...t, cost: round(t.cost), corrected: !!corrected });
  };
  const hint = (u, session) => {
    if (u.hints === false) return null;
    const t = open.get(`${u.id}|${session}`);
    const done = store.turns.filter((x) => x.user === u.id).length;
    if (lastHint.has(u.id) && done - lastHint.get(u.id) < HINTS.cooldownTurns) return null;
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    const h = hintFor(t, store.turns.filter((x) => x.ts >= since));
    if (!h) return null;
    t.hinted = h.rule; lastHint.set(u.id, done);
    return h.text;
  };
  return {
    route(req, res) {
      if (req.method === "GET" && req.url.startsWith("/token-saver/hint")) {
        const u = userOf(req);
        if (!u) { send(res, 401, { error: "unknown key" }); return true; }
        const session = new URL(req.url, "http://x").searchParams.get("session") || "";
        send(res, 200, { hint: u.active ? hint(u, session) : null });
        return true;
      }
      return adminRoute(req, res, store, isAdmin);
    },
    onRequest(u, body, info) {
      if (info.counting) return;
      const k = `${u.id}|${sessionOfKey(info.key)}`;
      if (info.boundary && !info.sub && !info.aux) {
        const sig = promptSignals(body, info.tier);
        close(k, sig.correction);
        open.set(k, { ts: new Date().toISOString(), user: u.id, session: sessionOfKey(info.key), ...sig, cost: 0, requests: 0, errors: 0, hinted: false });
        return;
      }
      const t = open.get(k), last = body.messages?.filter((m) => m?.role !== "system").at(-1);
      if (t && Array.isArray(last?.content)) t.errors += last.content.filter((b) => b?.type === "tool_result" && b.is_error).length;
    },
    identify: userOf,
    budget: (u) => ({ spend: store.monthSpend(u.id), limit: store.effectiveLimit(u.id) }),
    gate(u) {
      if (!u.active) return `token-saver: your gateway access is disabled. Ask your manager.`;
      const limit = store.effectiveLimit(u.id), spend = store.monthSpend(u.id);
      if (u.overLimit === "block" && limit > 0 && spend >= limit)
        return `token-saver: monthly budget reached ($${spend.toFixed(2)} of $${limit.toFixed(2)}). Ask your manager for a top-up.`;
      return null;
    },
    adjust(u, d, requested, pin) {
      if (!u.modelCap || rank(d.model) <= rank(CAP_MODEL[u.modelCap])) return d;
      const model = CAP_MODEL[u.modelCap];
      return { ...d, model, tier: u.modelCap === "haiku" ? "simple" : "standard", reason: `manager cap: ${u.modelCap} (${d.reason})`, switched: pin?.model !== model };
    },
    headers(h, req, u) {
      delete h["x-token-saver-key"];
      if (!u) return;
      const own = String(h["x-api-key"] || "").startsWith("tsk_") || /^Bearer\s+tsk_/i.test(String(h.authorization || ""));
      if (own) { delete h.authorization; delete h["x-api-key"]; if (team.apiKey) h["x-api-key"] = team.apiKey; }
    },
    onLog(e) {
      if (!e.user) return;
      const t = open.get(`${e.user}|${sessionOfKey(e.conv)}`);
      if (t && e.status === 200 && e.usage?.model) { t.cost += e.cost || 0; t.requests++; }
      const blocked = e.reason === "blocked";
      if (!blocked && !(e.status === 200 && e.usage?.model)) return;
      const u = e.usage || {};
      store.record({
        ts: new Date().toISOString(), user: e.user, conv: String(e.conv || "").split("|").slice(1).join("|"),
        requested: e.requested, routed: e.routed, model: u.model || e.routed, reason: e.reason, tier: e.tier,
        category: category(e.reason, e.requested, e.routed), status: e.status,
        cost: e.cost || 0, wouldCost: blocked ? 0 : priceUsage(e.requested, u),
        input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0,
      });
    },
  };
}

// ---------- reports ----------
const round = (n) => Math.round(n * 10000) / 10000;
function sum(events) {
  const t = { cost: 0, wouldCost: 0, requests: 0, rerouted: 0, blocked: 0, byModel: {} };
  for (const ev of events) {
    if (ev.reason === "blocked") { t.blocked++; continue; }
    t.requests++; t.cost += ev.cost; t.wouldCost += ev.wouldCost;
    if (ev.routed !== ev.requested) t.rerouted++;
    const m = (t.byModel[family(ev.model)] ||= { cost: 0, requests: 0 });
    m.cost += ev.cost; m.requests++;
  }
  t.saved = Math.max(0, t.wouldCost - t.cost);
  for (const k of ["cost", "wouldCost", "saved"]) t[k] = round(t[k]);
  for (const m of Object.values(t.byModel)) m.cost = round(m.cost);
  return t;
}
function daily(events, days, now) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push({ date: new Date(now - i * DAY).toISOString().slice(0, 10), byModel: {}, cost: 0 });
  const idx = new Map(out.map((d, i) => [d.date, i]));
  for (const ev of events) {
    const d = out[idx.get(ev.ts.slice(0, 10))];
    if (!d || ev.reason === "blocked") continue;
    const f = family(ev.model);
    d.byModel[f] = round((d.byModel[f] || 0) + ev.cost); d.cost = round(d.cost + ev.cost);
  }
  return out;
}
function engineerRow(store, e, periodEvents) {
  const mine = periodEvents.filter((ev) => ev.user === e.id);
  const limit = store.effectiveLimit(e.id), spend = store.monthSpend(e.id);
  const { keyHash, ...pub } = e;
  return {
    ...pub, monthSpend: round(spend), effectiveLimit: round(limit), credits: round(store.credits(e.id)),
    usedPct: limit > 0 ? Math.round((spend / limit) * 100) : null,
    state: !e.active ? "disabled" : limit > 0 && spend >= limit ? (e.overLimit === "block" ? "blocked" : "downgraded") : limit > 0 && spend >= 0.8 * limit ? "near limit" : "ok",
    period: sum(mine), lastSeen: mine.at(-1)?.ts || null,
  };
}
export function overview(store, { days = 30, now = Date.now() } = {}) {
  const since = new Date(now - (days - 1) * DAY).toISOString().slice(0, 10);
  const ev = store.events.filter((x) => x.ts >= since);
  const cats = {}, matrix = {};
  for (const x of ev) {
    const c = (cats[x.category] ||= { requests: 0, cost: 0, wouldCost: 0 });
    c.requests++; c.cost = round(c.cost + (x.cost || 0)); c.wouldCost = round(c.wouldCost + (x.wouldCost || 0));
    if (x.reason !== "blocked") { const k = `${family(x.requested)}→${family(x.model)}`; matrix[k] = (matrix[k] || 0) + 1; }
  }
  const engineers = store.engineers().map((e) => engineerRow(store, e, ev));
  return {
    days, since, monthStart: new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1)).toISOString().slice(0, 10),
    totals: { ...sum(ev), monthSpend: round(engineers.reduce((s, e) => s + e.monthSpend, 0)), monthLimit: round(engineers.reduce((s, e) => s + e.effectiveLimit, 0)) },
    daily: daily(ev, days, now), engineers, routing: { categories: cats, matrix },
    prompts: { turns: store.turns.filter((t) => t.ts >= since).length, patterns: patternStats(store.turns.filter((t) => t.ts >= since)) },
  };
}
export function engineerDetail(store, id, { days = 30, now = Date.now() } = {}) {
  const e = store.get(id);
  if (!e) return null;
  const since = new Date(now - (days - 1) * DAY).toISOString().slice(0, 10);
  const ev = store.events.filter((x) => x.user === id && x.ts >= since);
  const cats = {};
  for (const x of ev) cats[x.category] = (cats[x.category] || 0) + 1;
  return {
    engineer: engineerRow(store, e, ev), daily: daily(ev, days, now), categories: cats,
    conversations: new Set(ev.map((x) => x.conv)).size,
    recent: ev.slice(-60).reverse(), audit: store.audit().filter((a) => a.engineer === id).slice(-40).reverse(),
  };
}

// ---------- admin API + dashboard ----------
const DASHBOARD = path.join(path.dirname(fileURLToPath(import.meta.url)), "dashboard.html");
function send(res, status, data, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(data) : data);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ""; req.on("data", (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("invalid JSON")); } });
  });
}
function adminRoute(req, res, store, isAdmin) {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && (url.pathname === "/admin" || url.pathname === "/admin/")) {
    send(res, 200, fs.readFileSync(DASHBOARD, "utf8"), "text/html; charset=utf-8");
    return true;
  }
  // The single-user proxy's status page would list every engineer's conversations: not on a shared gateway.
  if (url.pathname === "/token-saver/status") { send(res, 404, { error: "use /admin/api/overview" }); return true; }
  if (!url.pathname.startsWith("/admin/api/")) return false;
  if (!isAdmin(req)) { send(res, 401, { error: "admin token required" }); return true; }
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));
  const m = url.pathname.match(/^\/admin\/api\/engineers\/([\w-]+)(\/credit|\/rotate-key)?$/);
  (async () => {
    try {
      if (req.method === "GET" && url.pathname === "/admin/api/overview") return send(res, 200, overview(store, { days }));
      if (req.method === "GET" && url.pathname === "/admin/api/audit") return send(res, 200, store.audit().slice(-200).reverse());
      if (req.method === "POST" && url.pathname === "/admin/api/engineers") {
        const { engineer, key } = store.create(await readJson(req));
        return send(res, 201, { id: engineer.id, key });
      }
      if (m && req.method === "GET" && !m[2]) {
        const d = engineerDetail(store, m[1], { days });
        return d ? send(res, 200, d) : send(res, 404, { error: "no such engineer" });
      }
      if (m && req.method === "PATCH" && !m[2]) { store.update(m[1], await readJson(req)); return send(res, 200, engineerDetail(store, m[1], { days })); }
      if (m && req.method === "POST" && m[2] === "/credit") {
        const b = await readJson(req);
        store.credit(m[1], b.amount, b.note);
        return send(res, 200, engineerDetail(store, m[1], { days }));
      }
      if (m && req.method === "POST" && m[2] === "/rotate-key") return send(res, 200, { key: store.rotateKey(m[1]) });
      send(res, 404, { error: "not found" });
    } catch (e) { send(res, 400, { error: e.message }); }
  })();
  return true;
}

export function startGateway(team = TEAM) {
  const store = openStore(team.dir);
  if (!team.adminToken) {
    team.adminToken = crypto.randomBytes(16).toString("hex");
    console.error(`[token-saver team] no TOKEN_SAVER_ADMIN_TOKEN set; admin token for this run: ${team.adminToken}`);
  }
  const hooks = gatewayHooks(store, team);
  const server = start(team.port, hooks, team.host);
  console.error(`[token-saver team] dashboard: http://${team.host}:${team.port}/admin   data: ${team.dir}`);
  if (!team.apiKey) console.error("  no TOKEN_SAVER_TEAM_API_KEY: engineers must send their own login and pass their gateway key in x-token-saver-key");
  return { server, store };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) startGateway();
