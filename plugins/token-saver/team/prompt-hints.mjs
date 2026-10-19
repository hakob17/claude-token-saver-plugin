// Prompt hints: the shape of each turn's prompt (never its text), what the turn cost,
// and a short hint after a costly turn whose prompt left out something that usually helps.
// Pure functions; the gateway keeps the turns and serves hints at /token-saver/hint.
import { userText, FILE_RE } from "../proxy/smart-policy.mjs";

export const HINTS = {
  minCost: Number(process.env.TOKEN_SAVER_HINT_MIN_COST || 0.5), // only after turns that cost at least this...
  minRequests: Number(process.env.TOKEN_SAVER_HINT_MIN_REQUESTS || 20), // ...or took this many requests
  cooldownTurns: Number(process.env.TOKEN_SAVER_HINT_COOLDOWN || 3), // turns between two hints for one engineer
  minSample: 5, // turns needed on each side before quoting a team average
};

const SYMBOL_RE = /`[^`\n]{2,80}`|\b[a-z]+[A-Z]\w*\s*\(|\b\w+_\w+\b|\b[A-Z]\w+\.\w+\b|\b\w+\(\)/;
const CHECK_RE = /\b(should|must|expect(ed)?|so that|acceptance|until|pass(es|ing)?|returns?|npm (run )?test|pytest|go test|cargo test|make test|xcodebuild test|gradle test|jest|vitest)\b/i;
const VAGUE_RE = /\b(fix (it|this|that)|make it (better|work|nicer|cleaner|faster|production[- ]ready)|clean (it )?up|improve (it|this)|something|stuff|whatever|etc\.?|and so on|you know)\b/i;
const BROAD_RE = /\b(whole|entire|everything|all (the )?(files|code|pages|screens)|end[- ]to[- ]end|from scratch|full (app|project|feature))\b/i;
const CORRECTION_RE = /^\s*(no[,.! ]|nope|that'?s (not|wrong)|not what i|i meant|actually[, ]|wrong|undo|revert)/i;

// What the prompt contains, as booleans and a length bucket. No prompt text leaves this function.
export function promptSignals(body, tier) {
  const text = userText(body);
  const words = text.replace(FILE_RE, " ");
  const isQuestion = tier === "simple";
  return {
    len: text.length,
    tier: tier || null,
    files: (text.match(FILE_RE) || []).length > 0,
    symbols: SYMBOL_RE.test(text),
    check: CHECK_RE.test(words),
    vague: VAGUE_RE.test(words),
    broad: BROAD_RE.test(words),
    correction: CORRECTION_RE.test(text),
    question: isQuestion,
  };
}

// The hint rules, most useful first. `when` is true for a turn that missed the pattern;
// `has` splits all turns into "did it" vs "didn't" for the team comparison.
export const RULES = [
  { id: "broad", when: (t) => t.broad && t.len < 400 && !t.question, has: (t) => !(t.broad && t.len < 400),
    tip: "Big one-line requests make Claude explore and plan on the expensive model. Split it: ask for a short plan first, then build one part per turn." },
  { id: "target", when: (t) => !t.files && !t.symbols && !t.question, has: (t) => t.files || t.symbols,
    tip: "Name the file and the function or component (\"fix `calcTotal` in src/cart.js\") so Claude doesn't have to search for them." },
  { id: "check", when: (t) => !t.check && !t.question, has: (t) => t.check,
    tip: "Say what done looks like and how to check it (\"… `npm test` should pass\", \"returns 409 when out of stock\"). Claude stops sooner and retries less." },
  { id: "vague", when: (t) => t.vague, has: (t) => !t.vague,
    tip: "Replace words like \"fix it\" or \"make it better\" with the concrete change you want." },
  { id: "errors", when: (t) => t.errors >= 3, has: (t) => t.errors < 3, noCompare: true,
    tip: "Several commands failed in this turn. Paste the exact error or the failing test's name next time; it's the fastest way to the fix." },
];

const avg = (xs) => xs.reduce((s, x) => s + x.cost, 0) / xs.length;
// Team comparison for one rule over recent work turns: average cost of turns that followed the pattern vs not.
export function compare(rule, turns) {
  const work = turns.filter((t) => !t.question);
  const did = work.filter(rule.has), didnt = work.filter((t) => !rule.has(t));
  if (did.length < HINTS.minSample || didnt.length < HINTS.minSample) return null;
  const a = avg(did), b = avg(didnt);
  return a < b ? { with: a, without: b, n: did.length + didnt.length } : null;
}

// The hint for a finished turn, or null. `history` is the team's recent finished turns.
export function hintFor(turn, history, cfg = HINTS) {
  if (!turn || turn.hinted || turn.question) return null;
  if (turn.cost < cfg.minCost && turn.requests < cfg.minRequests) return null;
  const rule = RULES.find((r) => r.when(turn));
  if (!rule) return null;
  const c = rule.noCompare ? null : compare(rule, history);
  const cost = `This turn cost $${turn.cost.toFixed(2)} over ${turn.requests} requests.`;
  const team = c ? ` In your team, turns that do this averaged $${c.with.toFixed(2)} vs $${c.without.toFixed(2)}.` : "";
  return { rule: rule.id, text: `💡 token-saver: ${cost} ${rule.tip}${team}` };
}

// Team-level view for managers: for each pattern, how many turns followed it and what they cost on average.
export function patternStats(turns) {
  const work = turns.filter((t) => !t.question);
  return RULES.filter((r) => !r.noCompare).map((r) => {
    const did = work.filter(r.has), didnt = work.filter((t) => !r.has(t));
    return { id: r.id, tip: r.tip, did: did.length, didnt: didnt.length,
      avgWith: did.length ? avg(did) : null, avgWithout: didnt.length ? avg(didnt) : null,
      costWithout: didnt.reduce((s, t) => s + t.cost, 0) };
  });
}
