// PreToolUse(Edit|Write|MultiEdit|NotebookEdit): when the MAIN thread runs an
// expensive model (Opus/Fable), push substantial code writing to the Sonnet
// `token-saver:coder` subagent. Small fixes stay on the main model, because a
// subagent has to re-read files and the handoff would cost more than it saves.
import { readStdin, deny, mainModel, routerEnabled, EXPENSIVE_MODEL } from "./lib.mjs";

const input = readStdin();
if (input.agent_id) process.exit(0); // already inside a subagent
if (!routerEnabled(input.cwd)) process.exit(0);

const model = mainModel(input);
if (!EXPENSIVE_MODEL.test(model)) process.exit(0);

const ti = input.tool_input || {};
const MAX_WRITE = Number(process.env.TOKEN_SAVER_ROUTE_WRITE_CHARS || 1500);
const MAX_EDIT = Number(process.env.TOKEN_SAVER_ROUTE_EDIT_CHARS || 800);

let size = 0, limit = MAX_EDIT;
switch (input.tool_name) {
  case "Write":
    size = String(ti.content || "").length; limit = MAX_WRITE; break;
  case "Edit":
    size = String(ti.new_string || "").length; break;
  case "MultiEdit":
    size = (ti.edits || []).reduce((n, e) => n + String(e.new_string || "").length, 0); break;
  case "NotebookEdit":
    size = String(ti.new_source || "").length; break;
  default:
    process.exit(0);
}
if (size <= limit) process.exit(0);

deny(
  `[token-saver router] You're on ${model}; writing ~${Math.round(size / 4)} tokens of code here is expensive. ` +
  `Act as the architect: delegate this implementation to the token-saver:coder agent (Sonnet) with a precise spec — ` +
  `target files and symbols, the exact behaviour, constraints, edge cases, and how to verify (which tests to run). ` +
  `Use token-saver:grunt (Haiku) instead for purely mechanical changes. Batch related changes into one delegation. ` +
  `When it reports back, review with \`git diff\` rather than re-reading files. Small fixes (< ${limit} chars) you may still make directly.`
);
