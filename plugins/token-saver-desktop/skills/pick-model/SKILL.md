---
name: pick-model
description: >
  This skill should be used when the user asks "which model should I use", "is Opus worth it for this",
  "should I switch to Haiku/Sonnet", "cheapest model for this task", or invokes /pick-model with a task.
  Recommends the cheapest model and effort level that will do the job well.
metadata:
  version: "0.1.0"
---

# Pick a model

Recommend the cheapest model that will do the described task well (or, if no task is given, the task this conversation is about). Claude cannot switch models itself; the user changes it in the model picker.

## Guide

| Tier | Good for | Avoid for |
|---|---|---|
| **Haiku** | Quick facts, short rewrites, translations, formatting, extracting data, summarizing short texts, simple scripts | Multi-step reasoning, long documents, nuanced writing |
| **Sonnet** | Most work: writing, analysis, coding, research, long documents, data work | Only the hardest problems |
| **Opus / higher tiers** | Hard reasoning, tricky debugging, architecture, high-stakes writing, problems Sonnet failed at | Routine tasks — costs several times more per token than Sonnet |

Rules of thumb:
- Default to Sonnet. Recommend Opus only when the task is genuinely hard or a cheaper model already failed at it.
- Suggest Haiku for anything mechanical or short.
- If extended thinking is on, suggest turning it off for routine tasks; it is billed as output.
- For a mixed job, suggest splitting it: plan or decide on the stronger model, then do the bulk in a new chat on the cheaper one (using /handoff and /resume).

## Answer format

At most 4 lines: the recommended model, one line on why, whether to use extended thinking, and (if relevant) how to split the work. Don't pad with the full table.
