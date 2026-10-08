// Review gate: when the main thread runs Opus/Fable and delegated code writing,
// make sure Opus reviews the result before finishing — cheaply, via git diff.
//   PostToolUse(Agent|Task): a writing agent finished -> mark review pending,
//                            remind Opus how to review.
//   PostToolUse(Bash):       `git diff` / `git show` ran -> review done.
//   Stop:                    review still pending -> block finishing once.
import fs from "node:fs";
import path from "node:path";
import { readStdin, loadState, saveState, mainModel, routerEnabled, EXPENSIVE_MODEL } from "./lib.mjs";

const input = readStdin();
const event = input.hook_event_name;
if (input.agent_id) process.exit(0); // only the main thread reviews
if (!routerEnabled(input.cwd)) process.exit(0);

const state = loadState(input.session_id);
const out = (obj) => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };

function inGitRepo(dir) {
  let d = dir || process.cwd();
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(d, ".git"))) return true;
    const up = path.dirname(d);
    if (up === d) return false;
    d = up;
  }
  return false;
}

const HOW =
  "Review cheaply: run `git diff --stat`, then `git diff -U3 -- <file>` only for files that matter; " +
  "don't re-read whole files. Check (1) the diff matches the spec, (2) the agents' interface-change lists agree with each other " +
  "and with callers, (3) tests were run and passed. Send real problems back to the same agent (SendMessage to its id keeps its context) " +
  "or to a new token-saver:coder task with a short fix spec, rather than rewriting the code yourself. Report the outcome to the user in a few lines.";

if (event === "PostToolUse" && /^(Agent|Task)$/.test(input.tool_name || "")) {
  const type = String(input.tool_input?.subagent_type || "general-purpose");
  if (/explore|scout|plan|guide/i.test(type)) process.exit(0); // read-only agents
  if (!EXPENSIVE_MODEL.test(mainModel(input))) process.exit(0);
  state.data.reviewPending = true;
  saveState(state);
  out({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        `[token-saver review] ${type} finished. If other delegated tasks for this request are still running, wait for them and review once at the end. ` + HOW,
    },
  });
}

if (event === "PostToolUse" && input.tool_name === "Bash") {
  if (state.data.reviewPending && /\bgit\s+(-C\s+\S+\s+)?(diff|show)\b/.test(String(input.tool_input?.command || ""))) {
    state.data.reviewPending = false;
    saveState(state);
  }
  process.exit(0);
}

if (event === "Stop") {
  if (!state.data.reviewPending || input.stop_hook_active) process.exit(0);
  state.data.reviewPending = false; // block at most once per request
  saveState(state);
  if (!inGitRepo(input.cwd)) process.exit(0);
  out({
    decision: "block",
    reason: "[token-saver review] Delegated code hasn't been reviewed yet. " + HOW,
  });
}

process.exit(0);
