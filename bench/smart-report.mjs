// Summarises the smart-router benchmark: the coffee shop plan as one mixed session
// (3 build turns + 4 questions), no plugin vs plugin vs plugin + smart router.
//   node bench/smart-report.mjs
import fs from "node:fs";

const load = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const main = load("bench/results/mixed-2026-10/runs.jsonl");
const tuned = load("bench/results/mixed-2026-10-tuned/runs.jsonl").map((r) => ({ ...r, config: r.config + "@tuned" }));
const runs = [...main, ...tuned];
const label = {
  baseline: "No plugin",
  plugin: "Plugin (router off, default)",
  "plugin+smart": "Plugin + smart router, run 1",
  "plugin+smart@tuned": "Plugin + smart router, run 2",
};
const ref = runs.find((r) => r.config === "baseline")?.true_cost_usd;
const pct = (v) => (v === ref ? "—" : `${v >= ref ? "+" : "−"}${Math.abs(Math.round((v / ref - 1) * 100))}%`);
const acc = (q) => (String(q).match(/acceptance (\d+\/\d+)/) || [])[1] || "?";

console.log(`Task: the coffee shop plan ([webshop-PLAN.md](fixture/webshop-PLAN.md)) as one realistic mixed session: the three build turns of the webshop round with four simple questions in between ("what does POST /api/orders return when stock runs out?", "how is the cart stored?", "where is the admin password configured?", "list the npm scripts"). Main model Opus (\`claude-opus-5\`), 1 run per setup, graded by the same 37-check acceptance test plus the build's own \`npm test\`.

| Setup | Acceptance | Cost (API-equivalent) | vs no plugin | Claude Code's own figure |
|---|---|---|---|---|
${runs.map((r) => `| ${label[r.config] || r.config} | ${acc(r.quality)} ${r.quality_ok ? "✅" : "❌"} | **$${r.true_cost_usd.toFixed(2)}** | ${pct(r.true_cost_usd)} | $${(r.cost_usd || 0).toFixed(2)} |`).join("\n")}
`);

// Per-turn routing from the proxy logs (copied next to each run's results).
const names = ["Build backend + public API", "Question: orders when out of stock", "Build landing page + shop", "Question: cart storage", "Build admin panel + final pass", "Question: admin password", "Question: npm scripts"];
function perTurn(file) {
  const L = load(file).filter((e) => e.requested && !/side request/.test(e.reason || ""));
  const turns = [];
  for (const e of L) {
    if (/^turn:/.test(e.reason || "")) turns.push({ model: (e.usage?.model || e.routed).replace("claude-", ""), reason: e.reason, n: 0, c: 0, big: 0 });
    const t = turns.at(-1);
    if (!t) continue;
    t.n++; t.c += e.cost || 0;
    if ((e.usage?.cache_creation_input_tokens || 0) > 40000) t.big++;
  }
  return turns;
}
const a = perTurn("bench/results/mixed-2026-10/plugin+smart-proxy-log.jsonl");
const b = perTurn("bench/results/mixed-2026-10-tuned/plugin+smart-proxy-log.jsonl");
const cell = (t) => (t ? `${t.model}, ${t.n} req, $${t.c.toFixed(2)}${t.big ? `, ${t.big} cache rebuild${t.big > 1 ? "s" : ""}` : ""}` : "—");
console.log(`Per-turn routing of the smart router ("cache rebuild" = a request that rewrote more than 40k tokens of cache):

| Turn | Run 1 | Run 2 |
|---|---|---|
${names.map((n, i) => `| ${i + 1}. ${n} | ${cell(a[i])} | ${cell(b[i])} |`).join("\n")}
`);
