# token-saver benchmark results

Runs: 3. Each run = fresh copy of the sample project, `claude -p` headless, then an automatic quality check.
Savings compare mean cost per task (baseline → plugin). Quality = runs passing the task's check.

| Model | Task | Runs (base/plugin) | Mean cost base | Mean cost plugin | Saving | Median saving | Input tokens base → plugin | Output tokens base → plugin | Turns base → plugin | Quality base | Quality plugin |
|---|---|---|---|---|---|---|---|---|---|---|---|
| opus | Large feature: bonus / wagering module | 0/3 | – | $0.385 | **–** | – | NaNk → 145k | NaNk → 9.8k | NaN → 6.3 | 0/0 | 3/3 |

## Overall (mean of per-task means)

| Model | Cost per task base | Cost per task plugin | Saving | Quality base | Quality plugin |
|---|---|---|---|---|---|
| opus | – | $0.385 | **–** | 0/0 | 3/3 |

_Negative saving (+%) means the plugin cost more on that task._

