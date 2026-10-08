// PreToolUse(Read): stop full reads of huge files and generated/vendor files.
// A repeated identical request is allowed through, so Claude is never hard-stuck.
import fs from "node:fs";
import { readStdin, deny, loadState, saveState, JUNK_PATH, CONFIG } from "./lib.mjs";

const input = readStdin();
const ti = input.tool_input || {};
const file = ti.file_path;
if (!file) process.exit(0);

const ranged = ti.offset != null || ti.limit != null;
const isMedia = /\.(png|jpe?g|gif|webp|pdf|ipynb)$/i.test(file);
if (isMedia) process.exit(0);

const state = loadState(input.session_id);
const key = `read:${file}:${ti.offset ?? ""}:${ti.limit ?? ""}`;
state.data.denied ||= {};
if (state.data.denied[key]) {
  // Second identical attempt: Claude decided it really needs it. Let it through.
  delete state.data.denied[key];
  saveState(state);
  process.exit(0);
}

function block(reason) {
  state.data.denied[key] = true;
  saveState(state);
  deny(`[token-saver] ${reason} If you truly need it, repeat the exact same Read call and it will be allowed.`);
}

if (JUNK_PATH.test(file)) {
  block(`"${file}" looks generated, vendored, a lockfile or a log. Grep it for what you need instead of reading it.`);
}

if (!ranged) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    process.exit(0);
  }
  if (st.isFile() && st.size > CONFIG.maxReadBytes) {
    let lines = "?";
    try {
      lines = fs.readFileSync(file, "utf8").split("\n").length;
    } catch {}
    block(
      `"${file}" is large (${Math.round(st.size / 1024)} KB, ~${lines} lines, ~${Math.round(st.size / 4 / 1000)}k tokens). ` +
        `Grep for the symbol/section you need (use -n for line numbers), then Read with offset/limit around it (≤ ${CONFIG.maxReadLines} lines).`
    );
  }
}

process.exit(0);
