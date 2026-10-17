// Summarises the router benchmark: one full native iOS app build per router setup.
//   node bench/router-report.mjs [bench/results/router-homeplanner-2026-10/runs.jsonl]
import fs from "node:fs";

const file = process.argv[2] || "bench/results/router-homeplanner-2026-10/runs.jsonl";
const runs = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const order = ["baseline", "plugin", "plugin+router", "plugin+proxy", "plugin+proxy-v1"];
const label = {
  baseline: "No plugin",
  plugin: "Plugin (router off, default)",
  "plugin+router": "Plugin + hook router",
  "plugin+proxy": "Plugin + routing proxy",
  "plugin+proxy-v1": "Plugin + routing proxy, v1 (conversation-tracking bug)",
};
runs.sort((a, b) => order.indexOf(a.config) - order.indexOf(b.config));
const ref = runs.find((r) => r.config === "baseline")?.true_cost_usd;
const pct = (v) => (ref && v === ref ? "—" : ref ? `${v >= ref ? "+" : "−"}${Math.abs(Math.round((v / ref - 1) * 100))}%` : "");
const num = (re, s) => Number((String(s).match(re) || [])[1] || 0);

const rows = runs.map((r) => {
  const opus = Object.entries(r.proxy?.by_model || r.transcript?.by_model || {})
    .filter(([m]) => /opus/.test(m)).reduce((n, [, v]) => n + v.cost, 0);
  const share = r.true_cost_usd ? Math.round((opus / r.true_cost_usd) * 100) : 0;
  return `| ${label[r.config] || r.config} | ${r.quality_ok ? "✅" : "❌"} | **$${r.true_cost_usd.toFixed(2)}** | ${pct(r.true_cost_usd)} | ${r.turns} | ${num(/swift lines:(\d+)/, r.quality)} | ${num(/test files:(\d+)/, r.quality)} | ${share}% |`;
});

const proxy = runs.find((r) => r.config === "plugin+proxy");
const v1 = runs.find((r) => r.config === "plugin+proxy-v1");
const p = proxy?.proxy;
console.log(`Task: build a native iOS (SwiftUI) home planner from an empty repo in 3 user turns of one session: (1) drawing canvas, geometry and plan JSON, (2) furniture and garden catalogue, (3) an AI assistant calling the Anthropic API, then ready to install. Main model Opus (\`claude-opus-5\`), 1 run per setup, Claude Code 2.1.228, Xcode 27. A run passes when \`xcodebuild test\` passes, the app installs and launches on the iOS 27 simulator, and the canvas, garden, catalogue and LLM-client code is present with no real API key committed.

| Setup | Quality | Cost (API-equivalent) | vs no plugin | Turns | Swift lines | Test files | Opus share of cost |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}
`);
if (p) console.log(`Routing proxy details: ${p.rewritten} of ${Object.values(p.by_model).reduce((n, v) => n + v.requests, 0)} requests went to Sonnet 5.5, ${p.held} were held on Opus mid-turn, ${p.switched} switch at a turn boundary, ${p.fail_open} fail-open retries. Claude Code reported $${proxy.cost_usd.toFixed(2)} (priced as Opus); the true cost from the proxy log is $${proxy.true_cost_usd.toFixed(2)}.`);
if (v1) console.log(`\nThe v1 run (before the fix) switched once, then lost track of the conversation and went back to Opus: ${v1.proxy.rewritten} of ${Object.values(v1.proxy.by_model).reduce((n, v) => n + v.requests, 0)} requests on Sonnet, $${v1.true_cost_usd.toFixed(2)} in total.`);
