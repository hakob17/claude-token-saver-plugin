// Shared helpers for token-saver hooks. No dependencies; Node 18+.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG = {
  // Read guard
  maxReadBytes: Number(process.env.TOKEN_SAVER_MAX_READ_BYTES || 40_000), // ~10k tokens
  maxReadLines: Number(process.env.TOKEN_SAVER_MAX_READ_LINES || 600),
  // Context watch: nudge to /compact or /clear past these context sizes (tokens)
  contextWarnAt: Number(process.env.TOKEN_SAVER_CONTEXT_WARN || 80_000),
  contextUrgentAt: Number(process.env.TOKEN_SAVER_CONTEXT_URGENT || 150_000),
};

// Paths that are almost never worth reading in full.
export const JUNK_PATH = new RegExp(
  [
    "(^|[\\\\/])(node_modules|target|build|dist|out|\\.gradle|\\.idea|\\.git|coverage|__pycache__|\\.next|vendor)[\\\\/]",
    "\\.min\\.(js|css)$",
    "(package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|gradle\\.lockfile|Cargo\\.lock|poetry\\.lock)$",
    "\\.(map|class|jar|war|log)$",
  ].join("|"),
  "i"
);

export function readStdin() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function stateDir() {
  const base = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), "claude-token-saver");
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export function loadState(sessionId) {
  const f = path.join(stateDir(), `${sessionId || "default"}.json`);
  try {
    return { file: f, data: JSON.parse(fs.readFileSync(f, "utf8")) };
  } catch {
    return { file: f, data: {} };
  }
}

export function saveState(state) {
  try {
    fs.writeFileSync(state.file, JSON.stringify(state.data));
  } catch {
    /* best effort */
  }
}

export function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

export function addContext(event, text) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } })
  );
  process.exit(0);
}

// Current context size = input side of the most recent assistant turn in the transcript.
export function currentContextTokens(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return 0;
  let text;
  try {
    const stat = fs.statSync(transcriptPath);
    const fd = fs.openSync(transcriptPath, "r");
    const len = Math.min(stat.size, 2_000_000); // tail only
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, stat.size - len);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch {
    return 0;
  }
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.includes('"usage"')) continue;
    try {
      const obj = JSON.parse(line);
      const u = obj?.message?.usage;
      if (u && !obj.isSidechain) {
        return (
          (u.input_tokens || 0) +
          (u.cache_read_input_tokens || 0) +
          (u.cache_creation_input_tokens || 0)
        );
      }
    } catch {
      /* partial line at the tail cut */
    }
  }
  return 0;
}
