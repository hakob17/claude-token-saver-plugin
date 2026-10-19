// Fills a team data directory with made-up demo data (engineers, 30 days of routed requests,
// a few manager actions) so the dashboard can be tried without real traffic.
//   TOKEN_SAVER_TEAM_DIR=/tmp/ts-team-demo node plugins/token-saver/team/seed-demo.mjs
// Prints the engineers' keys. Never point this at a real team directory.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openStore } from "./store.mjs";
import { category } from "./gateway.mjs";

const dir = process.env.TOKEN_SAVER_TEAM_DIR || path.join(os.tmpdir(), "ts-team-demo");
if (fs.existsSync(path.join(dir, "team.json"))) { console.error(`${dir} already has team data; pick an empty directory`); process.exit(1); }
const store = openStore(dir);

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (w) => { let x = rnd() * w.reduce((s, [, p]) => s + p, 0); for (const [v, p] of w) if ((x -= p) <= 0) return v; return w[0][0]; };
const P = { "claude-opus-5": [5, 25, 0.5], "claude-sonnet-5-5": [2, 10, 0.2], "claude-haiku-5-5": [0.1, 0.5, 0.01] };
const price = (m, u) => { const [i, o, r] = P[m]; return (u.input * i + u.output * o + u.cacheRead * r + u.cacheWrite * i * 1.25) / 1e6; };

// [name, team, monthly limit, over-limit rule, model cap, requests per workday, share of hard turns]
const people = [
  ["Ana Petrosyan", "Payments", 300, "downgrade", null, 70, 0.30],
  ["Ben Ortiz", "Payments", 50, "block", null, 55, 0.25],
  ["Chen Wei", "Platform", 140, "downgrade", null, 95, 0.40],
  ["Dana Kim", "Platform", 200, "downgrade", null, 80, 0.35],
  ["Eli Novak", "Web", 30, "block", null, 40, 0.15],
  ["Farah Haddad", "Web", 0, "downgrade", "sonnet", 50, 0.20],
  ["Gus Lindqvist", "Data", 250, "downgrade", null, 35, 0.45],
  ["Hana Sato", "Data", 100, "downgrade", "haiku", 25, 0.10],
];
const keys = {};
for (const [name, team, monthlyLimit, overLimit, modelCap] of people) {
  const { engineer, key } = store.create({ name, team, monthlyLimit, overLimit, modelCap }, "seed");
  keys[engineer.id] = key;
}
const ids = Object.keys(keys);

const now = Date.now(), DAY = 86_400_000;
const spentMonth = {};
for (let day = 29; day >= 0; day--) {
  const date = new Date(now - day * DAY);
  const weekend = [0, 6].includes(date.getUTCDay());
  ids.forEach((id, k) => {
    const [, , limit, mode, cap, perDay, hardShare] = people[k];
    const n = Math.round(perDay * (weekend ? 0.1 : 0.7 + rnd() * 0.6));
    const sameMonth = date.getUTCMonth() === new Date(now).getUTCMonth();
    for (let j = 0; j < n; j++) {
      const ts = new Date(Math.min(now - 60_000, Math.floor(date.getTime() / DAY) * DAY + (6 + rnd() * 10) * 3_600_000)).toISOString();
      const conv = `s${day}-${k}-${Math.floor(j / 12)}`;
      const over = sameMonth && limit > 0 && (spentMonth[id] || 0) >= limit;
      if (over && mode === "block") {
        if (rnd() < 0.15) store.record({ ts, user: id, conv, requested: "claude-opus-5", routed: null, model: null, reason: "blocked", category: category("blocked"), status: 403, cost: 0, wouldCost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
        continue;
      }
      const kind = pick([["mid", 0.62], ["hard", hardShare * 0.2], ["standard", 0.12], ["simple", 0.06], ["side", 0.06], ["sub", 0.03], ["held", 0.01]]);
      let model = { hard: "claude-opus-5", standard: "claude-sonnet-5-5", simple: "claude-haiku-5-5", side: "claude-haiku-5-5", sub: "claude-sonnet-5-5", held: "claude-opus-5" }[kind]
        || (rnd() < hardShare + 0.15 ? "claude-opus-5" : rnd() < 0.85 ? "claude-sonnet-5-5" : "claude-haiku-5-5");
      let reason = { hard: "turn: hard (score 5)", standard: "turn: standard (score 2) switch", simple: "turn: simple (score -4) switch", side: "side request (no tools)", sub: "subagent", held: "turn: standard (score 1) held: context 62k too large to re-cache" }[kind] || "mid-turn: keep the turn's model";
      if (over && model === "claude-opus-5") { model = "claude-sonnet-5-5"; reason = "turn: standard (score 5) switch; over budget: hard capped to standard"; }
      if (cap === "sonnet" && model === "claude-opus-5") { model = "claude-sonnet-5-5"; reason = `manager cap: sonnet (${reason})`; }
      if (cap === "haiku" && model !== "claude-haiku-5-5") { model = "claude-haiku-5-5"; reason = `manager cap: haiku (${reason})`; }
      const u = kind === "side" || kind === "simple"
        ? { input: 2000 + rnd() * 3000, output: 150 + rnd() * 600, cacheRead: rnd() * 20000, cacheWrite: kind === "simple" ? 30000 + rnd() * 40000 : 0 }
        : { input: 50 + rnd() * 400, output: 300 + rnd() * 3500, cacheRead: 20000 + rnd() * 110000, cacheWrite: rnd() < 0.12 ? 20000 + rnd() * 60000 : 1000 + rnd() * 6000 };
      for (const f in u) u[f] = Math.round(u[f]);
      const cost = price(model, u), wouldCost = price("claude-opus-5", u);
      if (sameMonth) spentMonth[id] = (spentMonth[id] || 0) + cost;
      store.record({ ts, user: id, conv, requested: "claude-opus-5", routed: model, model, reason, tier: kind, category: category(reason, "claude-opus-5", model), status: 200, cost, wouldCost, ...u });
    }
  });
}
store.credit("ben-ortiz", 50, "release week", "seed");
store.update("dana-kim", { monthlyLimit: 80, note: "lowered after a runaway agent loop" }, "seed");
store.update("hana-sato", { modelCap: "haiku", note: "docs and data questions only" }, "seed");
store.events.sort((a, b) => a.ts.localeCompare(b.ts));
// Turns (prompt shape + cost): one per conversation; costlier turns are more likely to miss a pattern.
const convs = new Map();
for (const e of store.events) if (e.reason !== "blocked") { const k = `${e.user}|${e.conv}`; const c = convs.get(k) || { ts: e.ts, user: e.user, session: e.conv, cost: 0, requests: 0 }; c.cost += e.cost; c.requests++; convs.set(k, c); }
const turnLines = [];
for (const c of convs.values()) {
  const q = c.requests < 3, p = Math.min(0.8, c.cost / 6);
  const t = { ...c, cost: Math.round(c.cost * 10000) / 10000, len: q ? 40 + Math.round(rnd() * 80) : 60 + Math.round(rnd() * 900), tier: q ? "simple" : rnd() < 0.3 ? "hard" : "standard",
    files: rnd() > p, symbols: rnd() > p + 0.2, check: rnd() > p + 0.1, vague: rnd() < p * 0.4, broad: rnd() < p * 0.35, correction: rnd() < 0.08, question: q, errors: Math.round(rnd() * p * 5), hinted: false };
  turnLines.push(t);
}
fs.writeFileSync(path.join(dir, "turns.jsonl"), turnLines.map((t) => JSON.stringify(t)).join("\n") + "\n");
fs.writeFileSync(path.join(dir, "usage.jsonl"), store.events.map((e) => JSON.stringify(e)).join("\n") + "\n");
console.log(`demo team written to ${dir}: ${ids.length} engineers, ${store.events.length} requests`);
console.log(JSON.stringify(keys, null, 2));
