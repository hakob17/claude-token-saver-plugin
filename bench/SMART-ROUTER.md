# Smart router: design note *(experimental)*

A routing policy inside the local proxy ([`router-proxy.mjs`](../plugins/token-saver/proxy/router-proxy.mjs)), turned on with `TOKEN_SAVER_PROXY_POLICY=smart`. The default policy (`budget`, see [ROUTING-PROXY.md](ROUTING-PROXY.md)) only fails over when money runs out. The smart policy decides for every turn how much model the work needs, and keeps long conversations lean.

Code: [`smart-policy.mjs`](../plugins/token-saver/proxy/smart-policy.mjs) (pure functions), wired into the proxy's request path. Tests: [`smart-test.mjs`](../plugins/token-saver/proxy/smart-test.mjs) (classifier cases plus end-to-end scenarios against a fake API).

## What the proxy can and can't do

The proxy can't change how Claude Code orchestrates its work. Claude Code still sends its tools and runs its agent loop. What the proxy controls for each request is:
- **which model answers it**,
- **at what effort**, and
- **how much stale context the model sees**.

That's enough to make a simple question cheap and to keep a long session lean.

## 1. Routing by task complexity

The classifier runs once per turn, on the first request after a user message. That's the only point where changing models is cheap: nothing of the turn is cached yet and there's no thinking chain to break. The model is then pinned until the next user message.

The classifier reads the user's own words (injected `<system-reminder>` text and tool results removed) and scores them:

| Signal | Score |
|---|---|
| Design or scope words: design, architect, plan, refactor, migrate, rewrite, implement, build, integrate, from scratch, end-to-end, whole, entire, across… | +2 each (max +6) |
| Edit words: add, fix, change, update, rename, create, write, remove, test… | +1 each (max +2) |
| A question (what / why / where / how does / explain / list… or ends in "?") with no edit or design words | −3 (−1 if it also has them) |
| Short message (< 200 characters, no design words) | −1 |
| Long message or pasted spec (> 1,500 characters) | +2 |
| 3 or more files named | +2 |
| First turn of a new project with a real brief (> 400 characters) | +1 |
| The previous turn had 3+ failing tool calls or failing tests | escalate one tier |

File names are removed before matching words, so `docs/PLAN.md` doesn't count as "plan".

| Score | Tier | Model (configurable) | Effort |
|---|---|---|---|
| ≤ −1 | simple | Haiku 5.5 (`TOKEN_SAVER_PROXY_TIER_SIMPLE`) | low |
| 0 – 3 | standard | Sonnet 5.5 (`TOKEN_SAVER_PROXY_TIER_STANDARD`) | unchanged |
| ≥ 4 | hard | the model Claude Code asked for (Opus) | unchanged |

Other rules:

- **Moving up is always allowed.** Moving down means re-caching the context on the cheaper model, so it happens only on a fresh conversation, a small context (≤ 40k tokens), or to the cheap tier. A Haiku cache write is so cheap that a quick question never waits.
- **Old thinking blocks are kept as they are.** Other models ignore another model's thinking blocks, and keeping the history byte-identical means a model that comes back later (Opus after a quick Haiku answer) can still read its own cache. If the API ever objects, the proxy retries once with old thinking removed.
- **Side requests without tools** (Claude Code's titles and summaries) go to Haiku.
- **Subagents** go to Sonnet. Agents that name a cheaper model in their definition already ask for it themselves.
- **A user who picked Sonnet or Haiku is never rerouted.** Only requests for an expensive model are.
- **With a budget set,** the hard tier is capped at standard once the budget is spent.

Every decision is logged with its tier, score and signals (`~/.claude/token-saver/proxy-log.jsonl`), so a misroute can be traced and the weights tuned.

## 2. Context management

Long sessions pay twice for stale context: input tokens on every request, and a model whose attention is spread over file contents read 50 steps ago. Once a conversation passes about 60k tokens (`TOKEN_SAVER_PROXY_CTX_EDIT_AT`), the proxy adds the API's server-side tool-result clearing to every request in that conversation:

```json
{ "type": "clear_tool_uses_20250919",
  "trigger": { "type": "input_tokens", "value": 60000 },
  "keep": { "type": "tool_uses", "value": 6 },
  "clear_at_least": { "type": "input_tokens", "value": 10000 } }
```

How it behaves:

- **The newest tool results stay.** The 6 most recent tool uses are always kept; older results are removed on the server.
- **Clearing is batched.** It only runs when it saves at least 10k tokens, so the cache isn't rebuilt for a small gain.
- **Claude Code's history isn't touched.** Its own copy of the conversation stays complete.
- **Claude Code's own settings are kept.** Claude Code already sends its own `context_management` (thinking settings, listed first). The proxy appends its edit after Claude Code's and adds the `context-management-2025-06-27` beta flag to the header.
- **It turns itself off if refused.** If the API rejects the edit, the proxy removes only its own entry, resends, and stops adding it.

What it clears is reported in the response's `context_management.applied_edits`, and the proxy logs it.

Compaction (summarising old turns) isn't used: Claude Code runs its own `/compact`, and the proxy treats a sudden drop in history length as a new conversation.

## Verified live

On 2026-10-17, through Claude Code with a Max subscription:
- a simple question was routed to Haiku 5.5 with Claude Code's full toolset and answered correctly;
- the merged `context_management` (Claude Code's `clear_thinking` plus the proxy's `clear_tool_uses`) was accepted;
- side requests went to Haiku.

## Limits

- **The classifier only reads the words.** A one-line request can hide a big job ("make it production-ready"). The hard-tier escalation after repeated failures and the per-decision log are the safety net.
- **Changing effort mid-conversation** invalidates the messages cache. It only happens together with a model switch at a turn boundary, where the cache is rebuilt anyway.
- **Benchmark:** see [BENCHMARKS-SMART.md](BENCHMARKS-SMART.md).
