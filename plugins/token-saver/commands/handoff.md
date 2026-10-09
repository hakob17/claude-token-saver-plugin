---
description: Save a compact handoff note so you can /clear and continue cheaply in a fresh context
argument-hint: "[optional focus for the next session]"
---

Write a handoff note to `.claude/handoff.md` in the project root (create the folder if needed, overwrite the file). It replaces this whole conversation for the next session, so make it dense and complete but short (aim for under 60 lines):

## Goal
One or two sentences.

## Done so far
One bullet per change or completed request in this session, in order, including anything carried over from an earlier handoff note: never merge or drop items, since later questions like "what did we change today?" depend on this list. Keep each bullet to one line with `file` references. No code blocks unless a snippet is essential.

## Decisions & constraints
Bullets: choices made and why, things that must not change, gotchas discovered.

## Next steps
Numbered, concrete, in order.

## Key files
Paths only, with a few words each.

Focus for next session: $ARGUMENTS

After writing it, reply with exactly one line: `Handoff saved. Run /clear, then /token-saver:resume.`
