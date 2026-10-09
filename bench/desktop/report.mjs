// Summarise bench/desktop/results/runs.jsonl.   node bench/desktop/report.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SINGLE, CONVERSATION } from "./scenarios.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rows = fs.readFileSync(process.argv[2] || path.join(here, "results", "runs.jsonl"), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const usd = (x) => `$${x.toFixed(3)}`;
const pct = (b, p) => { const s = (b - p) / b; return `${s >= 0 ? "−" : "+"}${Math.abs(s * 100).toFixed(0)}%`; };
const words = (r) => Number((r.detail.match(/words:(\d+)/) || [])[1]);
const pick = (f) => rows.filter(f);

let md = `# token-saver-desktop benchmark results\n\n`;
md += `Headless Claude Code (\`claude -p\`) with vs without the desktop plugin, 3 runs per cell. Quality checks look for the facts the user asked for.\n\n`;
md += `## Single messages\n\n| Model | Task | Cost without | Cost with | Change | Answer words without → with | Quality without / with |\n|---|---|---|---|---|---|---|\n`;
const overall = {};
for (const model of ["sonnet", "opus"])
  for (const task of Object.keys(SINGLE)) {
    const b = pick((r) => r.kind === "single" && r.model === model && r.task === task && r.config === "baseline");
    const p = pick((r) => r.kind === "single" && r.model === model && r.task === task && r.config === "plugin");
    if (!b.length || !p.length) continue;
    const cb = mean(b.map((r) => r.cost)), cp = mean(p.map((r) => r.cost));
    (overall[model] ||= []).push([cb, cp]);
    md += `| ${model} | ${SINGLE[task].title} | ${usd(cb)} | ${usd(cp)} | **${pct(cb, cp)}** | ${Math.round(mean(b.map(words)))} → ${Math.round(mean(p.map(words)))} | ${b.filter((r) => r.ok).length}/${b.length} / ${p.filter((r) => r.ok).length}/${p.length} |\n`;
  }
for (const [m, xs] of Object.entries(overall)) {
  const b = mean(xs.map((x) => x[0])), p = mean(xs.map((x) => x[1]));
  md += `| ${m} | **Mean** | ${usd(b)} | ${usd(p)} | **${pct(b, p)}** | | |\n`;
}

md += `\n## ${CONVERSATION.turns.length}-message conversation (handoff after message ${CONVERSATION.handoffAfter})\n\n`;
md += `| Model | Setup | Whole conversation | Messages ${CONVERSATION.handoffAfter + 1}–${CONVERSATION.turns.length} (incl. handoff) | vs without plugin | Checks passed |\n|---|---|---|---|---|---|\n`;
for (const model of ["sonnet", "opus"]) {
  const base = pick((r) => r.kind === "conversation" && r.model === model && r.config === "baseline");
  if (!base.length) continue;
  const bc = mean(base.map((r) => r.cost));
  for (const [config, label] of [["baseline", "Without plugin"], ["plugin", "With plugin"], ["plugin-handoff", "With plugin + /handoff → /resume"]]) {
    const rs = pick((r) => r.kind === "conversation" && r.model === model && r.config === config);
    if (!rs.length) continue;
    const c = mean(rs.map((r) => r.cost)), late = mean(rs.map((r) => r.cost_after_handoff_point));
    const checks = rs.map((r) => r.detail.match(/(\d+)\/(\d+)/)).reduce((a, m) => [a[0] + +m[1], a[1] + +m[2]], [0, 0]);
    md += `| ${model} | ${label} | ${usd(c)} | ${usd(late)} | ${config === "baseline" ? "–" : `**${pct(bc, c)}**`} | ${checks[0]}/${checks[1]} |\n`;
  }
}
const spend = rows.reduce((s, r) => s + (r.cost || 0), 0);
md += `\nRuns: ${rows.length}. Total spend: $${spend.toFixed(2)}.\n`;
console.log(md);
