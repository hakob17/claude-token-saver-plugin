// Summarise bench/results/runs.jsonl into a markdown report.
//   node bench/report.mjs [path/to/runs.jsonl]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TASKS } from "./tasks.mjs";

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const usd = (x) => (Number.isFinite(x) ? `$${x.toFixed(3)}` : "–");
const pct = (x) => (Number.isFinite(x) ? `${x > 0 ? "−" : "+"}${Math.abs(x * 100).toFixed(0)}%` : "–");
const tok = (u) =>
  u ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : NaN;

export function summarize(file) {
  const rows = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.cost_usd != null);
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.model}|${r.task}`;
    if (!groups.has(k)) groups.set(k, { baseline: [], plugin: [] });
    groups.get(k)[r.config]?.push(r);
  }

  let md = `# token-saver benchmark results\n\n`;
  md += `Runs: ${rows.length}. Each run = fresh copy of the sample project, \`claude -p\` headless, then an automatic quality check.\n`;
  md += `Savings compare mean cost per task (baseline → plugin). Quality = runs passing the task's check.\n\n`;
  md += `| Model | Task | Runs (base/plugin) | Mean cost base | Mean cost plugin | Saving | Median saving | Input tokens base → plugin | Output tokens base → plugin | Turns base → plugin | Quality base | Quality plugin |\n`;
  md += `|---|---|---|---|---|---|---|---|---|---|---|---|\n`;

  const totals = {};
  for (const [k, g] of [...groups.entries()].sort()) {
    const [model, task] = k.split("|");
    const cb = g.baseline.map((r) => r.cost_usd), cp = g.plugin.map((r) => r.cost_usd);
    const mb = mean(cb), mp = mean(cp);
    const save = (mb - mp) / mb, msave = (median(cb) - median(cp)) / median(cb);
    const ib = mean(g.baseline.map((r) => tok(r.usage))), ip = mean(g.plugin.map((r) => tok(r.usage)));
    const ob = mean(g.baseline.map((r) => r.usage?.output_tokens ?? NaN)), op = mean(g.plugin.map((r) => r.usage?.output_tokens ?? NaN));
    const tb = mean(g.baseline.map((r) => r.turns)), tp = mean(g.plugin.map((r) => r.turns));
    const qb = g.baseline.filter((r) => r.quality_ok).length, qp = g.plugin.filter((r) => r.quality_ok).length;
    md += `| ${model} | ${TASKS[task]?.title ?? task} | ${cb.length}/${cp.length} | ${usd(mb)} | ${usd(mp)} | **${pct(save)}** | ${pct(msave)} | ${Math.round(ib / 1000)}k → ${Math.round(ip / 1000)}k | ${Math.round(ob / 1000 * 10) / 10}k → ${Math.round(op / 1000 * 10) / 10}k | ${tb.toFixed(1)} → ${tp.toFixed(1)} | ${qb}/${g.baseline.length} | ${qp}/${g.plugin.length} |\n`;
    totals[model] ||= { b: [], p: [], qb: 0, qp: 0, nb: 0, np: 0 };
    totals[model].b.push(mb); totals[model].p.push(mp);
    totals[model].qb += qb; totals[model].qp += qp; totals[model].nb += g.baseline.length; totals[model].np += g.plugin.length;
  }

  md += `\n## Overall (mean of per-task means)\n\n| Model | Cost per task base | Cost per task plugin | Saving | Quality base | Quality plugin |\n|---|---|---|---|---|---|\n`;
  for (const [model, t] of Object.entries(totals)) {
    const b = mean(t.b), p = mean(t.p);
    md += `| ${model} | ${usd(b)} | ${usd(p)} | **${pct((b - p) / b)}** | ${t.qb}/${t.nb} | ${t.qp}/${t.np} |\n`;
  }
  md += `\n_Negative saving (+%) means the plugin cost more on that task._\n`;
  return md;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  console.log(summarize(process.argv[2] || path.join(here, "results", "runs.jsonl")));
}
