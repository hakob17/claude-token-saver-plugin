# Team gateway and manager dashboard *(experimental)*

One shared routing proxy for a whole team. Every engineer points Claude Code at it with a personal gateway key. Managers get a dashboard that shows:
- who spent how much,
- on which models,
- what the router decided,
- and controls to top up, lower or cap each engineer.

Code: [`team/gateway.mjs`](../plugins/token-saver/team/gateway.mjs) (server and admin API), [`team/store.mjs`](../plugins/token-saver/team/store.mjs) (data), [`team/dashboard.html`](../plugins/token-saver/team/dashboard.html) (the dashboard, no build step). Test: [`team/team-test.mjs`](../plugins/token-saver/team/team-test.mjs), run against a fake API. No dependencies; Node 18+.

## Run it

```bash
TOKEN_SAVER_ADMIN_TOKEN=<long random string> \
TOKEN_SAVER_TEAM_API_KEY=sk-ant-... \
TOKEN_SAVER_TEAM_HOST=0.0.0.0 \
node plugins/token-saver/team/gateway.mjs
# dashboard: http://<host>:8790/admin
```

| Variable | Default | Meaning |
|---|---|---|
| `TOKEN_SAVER_ADMIN_TOKEN` | random, printed at start | Token for the dashboard and admin API |
| `TOKEN_SAVER_TEAM_API_KEY` | none | Anthropic key the gateway uses for engineers who sign in with their gateway key |
| `TOKEN_SAVER_TEAM_PORT` / `_HOST` | `8790` / `127.0.0.1` | Where it listens. Use `0.0.0.0` behind TLS for a team |
| `TOKEN_SAVER_TEAM_DIR` | `~/.claude/token-saver/team` | Engineers, audit trail (`team.json`), usage (`usage.jsonl`) |
| `TOKEN_SAVER_PROXY_POLICY` | `smart` | Routing policy (see [SMART-ROUTER.md](SMART-ROUTER.md)); `budget` for failover only |

The dashboard's **Add engineer** button creates a key, shown once; only a hash is stored. Engineers use the key in one of two ways:

```bash
# The team pays through the gateway's API key: the gateway key replaces the API key
ANTHROPIC_BASE_URL=https://gateway.example:8790 ANTHROPIC_API_KEY=tsk_... claude

# The engineer keeps their own login (API key or subscription): the gateway key goes in a header
ANTHROPIC_BASE_URL=https://gateway.example:8790 ANTHROPIC_CUSTOM_HEADERS="x-token-saver-key: tsk_..." claude
```

The gateway strips `x-token-saver-key` before forwarding. In the first mode it replaces the `tsk_` key with the team key. In the second it passes the engineer's own credentials through unchanged.

## What managers see

- **Spend this month** against the sum of all limits, **savings from routing** (cost if every request had run on the model Claude Code asked for, minus the actual cost), request count and the share sent to a cheaper model, and who needs attention.
- **Daily spend by model** (Opus, Sonnet, Haiku), with a table view.
- **How the router decided**:
  - requests per decision: simple turn → Haiku, standard turn → Sonnet, hard turn → requested model, kept mid-turn, side request, subagent, held because the context was too large, manager cap, blocked;
  - each decision's cost and savings;
  - a table of the model asked for against the model that answered.
- **Engineers**: month spend against limit, status (within limit / near limit / over limit and downgraded / blocked / disabled), model mix, rerouted share, savings, rules, last activity.
- **Engineer panel**: top-ups, limit, rules, daily spend, router decisions, the last 25 requests (asked → ran on, why, cost), and the change history.
- **Manager actions**: every limit change, top-up, cap and key rotation, with who did it and an optional reason.

## What managers can change

| Control | Effect |
|---|---|
| **Monthly limit** | Budget in USD per calendar month (0 = no limit). Lowering it takes effect on the next request. |
| **Top-up** | Adds to this month's limit only (a negative amount takes budget away). Next month starts from the monthly limit again. |
| **When the limit is reached: Downgrade** | The router stops using the expensive model. The budget policy fails over at the next turn boundary; the smart policy caps hard turns at Sonnet. Work continues more cheaply. |
| **When the limit is reached: Block** | Requests get a 403 with a readable message ("monthly budget reached ($X of $Y). Ask your manager for a top-up.") and never reach the API. |
| **Highest model allowed** | *Up to Sonnet* or *Haiku only*. Applies to every request, whatever the budget. |
| **Disable access / Rotate key** | Refuse all requests, or issue a new key (the old one stops working at once). |

## How it fits the proxy

The gateway starts the same [`router-proxy.mjs`](../plugins/token-saver/proxy/router-proxy.mjs) with a set of optional hooks:
- `identify` (key → engineer);
- `budget` (that engineer's month spend and limit, fed to the existing failover and smart-policy budget rules);
- `gate` (block or disabled);
- `adjust` (model cap, applied before the conversation is pinned so the cap counts as a normal switch);
- `headers` (auth swap);
- `onLog` (one usage record per relayed request, priced from the usage in the response).

Conversations are pinned per engineer, so two engineers never share a pin. The single-user `/token-saver/status` page is turned off on the gateway because it would list everyone's conversations.

## Limits

- **Prices are API list prices** for the model that actually answered, computed from the usage the API returns. With a subscription login the engineer isn't billed per token; the dashboard still shows the API-equivalent cost.
- **One process, files on disk.** Fine for a team of tens. Usage is kept in memory for reports, so very long histories should be rotated. There's no high-availability mode.
- **One admin token, no per-manager accounts.** The audit trail records "manager" as the actor. Put the gateway behind your SSO proxy and TLS before exposing it beyond localhost.
- **A downgrade waits for a turn boundary** (by design, to keep the prompt cache). An engineer can go a little past the limit within a turn. Block mode stops at the next request.

## Try it with demo data

```bash
TOKEN_SAVER_TEAM_DIR=/tmp/ts-team-demo node plugins/token-saver/team/seed-demo.mjs   # 8 made-up engineers, 30 days
TOKEN_SAVER_TEAM_DIR=/tmp/ts-team-demo TOKEN_SAVER_ADMIN_TOKEN=demo-admin node plugins/token-saver/team/gateway.mjs
# open http://127.0.0.1:8790/admin, token: demo-admin
```
