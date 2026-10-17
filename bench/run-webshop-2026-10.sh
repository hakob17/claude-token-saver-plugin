#!/bin/sh
# Webshop round: one coffee shop website + backend + admin per setup, all from the same fixed plan
# (bench/fixture/webshop-PLAN.md), 3 user turns, Opus main model. Graded by bench/webshop-check.mjs
# (37 black-box checks + the build's own npm test). Bills the account the `claude` CLI is signed into.
# Stops by itself if the plan's usage limit is hit; re-run with RESUME_ROOT=<work dir> to continue in place.
node bench/run.mjs --models opus --tasks webshop --runs 1 --parallel 2 \
  --configs baseline,plugin,plugin+router,plugin+proxy,plugin+proxy+effort-low \
  --budget 400 --run-budget 40 --proxy-budget 8 ${RESUME_ROOT:+--resume-root "$RESUME_ROOT"} \
  --out bench/results/webshop-2026-10 2>&1 | tee -a bench/results/webshop-2026-10.log
