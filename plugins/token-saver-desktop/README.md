# token-saver-desktop

The Claude desktop app version of token-saver: helps Claude spend fewer credits in everyday chat and knowledge work.

> Using the desktop app's **Code** tab? That runs Claude Code, so install the main `token-saver` plugin instead — it has the stronger, code-specific guards.

## What it does automatically

At the start of every session Claude gets a short set of economy rules:
- brief, direct answers with no recaps
- replies in chat; files and documents only when asked
- only as many web searches as the answer needs; asks before deep research or long multi-step work
- no image search or decorative visuals unless asked
- reads only the relevant parts of long attachments, and doesn't re-read them
- returns only the changed parts when revising long text
- suggests `/handoff` when a chat gets long or the topic changes

## Skills

| Skill | Use it to |
|---|---|
| `/lean-mode [on\|strict\|off]` | Switch the chat to an even more economical style (strict caps answers at ~120 words and skips web search). |
| `/handoff [focus]` | Get a compact summary of the chat to paste into a new one. Long chats cost more with every message. |
| `/resume` | Paste a handoff note after it to continue in a fresh chat without redoing work. |
| `/pick-model <task>` | Find the cheapest model (Haiku / Sonnet / Opus) that will do the task well. |
| `/sharpen-prompt <draft>` | Rewrite a request so it's answered right the first time, instead of after five corrections. |
| `/digest` | Turn long attachments into a short reusable digest file, so you don't re-attach the originals. |

The skills also trigger from plain language ("this chat is getting long", "which model should I use for this?").

## Habits that save the most

1. Start a new chat for each new topic (use `/handoff` → `/resume` to carry context over).
2. Use Sonnet by default; switch to Opus only for genuinely hard problems.
3. Turn extended thinking off for routine tasks.
4. Attach a `/digest` instead of the same long PDF every time.
5. Send one complete request instead of a vague one plus corrections.

## Install

Download [`dist/token-saver-desktop.plugin`](../../dist/token-saver-desktop.plugin) and open it in the desktop app (it shows a preview with an install button), or add the marketplace `hakob17/claude-token-saver-plugin` and install `token-saver-desktop`.
