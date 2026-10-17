# Routing proxy: design note and benchmark plan *(experimental)*

Status: prototype. Offline smoke test passes (13 scenarios); live routing verified on a Max subscription; benchmarked on one full iOS app build (see [BENCHMARKS-IOS.md](BENCHMARKS-IOS.md)): **$14.21 vs $29.63 without the plugin (−52%)**, with every quality check passing. One run, so treat the size of the saving as an estimate.

## Why a proxy

The hook router (`scripts/route-edits.mjs`) sees a tool call only after Opus has generated it. When it blocks a large write, Opus has already paid for writing that code, and then pays again to write a delegation spec. On the big feature that cost **+31%** ([BENCHMARKS.md](BENCHMARKS.md)).

A gateway sits in front of the API instead: Claude Code sends every request to `ANTHROPIC_BASE_URL`, and the gateway decides which model serves it before any tokens are generated. That's the pattern from the EPAM DIAL demo, where a model alias was backed by a small app that switched from Opus to a cheaper model once $100 had been spent. This prototype does the same thing locally, with no dependencies and no separate service.

```
claude ──HTTP──▶ 127.0.0.1:8787 (router-proxy) ──HTTPS──▶ api.anthropic.com
                 │ reads budget ledger (budget-lib.mjs)
                 │ rewrites body.model, maybe strips old thinking
                 └ appends usage to ~/.claude/token-saver/proxy-log.jsonl
```

## Rules

Only requests whose `model` matches `/opus|fable|mythos/` are ever rewritten. Sonnet, Haiku, and Claude Code's own small calls (titles, summaries) pass through untouched.

1. **Budget failover.** `periodTotal()` from `budget-lib.mjs` (cached for 10 s) is compared with the configured monthly limit. At `TOKEN_SAVER_PROXY_THRESHOLD` (default 100%) the target becomes `TOKEN_SAVER_PROXY_FALLBACK` (default `claude-sonnet-5-5`).
2. **Subagents (optional).** With `TOKEN_SAVER_PROXY_SUBAGENTS=<model id>`, subagent requests go to that model. Detection: the main thread's tool list contains the `Agent` (formerly `Task`) tool, and subagents' lists don't. Requests with no tools at all are not treated as subagents. This only matters for subagents that inherit Opus; agents with `model:` in their frontmatter already ask for the cheaper model.

## When the model may change: cache and conversation identity

The prompt cache is per model. Switching a conversation's model means the next request rewrites the whole prefix into a new cache: a cache *write* (1.25× base input on the new model) instead of a cache *read* (0.1× on the old one). With a 100k-token context, that one switch costs about as much input as ten more cached Opus requests. So the proxy pins a model to each **conversation** and changes it only at a boundary:

- **Conversation key** = session id (`metadata.user_id` → `session_<uuid>`, else the `x-claude-code-session-id` header) + main or subagent + a hash of the first message. `/clear` and `/compact` replace the first message, so they start a new conversation, which is a free switch point. Each subagent run is its own conversation.
- **Fresh conversation** (first request): use the target model straight away. Nothing is cached yet.
- **Mid-turn** (the last message contains a `tool_result`, i.e. Claude is in its tool loop): never switch. That would bust the cache and break the thinking chain, which has to stay intact across the tool loop.
- **Turn boundary** (the last message is the user's text): switch only if `TOKEN_SAVER_PROXY_SWITCH=turn` (the default) and the estimated context is ≤ `TOKEN_SAVER_PROXY_MAX_SWITCH_CTX` (40k tokens), so re-caching is cheap. Past `TOKEN_SAVER_PROXY_HARD` (110% of budget), switch at the next boundary whatever the size, to cap overshoot.
- `TOKEN_SAVER_PROXY_SWITCH=session`: switch only for fresh conversations, plus the hard-limit escape.

Consequence: a long Opus session that crosses the budget keeps running on Opus until the next `/clear`, `/compact` or new session, unless it goes past the hard limit. Because Claude Code itself re-sends the full history, a switch never loses context. It only costs one cache write.

Pins live in memory (LRU, 2,000 conversations). After a proxy restart, a running conversation is treated as already on the model it asks for, so a restart can never cause a switch mid-turn.

## Thinking blocks

Thinking blocks carry signatures that are only valid for the model that produced them. Within a turn's tool loop, those blocks must be sent back unchanged, which is one more reason never to switch mid-turn. Thinking from previous turns may be omitted. So when a conversation switches, the proxy records the switch point (the index of that boundary user message) and drops `thinking`/`redacted_thinking` blocks from assistant messages **before** that index, on that request and on every later one. Messages after the switch point are left alone, so the prefix stays byte-stable and later requests hit the cache. An assistant message left empty gets a placeholder text block.

## Streaming and other passthrough details

- The response (SSE or JSON) is piped to Claude Code chunk by chunk without buffering. The proxy reads `message_start`/`message_delta` usage on the side for its log. Upstream is asked for `accept-encoding: identity` so the stream is readable.
- All headers pass through: `x-api-key`/`authorization`, `anthropic-version`, `anthropic-beta`. A rewritten response gets an `x-token-saver-routed: <model>` header.
- **Fail open:** if a *rewritten* request gets a 400 (for example a beta header such as 1M context, an effort/thinking parameter, or a block the fallback model rejects), the proxy resends the original request once and pins the conversation back to the requested model. 429, 5xx and network errors are passed through as they are.
- A rewrite the API rejected once (same target model and `anthropic-beta` header) is not tried again while the proxy runs, so later conversations don't pay the extra 400 round trip.
- `/v1/messages/count_tokens` gets the same model decision but doesn't update pins. Every other path is proxied unchanged.
- If the client disconnects, the upstream request is aborted.
- It binds to `127.0.0.1` only. `GET /token-saver/status` shows the config, budget and pins.

## Findings from live tests (2026-10-16)

- Claude Code (2.1.228) adds a `system`-role message at the **end** of `messages`. The proxy ignores system-role messages when it decides whether a request is a fresh conversation or a turn boundary. Before this fix, every running conversation looked "mid-turn" and was never switched.
- Claude Code's small side requests (no tools) ask Opus with `thinking: {type: "disabled"}`, which `claude-sonnet-5-5` rejects ("send `{type: "between_tools"}` instead"). The proxy learns such differences from the 400 message, adapts the request and resends the rewrite once. Later requests to that model get the adaptation up front. Only unknown rejections fall back to the original model.
- On the CLI default, the `opus` alias resolves to `claude-opus-5`.

- **Conversation identity is unstable (found in the full-app benchmark, 2026-10-17).** The proxy identifies a conversation by hashing its first message, but Claude Code rewrites that message mid-session (and again on `--resume`). In the iOS build the failover worked at the turn-3 boundary: it switched to Sonnet, dropped 18 old thinking blocks, and the next request read 99k cached tokens. One request later the hash changed, the proxy saw a "new" conversation already mid-turn, put it back on Opus with a 365k-token cache write, and held Opus for the rest of the build (98% of cost on Opus, +6% vs. no plugin). **Fixed:** the main thread (requests with the `Agent` tool) is now keyed by session id, and a drop of the history to ≤2 messages is treated as `/clear`/`/compact`. Smoke tests 11–13 cover a rewritten first message, side requests in the same session, and `/clear`. The re-run kept one conversation key for the whole build and stayed on Sonnet after the switch.

## Known gaps and risks

- **Spend source.** The ledger is fed by the token-saver status line (install Option B). Without it, the spend stays at $0 and failover never triggers (the proxy says so at startup). The proxy logs real usage but doesn't write it to the ledger, to avoid double counting.
- **Cost display (verified 2026-10-16, CLI 2.1.228).** Claude Code prices usage by the model it *requested*. A request rewritten to Sonnet still shows up in `/cost`, `--output-format json` `modelUsage` and the status line as `claude-opus-5` at Opus rates. So after failover the ledger **overstates** spend: failover stays tripped, which is harmless, but the reported totals are wrong. The proxy log (`usage.model`) has the true serving model. A fix would be for the proxy to keep its own priced ledger.
- **Subagent heuristic** depends on Claude Code's tool naming. If a custom agent is given the `Agent` tool, it counts as main thread.
- **Subscription (Max) login works (verified 2026-10-16).** Claude Code sends its OAuth bearer token to a custom `ANTHROPIC_BASE_URL`, the proxy forwards it, and rewritten requests are served by `claude-sonnet-5-5`. On a subscription, the dollar budget is the API-equivalent figure Claude Code reports, so it works as a proxy for saving the Opus usage allowance rather than real dollars. Note: a shell with `ANTHROPIC_API_KEY` set makes Claude Code use that key instead.
- No auth on the local port: any local process could use it to reach the API with whatever key *it* sends. It adds no credentials of its own.
- The fallback model id is hard-coded by default. Check it against the current model list when models change.

## Benchmark plan (not run, because runs bill the account)

The plan reuses the existing harness (`bench/run.mjs`, fixture project, quality checks). The proxy is enabled per run by setting `ANTHROPIC_BASE_URL` in that run's environment, and every run also records the proxy log, so costs can be checked against the API's own usage numbers.

| ID | Configuration | Task(s) | Runs | Question |
|---|---|---|---|---|
| B0 | Opus, no proxy | `feature`, `bigfeature` | 3 each | Baseline (already in BENCHMARKS.md; re-run on the current CLI) |
| B1 | Opus via proxy, budget not reached | same | 3 each | Proxy overhead: cost and latency should match B0 within noise |
| B2 | Opus via proxy, budget pre-tripped (ledger seeded over the limit) | same | 3 each | Fresh conversations go straight to Sonnet: cost and quality against B0 and a plain Sonnet run |
| B3 | Opus via proxy, `SUBAGENTS=claude-sonnet-5-5`, budget not reached | `bigfeature` (prompted to use subagents) | 3 | Does sending inherited-Opus subagents to Sonnet save money without hurting quality? |
| B4 | Multi-turn script: 2 turns on Opus, ledger tripped between turns, 3rd turn | `feature` split into 3 prompts (`claude -p --resume`) | 3 each for `turn` and `session` modes | Switch behaviour: cache write cost at the switch, thinking-strip errors (expect 0 fail-opens), and what `/cost` reports afterwards |
| B5 | Same as B4 with a large context (> 40k) at the switch point | `bigfeature` + `explain` follow-ups | 2 | The hold-until-boundary rule keeps the cache, and the hard limit forces a switch |

Metrics per run: total $ (from the API usage in the proxy log, priced with the current price table), $ reported by Claude Code, cache read/write tokens before and after a switch, number of fail-open retries, quality check pass/fail, wall time.

Estimated spend: B0–B3 ≈ 30 runs at $0.2–$1.5 each ≈ **$15–25**. B4–B5 ≈ 10 multi-turn runs ≈ **$5–10**. Cap it with `--budget 35`.

Success criteria for making it more than experimental: B1 within ±5% of B0. B2 within 10% of plain Sonnet cost with no quality regressions. Zero fail-opens on the current models in B4. A documented, correct answer to the cost-display question.
