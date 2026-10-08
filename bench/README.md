# Benchmark

A/B test of Claude Code **without** vs **with** the `token-saver` plugin on a sample wallet/betting backend (plain Node, no dependencies).

Each run gets a fresh copy of the project, runs `claude -p` headless, then an automatic quality check, so a cheaper run that breaks things doesn't count as a win.

| Task | Check |
|---|---|
| `fix` — fix failing tests | all tests pass, tests untouched |
| `feature` — refund feature + API + tests | all tests pass, new tests added, refund in service and API |
| `explain` — where/how payout is computed | names the function and the rounding mode, no files changed |
| `rename` — `userId` → `accountId` across src/test | all tests pass, no `userId` left |

The project includes a ~190 KB legacy module, a 450 KB data fixture, a 1.3 MB log and a verbose test run, so there's waste to avoid.

## Run it

```bash
node bench/run.mjs --models sonnet --runs 3 --parallel 4 --budget 15
node bench/run.mjs --models opus   --runs 3 --parallel 4 --budget 12
node bench/report.mjs              # re-summarise bench/results/runs.jsonl
```

Runs bill the account the `claude` CLI is signed into; `--budget` caps total spend and `--run-budget` each run.

## Results so far

See [`results/summary.md`](results/summary.md). Sonnet, 24 runs: **no meaningful difference** (≈ $0.064 per task either way, 24/24 quality passes). This Claude Code version already reads files selectively and trims test output, so the guards rarely fire. Not yet measured: Opus (the router) and long multi-request sessions (context warnings, handoff/resume).
