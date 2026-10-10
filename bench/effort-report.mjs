// Effort-level comparison (no plugin): low vs medium (the default) vs high.
//   node bench/effort-report.mjs
import fs from "node:fs";
const rows = fs.readFileSync("bench/results/effort/runs.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const titles = { fix: "Fix failing tests", feature: "Add refund feature", bigfeature: "Large feature (bonus module)", explain: "Explain payout logic", rename: "Rename across codebase" };
const L = ["low", "medium", "high"];
const pct = (x, base) => { const d = x / base - 1; return d === 0 ? "–" : `${d < 0 ? "−" : "+"}${Math.abs(d * 100).toFixed(0)}%`; };
let md = "| Model | Task | Low | Medium (default) | High | Low vs default | High vs default | Quality L / M / H | New tests L / M / H |\n|---|---|---|---|---|---|---|---|---|\n";
let sum = "| Model | Low | Medium (default) | High | Low vs default | High vs default |\n|---|---|---|---|---|---|\n";
for (const m of ["sonnet", "opus"]) {
  const tot = { low: 0, medium: 0, high: 0 };
  for (const t of Object.keys(titles)) {
    const g = (l) => rows.filter((r) => r.model === m && r.task === t && r.config === `effort-${l}`);
    const c = Object.fromEntries(L.map((l) => [l, mean(g(l).map((r) => r.cost_usd))]));
    L.forEach((l) => (tot[l] += c[l]));
    const q = L.map((l) => `${g(l).filter((r) => r.quality_ok).length}/${g(l).length}`).join(" / ");
    const nt = L.map((l) => { const v = g(l).map((r) => Number((r.quality.match(/\(\+(\d+) new\)/) || [])[1])).filter(Number.isFinite); return v.length ? mean(v).toFixed(0) : "–"; }).join(" / ");
    md += `| ${m} | ${titles[t]} | $${c.low.toFixed(3)} | $${c.medium.toFixed(3)} | $${c.high.toFixed(3)} | **${pct(c.low, c.medium)}** | ${pct(c.high, c.medium)} | ${q} | ${nt} |\n`;
  }
  sum += `| ${m} | $${tot.low.toFixed(3)} | $${tot.medium.toFixed(3)} | $${tot.high.toFixed(3)} | **${pct(tot.low, tot.medium)}** | ${pct(tot.high, tot.medium)} |\n`;
}
console.log(`Cost of all 5 tasks together (mean of 3 runs each):\n\n${sum}\nPer task:\n\n${md}\n${rows.length} runs, $${rows.reduce((s, r) => s + r.cost_usd, 0).toFixed(2)}.`);
