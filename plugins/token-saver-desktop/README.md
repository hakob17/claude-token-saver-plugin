# token-saver-desktop

The Claude desktop app version of [token-saver](../../README.md): helps Claude spend fewer credits in everyday chat, document work and research.

Every message resends the whole conversation. Prompt caching makes those repeats fairly cheap, so the main lever is how much Claude writes. This plugin keeps answers lean by default, and adds tools to start fresh when a chat gets very long.

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

1. Start a new chat for each new topic. Use `/handoff` → `/resume` only to continue a **very long** chat: on short chats it costs more than it saves (see benchmark below).
2. Use Sonnet by default; switch to Opus only for genuinely hard problems.
3. Turn extended thinking off for routine tasks.
4. Attach a `/digest` instead of the same long PDF every time.
5. Send one complete request instead of a vague one plus corrections.

## Benchmark

Measured with headless Claude Code as a stand-in for the desktop app (same models and plugin mechanism, different system prompt), 3 runs per cell, with automatic checks for the facts the user asked for. Full tables: [bench/desktop/results/summary.md](../../bench/desktop/results/summary.md).

| | Without plugin | With plugin | Change |
|---|---|---|---|
| **Opus**, single messages (mean of 3 tasks) | $0.094 | $0.079 | **−16%** |
| **Opus**, 9-message conversation | $0.420 | $0.354 | **−16%** |
| **Sonnet**, single messages | $0.051 | $0.050 | ±0% (noise) |
| **Sonnet**, 9-message conversation | $0.337 | $0.327 | −3% |

- Answers were 30–50% shorter with the plugin, and every quality check passed (all facts present).
- The biggest single win: Opus answering a question about a long contract, **−38%**.
- Revising a paragraph cost slightly more with the plugin (+8–11%).
- **`/handoff` → `/resume` didn't pay off in a 9-message chat** (Sonnet −1%, Opus +6% vs no plugin). Messages after the handoff were about half the price, but writing the note and rebuilding context in the new chat (Claude re-read the contract) cost more than the savings. Rough break-even is about 6–10 further messages, so use it for long chats or after a long break, not routinely.

## Install

Download [`dist/token-saver-desktop.plugin`](../../dist/token-saver-desktop.plugin) and open it in the desktop app (it shows a preview with an install button), or add the marketplace `hakob17/claude-token-saver-plugin` and install `token-saver-desktop`.

To turn the automatic rules down for one chat, just tell Claude ("give me the full detailed version", "search as much as you need"). Your request in the chat always wins.

## How it works

- `hooks/hooks.json` runs at the start of each session and loads `context/economy-rules.md` into Claude's context. The rules are short on purpose, since they're part of every message.
- Each skill in `skills/` loads only when you invoke it or ask for it in plain words, so unused skills cost nothing.
- These are instructions, not hard blocks: Claude follows them, but nothing is forcibly prevented. For enforced guards, use the Claude Code plugin.

## Limitations

- Claude can't change the model for you. `/pick-model` recommends one, and you switch it in the model picker.
- Handoff notes are summaries. Check that anything critical (exact figures, approved wording) made it into the note before starting the new chat.
- Not tested on every desktop app version; if skills don't appear after installing, restart the app.
