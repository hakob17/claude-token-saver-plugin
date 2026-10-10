---
name: deep
description: Run one request at high effort (deeper reasoning, more thorough tests). Use for hard bugs, design decisions, big features, or anything a low-effort attempt got wrong.
argument-hint: "<request>"
effort: high
disable-model-invocation: true
---

This request is running at high effort because the user asked for a deeper pass. Think it through properly, be thorough (edge cases, tests), and verify your work. Keep the final reply concise.

Request: $ARGUMENTS
