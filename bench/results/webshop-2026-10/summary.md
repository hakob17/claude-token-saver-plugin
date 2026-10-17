# token-saver benchmark results

Runs: 5. Each run = fresh copy of the sample project, `claude -p` headless, then an automatic quality check.
Savings compare mean cost per task (baseline → plugin). Quality = runs passing the task's check.

| Model | Task | Runs (base/plugin) | Mean cost base | Mean cost plugin | Saving | Median saving | Input tokens base → plugin | Output tokens base → plugin | Turns base → plugin | Quality base | Quality plugin |
|---|---|---|---|---|---|---|---|---|---|---|---|
| opus | Coffee shop website + backend + admin from a fixed plan | 1/1 | $4.610 | $6.855 | **+49%** | +49% | 3699k → 7208k | 51.2k → 57.9k | 29.0 → 51.0 | 1/1 | 1/1 |

## Overall (mean of per-task means)

| Model | Cost per task base | Cost per task plugin | Saving | Quality base | Quality plugin |
|---|---|---|---|---|---|
| opus | $4.610 | $6.855 | **+49%** | 1/1 | 1/1 |

_Negative saving (+%) means the plugin cost more on that task._
