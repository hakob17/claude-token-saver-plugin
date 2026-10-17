// Offline smoke test for router-proxy.mjs: a fake upstream stands in for the
// API, so nothing is billed. Run: node plugins/token-saver/proxy/smoke-test.mjs
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "ts-proxy-"));
Object.assign(process.env, {
  TOKEN_SAVER_HOME: home,
  TOKEN_SAVER_PROXY_UPSTREAM: "http://127.0.0.1:18788",
  TOKEN_SAVER_PROXY_SPEND_TTL_MS: "0",
  TOKEN_SAVER_PROXY_LOG: path.join(home, "log.jsonl"),
  TOKEN_SAVER_PROXY_SUBAGENTS: "claude-haiku-5-5",
});
const { start } = await import("./router-proxy.mjs");
const { periodKey } = await import("../scripts/budget-lib.mjs");

// Fake upstream: streams SSE, rejects model "reject-me" and any thinking block on Sonnet.
const seen = [];
const upstream = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw);
    seen.push(body);
    const hasThinking = body.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "thinking"));
    if (/sonnet/.test(body.model) && body.thinking?.type === "disabled") {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: 'To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}.' } }));
    }
    if (body.model === "reject-me" || (hasThinking && /sonnet|haiku/.test(body.model) && !body.allowThinking)) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end('{"type":"error","error":{"type":"invalid_request_error","message":"nope"}}');
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { model: body.model, usage: { input_tokens: 10, cache_read_input_tokens: 5 } } })}\n\n`);
    setTimeout(() => {
      res.write(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 7 } })}\n\n`);
      res.end("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n");
    }, 20);
  });
}).listen(18788);
const proxy = start(18787);
await new Promise((r) => setTimeout(r, 100));

async function send(body) {
  const r = await fetch("http://127.0.0.1:18787/v1/messages", {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": "test" }, body: JSON.stringify({ stream: true, ...body }),
  });
  return { status: r.status, routed: r.headers.get("x-token-saver-routed"), text: await r.text(), sent: seen.at(-1) };
}
const meta = (s) => ({ metadata: { user_id: `user_x_account_y_session_${s}` } });
const mainTools = [{ name: "Agent" }, { name: "Read" }];
const setSpend = (cost) => {
  fs.writeFileSync(path.join(home, "budget.json"), JSON.stringify({ limit: 100 }));
  const d = path.join(home, "spend", periodKey(1)); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "s.json"), JSON.stringify({ cost, base: 0 }));
};

// 1. Under budget: Opus passes through, stream relayed intact.
setSpend(10);
let r = await send({ model: "claude-opus-5-5", ...meta("aaaaaaaa-1"), tools: mainTools, messages: [{ role: "user", content: "hi" }] });
assert.equal(r.status, 200); assert.equal(r.sent.model, "claude-opus-5-5"); assert.match(r.text, /message_stop/);

// 2. Over budget, conversation already pinned to Opus: mid-turn (tool_result) is held.
setSpend(100);
const hist = [
  { role: "user", content: "hi" },
  { role: "assistant", content: [{ type: "thinking", thinking: "...", signature: "opus-sig" }, { type: "tool_use", id: "t1", name: "Read", input: {} }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] },
];
r = await send({ model: "claude-opus-5-5", ...meta("aaaaaaaa-1"), tools: mainTools, messages: hist });
assert.equal(r.sent.model, "claude-opus-5-5", "mid-turn must not switch");

// 3. Next user turn, small context: switches to Sonnet and drops the old Opus thinking.
const hist2 = [...hist, { role: "assistant", content: [{ type: "text", text: "done" }] }, { role: "user", content: "next task" }];
r = await send({ model: "claude-opus-5-5", ...meta("aaaaaaaa-1"), tools: mainTools, messages: hist2 });
assert.equal(r.status, 200); assert.equal(r.sent.model, "claude-sonnet-5-5"); assert.equal(r.routed, "claude-sonnet-5-5");
assert.ok(!JSON.stringify(r.sent.messages).includes("opus-sig"), "old thinking stripped");

// 4. Same conversation stays on Sonnet in its tool loop; new Sonnet thinking is kept.
const hist3 = [...hist2, { role: "assistant", content: [{ type: "thinking", thinking: "s", signature: "sonnet-sig" }, { type: "tool_use", id: "t2", name: "Read", input: {} }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "y" }] }];
r = await send({ model: "claude-opus-5-5", ...meta("aaaaaaaa-1"), tools: mainTools, messages: hist3, allowThinking: true });
assert.equal(r.sent.model, "claude-sonnet-5-5"); assert.ok(JSON.stringify(r.sent.messages).includes("sonnet-sig"));

// 5. A fresh conversation over budget starts on Sonnet.
r = await send({ model: "claude-opus-5-5", ...meta("bbbbbbbb-2"), tools: mainTools, messages: [{ role: "user", content: "new" }] });
assert.equal(r.sent.model, "claude-sonnet-5-5");

// 6. Subagent (no Agent tool) goes to Haiku; non-expensive requests are untouched.
setSpend(0);
r = await send({ model: "claude-opus-5-5", ...meta("cccccccc-3"), tools: [{ name: "Read" }], messages: [{ role: "user", content: "sub task" }] });
assert.equal(r.sent.model, "claude-haiku-5-5");
r = await send({ model: "claude-haiku-5-5", ...meta("cccccccc-3"), messages: [{ role: "user", content: "title" }] });
assert.equal(r.sent.model, "claude-haiku-5-5"); assert.equal(r.routed, null);

// 7. Fail open: a rewritten request rejected with 400 is resent unchanged.
process.env.TOKEN_SAVER_PROXY_SUBAGENTS = "reject-me"; // CFG is read at import; patch it
(await import("./router-proxy.mjs")).CFG.subagents = "reject-me";
r = await send({ model: "claude-opus-5-5", ...meta("dddddddd-4"), tools: [{ name: "Read" }], messages: [{ role: "user", content: "sub2" }] });
assert.equal(r.status, 200); assert.equal(r.sent.model, "claude-opus-5-5");


// 8. A combo the API rejected once is not retried for later conversations (no wasted 400).
const before = seen.length;
r = await send({ model: "claude-opus-5-5", ...meta("eeeeeeee-5"), tools: [{ name: "Read" }], messages: [{ role: "user", content: "sub3" }] });
assert.equal(r.sent.model, "claude-opus-5-5"); assert.equal(seen.length - before, 1, "single upstream call");

// 9. Claude Code appends system-role messages: still a fresh conversation / turn boundary.
setSpend(100);
r = await send({ model: "claude-opus-5-5", ...meta("ffffffff-6"), tools: mainTools, messages: [{ role: "user", content: "go" }, { role: "system", content: [{ type: "text", text: "reminder" }] }] });
assert.equal(r.sent.model, "claude-sonnet-5-5", "trailing system message must not count as mid-turn");

// 10. thinking:disabled rejected by the target: adapted to between_tools and resent, not failed open.
r = await send({ model: "claude-opus-5-5", ...meta("abababab-7"), messages: [{ role: "user", content: "title" }], thinking: { type: "disabled" } });
assert.equal(r.status, 200); assert.equal(r.sent.model, "claude-sonnet-5-5"); assert.equal(r.sent.thinking.type, "between_tools");
const n = seen.length;
r = await send({ model: "claude-opus-5-5", ...meta("abababab-8"), messages: [{ role: "user", content: "title2" }], thinking: { type: "disabled" } });
assert.equal(seen.length - n, 1, "quirk applied up front next time");

// 11. Regression (iOS benchmark): Claude Code rewrites the opening message mid-session.
// The conversation must keep its pin instead of looking "new" and going back to Opus.
setSpend(100);
const s11 = meta("1111aaaa-11");
const h11 = [{ role: "user", content: "build the app" }, { role: "assistant", content: [{ type: "thinking", thinking: "o", signature: "opus-sig-11" }, { type: "text", text: "turn 1 done" }] }];
r = await send({ model: "claude-opus-5-5", ...s11, tools: mainTools, messages: [...h11.slice(0, 1)] });
assert.equal(r.sent.model, "claude-sonnet-5-5", "fresh conversation over budget starts on Sonnet");
setSpend(10); // a pinned conversation: start it under budget instead
const s11b = meta("1111bbbb-11");
r = await send({ model: "claude-opus-5-5", ...s11b, tools: mainTools, messages: [h11[0]] });
assert.equal(r.sent.model, "claude-opus-5-5");
setSpend(100);
const turn2 = [...h11, { role: "user", content: "next turn" }];
r = await send({ model: "claude-opus-5-5", ...s11b, tools: mainTools, messages: turn2 });
assert.equal(r.sent.model, "claude-sonnet-5-5", "switches at the turn boundary");
const rewritten = [{ role: "user", content: "build the app\n<system-reminder>context changed</system-reminder>" }, ...turn2.slice(1),
  { role: "assistant", content: [{ type: "tool_use", id: "t11", name: "Read", input: {} }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "t11", content: "x" }] }];
r = await send({ model: "claude-opus-5-5", ...s11b, tools: mainTools, messages: rewritten });
assert.equal(r.sent.model, "claude-sonnet-5-5", "rewritten first message must not reset the pin");
assert.ok(!JSON.stringify(r.sent.messages).includes("opus-sig-11"), "old Opus thinking still stripped");

// 12. A tool-less side request (title, summary) in the same session doesn't disturb the main pin.
r = await send({ model: "claude-opus-5-5", ...s11b, messages: [{ role: "user", content: "title this" }] });
r = await send({ model: "claude-opus-5-5", ...s11b, tools: mainTools, messages: [...rewritten, { role: "assistant", content: [{ type: "text", text: "ok" }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t12", content: "y" }] }] });
assert.equal(r.sent.model, "claude-sonnet-5-5", "main pin survives side requests");

// 13. /clear (history shrinks to one message) starts a new conversation in the same session.
setSpend(10);
r = await send({ model: "claude-opus-5-5", ...s11b, tools: mainTools, messages: [{ role: "user", content: "new task after /clear" }] });
assert.equal(r.sent.model, "claude-opus-5-5", "/clear resets the pin; under budget it's Opus again");
const log = fs.readFileSync(path.join(home, "log.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
assert.ok(log.some((e) => e.usage?.output_tokens === 7 && e.usage?.cache_read_input_tokens === 5), "usage read from stream");
console.log(`ok — ${seen.length} upstream calls, ${log.length} log lines`);
for (const e of log) console.log(`  ${e.requested} -> ${e.routed}  [${e.reason || e.note}] status=${e.status}`);
proxy.close(); upstream.close(); fs.rmSync(home, { recursive: true, force: true });
process.exit(0);
