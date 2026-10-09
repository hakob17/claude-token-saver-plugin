# Benchmark

A/B test of Claude Code **without** vs **with** the `token-saver` plugin on a sample wallet/betting backend (plain Node, no dependencies).

Each run gets a fresh copy of the project, runs `claude -p` headless, then an automatic quality check, so a cheaper run that breaks things doesn't count as a win.

| Task | Check |
|---|---|
| `fix` — fix failing tests | all tests pass, tests untouched |
| `feature` — refund feature + API + tests | all tests pass, new tests added, refund in service and API |
| `bigfeature` — bonus/wagering module (~300 lines + tests) | all tests pass, ≥8 new tests, src/bonus, API routes, bets integration |
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

## Results (shipped configuration)

Sonnet 5.5 and Opus 5.5, 3 runs per task and configuration, Claude Code 2.1.294. Total spend for all rounds: ≈ $16.8.

| Model | Task | Without plugin | With plugin | Saving | Quality (without / with) | New tests (without / with) |
|---|---|---|---|---|---|---|
| sonnet | Fix failing tests | $0.061 | $0.072 | **+18%** | 3/3 / 3/3 | – / – |
| sonnet | Add refund feature | $0.091 | $0.084 | **−7%** | 3/3 / 3/3 | 6 / 5 |
| sonnet | Explain payout logic | $0.051 | $0.057 | **+12%** | 3/3 / 3/3 | – / – |
| sonnet | Rename across codebase | $0.051 | $0.044 | **−13%** | 3/3 / 3/3 | – / – |
| opus | Fix failing tests | $0.124 | $0.121 | **−2%** | 3/3 / 3/3 | – / – |
| opus | Add refund feature | $0.225 | $0.185 | **−18%** | 3/3 / 3/3 | 7 / 7 |
| opus | Explain payout logic | $0.141 | $0.115 | **−19%** | 3/3 / 3/3 | – / – |
| opus | Rename across codebase | $0.136 | $0.121 | **−11%** | 3/3 / 3/3 | – / – |
| opus | Large feature (bonus module) | $0.450 | $0.385 | **−14%** | 3/3 / 3/3 | 36 / 28 |

| Model | Mean cost per task without | with | Saving |
|---|---|---|---|
| sonnet | $0.064 | $0.065 | **+1%** |
| opus | $0.215 | $0.185 | **−14%** |

**Takeaways**

- **Opus: about 14% cheaper per task**, mostly from shorter output (the session economy rules). Every run passed its quality check.
- **Sonnet: no difference.** This Claude Code version already reads files selectively and trims test output, so the guards rarely have anything to block. Differences of ±10–18% on these $0.05 tasks are within run-to-run noise.
- **Quality caveat:** on the large feature, Opus with the plugin wrote fewer new tests on average (28 vs 36). All checks passed, but the "be terse" rules may trim thoroughness on big jobs.
- **Not measured:** long multi-request sessions, where the context warnings and handoff/resume are designed to help. Each run here is a single request.

## Total cost comparison

Every shipped-configuration run summed, both plugins: [`results/TOTALS.md`](results/TOTALS.md). Overall **$7.56 → $6.75 (−10.7%)**; Opus −14.7%, Sonnet −1.3%. All 102 quality checks passed on both sides.

## How we got here

| Round | Change | Finding |
|---|---|---|
| [1](results/round1/summary.md) | v1.3 on Sonnet + Opus | Router never fired: Opus writes code through the shell (`python3 - <<EOF`, `sed -i`), not Edit/Write. Opus still ~10–20% cheaper from the rules. |
| [2](results/round2/summary.md) | Router also catches shell-written code | Router fired, and the feature task got **34% more expensive**: a blocked write has already been generated (paid) in Opus output; Sonnet then writes it again. |
| [3](results/round3/summary.md) | Delegate upfront for large jobs only; block only very large writes; added the large-feature task | Small/medium tasks 11–19% cheaper (router didn't fire). Large feature **+31%**: Opus ignored the upfront rule, wrote the implementation itself, and only the test file got routed. |
| [4](results/round4/summary.md) | Router made opt-in (off by default) | Large feature **−14%** vs baseline. |

**Conclusion on the router:** with current models, a hook can't move Opus's code-writing to Sonnet. Hooks only see a tool call after Opus has generated it, and instructions to delegate upfront weren't followed reliably. It's kept as an opt-in experiment; for Opus planning with Sonnet coding, switch models yourself (`/model opusplan`, or plan on Opus then `/model sonnet`).

## Desktop plugin benchmark

`bench/desktop/` measures `token-saver-desktop` on chat-style work: a question about a ~24k-token contract, a general question, revising an email paragraph, and a 9-message conversation run three ways (without plugin, with plugin, with plugin + `/handoff` after message 5 and `/resume` in a fresh chat). Run with `node bench/desktop/run.mjs`; results in [`desktop/results/summary.md`](desktop/results/summary.md). Opus −16%, Sonnet ±0%, handoff not worth it in a 9-message chat.

Caveats: a small synthetic Node project, single-request tasks, 3 runs per cell. Run it on your own repo and tasks for numbers that matter to you.
