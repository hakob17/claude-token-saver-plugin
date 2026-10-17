#!/bin/sh
# Smart router, 3 rounds: no plugin vs plugin + smart router on the mixed session, with the fixed
# defaults (no escalation on plain questions, tool-result clearing off). Interleaved, 2 at a time.
# Bills the account the `claude` CLI is signed into. Resume with RESUME_ROOT=<work dir>.
node bench/run.mjs --models opus --tasks mixed --runs 3 --parallel 2 --configs baseline,plugin+smart \
  --budget 400 --run-budget 40 ${RESUME_ROOT:+--resume-root "$RESUME_ROOT"} \
  --out bench/results/mixed-2026-10-x3 2>&1 | tee -a bench/results/mixed-2026-10-x3.log
