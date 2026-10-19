// Offline test of the team gateway against a fake API: keys, auth swap, usage records,
// limits (downgrade and block), manager credits, model caps and the admin API. Nothing is billed.
//   node plugins/token-saver/team/team-test.mjs
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "ts-team-"));
Object.assign(process.env, {
  TOKEN_SAVER_HOME: home,
  TOKEN_SAVER_PROXY_UPSTREAM: "http://127.0.0.1:18898",
  TOKEN_SAVER_TEAM_DIR: path.join(home, "team"),
  TOKEN_SAVER_TEAM_PORT: "18897",
  TOKEN_SAVER_TEAM_API_KEY: "sk-team-upstream",
  TOKEN_SAVER_ADMIN_TOKEN: "admin-secret",
});
const { startGateway } = await import("./gateway.mjs");

// Fake API: every response uses 1M input + 100k output tokens, so prices are easy to check
// (Opus 5: $5 + $2.50 = $7.50, Sonnet 5.5: $2 + $1 = $3, Haiku 5.5: $0.10 + $0.05 = $0.15).
const seen = [];
http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
    const body = JSON.parse(raw);
    seen.push({ body, headers: req.headers });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ type: "message_start", message: { model: body.model, usage: { input_tokens: 1_000_000 } } })}\n\n`);
    res.end(`data: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 100_000 } })}\n\n`);
  });
}).listen(18898);
const { server, store } = startGateway();
await new Promise((r) => setTimeout(r, 100));

const base = "http://127.0.0.1:18897";
const admin = (p, method = "GET", body) => fetch(base + p, { method, headers: { authorization: "Bearer admin-secret", "content-type": "application/json" }, ...(body && { body: JSON.stringify(body) }) }).then(async (r) => ({ status: r.status, json: await r.json() }));
const tools = [{ name: "Agent" }, { name: "Read" }];
let sess = 0;
async function ask(headers, text, model = "claude-opus-5") {
  const r = await fetch(base + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ model, stream: true, tools, metadata: { user_id: `user_x_account_y_session_s${++sess}` }, messages: [{ role: "user", content: text }] }) });
  const t = await r.text();
  return { status: r.status, text: t, up: seen.at(-1) };
}
const HARD = "Design and implement the whole backend: data model, API and storage, refactor it end-to-end across files";

// 1. admin API needs the token; engineers are created with a one-time key
assert.equal((await fetch(base + "/admin/api/overview")).status, 401, "admin API is protected");
const alice = (await admin("/admin/api/engineers", "POST", { name: "Alice", team: "Payments", monthlyLimit: 10, overLimit: "downgrade" })).json;
const bob = (await admin("/admin/api/engineers", "POST", { name: "Bob", team: "Payments", monthlyLimit: 10, overLimit: "block" })).json;
const cara = (await admin("/admin/api/engineers", "POST", { name: "Cara", team: "Web", monthlyLimit: 0, modelCap: "sonnet" })).json;
assert.match(alice.key, /^tsk_/);
assert.ok(!JSON.stringify(store.get("alice")).includes(alice.key), "only a hash of the key is stored");

// 2. unknown key -> 401; a tsk_ API key is swapped for the team key upstream
assert.equal((await ask({ "x-api-key": "tsk_nope" }, "hi")).status, 401);
let r = await ask({ "x-api-key": alice.key }, HARD);
assert.equal(r.status, 200);
assert.equal(r.up.headers["x-api-key"], "sk-team-upstream", "team key used upstream");
assert.equal(r.up.body.model, "claude-opus-5", "hard turn stays on the requested model");

// 3. own login + x-token-saver-key: own auth forwarded, gateway header stripped
r = await ask({ authorization: "Bearer oauth-own-token", "x-token-saver-key": alice.key }, "where is the admin password configured?");
assert.equal(r.up.headers.authorization, "Bearer oauth-own-token");
assert.equal(r.up.headers["x-token-saver-key"], undefined);
assert.equal(r.up.body.model, "claude-haiku-5-5", "smart policy: simple question -> Haiku");

// 4. usage is recorded per engineer with what it would have cost on the requested model
const ev = store.events.filter((e) => e.user === "alice");
assert.equal(ev.length, 2);
assert.equal(ev[0].cost, 7.5); assert.equal(ev[1].cost, 0.15); assert.equal(ev[1].wouldCost, 7.5);
assert.equal(ev[1].category, "Simple turn → Haiku");

// 5. downgrade mode: over the limit ($7.65 + $7.50 > $10), a hard turn goes to Sonnet instead of Opus
await ask({ "x-api-key": alice.key }, HARD);
r = await ask({ "x-api-key": alice.key }, HARD);
assert.equal(r.status, 200);
assert.equal(r.up.body.model, "claude-sonnet-5-5", "over limit -> downgraded to Sonnet");

// 6. block mode: over the limit -> 403 with a readable message; a manager credit unblocks
await ask({ "x-api-key": bob.key }, HARD); await ask({ "x-api-key": bob.key }, HARD); // $15 > $10
const before = seen.length;
r = await ask({ "x-api-key": bob.key }, HARD);
assert.equal(r.status, 403); assert.match(r.text, /monthly budget reached/);
assert.equal(seen.length, before, "blocked request never reaches the API");
let d = (await admin("/admin/api/engineers/bob/credit", "POST", { amount: 10, note: "release week" })).json;
assert.equal(d.engineer.effectiveLimit, 20);
assert.equal((await ask({ "x-api-key": bob.key }, HARD)).status, 200, "credit unblocks");

// 7. lowering the limit and disabling take effect at once
await admin("/admin/api/engineers/bob", "PATCH", { monthlyLimit: 1 });
assert.equal((await ask({ "x-api-key": bob.key }, HARD)).status, 403, "lower limit blocks again");
await admin("/admin/api/engineers/alice", "PATCH", { active: false });
r = await ask({ "x-api-key": alice.key }, "hi");
assert.equal(r.status, 403); assert.match(r.text, /disabled/);

// 8. model cap: Cara is capped at Sonnet even for a hard turn; no limit means never blocked
r = await ask({ "x-api-key": cara.key }, HARD);
assert.equal(r.up.body.model, "claude-sonnet-5-5");
assert.equal(store.events.at(-1).category, "Manager model cap");

// 9. invalid changes are refused; every change is in the audit trail
assert.equal((await admin("/admin/api/engineers/bob", "PATCH", { overLimit: "explode" })).status, 400);
const audit = (await admin("/admin/api/audit")).json;
assert.ok(audit.some((a) => a.action === "credit" && a.amount === 10 && a.note === "release week"));
assert.ok(audit.some((a) => a.action === "update" && a.engineer === "bob" && a.to.monthlyLimit === 1));

// 10. overview and rotate-key
const o = (await admin("/admin/api/overview?days=7")).json;
assert.equal(o.engineers.length, 3);
assert.equal(o.engineers.find((e) => e.id === "bob").state, "blocked");
assert.equal(o.engineers.find((e) => e.id === "alice").state, "disabled");
assert.ok(o.totals.saved > 0 && o.totals.blocked >= 2);
assert.ok(o.routing.categories["Blocked: over limit or disabled"].requests >= 2);
const nk = (await admin("/admin/api/engineers/cara/rotate-key", "POST")).json.key;
assert.equal((await ask({ "x-api-key": cara.key }, "hi")).status, 401, "old key stops working");
assert.equal((await ask({ "x-api-key": nk }, "what is this?")).status, 200);
assert.equal((await fetch(base + "/admin")).status, 200, "dashboard is served");

console.log(`ok — team gateway: ${seen.length} upstream calls, ${store.events.length} usage records, ${audit.length} audit entries`);
server.close(); fs.rmSync(home, { recursive: true, force: true }); process.exit(0);
