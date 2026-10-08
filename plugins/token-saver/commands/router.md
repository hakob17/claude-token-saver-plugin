---
description: Turn the Opus→Sonnet code router on/off for this project, or show its status
argument-hint: "on | off | status"
allowed-tools: Bash
---

Manage the token-saver router for this project. It is controlled by the marker file `.claude/token-saver-router-off` in the project root (file present = router off). The env var `TOKEN_SAVER_ROUTER=off` disables it globally.

Argument: $ARGUMENTS

- `off`: create `.claude/token-saver-router-off` (create `.claude/` if needed).
- `on`: delete that file if it exists.
- `status` or empty: check whether the file exists and whether `TOKEN_SAVER_ROUTER` is set.

Use a single short shell command, then reply with one line: `Router: ON` or `Router: OFF` (and why, if the env var is what disables it).
