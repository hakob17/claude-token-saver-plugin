---
description: Set or check your monthly Claude budget (e.g. /token-saver:budget 100)
argument-hint: "<amount> [reset-day] | status | off"
allowed-tools: Bash
---

Manage the token-saver monthly budget. Config lives in `~/.claude/token-saver/budget.json` as `{"limit": <dollars>, "resetDay": <1-28>}`. Spend is recorded per session by the token-saver status line under `~/.claude/token-saver/spend/<YYYY-MM>/`, one JSON file per session: `{"cost": <session total>, "base": <amount spent before this period>}`; a session's spend this period is `cost - base`. The period key is the YYYY-MM in which the current period started (if today's day of month is before `resetDay`, it's last month).

Argument: $ARGUMENTS

- A number (e.g. `100`, optionally followed by a reset day such as `100 15`): write the config with that limit and reset day (default 1), creating the folder if needed. Then report like `status`.
- `off`: delete `budget.json`.
- `status` or empty: read the config and sum this period's spend.

Use one short `node -e` command for this (no other tools needed). Then reply with at most two lines, e.g. `Budget: $42.10 of $100 used this month (42%), resets on the 1st.` If no spend files exist yet, add: `Spend is recorded by the token-saver status line — install it with node install.mjs if the status line isn't showing.`
