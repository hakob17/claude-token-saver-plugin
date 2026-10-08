---
description: Turn the experimental Opus→Sonnet code router on/off for this project, or show its status
argument-hint: "on | off | status"
allowed-tools: Bash
---

Manage the token-saver router for this project. It is OFF by default (benchmarks showed it usually costs more than it saves) and is enabled by the marker file `.claude/token-saver-router-on` in the project root. The env var `TOKEN_SAVER_ROUTER=on|off` overrides the marker everywhere.

Argument: $ARGUMENTS

- `on`: create `.claude/token-saver-router-on` (create `.claude/` if needed).
- `off`: delete that file if it exists.
- `status` or empty: check whether the file exists and whether `TOKEN_SAVER_ROUTER` is set.

Use a single short shell command, then reply with one line: `Router: ON` or `Router: OFF` (and why, if the env var decides it).
