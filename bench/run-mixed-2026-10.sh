#!/bin/sh
# Smart-router benchmark: the coffee shop plan as a mixed session (3 build turns with 4 simple
# questions in between), Opus main model. Setups: no plugin, plugin, plugin + smart router
# (per-turn complexity routing + tool-result clearing, no budget failover).
# Graded by bench/webshop-check.mjs. Bills the account the `claude` CLI is signed into.
node bench/run.mjs --models opus --tasks mixed --runs 1 --parallel 2 \
  --configs baseline,plugin,plugin+smart \
  --budget 400 --run-budget 40 ${RESUME_ROOT:+--resume-root "$RESUME_ROOT"} \
  --out bench/results/mixed-2026-10 2>&1 | tee -a bench/results/mixed-2026-10.log
