// Offline tests for the smart policy (TOKEN_SAVER_PROXY_POLICY=smart): the classifier on
// sample messages, then the proxy end to end against a fake upstream. Nothing is billed.
//   node plugins/token-saver/proxy/smart-test.mjs
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "ts-smart-"));
Object.assign(process.env, {
  TOKEN_SAVER_HOME: home,
  TOKEN_SAVER_PROXY_POLICY: "smart",
  TOKEN_SAVER_PROXY_UPSTREAM: "http://127.0.0.1:18798",
  TOKEN_SAVER_PROXY_LOG: path.join(home, "log.jsonl"),
  TOKEN_SAVER_PROXY_CTX_EDIT_AT: "3000", // est. tokens (~12k chars) so tests can cross it
  TOKEN_SAVER_PROXY_MAX_SWITCH_CTX: "2000",
});
const { classifyTurn, decideSmart } = await import("./smart-policy.mjs");
const { start } = await import("./router-proxy.mjs");

// ---- classifier ----
const msg = (text, history = []) => ({ messages: [...history, { role: "user", content: text }] });
const prior = [{ role: "user", content: "earlier" }, { role: "assistant", content: [{ type: "text", text: "ok" }] }];
const cases = [
  ["what does the orders endpoint return?", "simple"],
  ["where is the admin password configured?", "simple"],
  ["explain how stock is reduced when an order is placed", "simple"],
  ["Add a rename button to the product card", "standard"],
  ["fix the failing test in test/orders.test.js", "standard"],
  ["Design and implement the whole admin panel: auth, product CRUD and order management across the backend and frontend, refactor the API layer for it", "hard"],
  ["Build this:\n" + "- requirement line with details about pages, api and storage\n".repeat(40), "hard"],
];
for (const [text, want] of cases) {
  const c = classifyTurn(msg(text, prior));
  assert.equal(c.tier, want, `"${text.slice(0, 50)}" -> ${c.tier} (score ${c.score}: ${c.signals.join(", ")})`);
}
// escalation: a question right after a turn with repeated failing tool calls moves up a tier
const failing = [{ role: "user", content: "run the tests" }];
for (let i = 0; i < 3; i++) failing.push(
  { role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "Bash", input: {} }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, is_error: true, content: "Error: boom" }] });
failing.push({ role: "assistant", content: [{ type: "text", text: "still failing" }] });
assert.equal(classifyTurn(msg("why does it fail?", failing)).tier, "standard", "repeated failures escalate a simple turn");
assert.equal(classifyTurn(msg("where is the admin password configured?", failing)).tier, "simple", "a plain question isn't escalated by earlier failures");
assert.equal(classifyTurn(msg("Add a rename button to the product card", failing)).tier, "hard", "a work turn after failures escalates");
assert.equal(classifyTurn(msg("How is the cart stored in the browser? Just explain, don't change anything.", failing)).tier, "simple", "a negated edit word (\"don't change\") doesn't make a question a work turn");
assert.equal(classifyTurn(msg("Fix the cart total, but don't refactor the API", prior)).tier, "standard", "only the negated verb is ignored");

// over budget with a large context: the next turn leaves Opus anyway (a plain small edit would be held)
const bigTurn = { requested: "claude-opus-5", messages: msg("Add a rename button to the product card", prior).messages, boundary: true, fresh: false, ctx: 90_000, pin: { model: "claude-opus-5", tier: "hard" } };
assert.equal(decideSmart({ ...bigTurn, overBudget: false }).model, "claude-opus-5", "large context holds the expensive model");
assert.equal(decideSmart({ ...bigTurn, overBudget: true }).model, "claude-sonnet-5-5", "over budget forces the switch down");
assert.equal(decideSmart({ ...bigTurn, boundary: false, overBudget: true }).model, "claude-opus-5", "but never mid-turn");

// ---- proxy end to end ----
const seen = [];
http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
    const body = JSON.parse(raw);
    seen.push({ body, beta: req.headers["anthropic-beta"] || "" });
    if (process.env.REJECT_CTX && body.context_management?.edits?.some((e) => e.type === "clear_tool_uses_20250919")) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end('{"type":"error","error":{"type":"invalid_request_error","message":"context_management not supported"}}');
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ type: "message_start", message: { model: body.model, usage: { input_tokens: 5 } } })}\n\n`);
    res.end(`data: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 3 }, ...(body.context_management && { context_management: { applied_edits: [{ type: "clear_tool_uses_20250919", cleared_tool_uses: 2, cleared_input_tokens: 9000 }] } }) })}\n\n`);
  });
}).listen(18798);
const proxy = start(18797);
await new Promise((r) => setTimeout(r, 100));
async function send(body) {
  const r = await fetch("http://127.0.0.1:18797/v1/messages", { method: "POST", headers: { "content-type": "application/json", "anthropic-beta": "oauth-2025-04-20" }, body: JSON.stringify({ stream: true, ...body }) });
  await r.text();
  return seen.at(-1);
}
const meta = { metadata: { user_id: "user_x_account_y_session_5ma7-0001" } };
const tools = [{ name: "Agent" }, { name: "Read" }, { name: "Bash" }];
const opus = "claude-opus-5";
let h = [];
const CC_CM = { edits: [{ type: "clear_thinking_20251015", keep: "all" }] }; // what Claude Code sends itself
const turn = async (text) => { h = [...h, { role: "user", content: text }]; return send({ model: opus, ...meta, tools, messages: h, context_management: CC_CM }); };
const reply = (blocks) => { h = [...h, { role: "assistant", content: blocks }]; };

// 1. a simple question opens the session: Haiku at low effort
let s = await turn("what is in docs/PLAN.md?");
assert.equal(s.body.model, "claude-haiku-5-5"); assert.equal(s.body.output_config?.effort, "low");
reply([{ type: "thinking", thinking: "h", signature: "haiku-sig" }, { type: "text", text: "a plan" }]);

// 2. a hard task escalates to the requested model (Opus), effort untouched
s = await turn("Design and implement the whole backend: data model, API and storage, refactor it end-to-end across files");
assert.equal(s.body.model, opus); assert.equal(s.body.output_config?.effort, undefined);
assert.ok(JSON.stringify(s.body.messages).includes("haiku-sig"), "smart policy keeps old thinking blocks (no strip)");
reply([{ type: "tool_use", id: "u1", name: "Read", input: {} }]);

// 3. mid-turn (tool result) keeps Opus even though the text looks simple
h = [...h, { role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: "x".repeat(16000) }] }];
s = await send({ model: opus, ...meta, tools, messages: h, context_management: CC_CM });
assert.equal(s.body.model, opus, "mid-turn keeps the turn's model");
reply([{ type: "text", text: "done" }]);

// 4. context is now past the context-editing threshold: clearing is added, with its beta header
const ed = s.body.context_management?.edits || [];
assert.equal(ed[0]?.type, "clear_thinking_20251015", "Claude Code's own edit stays first");
assert.equal(ed[1]?.type, "clear_tool_uses_20250919", "tool-result clearing appended past threshold");
assert.ok(s.beta.includes("context-management-2025-06-27") && s.beta.includes("oauth-2025-04-20"), "beta header merged");

// 5. a simple question after a big context still drops to Haiku (cheap to re-cache)
s = await turn("where is the admin password configured?");
assert.equal(s.body.model, "claude-haiku-5-5");
reply([{ type: "text", text: "in env" }]);

// 6. a standard edit with a large context moves up from Haiku to Sonnet (upward moves always allowed)
s = await turn("Add a rename button to the product card");
assert.equal(s.body.model, "claude-sonnet-5-5");
reply([{ type: "text", text: "added" }]);

// 7. a side request without tools (title generation) goes to Haiku
s = await send({ model: opus, ...meta, messages: [{ role: "user", content: "Write a 3-word title for this chat" }] });
assert.equal(s.body.model, "claude-haiku-5-5");

// 8. if the API rejects context editing, the proxy fails open and stops adding it
process.env.REJECT_CTX = "1";
const before = seen.length;
s = await turn("Add a delete button to the product card");
assert.equal(seen.length - before, 2, "rejected once, resent without changes");
assert.deepEqual(seen.at(-1).body.context_management, CC_CM, "only our edit removed, Claude Code's kept");
assert.equal(seen.at(-1).body.model, "claude-sonnet-5-5", "the turn keeps its routed model, only context editing is dropped");
delete process.env.REJECT_CTX;
reply([{ type: "text", text: "ok" }]);
s = await turn("Add an edit button to the product card");
assert.deepEqual(s.body.context_management, CC_CM, "tool-result clearing stays off after a rejection");
assert.equal(s.body.model, "claude-sonnet-5-5");

// 9. Sonnet/Haiku requested by the user are never rerouted
s = await send({ model: "claude-sonnet-5-5", ...meta, tools, messages: [{ role: "user", content: "Design the whole thing end-to-end" }] });
assert.equal(s.body.model, "claude-sonnet-5-5");

const log = fs.readFileSync(path.join(home, "log.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
assert.ok(log.some((e) => e.usage?.applied_edits?.[0]?.cleared_tool_uses === 2), "applied context edits are logged");
assert.ok(log.some((e) => e.tier === "hard" && e.signals?.length), "classifier signals are logged");
console.log(`ok — ${cases.length + 1} classifier cases, 9 proxy scenarios, ${seen.length} upstream calls`);
for (const e of log.filter((x) => x.requested)) console.log(`  ${e.requested} -> ${e.routed}  [${e.reason}]${e.ctxEdit ? " +ctx-edit" : ""}`);
proxy.close(); fs.rmSync(home, { recursive: true, force: true }); process.exit(0);
