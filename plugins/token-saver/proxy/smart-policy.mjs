// Smart routing policy for router-proxy.mjs (TOKEN_SAVER_PROXY_POLICY=smart). Pure functions only.
//
// At each new user turn, a heuristic classifier scores the message and picks a tier:
//   simple   (questions, lookups)            -> cheap model at low effort
//   standard (ordinary edits and features)   -> mid model
//   hard     (design, big multi-file work)   -> the model Claude Code asked for
// The model is then fixed for the whole turn (cache and thinking chain stay valid).
// As the conversation grows, it turns on server-side clearing of old tool results.
// See bench/SMART-ROUTER.md.

export const SMART = {
  simple: process.env.TOKEN_SAVER_PROXY_TIER_SIMPLE || "claude-haiku-5-5",
  standard: process.env.TOKEN_SAVER_PROXY_TIER_STANDARD || "claude-sonnet-5-5",
  maxSwitchCtx: Number(process.env.TOKEN_SAVER_PROXY_MAX_SWITCH_CTX || 40_000),
  ctxEditAt: Number(process.env.TOKEN_SAVER_PROXY_CTX_EDIT_AT || 60_000), // est. tokens; 0 = off
  ctxKeep: Number(process.env.TOKEN_SAVER_PROXY_CTX_KEEP || 6), // recent tool uses kept
  ctxClearAtLeast: Number(process.env.TOKEN_SAVER_PROXY_CTX_CLEAR_AT_LEAST || 10_000),
};
const RANK = { simple: 0, standard: 1, hard: 2 };

// The user's own words in the last message: no tool results, no injected reminders.
export function userText(body) {
  const msgs = (body?.messages || []).filter((m) => m?.role !== "system");
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== "user") return "";
  const parts = typeof last.content === "string" ? [last.content]
    : (Array.isArray(last.content) ? last.content : []).filter((b) => b?.type === "text").map((b) => b.text || "");
  return parts.join("\n").replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
}

// Trouble in the turn that just ended: failing tool calls or failing tests.
export function recentTrouble(body) {
  const msgs = (body?.messages || []).filter((m) => m?.role !== "system");
  let errors = 0;
  // walk back over the previous turn (stop at the previous user text message)
  for (let i = msgs.length - 2; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "user" && (typeof m.content === "string" || !m.content?.some?.((b) => b?.type === "tool_result"))) break;
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b?.type !== "tool_result") continue;
      const t = typeof b.content === "string" ? b.content : JSON.stringify(b.content || "");
      if (b.is_error || /\b\d+ (failing|failed)\b|# fail [1-9]|\bFAIL\b|Error:|error TS\d+|BUILD FAILED|TEST FAILED/.test(t)) errors++;
    }
  }
  return errors;
}

const SIMPLE_RE = /\b(what|why|where|which|who|when|how (does|do|is|are|can)|explain|show me|summari[sz]e|describe|tell me|is there|does (it|this)|list)\b/i;
const HARD_RE = /\b(design|architect(ure)?|plan|refactor|migrat(e|ion)|rewrite|from scratch|end[- ]to[- ]end|implement|build|integrat(e|ion)|optimi[sz]e|performance|security|scal(e|ability)|whole|entire|across)\b/gi;
const EDIT_RE = /\b(add|fix|change|update|rename|create|write|remove|delete|move|test|bump|tweak|adjust|replace)\b/gi;
const FILE_RE = /[\w./-]+\.(m?[jt]sx?|swift|kt|py|go|rb|java|json|md|css|s?html|ya?ml|sql|sh|toml)\b/g;

// Score the user's message. Positive = harder.
export function classifyTurn(body) {
  const text = userText(body);
  const len = text.length;
  const words = text.replace(FILE_RE, " "); // "docs/PLAN.md" names a file, it doesn't ask for a plan
  const hard = new Set((words.match(HARD_RE) || []).map((w) => w.toLowerCase())).size;
  const edits = new Set((words.match(EDIT_RE) || []).map((w) => w.toLowerCase())).size;
  const files = new Set(text.match(FILE_RE) || []).size;
  const question = SIMPLE_RE.test(words.slice(0, 80)) || /\?\s*$/.test(text);
  const firstTurn = (body?.messages || []).filter((m) => m?.role !== "system").length <= 1;
  const trouble = recentTrouble(body);

  let score = 0;
  const signals = [];
  const add = (n, why) => { if (n) { score += n; signals.push(`${n > 0 ? "+" : ""}${n} ${why}`); } };
  add(Math.min(hard, 3) * 2, `${hard} design/scope word(s)`);
  add(Math.min(edits, 2), `${edits} edit word(s)`);
  if (question && !edits && !hard) add(-3, "question, no edit/design words");
  else if (question) add(-1, "phrased as a question");
  if (len < 200 && !hard) add(-1, "short message");
  if (len > 1500) add(2, "long message / spec");
  if (files >= 3) add(2, `${files} files named`);
  if (firstTurn && len > 400) add(1, "first turn of a project");

  let tier = score <= -1 ? "simple" : score >= 4 ? "hard" : "standard";
  if (trouble >= 3 && tier !== "hard") { tier = tier === "simple" ? "standard" : "hard"; signals.push(`escalate: ${trouble} failing tool calls last turn`); }
  return { tier, score, signals };
}

export const tierOf = (model, requested) =>
  model === SMART.simple ? "simple" : model === SMART.standard ? "standard" : model === requested ? "hard" : "standard";

// Decide the model for one request. ctx is the estimated context size in tokens.
// Returns { model, tier, reason, switched, effort, ctxEdit, cls }.
export function decideSmart({ requested, messages, sub, aux, boundary, fresh, ctx, pin, overBudget }, cfg = SMART) {
  const models = { simple: cfg.simple, standard: cfg.standard, hard: requested };
  const ctxEdit = cfg.ctxEditAt > 0 && (pin?.ctxEdit || ctx >= cfg.ctxEditAt);
  if (aux) return { model: cfg.simple, tier: "simple", reason: "side request (no tools)", effort: "low" };
  if (sub) return { model: pin?.model || cfg.standard, tier: "standard", reason: "subagent", ctxEdit };
  if (!boundary && !fresh && pin) return { model: pin.model, tier: pin.tier, reason: "mid-turn: keep the turn's model", effort: pin.effort, ctxEdit };

  const cls = classifyTurn({ messages });
  let tier = cls.tier;
  if (overBudget && tier === "hard") { tier = "standard"; cls.signals.push("over budget: hard capped to standard"); }
  const target = models[tier];
  const effort = tier === "simple" ? "low" : undefined;
  const current = pin?.model || (fresh ? target : requested);
  const curTier = pin?.tier || tierOf(current, requested);
  if (target === current) return { model: target, tier, reason: `turn: ${tier} (score ${cls.score})`, effort, ctxEdit, cls };

  // Moving up is always allowed. Moving down re-caches the context on the cheaper model:
  // allowed on a fresh conversation, a small context, or to the cheap tier (its writes cost ~nothing).
  const up = RANK[tier] > RANK[curTier];
  if (fresh || up || ctx <= cfg.maxSwitchCtx || tier === "simple")
    return { model: target, tier, reason: `turn: ${tier} (score ${cls.score}) ${up ? "escalate" : "switch"}`, switched: true, effort, ctxEdit, cls };
  return { model: current, tier: curTier, reason: `turn: ${tier} (score ${cls.score}) held: context ${Math.round(ctx / 1000)}k too large to re-cache`, effort: pin?.effort, ctxEdit, cls };
}

// Server-side clearing of old tool results (context editing beta).
export const CTX_BETA = "context-management-2025-06-27";
export function contextEdits(cfg = SMART) {
  return { edits: [{
    type: "clear_tool_uses_20250919",
    trigger: { type: "input_tokens", value: cfg.ctxEditAt },
    keep: { type: "tool_uses", value: cfg.ctxKeep },
    clear_at_least: { type: "input_tokens", value: cfg.ctxClearAtLeast },
  }] };
}
