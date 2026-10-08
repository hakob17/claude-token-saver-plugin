#!/usr/bin/env node
// Claude Code status line: model · session cost · context size (with warnings).
import fs from "node:fs";

let input = {};
try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch {}

const model = input.model?.display_name || "?";
const cost = Number(input.cost?.total_cost_usd || 0);

function contextTokens(p) {
  if (!p || !fs.existsSync(p)) return 0;
  try {
    const st = fs.statSync(p);
    const len = Math.min(st.size, 2_000_000);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(p, "r");
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    const lines = buf.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"usage"')) continue;
      try {
        const o = JSON.parse(lines[i]);
        const u = o?.message?.usage;
        if (u && !o.isSidechain)
          return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      } catch {}
    }
  } catch {}
  return 0;
}

const ctx = contextTokens(input.transcript_path);
const k = Math.round(ctx / 1000);
const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`;

let ctxPart = `ctx ${k}k`;
if (ctx >= 150_000) ctxPart = c("31", `ctx ${k}k ⚠ /handoff + /clear`);
else if (ctx >= 80_000) ctxPart = c("33", `ctx ${k}k · consider /compact`);
else ctxPart = c("32", ctxPart);

let costPart = `$${cost.toFixed(2)}`;
if (cost >= 5) costPart = c("31", costPart);
else if (cost >= 2) costPart = c("33", costPart);

const modelPart = /opus|fable|mythos/i.test(model) ? c("35", `${model} $$$`) : model;

process.stdout.write(`[${modelPart}] ${costPart} · ${ctxPart}`);
