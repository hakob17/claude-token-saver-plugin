// Total cost comparison across every benchmark cell, shipped configuration only
// (Claude Code router off by default; desktop plugin as released).
//   node bench/totals.mjs
import fs from "node:fs";
const load = (f) => fs.readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const r1 = load("bench/results/round1/runs.jsonl"), r3 = load("bench/results/round3/runs.jsonl"), r4 = load("bench/results/round4/runs.jsonl");
const desk = load("bench/desktop/results/runs.jsonl");
const long = load("bench/long/results/runs.jsonl");

// [plugin, model, label, baselineRuns, pluginRuns]
const groups = [
  ["token-saver (Claude Code)", "sonnet", "4 coding tasks",
    r1.filter((r) => r.model === "sonnet" && r.config === "baseline"), r1.filter((r) => r.model === "sonnet" && r.config === "plugin")],
  ["token-saver (Claude Code)", "opus", "5 coding tasks",
    r3.filter((r) => r.config === "baseline"),
    [...r3.filter((r) => r.config === "plugin" && r.task !== "bigfeature"), ...r4.filter((r) => r.task === "bigfeature")]],
  ["token-saver (Claude Code)", "sonnet", "19-request session",
    long.filter((r) => r.model === "sonnet" && r.config === "baseline"), long.filter((r) => r.model === "sonnet" && r.config === "plugin")],
  ["token-saver (Claude Code)", "opus", "19-request session",
    long.filter((r) => r.model === "opus" && r.config === "baseline"), long.filter((r) => r.model === "opus" && r.config === "plugin")],
  ["token-saver-desktop", "sonnet", "3 chat tasks + 9-message conversation",
    desk.filter((r) => r.model === "sonnet" && r.config === "baseline"), desk.filter((r) => r.model === "sonnet" && r.config === "plugin")],
  ["token-saver-desktop", "opus", "3 chat tasks + 9-message conversation",
    desk.filter((r) => r.model === "opus" && r.config === "baseline"), desk.filter((r) => r.model === "opus" && r.config === "plugin")],
];
const cost = (r) => r.cost_usd ?? r.cost ?? 0;
const sum = (rs) => rs.reduce((s, r) => s + cost(r), 0);
const money = (x) => `${x < 0 ? "−" : ""}$${Math.abs(x).toFixed(2)}`;
const pct = (b, p) => { const s = (b - p) / b; return `${s >= 0 ? "−" : "+"}${Math.abs(s * 100).toFixed(1)}%`; };

let md = "| Plugin | Model | Work | Runs per side | Total without plugin | Total with plugin | Saved | Change | Quality passed (without / with) |\n|---|---|---|---|---|---|---|---|---|\n";
const T = { b: 0, p: 0, byModel: {} };
for (const [plugin, model, label, b, p] of groups) {
  const sb = sum(b), sp = sum(p);
  T.b += sb; T.p += sp;
  (T.byModel[model] ||= { b: 0, p: 0 }); T.byModel[model].b += sb; T.byModel[model].p += sp;
  const ok = (rs) => rs.filter((r) => r.quality_ok ?? r.ok).length;
  md += `| ${plugin} | ${model} | ${label} | ${b.length} / ${p.length} | $${sb.toFixed(2)} | $${sp.toFixed(2)} | ${sb - sp < 0 ? "−" : ""}$${Math.abs(sb - sp).toFixed(2)} | **${pct(sb, sp)}** | ${ok(b)}/${b.length} / ${ok(p)}/${p.length} |\n`;
}
for (const [m, t] of Object.entries(T.byModel))
  md += `| **All** | **${m}** | | | **$${t.b.toFixed(2)}** | **$${t.p.toFixed(2)}** | **${money(t.b - t.p)}** | **${pct(t.b, t.p)}** | |\n`;
md += `| **All** | **both** | | | **$${T.b.toFixed(2)}** | **$${T.p.toFixed(2)}** | **${money(T.b - T.p)}** | **${pct(T.b, T.p)}** | |\n`;
console.log(md);
