#!/bin/sh
# Webshop, proxy variants with the budget scaled to the app's size ($3 instead of $8),
# so the Opus -> Sonnet 5.5 failover triggers mid-build. Same plan, prompts and checks.
# Bills the account the `claude` CLI is signed into. Run from the repo root.
node bench/run.mjs --models opus --tasks webshop --runs 1 --parallel 2 \
  --configs plugin+proxy,plugin+proxy+effort-low \
  --budget 400 --run-budget 40 --proxy-budget 3 ${RESUME_ROOT:+--resume-root "$RESUME_ROOT"} \
  --out bench/results/webshop-2026-10-budget3 2>&1 | tee -a bench/results/webshop-2026-10-budget3.log
