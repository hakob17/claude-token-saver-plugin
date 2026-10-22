// /token-saver:smart-router on|off|status — turn the routing proxy's model routing on or off.
// Off: requests still go through the proxy (budget rules, logging, team limits), but each one
// uses the model Claude Code asked for. Takes effect at your next message; no restart needed.
//   Team gateway (a gateway key is set): saved as your engineer setting on the gateway.
//   Local proxy: saved in ~/.claude/token-saver/proxy.json, which the proxy re-reads every 2 s.
// A per-session header (x-token-saver-routing in ANTHROPIC_CUSTOM_HEADERS) overrides both.
import fs from "node:fs";
import path from "node:path";
import { gatewayInfo } from "./lib.mjs";
import { DIR } from "./budget-lib.mjs";

const arg = String(process.argv[2] || "status").toLowerCase();
if (!["on", "off", "status"].includes(arg)) { console.log("Usage: /token-saver:smart-router on | off | status"); process.exit(0); }
const { base, key, routingHeader } = gatewayInfo();
const say = (on, where) => console.log(`Smart routing: ${on ? "ON (each turn goes to the model it needs)" : "OFF (every request uses the model Claude Code asks for)"} — ${where}`);
const headerNote = () => routingHeader && console.log(`Note: this session sends x-token-saver-routing: ${routingHeader} (ANTHROPIC_CUSTOM_HEADERS), which overrides the setting.`);

if (base && key) {
  try {
    const r = await fetch(`${base}/token-saver/prefs`, {
      method: arg === "status" ? "GET" : "POST",
      headers: { "x-token-saver-key": key, "content-type": "application/json" },
      ...(arg !== "status" && { body: JSON.stringify({ routing: arg === "on" }) }),
      signal: AbortSignal.timeout(4000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.log(`The team gateway refused: ${j.error || r.status}. Check your gateway key.`); process.exit(0); }
    say(j.routing, `your setting on the team gateway (${base})${arg === "status" ? "" : ", saved; from your next message"}. Team limits and model caps still apply.`);
  } catch (e) {
    console.log(`Couldn't reach the team gateway at ${base}: ${e.message}`);
  }
  headerNote();
  process.exit(0);
}

const file = path.join(DIR, "proxy.json");
let prefs = {};
try { prefs = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
if (arg !== "status") {
  prefs.routing = arg;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(prefs, null, 2) + "\n");
}
const on = !/^(0|off|false|no)$/i.test(String(prefs.routing ?? "on"));
let proxy = "";
if (base) {
  try {
    const s = await fetch(`${base}/token-saver/status`, { signal: AbortSignal.timeout(2000) }).then((r) => (r.ok ? r.json() : null));
    proxy = s?.routing ? ` The proxy at ${base} reports routing ${s.routing}.` : "";
  } catch {}
}
say(on, `saved in ${file}${arg === "status" ? "" : "; from your next message"}.${proxy}`);
if (!base) console.log("Note: ANTHROPIC_BASE_URL isn't set, so this session talks to the API directly and nothing is routed either way. Start Claude Code with ANTHROPIC_BASE_URL pointing at the proxy.");
headerNote();
