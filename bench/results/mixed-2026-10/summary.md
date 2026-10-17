# token-saver benchmark results

Runs: 3. Each run = fresh copy of the sample project, `claude -p` headless, then an automatic quality check.
Savings compare mean cost per task (baseline → plugin). Quality = runs passing the task's check.

| Model | Task | Runs (base/plugin) | Mean cost base | Mean cost plugin | Saving | Median saving | Input tokens base → plugin | Output tokens base → plugin | Turns base → plugin | Quality base | Quality plugin |
|---|---|---|---|---|---|---|---|---|---|---|---|
| opus | Coffee shop website, mixed session (builds + questions) | 1/1 | $9.360 | $10.066 | **+8%** | +8% | 8689k → 6045k | 95.2k → 103.8k | 96.0 → 70.0 | 1/1 | 1/1 |

## Overall (mean of per-task means)

| Model | Cost per task base | Cost per task plugin | Saving | Quality base | Quality plugin |
|---|---|---|---|---|---|
| opus | $9.360 | $10.066 | **+8%** | 1/1 | 1/1 |

_Negative saving (+%) means the plugin cost more on that task._
