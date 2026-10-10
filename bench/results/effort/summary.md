Cost of all 5 tasks together (mean of 3 runs each):

| Model | Low | Medium (default) | High | Low vs default | High vs default |
|---|---|---|---|---|---|
| sonnet | $0.365 | $0.417 | $0.569 | **−12%** | +36% |
| opus | $0.787 | $1.067 | $1.291 | **−26%** | +21% |

Per task:

| Model | Task | Low | Medium (default) | High | Low vs default | High vs default | Quality L / M / H | New tests L / M / H |
|---|---|---|---|---|---|---|---|---|
| sonnet | Fix failing tests | $0.072 | $0.066 | $0.051 | **+9%** | −22% | 3/3 / 3/3 / 3/3 | – / – / – |
| sonnet | Add refund feature | $0.076 | $0.092 | $0.119 | **−18%** | +29% | 3/3 / 3/3 / 3/3 | 4 / 5 / 11 |
| sonnet | Large feature (bonus module) | $0.146 | $0.178 | $0.301 | **−18%** | +69% | 3/3 / 3/3 / 3/3 | 18 / 21 / 54 |
| sonnet | Explain payout logic | $0.034 | $0.042 | $0.047 | **−20%** | +11% | 3/3 / 3/3 / 3/3 | – / – / – |
| sonnet | Rename across codebase | $0.038 | $0.038 | $0.051 | **−2%** | +33% | 3/3 / 3/3 / 3/3 | – / – / – |
| opus | Fix failing tests | $0.137 | $0.126 | $0.148 | **+9%** | +18% | 3/3 / 3/3 / 3/3 | – / – / – |
| opus | Add refund feature | $0.161 | $0.209 | $0.255 | **−23%** | +22% | 3/3 / 3/3 / 3/3 | 5 / 8 / 12 |
| opus | Large feature (bonus module) | $0.314 | $0.447 | $0.569 | **−30%** | +27% | 3/3 / 3/3 / 3/3 | 13 / 31 / 36 |
| opus | Explain payout logic | $0.091 | $0.155 | $0.164 | **−41%** | +5% | 3/3 / 3/3 / 3/3 | – / – / – |
| opus | Rename across codebase | $0.083 | $0.130 | $0.156 | **−36%** | +20% | 3/3 / 3/3 / 3/3 | – / – / – |

90 runs, $13.49.
