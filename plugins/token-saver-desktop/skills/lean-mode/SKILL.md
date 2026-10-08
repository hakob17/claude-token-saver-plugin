---
name: lean-mode
description: >
  This skill should be used when the user says "lean mode", "save tokens", "save credits",
  "be economical", "I'm running out of credits", "keep it short", or invokes /lean-mode,
  optionally with "off" or "strict". Switches the conversation into an economical working style.
metadata:
  version: "0.1.0"
---

# Lean mode

Switch how the rest of this conversation is handled, according to the argument (default: `on`).

## `on` (default)

Apply these rules for the rest of the conversation:

1. Answer first, in as few words as fully answer the question. No preamble, no closing summary, no "let me know if…".
2. Reply in chat. Make a file, document or artifact only when the user asks for one.
3. Use at most 2 web searches per question unless told otherwise. Never launch deep research or subagents without asking.
4. No image search, diagrams or visuals unless asked.
5. Read only the parts of attachments the question needs. Never re-read content already in the conversation.
6. When editing text or code, return only the changed parts, clearly marked.
7. Ask one clarifying question instead of guessing when a wrong guess would mean redoing expensive work.

Confirm with one line: `Lean mode on.`

## `strict`

Everything in `on`, plus:

- Cap answers at about 120 words unless the user asks for more.
- No web searches unless the user explicitly asks.
- No tool use beyond what the request strictly requires; state what was skipped in one line if it matters.

Confirm with one line: `Lean mode on (strict).`

## `off`

Return to normal behaviour. Confirm with one line: `Lean mode off.`
