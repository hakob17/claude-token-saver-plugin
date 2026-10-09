# token-saver-desktop benchmark results

Headless Claude Code (`claude -p`) with vs without the desktop plugin, 3 runs per cell. Quality checks look for the facts the user asked for.

## Single messages

| Model | Task | Cost without | Cost with | Change | Answer words without → with | Quality without / with |
|---|---|---|---|---|---|---|
| sonnet | Question about a long document | $0.077 | $0.073 | **−6%** | 255 → 131 | 3/3 / 3/3 |
| sonnet | General knowledge question | $0.033 | $0.032 | **−5%** | 515 → 296 | 3/3 / 3/3 |
| sonnet | Revise one paragraph of an email | $0.042 | $0.045 | **+8%** | 190 → 173 | 3/3 / 3/3 |
| opus | Question about a long document | $0.135 | $0.084 | **−38%** | 292 → 132 | 3/3 / 3/3 |
| opus | General knowledge question | $0.071 | $0.068 | **−4%** | 637 → 430 | 3/3 / 3/3 |
| opus | Revise one paragraph of an email | $0.076 | $0.085 | **+11%** | 199 → 160 | 3/3 / 3/3 |
| sonnet | **Mean** | $0.051 | $0.050 | **−2%** | | |
| opus | **Mean** | $0.094 | $0.079 | **−16%** | | |

## 9-message conversation (handoff after message 5)

| Model | Setup | Whole conversation | Messages 6–9 (incl. handoff) | vs without plugin | Checks passed |
|---|---|---|---|---|---|
| sonnet | Without plugin | $0.337 | $0.082 | – | 18/18 |
| sonnet | With plugin | $0.327 | $0.071 | **−3%** | 18/18 |
| sonnet | With plugin + /handoff → /resume | $0.335 | $0.113 | **−1%** | 18/18 |
| opus | Without plugin | $0.420 | $0.114 | – | 18/18 |
| opus | With plugin | $0.354 | $0.108 | **−16%** | 18/18 |
| opus | With plugin + /handoff → /resume | $0.447 | $0.201 | **+6%** | 18/18 |

Runs: 54. Total spend: $9.12.

