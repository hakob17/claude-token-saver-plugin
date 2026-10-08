# token-saver benchmark results

Runs: 48. Each run = fresh copy of the sample project, `claude -p` headless, then an automatic quality check.
Savings compare mean cost per task (baseline → plugin). Quality = runs passing the task's check.

| Model | Task | Runs (base/plugin) | Mean cost base | Mean cost plugin | Saving | Median saving | Input tokens base → plugin | Output tokens base → plugin | Turns base → plugin | Quality base | Quality plugin |
|---|---|---|---|---|---|---|---|---|---|---|---|
| opus | Explain where/how payout is computed | 3/3 | $0.109 | $0.102 | **−6%** | −7% | 78k → 62k | 1.3k → 1k | 4.0 → 3.0 | 3/3 | 3/3 |
| opus | Add refund feature + API + tests | 3/3 | $0.255 | $0.224 | **−12%** | −17% | 143k → 128k | 4.1k → 3.3k | 6.7 → 5.7 | 3/3 | 3/3 |
| opus | Fix failing tests | 3/3 | $0.162 | $0.122 | **−25%** | −11% | 122k → 130k | 1.1k → 1.1k | 7.0 → 7.0 | 3/3 | 3/3 |
| opus | Rename userId -> accountId across src/ and test/ | 3/3 | $0.142 | $0.117 | **−17%** | −12% | 111k → 108k | 1.4k → 1.1k | 5.0 → 5.0 | 3/3 | 3/3 |
| sonnet | Explain where/how payout is computed | 3/3 | $0.051 | $0.057 | **+12%** | +18% | 60k → 76k | 0.8k → 0.8k | 3.3 → 4.0 | 3/3 | 3/3 |
| sonnet | Add refund feature + API + tests | 3/3 | $0.091 | $0.084 | **−7%** | −7% | 100k → 87k | 2.8k → 2.3k | 4.7 → 4.0 | 3/3 | 3/3 |
| sonnet | Fix failing tests | 3/3 | $0.061 | $0.072 | **+18%** | +21% | 101k → 141k | 0.7k → 0.9k | 5.0 → 7.3 | 3/3 | 3/3 |
| sonnet | Rename userId -> accountId across src/ and test/ | 3/3 | $0.051 | $0.044 | **−13%** | −8% | 79k → 65k | 0.8k → 0.6k | 4.0 → 3.3 | 3/3 | 3/3 |

## Overall (mean of per-task means)

| Model | Cost per task base | Cost per task plugin | Saving | Quality base | Quality plugin |
|---|---|---|---|---|---|
| opus | $0.167 | $0.142 | **−15%** | 12/12 | 12/12 |
| sonnet | $0.064 | $0.065 | **+1%** | 12/12 | 12/12 |

_Negative saving (+%) means the plugin cost more on that task._

