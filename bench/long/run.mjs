#!/usr/bin/env node
// Long-session benchmark for the token-saver Claude Code plugin.
//
//   node bench/long/run.mjs [--models sonnet,opus] [--runs 3] [--parallel 6] [--budget 20]
//
// One 19-request coding session on the sample wallet project, run three ways:
//   baseline        no plugin, one continuous session
//   plugin          plugin loaded, one continuous session (its warnings are ignored)
//   plugin-handoff  plugin loaded; whenever the context passes the plugin's warning
//                   threshold (80k tokens), run /token-saver:handoff, then continue
//                   in a fresh session starting with /token-saver:resume
//   plugin-handoff50  same, but hand off at 50k tokens (experiment: forces a handoff
//                   mid-session, since sessions here rarely reach 80k)
//
// For a resumed session Claude Code reports total_cost_usd as the running total,
// so per-request cost is the difference from the previous request in that session.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildFixture } from "../fixture/build-fixture.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(here, "../../plugins/token-saver");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] == null ? "true" : all[i + 1]]);
    return acc;
  }, [])
);
const models = (args.models || "sonnet,opus").split(",");
const runs = Number(args.runs || 3);
const parallel = Number(args.parallel || 6);
const totalBudget = Number(args.budget || 20);
const HANDOFF_AT = Number(args["handoff-at"] || 80_000);
const outDir = path.resolve(args.out || path.join(here, "results"));
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "runs.jsonl");
const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ts-long-"));

export const REQUESTS = [
  "Give me a short overview of how this project is structured and where the main business logic lives.",
  "Add refund support to the wallet: refund a previous DEBIT by its transaction id. A refund credits the amount back, can happen only once per transaction, and must be rejected for CREDIT entries and unknown ids. Expose it as POST /wallet/:userId/refund with body { transactionId }. Add tests.",
  "Add GET /wallet/:userId/summary returning { balance, credits, debits, refunds } where the last three are counts of ledger entries of each type. Add tests.",
  "Credits and debits above 1,000,000 cents should be rejected with a 400 from the API. Add tests.",
  "Add a daily deposit limit: an account may receive at most 500,000 cents of CREDIT entries per calendar day (UTC, use the clock util). Refunds don't count toward the limit. Exceeding it should be a 409 from the API. Add tests.",
  "How does settlement compute the payout for a winning bet, and which rounding mode does it use? Short answer.",
  "Add a CASHOUT settlement outcome: the player gets 90% of the potential payout (stake * odds), rounded the same way as normal payouts. Add tests.",
  "Refactor: move the error-to-HTTP-status mapping out of src/api/handlers.js into a new module src/api/errors.js. Behaviour must not change.",
  "Add src/reports/turnover.js exporting turnoverBySelection(bets) that returns total stake per selection, sorted by total descending. Don't touch the legacy reports module. Add tests.",
  "Add pagination to GET /wallet/:userId/history: optional ?limit= and ?offset= query params, default limit 50, maximum 200. Add tests.",
  "Add account freezing: POST /accounts/:userId/freeze and POST /accounts/:userId/unfreeze. A frozen account can't be debited or place bets, but can still receive credits. Add tests.",
  "Reject bets with a stake above 100,000 cents with a 400 from the API. Add tests.",
  "Make POST /wallet/:userId/credit idempotent: an optional requestId in the body; repeating a requestId returns the original transaction instead of crediting again. Add tests.",
  "How does the router match request paths to handlers? Short answer.",
  "Add GET /accounts/:userId/open-bets returning the account's OPEN bets. Add tests.",
  "Add an 'API' section to README.md documenting every endpoint, including all the new ones, one line each.",
  "Run the full test suite and fix anything that's failing.",
  "Is there anything in today's changes that could break under concurrent requests? Short answer, no code changes.",
  "Summarise everything we changed today as a short changelog, one line per change.",
];

function check(dir, lastAnswer) {
  const sh = (cmd) => { try { return execSync(cmd, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { return String(e.stdout || ""); } };
  let out = "";
  try { out = execSync(`node --test --test-reporter=tap "test/**/*.test.js"`, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 }); } catch (e) { out = String(e.stdout || ""); }
  const pass = Number((out.match(/^# pass (\d+)/m) || [])[1] || 0), fail = Number((out.match(/^# fail (\d+)/m) || [])[1] || 0);
  const features = {
    refund: /refund/i.test(sh("cat src/api/handlers.js src/api/*.js 2>/dev/null")),
    summary: /summary/.test(sh("cat src/api/handlers.js 2>/dev/null")),
    limit: /1[_,]?000[_,]?000/.test(sh("grep -rh '' src 2>/dev/null")),
    deposit: /500[_,]?000/.test(sh("grep -rh '' src 2>/dev/null")),
    cashout: /CASHOUT/.test(sh("cat src/settlement/settlementService.js 2>/dev/null")),
    errorsModule: fs.existsSync(path.join(dir, "src/api/errors.js")),
    turnover: fs.existsSync(path.join(dir, "src/reports/turnover.js")),
    pagination: /offset/.test(sh("grep -rh '' src 2>/dev/null")),
    freeze: /freeze/i.test(sh("cat src/api/handlers.js 2>/dev/null")),
    idempotency: /requestId/.test(sh("grep -rh '' src 2>/dev/null")),
    openBets: /open-bets/.test(sh("cat src/api/handlers.js 2>/dev/null")),
    readme: /refund/i.test(sh("cat README.md")) && /open-bets/.test(sh("cat README.md")),
  };
  const got = Object.values(features).filter(Boolean).length, nFeatures = Object.keys(features).length;
  const changelogLines = String(lastAnswer || "").split("\n").filter((l) => /^\s*([-*•]|\d+\.)\s+/.test(l)).length;
  const ok = fail === 0 && pass > 238 && got === nFeatures && changelogLines >= 5;
  return { ok, detail: `tests ${pass}/${fail} fail, features ${got}/${nFeatures}, changelog lines ${changelogLines}`, pass, fail, features: got };
}

function cleanEnv() {
  const env = { ...process.env, IS_SANDBOX: "1" };
  for (const k of Object.keys(env)) {
    if (
      k === "CLAUDECODE" ||
      /^CLAUDE_CODE_(SESSION_ID|REMOTE_SESSION_ID|CHILD_SESSION|SYNC_|CCR_EARLY|POST_TURN_MEMORY|ADDITIONAL_DIRECTORIES|ENTRYPOINT|SESSION_ORIGIN|SESSION_ATTENDED|MESSAGING_)/.test(k) ||
      /^CLAUDE_(ADDITIONAL_DIRECTORIES|AFTER_LAST_COMPACT|PROJECT_TOOL|PLUGIN_ROOT)$/.test(k)
    ) delete env[k];
  }
  return env;
}

function claude(dir, prompt, { model, plugin, resume }) {
  const a = ["-p", prompt, "--output-format", "json", "--model", model, "--permission-mode", "bypassPermissions",
    "--setting-sources", "project", "--max-budget-usd", "5"];
  if (plugin) a.push("--plugin-dir", PLUGIN_DIR);
  if (resume) a.push("--resume", resume);
  return new Promise((resolve) => {
    const child = spawn("claude", a, { cwd: dir, env: { ...cleanEnv(), CLAUDE_PLUGIN_DATA: path.join(dir, ".plugin-data") }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => child.kill("SIGTERM"), 20 * 60_000);
    child.on("close", () => {
      clearTimeout(t);
      let r;
      try { r = JSON.parse(out.trim().split("\n").pop()); } catch { r = { is_error: true, result: (err || out).slice(-400) }; }
      resolve({ cum: r.total_cost_usd ?? 0, session: r.session_id, result: String(r.result ?? ""), error: !!r.is_error, turns: r.num_turns });
    });
  });
}

// Size of the conversation context after the last request, read from the transcript.
function contextTokens(dir, session) {
  const proj = path.join(os.homedir(), ".claude", "projects", dir.replace(/[/.]/g, "-"));
  const file = path.join(proj, `${session}.jsonl`);
  try {
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"usage"')) continue;
      try {
        const o = JSON.parse(lines[i]);
        const u = o?.message?.usage;
        if (u && !o.isSidechain) return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      } catch {}
    }
  } catch {}
  return 0;
}

let spent = 0, stopped = false;
const addSpent = (x) => { spent += x; if (spent >= totalBudget) stopped = true; };

async function runSession(job) {
  const dir = path.join(workRoot, `${job.model}-${job.config}-r${job.rep}`);
  buildFixture(dir, { bug: false });
  execSync(`git init -q && git add -A && git -c user.name=bench -c user.email=bench@example.com commit -qm fixture`, { cwd: dir });
  const plugin = job.config !== "baseline";
  let session = null, cum = 0, total = 0, handoffs = 0, last = "";
  const steps = [];
  for (let i = 0; i < REQUESTS.length; i++) {
    let prompt = REQUESTS[i];
    const m = job.config.match(/^plugin-handoff(\d+)?$/);
    const threshold = m ? (m[1] ? Number(m[1]) * 1000 : HANDOFF_AT) : Infinity;
    if (session && contextTokens(dir, session) >= threshold) {
      const h = await claude(dir, "/token-saver:handoff", { model: job.model, plugin, resume: session });
      const hc = h.cum - cum; total += hc; addSpent(hc); handoffs++;
      steps.push({ n: `handoff-${handoffs}`, cost: hc, ctx: contextTokens(dir, session) });
      session = null; cum = 0;
      prompt = `/token-saver:resume ${REQUESTS[i]}`;
    }
    const r = await claude(dir, prompt, { model: job.model, plugin, resume: session });
    const cost = r.cum - cum; cum = r.cum; session = r.session;
    total += cost; addSpent(cost); last = r.result;
    steps.push({ n: i + 1, cost, ctx: contextTokens(dir, session), error: r.error });
    if (r.error && !r.session) break;
  }
  const c = check(dir, last);
  const rec = { ...job, at: new Date().toISOString(), cost: total, handoffs, ok: c.ok, detail: c.detail, steps };
  fs.appendFileSync(outFile, JSON.stringify(rec) + "\n");
  console.log(`${job.model.padEnd(6)} ${job.config.padEnd(15)} r${job.rep}  $${total.toFixed(3)}  handoffs ${handoffs}  peak ctx ${Math.round(Math.max(...steps.map((s) => s.ctx)) / 1000)}k  ${c.ok ? "PASS" : "FAIL"} ${c.detail}  (total $${spent.toFixed(2)})`);
}

const done = new Set();
if (fs.existsSync(outFile))
  for (const l of fs.readFileSync(outFile, "utf8").split("\n").filter(Boolean)) {
    const o = JSON.parse(l);
    done.add(`${o.model}|${o.config}|${o.rep}`);
    spent += o.cost || 0;
  }
const queue = [];
for (let r = 1; r <= runs; r++)
  for (const model of models)
    for (const config of (args.configs || "baseline,plugin,plugin-handoff").split(","))
      if (!done.has(`${model}|${config}|${r}`)) queue.push(() => runSession({ model, config, rep: r }));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`Long-session benchmark: ${queue.length} sessions × ${REQUESTS.length} requests, parallel ${parallel}, budget $${totalBudget} (already spent $${spent.toFixed(2)})\nResults: ${outFile}\n`);
  await Promise.all(Array.from({ length: parallel }, async () => { while (queue.length && !stopped) await queue.shift()(); }));
  if (stopped) console.log(`Budget of $${totalBudget} reached; remaining sessions skipped.`);
  console.log(`Done. Spent $${spent.toFixed(2)}.`);
}
