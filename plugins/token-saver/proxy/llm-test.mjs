// Offline test for the local-model classifier (TOKEN_SAVER_CLASSIFIER=ollama), against a fake
// Ollama and a fake API. Nothing is billed and no real model is needed.
//   node plugins/token-saver/proxy/llm-test.mjs
// To check the real local model instead: node plugins/token-saver/proxy/llm-test.mjs --live
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const live = process.argv.includes("--live");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "ts-llm-"));
Object.assign(process.env, {
  TOKEN_SAVER_HOME: home,
  TOKEN_SAVER_PROXY_POLICY: "smart",
  TOKEN_SAVER_CLASSIFIER: "ollama",
  TOKEN_SAVER_PROXY_UPSTREAM: "http://127.0.0.1:18898",
  TOKEN_SAVER_PROXY_LOG: path.join(home, "log.jsonl"),
  ...(!live && { TOKEN_SAVER_OLLAMA_URL: "http://127.0.0.1:18899", TOKEN_SAVER_CLASSIFIER_TIMEOUT_MS: "300" }),
});
const { askOllama, LLM } = await import("./llm-classifier.mjs");

if (live) {
  // Real model: show what it decides for typical requests, with timings.
  const cases = ["where is the admin password configured?", "How is the cart stored? Just explain, don't change anything.",
    "Add a rename button to the product card", "fix the failing test in test/orders.test.js", "make it production-ready",
    "Rename getUser to fetchUser across the codebase", "Design and implement the whole admin panel with auth and order management",
    "list the npm scripts", "why does checkout return 500?", "build the settings page end-to-end"];
  console.log(`ollama ${LLM.model} at ${LLM.url}, timeout ${LLM.timeoutMs}ms`);
  for (const c of cases) { const r = await askOllama(c, { ...LLM, timeoutMs: 30_000 }); console.log(`${(r?.tier || "FAILED").padEnd(9)} ${String(r?.ms ?? "").padStart(5)}ms  ${c}`); }
  process.exit(0);
}

// Fake Ollama: answers by keyword, can be slow or broken on demand.
let asked = 0, mode = "ok";
http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
    if (req.url === "/api/generate") return res.end("{}"); // warm-up
    asked++;
    const text = JSON.parse(raw).messages.at(-1).content;
    const tier = /production-ready|whole/i.test(text) ? "hard" : /\?/.test(text) ? "simple" : "standard";
    const reply = () => res.end(JSON.stringify({ message: { content: mode === "garbage" ? "not json" : JSON.stringify({ tier, reason: "fake" }) } }));
    mode === "slow" ? setTimeout(reply, 800) : reply();
  });
}).listen(18899);
// Fake API: echoes the model in the stream.
const seen = [];
http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
    const body = JSON.parse(raw); seen.push(body);
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ type: "message_start", message: { model: body.model, usage: { input_tokens: 5 } } })}\n\n`);
    res.end(`data: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 3 } })}\n\n`);
  });
}).listen(18898);
const { start } = await import("./router-proxy.mjs");
const proxy = start(18897);
await new Promise((r) => setTimeout(r, 150));

const tools = [{ name: "Agent" }, { name: "Read" }];
let n = 0;
const send = (messages, session = `5ma7-1${String(++n).padStart(3, "0")}`) => fetch("http://127.0.0.1:18897/v1/messages", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "claude-opus-5", stream: true, tools, metadata: { user_id: `user_x_account_y_session_${session}` }, messages }) }).then((r) => r.text()).then(() => seen.at(-1));
const log = () => fs.readFileSync(path.join(home, "log.jsonl"), "utf8").trim().split("\n").map(JSON.parse).filter((e) => e.requested).at(-1);

// 1. the local model decides: the heuristic says simple (score -1, "short message") for this, the model says hard
let s = await send([{ role: "user", content: "make it production-ready" }]);
assert.equal(s.model, "claude-opus-5", "local model: hard -> requested model");
assert.ok(log().signals.some((x) => /^ollama .*: hard/.test(x)) && log().signals.some((x) => /heuristic would say simple/.test(x)), "both views logged");

// 2. a question goes to Haiku, and the same text again is answered from the cache
const before = asked;
s = await send([{ role: "user", content: "where is the admin password configured?" }]);
assert.equal(s.model, "claude-haiku-5-5");
await send([{ role: "user", content: "where is the admin password configured?" }]);
assert.equal(asked, before + 1, "second identical question comes from the cache");

// 3. mid-turn requests don't ask the model again
const sess = "5ma7-2001";
await send([{ role: "user", content: "Add a delete button" }], sess);
const mid = asked;
s = await send([{ role: "user", content: "Add a delete button" }, { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] }], sess);
assert.equal(asked, mid, "tool-loop step: not classified again");
assert.equal(s.model, "claude-sonnet-5-5");

// 4. slow model: falls back to the heuristic within the timeout
mode = "slow";
const t0 = Date.now();
s = await send([{ role: "user", content: "explain how stock is reduced?" }]);
assert.ok(Date.now() - t0 < 700, "doesn't wait for a slow model");
assert.equal(s.model, "claude-haiku-5-5", "heuristic decided");
assert.ok(log().signals.some((x) => /heuristic used/.test(x)));

// 5. nonsense answer: heuristic again
mode = "garbage";
s = await send([{ role: "user", content: "Design and implement the whole backend across files" }]);
assert.equal(s.model, "claude-opus-5");
assert.ok(log().signals.some((x) => /heuristic used/.test(x)));

// 6. escalation after repeated failures still applies on top of the model's answer
mode = "ok";
const failing = [{ role: "user", content: "run the tests" }];
for (let i = 0; i < 3; i++) failing.push({ role: "assistant", content: [{ type: "tool_use", id: `f${i}`, name: "Bash", input: {} }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: `f${i}`, is_error: true, content: "Error: boom" }] });
failing.push({ role: "assistant", content: [{ type: "text", text: "still failing" }] }, { role: "user", content: "fix the checkout bug" });
s = await send(failing);
assert.equal(s.model, "claude-opus-5", "model said standard, escalated to hard after failures");

console.log(`ok — local-model classifier: 6 scenarios, ${asked} model calls`);
proxy.close(); fs.rmSync(home, { recursive: true, force: true }); process.exit(0);
