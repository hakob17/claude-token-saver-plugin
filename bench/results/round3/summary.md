# token-saver benchmark results

Runs: 30. Each run = fresh copy of the sample project, `claude -p` headless, then an automatic quality check.
Savings compare mean cost per task (baseline → plugin). Quality = runs passing the task's check.

| Model | Task | Runs (base/plugin) | Mean cost base | Mean cost plugin | Saving | Median saving | Input tokens base → plugin | Output tokens base → plugin | Turns base → plugin | Quality base | Quality plugin |
|---|---|---|---|---|---|---|---|---|---|---|---|
| opus | Large feature: bonus / wagering module | 3/3 | $0.450 | $0.588 | **+31%** | +30% | 176k → 318k | 11.7k → 11.1k | 7.0 → 10.7 | 3/3 | 3/3 |
| opus | Explain where/how payout is computed | 3/3 | $0.141 | $0.115 | **−19%** | −11% | 84k → 77k | 1.4k → 1.1k | 4.0 → 3.7 | 3/3 | 3/3 |
| opus | Add refund feature + API + tests | 3/3 | $0.225 | $0.185 | **−18%** | −19% | 151k → 118k | 4k → 3.2k | 6.7 → 5.7 | 3/3 | 3/3 |
| opus | Fix failing tests | 3/3 | $0.124 | $0.121 | **−2%** | −3% | 122k → 130k | 1.1k → 1.1k | 6.7 → 7.0 | 3/3 | 3/3 |
| opus | Rename userId -> accountId across src/ and test/ | 3/3 | $0.136 | $0.121 | **−11%** | −7% | 110k → 113k | 1.4k → 1.2k | 5.0 → 5.3 | 3/3 | 3/3 |

## Overall (mean of per-task means)

| Model | Cost per task base | Cost per task plugin | Saving | Quality base | Quality plugin |
|---|---|---|---|---|---|
| opus | $0.215 | $0.226 | **+5%** | 15/15 | 15/15 |

_Negative saving (+%) means the plugin cost more on that task._

