// Stop: when Claude Code runs through a token-saver team gateway, ask it whether the turn that
// just ended deserves a prompting hint, and show it under the reply. The hint is shown to the
// user only (systemMessage); it is never added to the conversation, so the model doesn't see it.
// Silent when there's no gateway, no gateway key, no hint, or any error. Off with TOKEN_SAVER_HINTS=off.
import { readStdin } from "./lib.mjs";

const input = readStdin();
const env = process.env;
if (env.TOKEN_SAVER_HINTS === "off" || input?.stop_hook_active) process.exit(0);

const base = env.ANTHROPIC_BASE_URL;
const header = /(?:^|\n|,)\s*x-token-saver-key\s*:\s*(tsk_[\w-]+)/i.exec(env.ANTHROPIC_CUSTOM_HEADERS || "");
const key = env.TOKEN_SAVER_KEY || header?.[1] ||
  [env.ANTHROPIC_API_KEY, env.ANTHROPIC_AUTH_TOKEN].find((k) => String(k || "").startsWith("tsk_"));
if (!base || !key || !input?.session_id) process.exit(0);

try {
  const url = `${base.replace(/\/$/, "")}/token-saver/hint?session=${encodeURIComponent(input.session_id)}`;
  const r = await fetch(url, { headers: { "x-token-saver-key": key }, signal: AbortSignal.timeout(2000) });
  const { hint } = r.ok ? await r.json() : {};
  if (hint) process.stdout.write(JSON.stringify({ systemMessage: hint }));
} catch {}
process.exit(0);
