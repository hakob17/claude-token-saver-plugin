# Claude token savers

Two plugins that make your Claude credits last longer, automatically, without changing how you work.

Most token spend isn't your prompts. It's **context**: every message resends the whole conversation, plus every file Claude read and every line of output it saw. On Opus, the other big cost is **output**, especially writing code. These plugins attack both.

## Which plugin do I need?

| You use Claude in… | Install | What you get |
|---|---|---|
| **Claude Code**: terminal, VS Code / JetBrains extensions, or the desktop app's **Code** tab | [`token-saver`](#token-saver-for-claude-code) | Hard guards against wasteful reads and noisy build output, context warnings, Haiku helpers, optional Opus → Sonnet router, handoff/resume, cost status line |
| **The Claude desktop app** for chat, documents and research | [`token-saver-desktop`](plugins/token-saver-desktop/README.md) | Economical defaults every chat, plus `/handoff`, `/resume`, `/pick-model`, `/sharpen-prompt`, `/digest`, `/lean-mode` |

Using both? Install both; they don't overlap.

### Install in one minute

**Claude Code**, from inside a session:
```
/plugin marketplace add hakob17/claude-token-saver-plugin
/plugin install token-saver@token-saver-marketplace
```

**Desktop app**: download [`dist/token-saver-desktop.plugin`](dist/token-saver-desktop.plugin) and open it in the app (it shows a preview with an install button). If your app supports adding marketplaces, add `hakob17/claude-token-saver-plugin` and install `token-saver-desktop` instead.

The rest of this page covers `token-saver` for Claude Code. The desktop plugin has [its own README](plugins/token-saver-desktop/README.md).

### Does it work? Benchmark

Measured with an A/B benchmark (Claude Code with vs without the plugin, same tasks, automatic quality checks, 3 runs each):

| | Without plugin | With plugin | Saving | Quality |
|---|---|---|---|---|
| **Opus**, mean cost per task (5 tasks) | $0.215 | $0.185 | **−14%** | 15/15 vs 15/15 |
| **Sonnet**, mean cost per task (4 tasks) | $0.064 | $0.065 | ±0% (noise) | 12/12 vs 12/12 |

Opus savings come mainly from shorter output. Sonnet is already frugal on single requests. The biggest savings the plugin targets (long sessions: context warnings, handoff/resume) aren't covered by this benchmark yet. Full results, method and caveats: [bench/README.md](bench/README.md).

---

# token-saver for Claude Code

- keeps junk out of context (huge files, build logs, recursive listings)
- warns you before a session gets bloated, and gives you a cheap way to restart it
- lets Opus think, but hands the code writing to Sonnet
- pushes searches and mechanical edits to Haiku

Requires **Node 18+** and Claude Code with plugin support.

## Quick start

**Option A — plugin only**, from inside Claude Code:
```
/plugin marketplace add hakob17/claude-token-saver-plugin
/plugin install token-saver@token-saver-marketplace
```

**Option B — plugin + status line + recommended settings:**
```bash
git clone https://github.com/hakob17/claude-token-saver-plugin
cd claude-token-saver-plugin
node install.mjs
```

Restart Claude Code after installing.

| Installer flag | Effect |
|---|---|
| *(none)* | Installs the plugin, the status line and the recommended settings. Backs up `~/.claude/settings.json` first. |
| `--no-settings` | Plugin only; your settings file is left alone. |
| `--uninstall` | Removes the plugin and status line, restores the settings backup. |

If the `claude` CLI isn't on your PATH, the installer prints the two `/plugin` commands to run inside Claude Code instead.

**Updating:** `/plugin marketplace update token-saver-marketplace`, then restart. (Option B: `git pull` first.) This updates both plugins.

---

## What happens automatically

### 1. Session rules
At session start Claude gets a short set of rules: be terse, edit rather than rewrite, Grep before Read, delegate broad searches to Haiku, keep build output quiet, stop and ask after two failed attempts. Kept deliberately short, since this text is sent on every turn.

### 2. Read guard
Blocks reading, in full:
- files larger than ~40 KB (~10k tokens) — Claude is told to Grep for the part it needs and read just that range;
- generated or vendored files: `target/`, `build/`, `dist/`, `node_modules/`, `.gradle/`, `.idea/`, lockfiles, `*.min.js`, `*.map`, `*.class`, `*.jar`, logs.

### 3. Bash guard
Blocks commands that dump thousands of lines into context, and tells Claude the cheaper version:

| Blocked | Suggested instead |
|---|---|
| `mvn clean test` | `mvn clean test -q 2>&1 \| tail -60` |
| `./gradlew build` | `./gradlew build -q --console=plain 2>&1 \| tail -60` |
| `npm install` | `npm install --silent 2>&1 \| tail -60` |
| `cat BigFile.java` | Grep, or Read with offset/limit |
| `grep -r foo .` | the Grep tool (respects `.gitignore`) |
| `find .`, `tree`, `ls -R` | Glob, or limit depth |

Commands already piped to `tail`/`head`/`grep`, redirected to a file, or using a quiet flag pass through.

> **Never stuck:** if Claude really needs the full read or output, repeating the exact same call is allowed through.

### 4. Context watch
Tracks how big the conversation context is:
- **~80k tokens** — if you've switched to a new task, Claude suggests `/clear`.
- **~150k tokens** — Claude tells you to run `/token-saver:handoff`, then `/clear`.

### 5. Opus → Sonnet router *(experimental, off by default)*

> **Benchmarked and found not to pay off**, so it's opt-in. Hooks can only react *after* Opus has generated a tool call, so by the time a large write is blocked, Opus has already paid for writing that code. In testing, Opus also kept writing implementations itself despite instructions to delegate upfront. On a large feature, routing cost **+31%** with no quality gain ([details](bench/README.md)). If you want Opus-quality planning with Sonnet-priced coding, switch models yourself: `/model opusplan` (Opus in plan mode, Sonnet when executing) or plan on Opus, then `/model sonnet` to implement.

When enabled (`/token-saver:router on`, or `TOKEN_SAVER_ROUTER=on`) and the session runs on Opus/Fable:

- Opus is told to delegate large implementations (≈150+ lines or 3+ files) to the `coder` agent (Sonnet) **before** writing, in 1–4 area-based tasks whose specs state intent, not code.
- Large writes on the main thread (a `Write` or shell-written file over 6,000 characters, an `Edit` over 3,000) are blocked with instructions to delegate. Code written through the shell (heredocs, `python3 -`, `sed -i`) is caught too.
- Delegation prompts carrying more than ~600 characters of code are blocked (the code has already been paid for at Opus prices), and more than 4 coding delegations per request must be batched.
- The coder reports interface changes; when it finishes, Opus must review via `git diff` before finishing, and send fixes back rather than rewriting.
- Subagent edits and Sonnet/Haiku sessions are never touched.

### 6. Status line *(Option B)*
```
[Sonnet 5.5] $0.84 · ctx 45k
```
Cost turns yellow at $2 and red at $5; context turns yellow at 80k and red at 150k; Opus/Fable are flagged with `$$$`.

### 7. Recommended settings *(Option B)*
Added to `~/.claude/settings.json` only where you haven't set your own value:
- `"model": "sonnet"` — switch with `/model opus` when a problem really needs it
- `"effortLevel": "medium"` — less thinking spend on routine work
- `permissions.deny` read rules for `node_modules`, `target`, `build`, `.gradle`, `dist`, minified JS and lockfiles

---

## Commands

| Command | What it does |
|---|---|
| `/token-saver:handoff [focus]` | Writes a dense summary of the session to `.claude/handoff.md`. Then run `/clear`. |
| `/token-saver:resume [instruction]` | Continues from the handoff in a fresh, cheap context — no re-exploring. |
| `/token-saver:find <question>` | Codebase search on Haiku; returns `file:line` locations and a short answer. |
| `/token-saver:grunt <change>` | Mechanical edit on Haiku (renames, boilerplate, formatting). |
| `/token-saver:review-diff [base]` | Reviews only the git diff, not whole files; reports real issues only. |
| `/token-saver:router on\|off\|status` | Toggles the experimental Opus → Sonnet router for the current project (off by default). |

The biggest single habit: **`/token-saver:handoff` → `/clear` → `/token-saver:resume`** whenever a session gets long or you switch tasks.

## Agents

| Agent | Model | Use |
|---|---|---|
| `token-saver:coder` | Sonnet | Implements code from a spec; runs tests quietly; short report. |
| `token-saver:grunt` | Haiku | Mechanical, well-specified edits. |
| `token-saver:scout` | Haiku | Read-only search; returns locations, not file contents. |

---

## Configuration

Set these as environment variables, e.g. in the `env` block of `~/.claude/settings.json`:

| Variable | Default | Meaning |
|---|---|---|
| `TOKEN_SAVER_MAX_READ_BYTES` | `40000` | Read guard size limit |
| `TOKEN_SAVER_MAX_READ_LINES` | `600` | Range size suggested to Claude |
| `TOKEN_SAVER_CONTEXT_WARN` | `80000` | First context warning (tokens) |
| `TOKEN_SAVER_CONTEXT_URGENT` | `150000` | Urgent context warning (tokens) |
| `TOKEN_SAVER_ROUTER` | off | `on` enables the experimental router everywhere; `off` forces it off |
| `TOKEN_SAVER_ROUTE_WRITE_CHARS` | `6000` | `Write` size that triggers routing |
| `TOKEN_SAVER_ROUTE_EDIT_CHARS` | `3000` | `Edit`/`MultiEdit` size that triggers routing |
| `TOKEN_SAVER_SPEC_CODE_CHARS` | `600` | Max code allowed inside a delegation spec |
| `TOKEN_SAVER_MAX_DELEGATIONS` | `4` | Coding delegations per request before batching is required |

Example:
```json
{
  "env": {
    "TOKEN_SAVER_MAX_READ_BYTES": "60000",
    "TOKEN_SAVER_ROUTE_EDIT_CHARS": "1200"
  }
}
```

---

## Limitations

- The router can't switch the model; it can only block after Opus has generated a write, which is why it's off by default.
- Delegation has overhead: the coder re-reads the files it needs. The savings come from moving code *output* off Opus, so they're largest on bigger features.
- Context size is read from the session transcript, which is an internal format and could change between Claude Code versions. If it can't be read, the context watch and status line simply stay quiet.
- Hook state is kept in the plugin's data directory (or your temp folder) per session.

---

## Project layout

```
.claude-plugin/marketplace.json     marketplace listing both plugins
dist/token-saver-desktop.plugin     packaged desktop plugin (open in the desktop app)
plugins/token-saver-desktop/        desktop app plugin (see its README)
  hooks/hooks.json                  loads the economy rules at session start
  context/economy-rules.md          the always-on rules
  skills/                           lean-mode, handoff, resume, pick-model, sharpen-prompt, digest
plugins/token-saver/
  .claude-plugin/plugin.json        plugin manifest
  hooks/hooks.json                  hook wiring
  scripts/
    session-start.mjs               session rules, model detection, handoff hint
    context-watch.mjs               context size warnings
    guard-read.mjs                  read guard
    guard-bash.mjs                  bash guard
    route-edits.mjs                 Opus → Sonnet router
    guard-delegation.mjs            spec checker: no code in specs, no tiny-task fan-out
    review-gate.mjs                 makes Opus review delegated work via git diff
    model-switch.mjs                tracks /model changes
    lib.mjs                         shared helpers and thresholds
  agents/   coder.md  grunt.md  scout.md
  commands/ handoff.md  resume.md  find.md  grunt.md  review-diff.md  router.md
install.mjs                         installer (settings, status line, plugin)
statusline.mjs                      status line script
```

Check what a session cost at any time with `/cost`.
