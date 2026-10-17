#!/bin/sh
# Smart router re-run with tuned context clearing (trigger 150k, clear_at_least 60k).
# Same mixed session and grading as bench/run-mixed-2026-10.sh. Bills the signed-in claude CLI.
node bench/run.mjs --models opus --tasks mixed --runs 1 --parallel 1 --configs plugin+smart \
  --budget 400 --run-budget 40 ${RESUME_ROOT:+--resume-root "$RESUME_ROOT"} \
  --out bench/results/mixed-2026-10-tuned 2>&1 | tee -a bench/results/mixed-2026-10-tuned.log
