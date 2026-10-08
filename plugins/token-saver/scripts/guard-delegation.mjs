// PreToolUse(Agent|Task): when the MAIN thread runs Opus/Fable, keep delegations
// cost-effective:
//   1. A spec must describe intent, not contain the code. If Opus writes the code
//      into the prompt, it already paid Opus output prices for it — no saving.
//   2. Don't fan out into many tiny tasks: each subagent pays a fixed start-up
//      cost and re-reads files. After 4 delegations in one user turn, batch.
// Both checks can be overridden by repeating the identical call.
import { readStdin, deny, loadState, saveState, mainModel, routerEnabled, EXPENSIVE_MODEL } from "./lib.mjs";

const input = readStdin();
if (input.agent_id) process.exit(0);
if (!routerEnabled(input.cwd)) process.exit(0);
const model = mainModel(input);
if (!EXPENSIVE_MODEL.test(model)) process.exit(0);

const ti = input.tool_input || {};
const prompt = String(ti.prompt || "");
const type = String(ti.subagent_type || "general-purpose");
const readOnly = /explore|scout|plan|guide/i.test(type);

const MAX_CODE = Number(process.env.TOKEN_SAVER_SPEC_CODE_CHARS || 600);
const MAX_DELEGATIONS = Number(process.env.TOKEN_SAVER_MAX_DELEGATIONS || 4);

const state = loadState(input.session_id);
state.data.denied ||= {};
const key = `agent:${type}:${prompt.length}:${prompt.slice(0, 200)}`;
if (state.data.denied[key]) {
  delete state.data.denied[key];
  state.data.delegations = (state.data.delegations || 0) + 1;
  saveState(state);
  process.exit(0);
}
function block(reason) {
  state.data.denied[key] = true;
  saveState(state);
  deny(`[token-saver router] ${reason} If this delegation really must go as written, repeat the identical call and it will be allowed.`);
}

// --- 1. Code inside the spec ---
function codeChars(text) {
  let n = 0;
  // fenced blocks
  const fenced = text.match(/```[\s\S]*?```/g) || [];
  for (const b of fenced) n += b.length;
  const rest = text.replace(/```[\s\S]*?```/g, "");
  // unfenced lines that look like code
  for (const line of rest.split("\n")) {
    const l = line.trim();
    if (l.length < 12) continue;
    const codey =
      /[;{}]\s*$/.test(l) ||
      /^(public|private|protected|static|final|class|interface|import|package|return|if\s*\(|for\s*\(|while\s*\(|try\s*\{|catch\s*\(|@\w+|const |let |var |def |function )/.test(l) ||
      /\)\s*(->|=>)/.test(l);
    if (codey) n += l.length;
  }
  return n;
}

if (!readOnly) {
  const code = codeChars(prompt);
  if (code > MAX_CODE) {
    block(
      `This spec contains ~${code} characters of code. Writing the code into the prompt means you (on ${model}) already paid for it, ` +
        `so delegating saves nothing. Rewrite the spec as intent: which files/classes, what behaviour, constraints, edge cases, ` +
        `and which tests to run. Keep code only for exact signatures or interfaces the pieces must agree on (under ~${MAX_CODE} chars).`
    );
  }
}

// --- 2. Too many small delegations in one turn ---
const n = (state.data.delegations || 0) + 1;
if (!readOnly && n > MAX_DELEGATIONS) {
  block(
    `This would be delegation #${n} for this request. Each subagent pays a fixed start-up cost and re-reads files, ` +
      `so many small tasks cost more than a few larger ones. Batch the remaining work into one task per area ` +
      `(e.g. "service logic + its tests", "endpoint + DTO"), or send purely mechanical changes to token-saver:grunt in one go.`
  );
}
if (!readOnly) state.data.delegations = n;
saveState(state);
process.exit(0);
