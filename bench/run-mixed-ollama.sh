#!/bin/sh
# Smart router with the local Ollama classifier (qwen2.5:1.5b), 3 rounds of the mixed session.
# Compare with bench/results/mixed-2026-10-x3 (same task, heuristic classifier and no plugin).
# Needs `ollama serve` with the model pulled. Bills the account the `claude` CLI is signed into.
TOKEN_SAVER_CLASSIFIER=ollama TOKEN_SAVER_OLLAMA_MODEL="${TOKEN_SAVER_OLLAMA_MODEL:-qwen2.5:1.5b}" \
node bench/run.mjs --models opus --tasks mixed --runs 3 --parallel 2 --configs plugin+smart \
  --budget 60 --run-budget 15 ${RESUME_ROOT:+--resume-root "$RESUME_ROOT"} \
  --out bench/results/mixed-2026-11-ollama 2>&1 | tee -a bench/results/mixed-2026-11-ollama.log
