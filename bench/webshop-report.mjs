// Summarises the webshop round: one coffee shop website + backend + admin per setup, from a fixed plan.
//   node bench/webshop-report.mjs [bench/results/webshop-2026-10/runs.jsonl]
import fs from "node:fs";

const file = process.argv[2] || "bench/results/webshop-2026-10/runs.jsonl";
const runs = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const order = ["baseline", "plugin", "plugin+router", "plugin+proxy", "plugin+proxy+effort-low"];
const label = {
  baseline: "No plugin",
  plugin: "Plugin (router off, default)",
  "plugin+router": "Plugin + hook router",
  "plugin+proxy": "Plugin + routing proxy ($8 budget)",
  "plugin+proxy+effort-low": "Plugin + routing proxy + low effort",
};
runs.sort((a, b) => order.indexOf(a.config) - order.indexOf(b.config));
const ref = runs.find((r) => r.config === "baseline")?.true_cost_usd;
const pct = (v) => (v === ref ? "—" : `${v >= ref ? "+" : "−"}${Math.abs(Math.round((v / ref - 1) * 100))}%`);
const acc = (q) => (String(q).match(/acceptance (\d+\/\d+)/) || [])[1] || "?";
const out = (r) => Object.values(r.transcript?.by_model || {}).reduce((n, v) => n + (v.output_tokens || 0), 0);

console.log(`Task: build "Brew & Bean", a coffee brewing website and shop, from an empty repo containing only a fixed product plan ([webshop-PLAN.md](fixture/webshop-PLAN.md)): landing page with brewing guides, shop with cart and checkout, admin panel, and a Node.js backend with an exact API contract. 3 user turns in one session (backend and public API; landing page and shop; admin panel and a final pass over the plan). Every variant got the identical plan and prompts. Main model Opus (\`claude-opus-5\`), 1 run per setup.

Graded by a black-box acceptance test the builds never see ([webshop-check.mjs](webshop-check.mjs)): 37 checks covering the API contract (validation, stock, cancellation), the four pages, admin auth, and data persisting across a restart, plus the build's own \`npm test\`.

| Setup | Acceptance | npm test | Cost (API-equivalent) | vs no plugin | Turns | Output tokens |
|---|---|---|---|---|---|---|
${runs.map((r) => `| ${label[r.config] || r.config} | ${acc(r.quality)} ${r.quality_ok ? "✅" : "❌"} | ${/npm test:true/.test(r.quality) ? "✅" : "❌"} | **$${r.true_cost_usd.toFixed(2)}** | ${pct(r.true_cost_usd)} | ${r.turns} | ${Math.round(out(r) / 1000)}k |`).join("\n")}
`);
for (const r of runs.filter((x) => x.proxy)) {
  const p = r.proxy, n = Object.values(p.by_model).reduce((s, v) => s + v.requests, 0);
  console.log(`- ${label[r.config]}: ${p.rewritten} of ${n} requests went to Sonnet 5.5, ${p.held} held on Opus mid-turn, ${p.switched} switches.`);
}
