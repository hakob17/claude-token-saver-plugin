#!/usr/bin/env node
// EXPERIMENTAL. Local routing proxy for Claude Code: point ANTHROPIC_BASE_URL at
// it and it picks the model per request, BEFORE generation (the hook router in
// scripts/route-edits.mjs can only block after Opus has written the code).
//
//   node plugins/token-saver/proxy/router-proxy.mjs
//   ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude
//
// Rules (only requests for an expensive model are ever rewritten):
//   1. Budget failover: once this period's spend (budget-lib ledger, fed by the
//      status line) reaches the threshold, Opus requests go to the fallback model.
//   2. Optional: subagent requests go to a cheaper model.
// A conversation keeps its model until a boundary (new conversation, or a new
// user turn with a small context), so the prompt cache isn't thrown away
// mid tool-loop. See bench/ROUTING-PROXY.md for the design.
//
// No dependencies; Node 18+.
import http from "node:http";
import { StringDecoder } from "node:string_decoder";
import https from "node:https";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DIR, readConfig, periodTotal } from "../scripts/budget-lib.mjs";
import { decideSmart, contextEdits, CTX_BETA } from "./smart-policy.mjs";

const env = process.env;
export const CFG = {
  port: Number(env.TOKEN_SAVER_PROXY_PORT || 8787),
  upstream: env.TOKEN_SAVER_PROXY_UPSTREAM || "https://api.anthropic.com",
  // "budget" (default): failover only. "smart": per-turn routing by task complexity + context management.
  policy: env.TOKEN_SAVER_PROXY_POLICY || "budget",
  fallback: env.TOKEN_SAVER_PROXY_FALLBACK || "claude-sonnet-5-5",
  threshold: Number(env.TOKEN_SAVER_PROXY_THRESHOLD || 1.0), // fraction of the budget
  hard: Number(env.TOKEN_SAVER_PROXY_HARD || 1.1), // past this, switch at the next turn regardless of context size
  subagents: env.TOKEN_SAVER_PROXY_SUBAGENTS || "off", // "off" or a model id
  switchAt: env.TOKEN_SAVER_PROXY_SWITCH || "turn", // "turn" | "session"
  maxSwitchCtx: Number(env.TOKEN_SAVER_PROXY_MAX_SWITCH_CTX || 40_000), // est. tokens
  // Own ledger: with a budget here, the proxy prices the usage it relays and
  // fails over on that, instead of the status-line ledger (useful headless).
  ownBudget: Number(env.TOKEN_SAVER_PROXY_BUDGET || 0),
  spendTtlMs: Number(env.TOKEN_SAVER_PROXY_SPEND_TTL_MS ?? 10_000),
  log: env.TOKEN_SAVER_PROXY_LOG || path.join(DIR, "proxy-log.jsonl"),
};
const EXPENSIVE = /opus|fable|mythos/i;

// ---------- request inspection (pure) ----------

export function sessionOf(body, headers = {}) {
  const uid = String(body?.metadata?.user_id || "");
  const m = uid.match(/session_([0-9a-f-]{8,})/i);
  return (m && m[1]) || headers["x-claude-code-session-id"] || "anon";
}

// Leading text of a message, without serialising large content (images, files).
function leadText(c, max = 4000) {
  if (typeof c === "string") return c.slice(0, max);
  let out = "";
  for (const b of Array.isArray(c) ? c : []) {
    out += b?.type === "text" ? b.text : b?.type || "";
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

// The conversation proper: Claude Code also sends system-role messages
// (reminders), which say nothing about turns.
const convo = (body) => (body?.messages || []).filter((m) => m?.role !== "system");

// Subagents don't get the Agent/Task tool; the main thread does. Requests
// without tools (titles, summaries) are not subagents.
export function isSubagent(body) {
  const tools = body?.tools;
  if (!Array.isArray(tools) || tools.length === 0) return false;
  return !tools.some((t) => t && (t.name === "Agent" || t.name === "Task"));
}

// Which conversation a request belongs to. The main thread (it has the Agent
// tool) is keyed by session id alone: Claude Code rewrites the opening message
// mid-session and on --resume, so hashing it splits one conversation into many
// (each split looked "new", lost its pin and went back to Opus mid-turn).
// /clear and /compact are detected separately, by the history shrinking.
// Subagent runs and tool-less side requests (titles, summaries) are short-lived,
// so they're keyed by their first message.
export function conversationKey(body, headers) {
  const session = sessionOf(body, headers);
  const tools = body?.tools;
  if (Array.isArray(tools) && tools.length && !isSubagent(body)) return `${session}:main`;
  const first = leadText(convo(body)[0]?.content);
  const kind = isSubagent(body) ? "sub" : "aux";
  return `${session}:${kind}:${crypto.createHash("sha1").update(first).digest("hex").slice(0, 12)}`;
}

// /clear or /compact on the main thread: the history shrank to a fresh start.
export function isReset(pin, n) {
  return !!pin && Number.isInteger(pin.n) && n < pin.n && n <= 2;
}

// A turn boundary: the last message is the user typing, not a tool result.
export function isTurnBoundary(body) {
  const msgs = convo(body);
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== "user") return false;
  if (typeof last.content === "string") return true;
  return Array.isArray(last.content) && !last.content.some((b) => b?.type === "tool_result");
}

// Per-model request differences the API tells us about in its 400 message.
// Today: some models reject thinking {type:"disabled"} and want "between_tools".
const quirks = new Map(); // model -> { thinkingOff }
export function applyQuirks(body, model) {
  const q = quirks.get(model);
  if (q?.thinkingOff && body.thinking?.type === "disabled") { body.thinking = { type: q.thinkingOff }; return true; }
  return false;
}
export function learnQuirk(model, errorText) {
  const m = /send \\?"thinking\\?":\s*\{\\?"type\\?":\s*\\?"([a-z_]+)\\?"\}\s*instead of \{\\?"type\\?":\s*\\?"disabled/.exec(errorText);
  if (!m) return false;
  quirks.set(model, { ...quirks.get(model), thinkingOff: m[1] });
  return true;
}

export const estTokens = (raw) => Math.round(raw.length / 4);

// ---------- routing decision (pure) ----------
// pin: { model, switchIndex } for this conversation, or undefined.
export function decide({ requested, sub, boundary, fresh, ctx, pin, spend, limit }, cfg = CFG) {
  if (!EXPENSIVE.test(requested || "")) return { model: requested, reason: "not-expensive" };

  let target = requested, why = "default";
  const frac = limit > 0 ? spend / limit : 0;
  if (sub && cfg.subagents !== "off") { target = cfg.subagents; why = "subagent"; }
  else if (limit > 0 && frac >= cfg.threshold) { target = cfg.fallback; why = `budget ${Math.round(frac * 100)}%`; }

  const current = pin ? pin.model : fresh ? target : requested;
  if (current === target) return { model: target, reason: why };

  // Model would change: only at a boundary, so the cache and thinking chain survive.
  const allowed = fresh || (boundary && (
    (cfg.switchAt === "turn" && ctx <= cfg.maxSwitchCtx) ||
    (limit > 0 && frac >= cfg.hard)
  ));
  if (allowed) return { model: target, reason: `${why} (switch)`, switched: true };
  return { model: current, reason: `${why} (held: ${boundary ? "context too large" : "mid-turn"})` };
}

// After a switch, earlier assistant turns carry thinking blocks signed by the
// other model. Previous-turn thinking may be omitted, so drop it. Only messages
// before the switch point are touched, so the prefix stays stable afterwards.
export function stripOldThinking(body, switchIndex) {
  if (!Number.isInteger(switchIndex) || switchIndex <= 0) return 0;
  let n = 0;
  body.messages.forEach((m, i) => {
    if (i >= switchIndex || m.role !== "assistant" || !Array.isArray(m.content)) return;
    const kept = m.content.filter((b) => b?.type !== "thinking" && b?.type !== "redacted_thinking");
    n += m.content.length - kept.length;
    if (kept.length !== m.content.length) m.content = kept.length ? kept : [{ type: "text", text: "(thinking omitted)" }];
  });
  return n;
}

// ---------- state ----------
let ctxEditOff = false; // set if the API rejects context editing for this account
const rejected = new Set(); // "model|anthropic-beta" combos the API refused once
const pins = new Map(); // convKey -> { model, switchIndex, at }
function setPin(key, value) {
  pins.delete(key);
  pins.set(key, { ...value, at: Date.now() });
  if (pins.size > 2000) pins.delete(pins.keys().next().value);
}
// $ per million tokens: input, output, cache read. Cache writes: 1.25x input (5m), 2x (1h).
const PRICES = [
  [/opus-5-5/, 4, 20, 0.2], [/opus/, 5, 25, 0.5], [/fable|mythos/, 10, 50, 0.25],
  [/sonnet-4/, 3, 15, 0.3], [/sonnet/, 2, 10, 0.2], [/haiku-5/, 0.1, 0.5, 0.01], [/haiku/, 1, 5, 0.1],
];
export function priceUsage(model, u = {}) {
  const p = PRICES.find(([re]) => re.test(model || ""));
  if (!p) return 0;
  const [, inp, out, read] = p;
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = (u.cache_creation_input_tokens || 0) - w1h;
  return ((u.input_tokens || 0) * inp + (u.output_tokens || 0) * out + (u.cache_read_input_tokens || 0) * read +
    w5m * inp * 1.25 + w1h * inp * 2) / 1e6;
}
let ownSpend = 0;

let spendCache = { at: 0, spend: 0, limit: 0 };
function budget() {
  if (CFG.ownBudget > 0) return { spend: ownSpend, limit: CFG.ownBudget, source: "proxy" };
  if (Date.now() - spendCache.at >= CFG.spendTtlMs) {
    const { limit } = readConfig();
    spendCache = { at: Date.now(), spend: periodTotal(), limit };
  }
  return spendCache;
}
function log(entry) {
  try { fs.appendFileSync(CFG.log, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n"); } catch {}
}

// ---------- proxy ----------
const HOP = new Set(["host", "connection", "content-length", "accept-encoding", "transfer-encoding", "keep-alive"]);
const upstreamUrl = new URL(CFG.upstream);
const lib = upstreamUrl.protocol === "http:" ? http : https;
const agent = new lib.Agent({ keepAlive: true });

function forward(req, bodyBuf, onResponse, extraBeta) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;
  headers["accept-encoding"] = "identity"; // so usage can be read off the stream
  if (extraBeta && !String(headers["anthropic-beta"] || "").includes(extraBeta))
    headers["anthropic-beta"] = [headers["anthropic-beta"], extraBeta].filter(Boolean).join(",");
  if (bodyBuf) headers["content-length"] = bodyBuf.length;
  const base = upstreamUrl.pathname.replace(/\/$/, "");
  const up = lib.request({
    protocol: upstreamUrl.protocol, hostname: upstreamUrl.hostname, port: upstreamUrl.port,
    path: base + req.url, method: req.method, headers, agent,
  }, onResponse);
  up.on("error", (e) => onResponse(null, e));
  if (bodyBuf) up.end(bodyBuf); else up.end();
  return up;
}

// Pipe the upstream response to the client unchanged, reading usage on the side.
function relay(upRes, res, entry) {
  const headers = { ...upRes.headers };
  delete headers.connection; delete headers["transfer-encoding"];
  if (entry.routed && entry.routed !== entry.requested) headers["x-token-saver-routed"] = entry.routed;
  res.writeHead(upRes.statusCode, headers);
  const usage = {};
  const sse = String(upRes.headers["content-type"] || "").includes("event-stream");
  const decoder = new StringDecoder("utf8"); // chunks can split multi-byte characters
  const json = []; // non-streamed bodies, parsed once at the end
  let buf = "";
  upRes.on("data", (chunk) => {
    res.write(chunk);
    if (!sse) { json.push(chunk); return; }
    buf += decoder.write(chunk);
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      try {
        const ev = JSON.parse(line.slice(5));
        if (ev.type === "message_start") Object.assign(usage, ev.message?.usage, { model: ev.message?.model });
        if (ev.type === "message_delta" && ev.usage) Object.assign(usage, ev.usage);
        if (ev.type === "message_delta" && ev.context_management?.applied_edits?.length) usage.applied_edits = ev.context_management.applied_edits;
      } catch {}
    }
  });
  upRes.on("end", () => {
    res.end();
    if (!sse) { try { const j = JSON.parse(Buffer.concat(json).toString("utf8")); Object.assign(usage, j.usage, { model: j.model }); } catch {} }
    const cost = upRes.statusCode === 200 ? priceUsage(usage.model, usage) : 0;
    ownSpend += cost;
    log({ ...entry, status: upRes.statusCode, usage, cost });
  });
  upRes.on("error", () => res.destroy());
}

function fail(res, e) {
  if (res.headersSent) return res.destroy();
  res.writeHead(502, { "content-type": "application/json" });
  res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: `token-saver proxy: ${e.message}` } }));
}

function handle(req, res) {
  if (req.method === "GET" && req.url === "/token-saver/status") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ config: CFG, budget: budget(), conversations: Object.fromEntries(pins) }, null, 2));
  }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    const isMessages = req.method === "POST" && /^\/v1\/messages(\/count_tokens)?(\?|$)/.test(req.url);
    let body = null;
    if (isMessages) { try { body = JSON.parse(raw.toString("utf8")); } catch {} }
    if (!body || !body.model) {
      const up = forward(req, raw.length ? raw : null, (upRes, e) => (e ? fail(res, e) : relay(upRes, res, { path: req.url })));
      res.on("close", () => { if (!res.writableFinished) up.destroy(); }); // keep the pooled socket otherwise
      return;
    }

    const counting = req.url.startsWith("/v1/messages/count_tokens");
    const key = conversationKey(body, req.headers);
    const n = convo(body).length;
    let pin = pins.get(key);
    if (isReset(pin, n)) { pins.delete(key); pin = undefined; } // new conversation in the same session
    const { spend, limit } = budget();
    const beta = String(req.headers["anthropic-beta"] || "");
    let d = decide({
      requested: body.model, sub: isSubagent(body), boundary: isTurnBoundary(body),
      fresh: !pin && n <= 1, ctx: estTokens(raw), pin, spend, limit,
    });

    if (CFG.policy === "smart" && EXPENSIVE.test(body.model)) {
      d = decideSmart({
        requested: body.model, messages: body.messages, sub: isSubagent(body), aux: !(Array.isArray(body.tools) && body.tools.length),
        boundary: isTurnBoundary(body), fresh: !pin && n <= 1, ctx: estTokens(raw), pin, overBudget: limit > 0 && spend / limit >= CFG.threshold,
      });
      if (ctxEditOff) d.ctxEdit = false;
    }
    if (d.model !== body.model && rejected.has(`${d.model}|${beta}`)) d = { model: body.model, reason: `${d.reason} (skipped: rejected before)` };

    const requested = body.model;
    let switchIndex = pin?.switchIndex;
    if (!counting) {
      // Budget policy strips old thinking at a switch. Smart policy doesn't: other models ignore
      // foreign thinking blocks, and keeping the history byte-identical lets a model that comes
      // back later (e.g. Opus after a quick Haiku answer) still hit its own cache.
      if (d.switched && pin && CFG.policy !== "smart") switchIndex = body.messages.length - 1;
      if (!pin || d.switched) setPin(key, { model: d.model, switchIndex, n, tier: d.tier, effort: d.effort, ctxEdit: d.ctxEdit });
      else { pin.n = n; if (d.ctxEdit) pin.ctxEdit = true; } // n spots /clear and /compact
    }
    const original = raw;
    let outBuf = raw, stripped = 0, ourCtxEdit = null;
    if (d.model !== body.model || switchIndex || d.effort || d.ctxEdit) {
      stripped = stripOldThinking(body, switchIndex);
      body.model = d.model;
      if (d.model !== requested) applyQuirks(body, d.model);
      if (d.effort) body.output_config = { ...(body.output_config || {}), effort: d.effort };
      // Claude Code sends its own context_management (clear_thinking first); add tool-result
      // clearing after it rather than replacing it. The API wants clear_thinking listed first.
      if (d.ctxEdit && !counting) {
        const cm = body.context_management || {};
        const edits = Array.isArray(cm.edits) ? cm.edits : [];
        if (!edits.some((e) => e?.type === "clear_tool_uses_20250919")) {
          ourCtxEdit = contextEdits().edits[0];
          body.context_management = { ...cm, edits: [...edits, ourCtxEdit] };
        }
      }
      outBuf = Buffer.from(JSON.stringify(body));
    }
    const extraBeta = ourCtxEdit ? CTX_BETA : undefined;
    const entry = { conv: key, requested, routed: d.model, reason: d.reason, stripped, path: req.url,
      ...(d.tier && { tier: d.tier }), ...(d.cls && { signals: d.cls.signals }), ...(extraBeta && { ctxEdit: true }),
      ...(CFG.policy === "smart" && { ccContextMgmt: JSON.stringify(JSON.parse(original.toString("utf8")).context_management ?? null).slice(0, 300) }) };
    let strippedRetry = false;
    let repaired = false;

    let up = forward(req, outBuf, function onRes(upRes, e) {
      if (e) return fail(res, e);
      // Fail open: if the rewritten request is rejected (unsupported beta,
      // param, or thinking block), resend the original once.
      if (upRes.statusCode === 400 && outBuf !== original) {
        const errChunks = [];
        upRes.on("data", (c) => errChunks.push(c));
        upRes.on("end", () => {
          const error = Buffer.concat(errChunks).toString("utf8").slice(0, 500);
          // A request difference we know how to fix: adapt and resend the rewrite once.
          if (!repaired && learnQuirk(d.model, error) && applyQuirks(body, d.model)) {
            repaired = true;
            log({ ...entry, status: 400, note: "adapted request for target model", error });
            outBuf = Buffer.from(JSON.stringify(body));
            up = forward(req, outBuf, onRes, extraBeta);
            return;
          }
          // Smart policy keeps old thinking blocks; if the target model objects, retry once without them.
          if (CFG.policy === "smart" && !strippedRetry && /thinking|signature/i.test(error) && d.model !== requested) {
            strippedRetry = true;
            const n2 = stripOldThinking(body, body.messages.length);
            log({ ...entry, status: 400, note: `retrying with ${n2} old thinking blocks removed`, error });
            outBuf = Buffer.from(JSON.stringify(body));
            up = forward(req, outBuf, onRes, extraBeta);
            return;
          }
          // Context editing rejected: turn it off for good and resend the same routing without it.
          if (ourCtxEdit && /context.?management|context.?edit|clear_tool_uses/i.test(error)) {
            ctxEditOff = true;
            const rest = (body.context_management?.edits || []).filter((e) => e !== ourCtxEdit);
            if (rest.length) body.context_management = { ...body.context_management, edits: rest };
            else delete body.context_management;
            ourCtxEdit = null;
            log({ ...entry, status: 400, note: "context editing rejected; resent without it", error });
            outBuf = Buffer.from(JSON.stringify(body));
            up = forward(req, outBuf, onRes);
            return;
          }
          log({ ...entry, status: 400, note: "rewritten request rejected; retrying original", error });
          rejected.add(`${d.model}|${beta}`);
          if (!counting) setPin(key, { model: requested });
          up = forward(req, original, (r2, e2) => (e2 ? fail(res, e2) : relay(r2, res, { ...entry, routed: requested, reason: "fail-open" })));
        });
        return;
      }
      relay(upRes, res, entry);
    }, extraBeta);
    res.on("close", () => { if (!res.writableFinished) up.destroy(); });
  });
}

export function start(port = CFG.port) {
  const server = http.createServer(handle);
  server.listen(port, "127.0.0.1", () => {
    const { limit } = budget();
    console.error(`[token-saver proxy] http://127.0.0.1:${port} -> ${CFG.upstream} (experimental)`);
    console.error(`  budget${CFG.ownBudget ? " (own ledger)" : ""}: ${limit ? `${limit}, switch to ${CFG.fallback} at ${Math.round(CFG.threshold * 100)}%` : "none set — budget failover inactive"}; subagents: ${CFG.subagents}; switch at: ${CFG.switchAt}`);
    console.error(`  log: ${CFG.log}`);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) start();
