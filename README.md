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

All results in one file: **[bench/BENCHMARKS.md](bench/BENCHMARKS.md)**.

Measured with an A/B benchmark (Claude Code with vs without the plugin, same tasks, automatic quality checks, 3 runs each):

| | Without plugin | With plugin | Saving | Quality |
|---|---|---|---|---|
| **Opus**, mean cost per task (5 tasks) | $0.215 | $0.185 | **−14%** | 15/15 vs 15/15 |
| **Sonnet**, mean cost per task (4 tasks) | $0.064 | $0.065 | ±0% (noise) | 12/12 vs 12/12 |
| **Opus**, 19-request coding session | $2.19 | $1.96 | **−11%** | 2/2 vs 2/2 |
| **Sonnet**, 19-request coding session | $0.94 | $1.05 | +12% | 3/3 vs 3/3 |

Opus savings come mainly from shorter output. Sonnet is already frugal, so the plugin's rules are mostly overhead there. Full results, method and caveats: [bench/README.md](bench/README.md).

**Total cost across every benchmark run** (same work with and without the plugins; `node bench/totals.mjs`):

| Plugin | Model | Work | Runs per side | Total without plugin | Total with plugin | Saved | Change | Quality passed (without / with) |
|---|---|---|---|---|---|---|---|---|
| token-saver (Claude Code) | sonnet | 4 coding tasks | 12 / 12 | $0.76 | $0.77 | −$0.01 | **+1.5%** | 12/12 / 12/12 |
| token-saver (Claude Code) | opus | 5 coding tasks | 15 / 15 | $3.23 | $2.78 | $0.45 | **−13.9%** | 15/15 / 15/15 |
| token-saver (Claude Code) | sonnet | 19-request session | 3 / 3 | $2.81 | $3.15 | −$0.34 | **+12.1%** | 3/3 / 3/3 |
| token-saver (Claude Code) | opus | 19-request session | 2 / 2 | $4.39 | $3.92 | $0.46 | **−10.5%** | 2/2 / 2/2 |
| token-saver-desktop | sonnet | 3 chat tasks + 9-message conversation | 12 / 12 | $1.47 | $1.43 | $0.04 | **−2.8%** | 12/12 / 12/12 |
| token-saver-desktop | opus | 3 chat tasks + 9-message conversation | 12 / 12 | $2.10 | $1.77 | $0.33 | **−15.9%** | 12/12 / 12/12 |
| **All** | **sonnet** | | | **$5.04** | **$5.35** | **−$0.31** | **+6.2%** | |
| **All** | **opus** | | | **$9.72** | **$8.47** | **$1.24** | **−12.8%** | |
| **All** | **both** | | | **$14.76** | **$13.83** | **$0.93** | **−6.3%** | |

In practice, with a $100 credit: if you mostly use **Opus**, the same work costs about **$87**, so the credit covers roughly **15% more work**. If you mostly use **Sonnet**, the plugins don't save money (and in long coding sessions cost ~12% more), so the installer's real benefit there is making Sonnet the default. These are synthetic, single-user tasks; your mileage will vary.

**Desktop plugin** (same method, chat-style tasks; [details](plugins/token-saver-desktop/README.md#benchmark)): Opus **−16%** on single messages and on a 9-message conversation; Sonnet ±0%. All quality checks passed. `/handoff` → `/resume` didn't pay off in a 9-message chat; it's for very long chats.

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
| `--budget 100 [--reset-day 15]` | Also sets a monthly budget (see *Monthly budget*). |
| `--uninstall` | Removes the plugin and status line, restores the settings backup. Spend history in `~/.claude/token-saver/` is kept. |

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
[Sonnet 5.5] $0.84 · ctx 45k · month $42.10/$100 (42%)
```
Session cost turns yellow at $2 and red at $5; context turns yellow at 80k and red at 150k; Opus/Fable are flagged with `$$$`. The last part is this month's total across all your sessions (see below).

### 6a. Monthly budget *(Option B)*
For company limits like $100–150 a month. Set your limit once:
```
/token-saver:budget 100          # inside Claude Code
/token-saver:budget 150 15       # $150, resetting on the 15th
node install.mjs --budget 100    # or at install time
```
- The status line adds up spend across **all** your Claude Code sessions in the current budget period (calendar month by default) and shows it as `month $42.10/$100`, yellow from 80% and red from 95%.
- When you cross **50%, 80%, 95% and 100%**, Claude tells you once in its next reply; from 80% it also suggests switching routine work to Sonnet.
- `/token-saver:budget` (or `status`) shows where you are; `/token-saver:budget off` removes the limit.
- Data is stored in `~/.claude/token-saver/`: one small file per session per month, so parallel sessions don't interfere. Old months are pruned after ~4 months.

Limits: spend is recorded by the status line, so it only counts Claude Code sessions where the status line runs (the terminal, and the IDE extensions if they show it). Usage in the Claude apps or by other tools isn't included, and the figure is Claude Code's own cost estimate, which may differ from how your company bills.

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
| `/token-saver:budget <amount> [reset-day]\|status\|off` | Sets or shows your monthly budget; the status line tracks spend and Claude warns at 50/80/95/100%. |
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
| `TOKEN_SAVER_BUDGET` | – | Monthly budget in dollars (overrides `/token-saver:budget`) |
| `TOKEN_SAVER_HOME` | `~/.claude/token-saver` | Where budget config and spend history are kept |
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
    statusline.mjs                  status line (model, cost, context, month total)
    budget-lib.mjs                  monthly spend ledger shared by status line and hook
    budget-watch.mjs                budget warnings at 50/80/95/100%
    model-switch.mjs                tracks /model changes
    lib.mjs                         shared helpers and thresholds
  agents/   coder.md  grunt.md  scout.md
  commands/ handoff.md  resume.md  find.md  grunt.md  review-diff.md  budget.md  router.md
install.mjs                         installer (settings, status line, budget, plugin)
```

Check what a session cost at any time with `/cost`.
