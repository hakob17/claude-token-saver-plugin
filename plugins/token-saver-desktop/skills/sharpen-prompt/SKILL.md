---
name: sharpen-prompt
description: >
  This skill should be used when the user invokes /sharpen-prompt, or asks to "improve my prompt",
  "make this request clearer", "tighten this prompt" with a draft request. Rewrites a draft request
  so it gets the right result in one pass instead of several rounds of corrections.
metadata:
  version: "0.1.0"
---

# Sharpen a prompt

The most expensive conversations are the ones that need five corrections. Turn the user's draft request into one that can be answered right the first time.

## Steps

1. Read the draft. Identify what's missing among: the goal, the audience or use, the inputs to use (which files, sources, data), constraints (length, tone, format, must/must-not), and what "done" looks like.
2. If something essential is missing and can't be reasonably assumed, ask for it in one short question (at most 3 items). Otherwise fill sensible assumptions and mark them `[assumed: …]` so the user can fix them.
3. Output the rewritten prompt in a fenced code block. Keep it as short as it can be while complete; don't add filler or role-play.
4. Below it, one line naming the biggest improvement made.

Do not carry out the task itself — the user will send the sharpened prompt (ideally in a new chat, on the model /pick-model suggests).
