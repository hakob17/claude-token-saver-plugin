// UserPromptSubmit: when the conversation context gets large, tell Claude to warn
// the user (once per threshold) to /compact or hand off and /clear.
import { readStdin, addContext, loadState, saveState, currentContextTokens, CONFIG } from "./lib.mjs";

const input = readStdin();

// New user turn: reset the per-turn delegation counter used by the router.
const state = loadState(input.session_id);
state.data.delegations = 0;
saveState(state);

const tokens = currentContextTokens(input.transcript_path);
if (!tokens) process.exit(0);

const k = Math.round(tokens / 1000);

// Reset flags after a compaction shrank the context.
if (state.data.lastTokens && tokens < state.data.lastTokens * 0.6) {
  state.data.warned = false;
  state.data.urgent = false;
}
state.data.lastTokens = tokens;

let msg = null;
if (tokens >= CONFIG.contextUrgentAt && !state.data.urgent) {
  state.data.urgent = true;
  state.data.warned = true;
  msg = `[token-saver] Context is ~${k}k tokens; every turn now resends all of it. Begin your reply with ONE short line telling the user to run /token-saver:handoff then /clear (or /compact) before continuing. Then answer normally.`;
} else if (tokens >= CONFIG.contextWarnAt && !state.data.warned) {
  state.data.warned = true;
  msg = `[token-saver] Context is ~${k}k tokens. If the user's new message is a different task from the earlier conversation, begin your reply with ONE short line suggesting /clear (or /compact if it's the same task). Otherwise say nothing about it.`;
}

saveState(state);
if (msg) addContext("UserPromptSubmit", msg);
process.exit(0);
