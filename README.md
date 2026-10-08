# token-saver for Claude Code

Makes Claude Code spend fewer tokens automatically. Requires Node 18+.

## Install

Plugin only, straight from GitHub (inside Claude Code):
```
/plugin marketplace add hakob17/claude-token-saver-plugin
/plugin install token-saver@token-saver-marketplace
```

Plugin + status line + recommended settings:
```bash
git clone https://github.com/hakob17/claude-token-saver-plugin && cd claude-token-saver-plugin
node install.mjs                 # plugin + recommended settings (backs up your settings.json)
node install.mjs --no-settings   # plugin only
node install.mjs --uninstall     # remove everything, restore settings backup
```

Then restart Claude Code. If the `claude` CLI isn't on your PATH, run inside Claude Code:
```
/plugin marketplace add /path/to/token-saver
/plugin install token-saver@token-saver-marketplace
```

## What it does automatically

| Piece | Effect |
|---|---|
| **Session rules** (SessionStart hook) | Short instructions to be terse, edit instead of rewrite, Grep before Read, delegate searches to Haiku, keep build output quiet. |
| **Read guard** | Blocks full reads of files over ~40 KB and of `target/`, `build/`, `node_modules/`, lockfiles, logs, `.class`. Claude is told to Grep then read a range. Repeating the identical call lets it through, so it never gets stuck. |
| **Bash guard** | Blocks unfiltered `mvn`/`gradle`/`npm` runs, `cat` of big files, `grep -r`, `find .`, `tree`. Suggests the quiet version (e.g. `mvn test -q 2>&1 \| tail -60`). Same repeat-to-allow escape. |
| **Context watch** | At ~80k context tokens, Claude suggests `/clear` if you switched tasks. At ~150k it tells you to hand off and clear. |
| **Status line** | `[model] $cost · ctx 45k`. Turns yellow/red as cost and context grow, and flags Opus. |
| **Opus → Sonnet router** | When the main thread runs Opus/Fable, any substantial code write (Write > 1500 chars, Edit > 800 chars) is blocked and Opus is told to hand it to the `coder` agent (Sonnet) with a precise spec, then review via `git diff`. Small fixes stay on Opus (delegating them would cost more than it saves). Subagent edits and Sonnet/Haiku sessions are never touched. |
| **Settings** (installer) | Default model `sonnet`, effort `medium`, deny-reads for build/vendor folders. Your existing values are kept. |

## Commands

- `/token-saver:handoff [focus]` — writes `.claude/handoff.md`; then `/clear`
- `/token-saver:resume` — continue from the handoff in a fresh, cheap context
- `/token-saver:find <question>` — codebase search on Haiku, returns `file:line` list
- `/token-saver:grunt <change>` — mechanical edits on Haiku
- `/token-saver:review-diff [base]` — review only the git diff
- `/token-saver:router on|off|status` — toggle the Opus→Sonnet router for this project

## Agents

- `token-saver:coder` — Sonnet, implements from a spec, runs tests quietly, short report
- `token-saver:grunt` — Haiku, mechanical edits
- `token-saver:scout` — Haiku, read-only code search

Typical flow on Opus: describe the feature → Opus plans → `coder` (Sonnet) writes it → Opus reviews the diff.
Built-in alternative: `/model opusplan` uses Opus in plan mode and Sonnet for execution.

## Tuning (env vars, e.g. in settings.json `env`)

`TOKEN_SAVER_MAX_READ_BYTES` (40000), `TOKEN_SAVER_CONTEXT_WARN` (80000), `TOKEN_SAVER_CONTEXT_URGENT` (150000),
`TOKEN_SAVER_ROUTER` (`off` disables), `TOKEN_SAVER_ROUTE_WRITE_CHARS` (1500), `TOKEN_SAVER_ROUTE_EDIT_CHARS` (800).

Switch models when needed: `/model opus` for hard problems, `/model sonnet` to go back. Check spend with `/cost`.
