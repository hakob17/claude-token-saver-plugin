// Optional classifier: a small local model (Ollama) decides each turn's tier instead of the
// points heuristic. Off by default; TOKEN_SAVER_CLASSIFIER=ollama turns it on.
// The prompt never leaves the machine. If Ollama is slow, down or answers nonsense, the
// heuristic decides, so a turn is never held up for long. See bench/SMART-ROUTER.md.
import crypto from "node:crypto";
import { classifyTurn, userText } from "./smart-policy.mjs";

const env = process.env;
export const LLM = {
  mode: env.TOKEN_SAVER_CLASSIFIER || "heuristic", // "heuristic" | "ollama"
  url: (env.TOKEN_SAVER_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, ""),
  model: env.TOKEN_SAVER_OLLAMA_MODEL || "qwen2.5:1.5b",
  timeoutMs: Number(env.TOKEN_SAVER_CLASSIFIER_TIMEOUT_MS || 1500),
  maxChars: 2000, // the start of a long message says enough about its size
};
const TIERS = ["simple", "standard", "hard"];

const SYSTEM = `You route requests sent to a coding assistant to one of three model tiers.
simple: questions, explanations, lookups, listing or summarising things; anything that needs no code changes.
standard: ordinary code changes: add, fix, rename or update one thing; a bug fix; a test; a small change in a few files.
hard: design or architecture; building a whole feature, page, app or module; large multi-file refactors or migrations; performance or security work; big vague asks such as "make it production-ready".
Negations count: "explain, don't change anything" is simple.
Reply with JSON only: {"tier": "simple" | "standard" | "hard", "reason": "at most 10 words"}.`;
const SHOTS = [
  ["where is the admin password configured?", "simple", "lookup question, no change"],
  ["How is the cart stored? Just explain, don't change anything.", "simple", "explanation only"],
  ["Add a rename button to the product card", "standard", "one small UI change"],
  ["fix the failing test in test/orders.test.js", "standard", "single bug fix"],
  ["Build the admin panel: login, product CRUD and order management", "hard", "whole feature across backend and frontend"],
  ["make it production-ready", "hard", "big vague scope"],
];
const FORMAT = { type: "object", properties: { tier: { type: "string", enum: TIERS }, reason: { type: "string" } }, required: ["tier"] };

const cache = new Map(); // hash of model + text -> result, so retries and count_tokens calls don't ask again
const remember = (k, v) => { cache.set(k, v); if (cache.size > 500) cache.delete(cache.keys().next().value); return v; };

// Ask the local model. Returns { tier, reason, ms } or null (timeout, error, bad answer).
export async function askOllama(text, cfg = LLM) {
  const k = crypto.createHash("sha1").update(cfg.model + "\n" + text).digest("hex");
  if (cache.has(k)) return { ...cache.get(k), cached: true };
  const t0 = Date.now();
  try {
    const r = await fetch(`${cfg.url}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(cfg.timeoutMs),
      body: JSON.stringify({
        model: cfg.model, stream: false, format: FORMAT, keep_alive: "30m",
        options: { temperature: 0, num_predict: 48 },
        messages: [{ role: "system", content: SYSTEM },
          ...SHOTS.flatMap(([q, tier, reason]) => [{ role: "user", content: q }, { role: "assistant", content: JSON.stringify({ tier, reason }) }]),
          { role: "user", content: text.slice(0, cfg.maxChars) }],
      }),
    });
    if (!r.ok) return null;
    const j = JSON.parse((await r.json())?.message?.content || "{}");
    if (!TIERS.includes(j.tier)) return null;
    return remember(k, { tier: j.tier, reason: String(j.reason || "").slice(0, 80), ms: Date.now() - t0 });
  } catch { return null; }
}

// Same shape as classifyTurn(): { tier, score, signals }. The heuristic always runs (it's free):
// it's the fallback, it keeps the escalation-after-failures rule, and it's logged for comparison.
export async function classifyTurnLLM(body, cfg = LLM) {
  const heur = classifyTurn(body);
  const text = userText(body);
  if (cfg.mode !== "ollama" || !text) return heur;
  const llm = await askOllama(text, cfg);
  if (!llm) return { ...heur, signals: [...heur.signals, `ollama unavailable or too slow (>${cfg.timeoutMs}ms): heuristic used`] };
  const escalation = heur.signals.find((s) => s.startsWith("escalate"));
  let tier = llm.tier;
  if (escalation && tier !== "hard") tier = TIERS[TIERS.indexOf(tier) + 1];
  return {
    tier, score: heur.score, source: "ollama",
    signals: [`ollama ${cfg.model}: ${llm.tier} (${llm.reason}${llm.cached ? ", cached" : `, ${llm.ms}ms`})`,
      `heuristic would say ${heur.tier} (score ${heur.score})`, ...(escalation ? [escalation] : [])],
  };
}

// Load the model into memory at start-up so the first turn isn't slow.
export function warmUp(cfg = LLM) {
  if (cfg.mode !== "ollama") return;
  fetch(`${cfg.url}/api/generate`, { method: "POST", body: JSON.stringify({ model: cfg.model, prompt: "", keep_alive: "30m" }), signal: AbortSignal.timeout(60_000) })
    .then((r) => console.error(`[token-saver proxy] classifier: ollama ${cfg.model} ${r.ok ? "loaded" : `not available (${r.status}); heuristic fallback`}`))
    .catch(() => console.error(`[token-saver proxy] classifier: ollama not reachable at ${cfg.url}; heuristic fallback`));
}
