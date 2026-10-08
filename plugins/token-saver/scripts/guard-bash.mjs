// PreToolUse(Bash): stop commands that dump huge output into context
// (verbose Maven/Gradle/npm runs, cat of big files, unbounded recursive listings).
import fs from "node:fs";
import { readStdin, deny, loadState, saveState, CONFIG } from "./lib.mjs";

const input = readStdin();
const cmd = String(input.tool_input?.command || "").trim();
if (!cmd) process.exit(0);

const state = loadState(input.session_id);
state.data.denied ||= {};
const key = `bash:${cmd}`;
if (state.data.denied[key]) {
  delete state.data.denied[key];
  saveState(state);
  process.exit(0);
}
function block(reason) {
  state.data.denied[key] = true;
  saveState(state);
  deny(`[token-saver] ${reason} If the full output is truly needed, repeat the exact same command and it will be allowed.`);
}

// Already limited: piped through a filter, redirected to a file (not 2>&1), or a quiet flag.
const limited = /\|\s*(tail|head|grep|rg|wc|jq|sed|awk|less)\b|(?<![0-9&])>\s*[^&\s]|--quiet\b|(^|\s)-q(\s|$)|--silent\b/.test(cmd);

// Build tools
const base = cmd.replace(/\s*2>&1\s*$/, "");
const build = /(^|[;&|]\s*)(\.\/)?(mvnw?|gradlew?|npm|pnpm|yarn|dotnet|cargo)\b/.test(cmd);
if (build && !limited) {
  let hint = "add a quiet flag and keep only the tail";
  if (/mvnw?\b/.test(cmd)) hint = `e.g. ${base} -q 2>&1 | tail -60`;
  else if (/gradlew?\b/.test(cmd)) hint = `e.g. ${base} -q --console=plain 2>&1 | tail -60`;
  else if (/\b(npm|pnpm|yarn)\b/.test(cmd)) hint = `e.g. ${base} --silent 2>&1 | tail -60`;
  block(`Build/test output is usually thousands of lines. Re-run with limited output: ${hint}. Grep the output for ERROR/FAIL if needed.`);
}

// cat / less of big files
const cat = cmd.match(/^(cat|less|more)\s+(["']?)([^\s"'|;&>]+)\2\s*$/);
if (cat) {
  try {
    const st = fs.statSync(cat[3]);
    if (st.size > CONFIG.maxReadBytes) {
      block(`"${cat[3]}" is ${Math.round(st.size / 1024)} KB. Use Grep or Read with offset/limit instead of cat.`);
    }
  } catch {}
}

// Unbounded recursive listings / searches
if (/^(find\s+(\/|~|\.)\s*$|ls\s+-[a-zA-Z]*R|tree(\s|$)(?!.*-L))/.test(cmd) && !limited) {
  block(`Recursive listings flood context. Use Glob with a pattern, or limit depth (find . -maxdepth 2, tree -L 2) and pipe to head.`);
}
if (/^grep\s+-[a-zA-Z]*r/.test(cmd) && !limited && !/--exclude-dir/.test(cmd)) {
  block(`Use the Grep tool (respects .gitignore, skips target/ and node_modules/) instead of grep -r.`);
}

process.exit(0);
