---
name: handoff
description: >
  This skill should be used when the user says "handoff", "summarize this chat so I can start a new one",
  "continue in a new chat", "this chat is getting long", "save where we are", or invokes /handoff.
  Produces a compact summary that replaces the whole conversation in a fresh chat.
metadata:
  version: "0.1.0"
---

# Handoff

Long chats are expensive because every new message resends the whole conversation. Produce a handoff note that lets a fresh chat continue the work without the history.

## Steps

1. Write the note using the template below. Keep it dense: aim for under 50 lines. Include facts, decisions and current state; drop the back-and-forth that led there. Include exact values that matter (names, numbers, versions, file names, wording the user approved).
2. If an optional focus was given with the command, put it under **Next steps** first.
3. Output the note in a single fenced code block so it copies cleanly.
4. If files were produced in this chat, list them by name under **Artifacts**; don't paste their contents.
5. After the block, add one line: `Copy this, open a new chat, and paste it after /resume.`

## Template

```
# Handoff — <topic>

## Goal
<1–2 sentences>

## Where we are
- <state of the work, decisions made, what's done>

## Constraints & preferences
- <requirements, tone, format, things to avoid>

## Key facts
- <numbers, names, sources, approved wording>

## Artifacts
- <file or document names, if any>

## Next steps
1. <concrete next action>
2. ...
```
