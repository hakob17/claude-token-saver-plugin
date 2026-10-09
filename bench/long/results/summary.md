| Model | Setup | Runs | Cost per session | vs without plugin | Handoffs | Peak context | Tests added | Changelog lines | Quality passed |
|---|---|---|---|---|---|---|---|---|---|
| sonnet | Without plugin | 3 | $0.937 | – | 0.0 | 66k | 59 | 13 | 3/3 |
| sonnet | With plugin | 3 | $1.051 | **+12%** | 0.0 | 77k | 54 | 14 | 3/3 |
| sonnet | With plugin + handoff at 80k (shipped threshold) | 3 | $0.985 | **+5%** | 0.0 | 70k | 49 | 13 | 3/3 |
| sonnet | With plugin + handoff at 50k (experiment) | 3 | $0.902 | **−4%** | 1.0 | 53k | 43 | 5 | 2/3 |
| opus | Without plugin | 2 | $2.193 | – | 0.0 | 87k | 77 | 15 | 2/2 |
| opus | With plugin | 2 | $1.962 | **−11%** | 0.0 | 82k | 63 | 14 | 2/2 |

16 sessions of 19 requests each, total spend $19.93.

