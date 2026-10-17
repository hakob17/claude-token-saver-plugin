#!/bin/sh
# Router benchmark: one full native iOS app build (3 user turns, Opus main model) per
# router setup. Bills the account the `claude` CLI is signed into. Run from the repo root.
#   baseline       no plugin
#   plugin         token-saver plugin, router off (default install)
#   plugin+router  plugin + hook router (TOKEN_SAVER_ROUTER=on)
#   plugin+proxy   plugin + routing proxy: subagents -> Sonnet 5.5, budget failover to Sonnet 5.5 at $8
# Interrupted? Re-run with RESUME_ROOT=<work dir printed at start> to continue in place.
node bench/run.mjs --models opus --tasks homeplanner --runs 1 --parallel 2 \
  --configs baseline,plugin,plugin+router,plugin+proxy \
  --budget 400 --run-budget 40 --proxy-budget 8 ${RESUME_ROOT:+--resume-root "$RESUME_ROOT"} \
  --out bench/results/router-homeplanner-2026-10 2>&1 | tee -a bench/results/router-homeplanner-2026-10.log
