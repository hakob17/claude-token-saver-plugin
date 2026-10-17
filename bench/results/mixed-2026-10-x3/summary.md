# token-saver benchmark results

Runs: 6. Each run = fresh copy of the sample project, `claude -p` headless, then an automatic quality check.
Savings compare mean cost per task (baseline → plugin). Quality = runs passing the task's check.

| Model | Task | Runs (base/plugin) | Mean cost base | Mean cost plugin | Saving | Median saving | Input tokens base → plugin | Output tokens base → plugin | Turns base → plugin | Quality base | Quality plugin |
|---|---|---|---|---|---|---|---|---|---|---|---|
| opus | Coffee shop website, mixed session (builds + questions) | 3/0 | $12.044 | – | **–** | – | 9900k → NaNk | 139.7k → NaNk | 89.3 → NaN | 3/3 | 0/0 |

## Overall (mean of per-task means)

| Model | Cost per task base | Cost per task plugin | Saving | Quality base | Quality plugin |
|---|---|---|---|---|---|
| opus | $12.044 | – | **–** | 3/3 | 0/0 |

_Negative saving (+%) means the plugin cost more on that task._
