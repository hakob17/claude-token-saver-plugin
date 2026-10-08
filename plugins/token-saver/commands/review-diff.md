---
description: Review only the current uncommitted git diff (not the whole files)
argument-hint: "[optional: base branch, e.g. main]"
---

Run `git diff --stat $ARGUMENTS` and then `git diff -U3 $ARGUMENTS` (if the diff is over ~1500 lines, review file by file with `git diff -U3 -- <file>`). Do not open whole files unless a hunk is impossible to judge without a few lines of surrounding code; then Read only that range.

Report only real issues — bugs, broken edge cases, concurrency/transaction problems, security, missing tests — as `file:line — problem — fix`. Skip style nitpicks and praise. If nothing is wrong, say so in one line.
