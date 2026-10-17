# token-saver benchmark results

Runs: 5. Each run = fresh copy of the sample project, `claude -p` headless, then an automatic quality check.
Savings compare mean cost per task (baseline → plugin). Quality = runs passing the task's check.

| Model | Task | Runs (base/plugin) | Mean cost base | Mean cost plugin | Saving | Median saving | Input tokens base → plugin | Output tokens base → plugin | Turns base → plugin | Quality base | Quality plugin |
|---|---|---|---|---|---|---|---|---|---|---|---|
| opus | Native iOS home planner with LLM assistant | 1/1 | $29.628 | $27.368 | **−8%** | −8% | 33152k → 27206k | 233.2k → 250.6k | 138.0 → 123.0 | 1/1 | 1/1 |

## Overall (mean of per-task means)

| Model | Cost per task base | Cost per task plugin | Saving | Quality base | Quality plugin |
|---|---|---|---|---|---|
| opus | $29.628 | $27.368 | **−8%** | 1/1 | 1/1 |

_Negative saving (+%) means the plugin cost more on that task._
