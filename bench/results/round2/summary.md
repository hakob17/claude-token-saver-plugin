# token-saver benchmark results

Runs: 24. Each run = fresh copy of the sample project, `claude -p` headless, then an automatic quality check.
Savings compare mean cost per task (baseline → plugin). Quality = runs passing the task's check.

| Model | Task | Runs (base/plugin) | Mean cost base | Mean cost plugin | Saving | Median saving | Input tokens base → plugin | Output tokens base → plugin | Turns base → plugin | Quality base | Quality plugin |
|---|---|---|---|---|---|---|---|---|---|---|---|
| opus | Explain where/how payout is computed | 3/3 | $0.148 | $0.104 | **−30%** | −41% | 65k → 62k | 1.2k → 0.9k | 3.0 → 3.0 | 3/3 | 3/3 |
| opus | Add refund feature + API + tests | 3/3 | $0.216 | $0.289 | **+34%** | +36% | 135k → 175k | 4k → 3.9k | 6.3 → 7.3 | 3/3 | 3/3 |
| opus | Fix failing tests | 3/3 | $0.122 | $0.121 | **−1%** | +1% | 121k → 124k | 1.1k → 1k | 6.7 → 6.7 | 3/3 | 3/3 |
| opus | Rename userId -> accountId across src/ and test/ | 3/3 | $0.133 | $0.117 | **−12%** | −9% | 103k → 107k | 1.2k → 1.1k | 4.7 → 5.0 | 3/3 | 3/3 |

## Overall (mean of per-task means)

| Model | Cost per task base | Cost per task plugin | Saving | Quality base | Quality plugin |
|---|---|---|---|---|---|
| opus | $0.155 | $0.158 | **+2%** | 12/12 | 12/12 |

_Negative saving (+%) means the plugin cost more on that task._

