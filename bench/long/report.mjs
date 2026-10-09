// Summarise bench/long/results/runs.jsonl.   node bench/long/report.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const rows = fs.readFileSync(process.argv[2] || path.join(here, "results", "runs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const labels = {
  baseline: "Without plugin",
  plugin: "With plugin",
  "plugin-handoff": "With plugin + handoff at 80k (shipped threshold)",
  "plugin-handoff50": "With plugin + handoff at 50k (experiment)",
};
let md = "| Model | Setup | Runs | Cost per session | vs without plugin | Handoffs | Peak context | Tests added | Changelog lines | Quality passed |\n|---|---|---|---|---|---|---|---|---|---|\n";
for (const model of ["sonnet", "opus"]) {
  const base = rows.filter((r) => r.model === model && r.config === "baseline");
  if (!base.length) continue;
  const bc = mean(base.map((r) => r.cost));
  for (const config of Object.keys(labels)) {
    const rs = rows.filter((r) => r.model === model && r.config === config);
    if (!rs.length) continue;
    const c = mean(rs.map((r) => r.cost)), s = (bc - c) / bc;
    const tests = mean(rs.map((r) => Number(r.detail.match(/tests (\d+)/)[1]) - 238));
    const cl = mean(rs.map((r) => Number(r.detail.match(/changelog lines (\d+)/)[1])));
    const peak = mean(rs.map((r) => Math.max(...r.steps.map((x) => x.ctx))));
    md += `| ${model} | ${labels[config]} | ${rs.length} | $${c.toFixed(3)} | ${config === "baseline" ? "–" : `**${s >= 0 ? "−" : "+"}${Math.abs(s * 100).toFixed(0)}%**`} | ${mean(rs.map((r) => r.handoffs)).toFixed(1)} | ${Math.round(peak / 1000)}k | ${tests.toFixed(0)} | ${cl.toFixed(0)} | ${rs.filter((r) => r.ok).length}/${rs.length} |\n`;
  }
}
const spend = rows.reduce((s, r) => s + r.cost, 0);
md += `\n${rows.length} sessions of 19 requests each, total spend $${spend.toFixed(2)}.\n`;
console.log(md);
