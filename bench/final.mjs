// Final comparison for the shipped configuration (router off by default):
//   Sonnet: round 1. Opus: round 3 (fix, feature, explain, rename), large feature:
//   round 3 baseline vs round 4 plugin (router off).
import fs from "node:fs";
const load = (f) => fs.readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const r1 = load("bench/results/round1/runs.jsonl").filter((r) => r.model === "sonnet");
const r3 = load("bench/results/round3/runs.jsonl");
const r4 = load("bench/results/round4/runs.jsonl");
const sets = [
  ...["fix", "feature", "explain", "rename"].map((t) => ["sonnet", t, r1.filter((r) => r.task === t && r.config === "baseline"), r1.filter((r) => r.task === t && r.config === "plugin")]),
  ...["fix", "feature", "explain", "rename"].map((t) => ["opus", t, r3.filter((r) => r.task === t && r.config === "baseline"), r3.filter((r) => r.task === t && r.config === "plugin")]),
  ["opus", "bigfeature", r3.filter((r) => r.task === "bigfeature" && r.config === "baseline"), r4.filter((r) => r.task === "bigfeature")],
];
const titles = { fix: "Fix failing tests", feature: "Add refund feature", explain: "Explain payout logic", rename: "Rename across codebase", bigfeature: "Large feature (bonus module)" };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
let md = "| Model | Task | Without plugin | With plugin | Saving | Quality (without / with) | New tests (without / with) |\n|---|---|---|---|---|---|---|\n";
const agg = {};
for (const [model, task, b, p] of sets) {
  const mb = mean(b.map((r) => r.cost_usd)), mp = mean(p.map((r) => r.cost_usd));
  const nt = (rs) => { const v = rs.map((r) => Number((r.quality.match(/\(\+(\d+) new\)/) || [])[1])).filter(Number.isFinite); return v.length ? mean(v).toFixed(0) : "–"; };
  const s = (mb - mp) / mb;
  md += `| ${model} | ${titles[task]} | $${mb.toFixed(3)} | $${mp.toFixed(3)} | **${s >= 0 ? "−" : "+"}${Math.abs(s * 100).toFixed(0)}%** | ${b.filter((r) => r.quality_ok).length}/${b.length} / ${p.filter((r) => r.quality_ok).length}/${p.length} | ${nt(b)} / ${nt(p)} |\n`;
  (agg[model] ||= []).push([mb, mp]);
}
md += "\n| Model | Mean cost per task without | with | Saving |\n|---|---|---|---|\n";
for (const [m, xs] of Object.entries(agg)) {
  const b = mean(xs.map((x) => x[0])), p = mean(xs.map((x) => x[1]));
  md += `| ${m} | $${b.toFixed(3)} | $${p.toFixed(3)} | **${(b - p) / b >= 0 ? "−" : "+"}${Math.abs(((b - p) / b) * 100).toFixed(0)}%** |\n`;
}
console.log(md);
