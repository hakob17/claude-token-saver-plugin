#!/usr/bin/env node
// A/B benchmark: Claude Code without vs with the token-saver plugin.
//
//   node bench/run.mjs [--models sonnet,opus] [--tasks fix,feature,explain,rename]
//                      [--runs 3] [--parallel 3] [--budget 25] [--run-budget 3]
//                      [--configs baseline,plugin] [--out bench/results]
//                      [--proxy-budget 8] [--proxy-subagents claude-sonnet-5-5] [--use-api-key]
//
// Every run gets a fresh copy of the sample project (git-initialised), runs
// `claude -p` headless, then an automatic quality check. Results are appended
// to <out>/runs.jsonl and summarised in <out>/summary.md.
//
// Costs real money: each run bills the account the `claude` CLI is signed into.
// --budget caps the total spend; --run-budget caps each run.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildFixture } from "./fixture/build-fixture.mjs";
import { TASKS } from "./tasks.mjs";
import { summarize } from "./report.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(here, "../plugins/token-saver");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] == null ? "true" : all[i + 1]]);
    return acc;
  }, [])
);
const models = (args.models || "sonnet").split(",");
// Opt-in tasks (long, greenfield) only run when named in --tasks.
const taskIds = (args.tasks || Object.keys(TASKS).filter((k) => !TASKS[k].optIn).join(",")).split(",");
const configs = (args.configs || "baseline,plugin").split(",");
const runs = Number(args.runs || 3);
const parallel = Number(args.parallel || 3);
const totalBudget = Number(args.budget || 25);
const runBudget = Number(args["run-budget"] || 3);
const outDir = path.resolve(args.out || path.join(here, "results"));
// --resume-root <dir> continues interrupted builds in an earlier work dir instead of starting over.
const workRoot = args["resume-root"] ? path.resolve(args["resume-root"]) : fs.mkdtempSync(path.join(os.tmpdir(), "ts-bench-"));
fs.mkdirSync(outDir, { recursive: true });
const runsFile = path.join(outDir, "runs.jsonl");

// Session-specific env from a parent Claude Code session must not leak into the
// benchmark sessions (both configs get the same cleaned env, so it stays fair).
function cleanEnv(extra) {
  const env = { ...process.env, ...extra };
  if (!args["use-api-key"]) delete env.ANTHROPIC_API_KEY; // bill the CLI's own login, not a stray shell key
  for (const k of Object.keys(env)) {
    if (
      k === "CLAUDECODE" ||
      /^CLAUDE_CODE_(SESSION_ID|REMOTE_SESSION_ID|CHILD_SESSION|SYNC_|CCR_EARLY|POST_TURN_MEMORY|ADDITIONAL_DIRECTORIES|ENTRYPOINT|SESSION_ORIGIN|SESSION_ATTENDED|MESSAGING_)/.test(k) ||
      /^CLAUDE_(ADDITIONAL_DIRECTORIES|AFTER_LAST_COMPACT|PROJECT_TOOL|PLUGIN_ROOT)$/.test(k)
    ) delete env[k];
  }
  return env;
}

// Queue: interleave configs so time-of-day effects hit both equally.
const queue = [];
for (let r = 1; r <= runs; r++)
  for (const model of models)
    for (const task of taskIds)
      for (const config of configs) queue.push({ model, task, config, rep: r });

const TOTAL = queue.length;
let spent = 0;
let stopped = false;
let done = 0;

// Config names: baseline | plugin | effort-<level> | plugin+effort-<level>
//   | plugin+router (hook router on) | plugin+proxy / proxy (routing proxy in front of the API)
const PROXY = path.resolve(here, "../plugins/token-saver/proxy/router-proxy.mjs");

// One routing proxy per run, on its own port, with its own ledger and log.
async function startProxy(dir, worker) {
  const port = 9100 + worker;
  const log = path.join(dir, ".proxy-log.jsonl");
  const child = spawn(process.execPath, [PROXY], {
    env: {
      ...process.env,
      TOKEN_SAVER_PROXY_PORT: String(port),
      TOKEN_SAVER_HOME: path.join(dir, ".ts-home"),
      TOKEN_SAVER_PROXY_LOG: log,
      TOKEN_SAVER_PROXY_BUDGET: args["proxy-budget"] || "8",
      TOKEN_SAVER_PROXY_SUBAGENTS: args["proxy-subagents"] || "claude-sonnet-5-5",
      TOKEN_SAVER_PROXY_FALLBACK: args["proxy-fallback"] || "claude-sonnet-5-5",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  await new Promise((ok) => child.stderr.once("data", ok)); // first line = listening
  return { url: `http://127.0.0.1:${port}`, log, stop: () => child.kill() };
}

// What actually ran, from the proxy log: requests and true cost per serving model.
function proxySummary(log) {
  const by = {};
  let rewritten = 0, failOpen = 0, adapted = 0, held = 0, switched = 0;
  for (const line of (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [])) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (!e.requested) continue;
    if (e.note?.startsWith("adapted")) { adapted++; continue; }
    if (e.note?.startsWith("rewritten request rejected")) { failOpen++; continue; }
    const m = e.usage?.model || e.routed;
    by[m] ??= { requests: 0, cost: 0, output_tokens: 0 };
    by[m].requests++; by[m].cost += e.cost || 0; by[m].output_tokens += e.usage?.output_tokens || 0;
    if (e.routed !== e.requested) rewritten++;
    if (/held/.test(e.reason)) held++;
    if (/switch/.test(e.reason)) switched++;
  }
  const cost = Object.values(by).reduce((n, v) => n + v.cost, 0);
  return { cost_usd: +cost.toFixed(4), by_model: by, rewritten, held, switched, adapted, fail_open: failOpen };
}

function claudeOnce(dir, prompt, job, env, resumeId) {
  const cliArgs = [
    "-p", prompt,
    "--output-format", "json",
    "--model", job.model,
    "--permission-mode", "bypassPermissions",
    "--setting-sources", "project",
    "--max-budget-usd", String(runBudget),
  ];
  if (resumeId) cliArgs.push("--resume", resumeId);
  if (job.config.startsWith("plugin")) cliArgs.push("--plugin-dir", PLUGIN_DIR);
  const eff = job.config.match(/effort-(low|medium|high|xhigh|max)/);
  if (eff) cliArgs.push("--effort", eff[1]);
  const task = TASKS[job.task];
  return new Promise((resolve) => {
    const child = spawn("claude", cliArgs, { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    // Safety net only; long tasks set timeoutMin: 0 (no cap) and rely on --max-budget-usd.
    const timer = task.timeoutMin === 0 ? null : setTimeout(() => child.kill("SIGTERM"), (task.timeoutMin || 20) * 60_000);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      let res = {};
      try { res = JSON.parse(stdout.trim().split("\n").pop()); } catch { res = { is_error: true, result: (stderr || stdout).slice(-500) }; }
      resolve({ code, res });
    });
  });
}

const add = (a = {}, b = {}) => {
  for (const [k, v] of Object.entries(b || {})) if (typeof v === "number") a[k] = (a[k] || 0) + v;
  return a;
};

// True cost from the session transcripts: every API response, priced by the model
// that served it. Survives killed turns, which never print their JSON result.
const PRICES = [[/opus-5-5/, 4, 20, 0.2], [/opus/, 5, 25, 0.5], [/fable|mythos/, 10, 50, 0.25], [/sonnet-4/, 3, 15, 0.3], [/sonnet/, 2, 10, 0.2], [/haiku-5/, 0.1, 0.5, 0.01], [/haiku/, 1, 5, 0.1]];
function transcriptCost(dir) {
  const root = path.join(os.homedir(), ".claude", "projects");
  const key = fs.realpathSync(dir).replace(/[^A-Za-z0-9]/g, "-");
  const last = {};
  const walk = (p) => {
    for (const f of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, f.name);
      if (f.isDirectory()) walk(q);
      else if (f.name.endsWith(".jsonl")) for (const l of fs.readFileSync(q, "utf8").split("\n")) {
        let e; try { e = JSON.parse(l); } catch { continue; }
        if (e.type === "assistant" && e.message?.usage) last[e.message.id + ":" + (e.requestId || "")] = e.message; // streamed entries repeat; keep the last
      }
    }
  };
  for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) if (d === key) walk(path.join(root, d));
  const by = {};
  let total = 0;
  for (const m of Object.values(last)) {
    const p = PRICES.find(([re]) => re.test(m.model || ""));
    if (!p) continue;
    const [, i, o, rd] = p, u = m.usage, w1 = u.cache_creation?.ephemeral_1h_input_tokens || 0, w5 = (u.cache_creation_input_tokens || 0) - w1;
    const c = ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + (u.cache_read_input_tokens || 0) * rd + w5 * i * 1.25 + w1 * i * 2) / 1e6;
    total += c;
    by[m.model] ??= { calls: 0, cost: 0, output_tokens: 0 };
    by[m.model].calls++; by[m.model].cost += c; by[m.model].output_tokens += u.output_tokens || 0;
  }
  return { cost_usd: +total.toFixed(4), by_model: by };
}
function latestSession(dir) {
  const d = path.join(os.homedir(), ".claude", "projects", fs.realpathSync(dir).replace(/[^A-Za-z0-9]/g, "-"));
  const f = fs.existsSync(d) ? fs.readdirSync(d).filter((n) => n.endsWith(".jsonl")).map((n) => [n, fs.statSync(path.join(d, n)).mtimeMs]).sort((a, b) => b[1] - a[1])[0] : null;
  return f ? f[0].replace(/\.jsonl$/, "") : null;
}
const CONTINUE = "You were interrupted. Continue exactly where you left off and finish the current step, including running the required build/test commands until they pass.";

async function runOne(job) {
  const task = TASKS[job.task];
  const id = `${job.model}-${job.task}-${job.config}-r${job.rep}`;
  const dir = path.join(workRoot, id);
  // Progress per build, so an interrupted build can be resumed with --resume-root.
  const progFile = path.join(dir, ".bench-progress.json");
  let prog = null;
  if (fs.existsSync(dir)) {
    try { prog = JSON.parse(fs.readFileSync(progFile, "utf8")); } catch {}
    if (prog?.finished) { console.log(`skip ${id}: already finished`); return null; }
    prog ??= { turn: 0, sessionId: latestSession(dir), interrupted: true }; // started before progress files existed
  } else {
    if (task.fixture.empty) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "README.md"), "# New project\n");
      for (const [rel, src] of Object.entries(task.fixture.files || {})) { // e.g. a fixed plan every variant gets
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.copyFileSync(path.resolve(here, src), path.join(dir, rel));
      }
    } else buildFixture(dir, task.fixture);
    execSync(`git init -q && git add -A && git -c user.name=bench -c user.email=bench@example.com commit -qm fixture`, { cwd: dir });
    prog = { turn: 0, sessionId: null, interrupted: false };
  }
  const saveProg = () => fs.writeFileSync(progFile, JSON.stringify(prog));

  const extra = { CLAUDE_PLUGIN_DATA: path.join(dir, ".plugin-data"), IS_SANDBOX: "1" };
  if (job.config.includes("router")) extra.TOKEN_SAVER_ROUTER = "on";
  const proxy = /(^|\+)proxy/.test(job.config) ? await startProxy(dir, job.worker || 0) : null;
  if (proxy) extra.ANTHROPIC_BASE_URL = proxy.url;
  const env = cleanEnv(extra);

  // Multi-turn tasks resume the same session, like a user sending follow-ups.
  const prompts = task.turns ? task.turns.map((t) => (typeof t === "function" ? t(job) : t))
    : [typeof task.prompt === "function" ? task.prompt(job) : task.prompt];
  const started = Date.now();
  let cost = 0, turns = 0, last = {}, code = 0, continuations = 0;
  const usage = {}, modelUsage = {};
  // An interrupted turn (killed, crashed, per-call budget hit) is continued in the
  // same session, up to 3 times per turn, instead of ending the build.
  while (prog.turn < prompts.length && spent + cost < totalBudget) {
    const out = await claudeOnce(dir, prog.interrupted ? CONTINUE : prompts[prog.turn], job, env, prog.sessionId);
    last = out.res; code = out.code;
    prog.sessionId = last.session_id || prog.sessionId || latestSession(dir);
    cost += last.total_cost_usd || 0; turns += last.num_turns || 0;
    add(usage, last.usage);
    for (const [m, u] of Object.entries(last.modelUsage || {})) modelUsage[m] = add(modelUsage[m], u);
    // A plan's usage limit comes back as a normal "success" whose text is the limit notice.
    // Stop everything: retrying only burns attempts, and the build can resume later in place.
    if (/hit your (session |usage )?limit|usage limit (reached|exceeded)/i.test(String(last.result || ""))) {
      prog.interrupted = true; saveProg();
      if (proxy) proxy.stop();
      if (!stopped) { stopped = true; console.log(`Usage limit reached during ${id}; stopping. Resume later with --resume-root ${workRoot}`); }
      return null;
    }
    const ok = !last.is_error && last.subtype === "success";
    if (ok) { prog.turn++; prog.interrupted = false; continuations = 0; }
    else if (++continuations > 3) { saveProg(); break; }
    else prog.interrupted = true;
    saveProg();
  }
  prog.finished = prog.turn >= prompts.length; saveProg();
  if (proxy) proxy.stop();

  const check = task.check(dir, last.result, job);
  const rec = {
    id, ...job, at: new Date().toISOString(), exit: code,
    cost_usd: cost, // as reported by Claude Code (priced by the requested model; misses killed turns)
    true_cost_usd: (proxy && proxySummary(proxy.log).cost_usd) || transcriptCost(dir).cost_usd || cost, // every response, priced by the serving model
    transcript: transcriptCost(dir),
    completed_turns: prog.turn,
    proxy: proxy ? proxySummary(proxy.log) : null,
    turns, prompts: prompts.length,
    duration_ms: Date.now() - started,
    usage, modelUsage,
    is_error: !!last.is_error, subtype: last.subtype ?? null,
    quality_ok: check.ok, quality: check.detail,
    result_excerpt: String(last.result ?? "").slice(0, 400),
  };
  fs.appendFileSync(runsFile, JSON.stringify(rec) + "\n");
  spent += rec.true_cost_usd || 0;
  done += 1;
  console.log(
    `[${done}/${TOTAL}] ${id.padEnd(40)} $${rec.true_cost_usd.toFixed(3).padStart(7)}${proxy ? ` (CC says $${cost.toFixed(2)})` : ""}  ` +
      `turns ${String(turns).padStart(3)}  ${check.ok ? "PASS" : "FAIL"}  ${check.detail}   (total $${spent.toFixed(2)})`
  );
  if (spent >= totalBudget && !stopped) {
    stopped = true;
    console.log(`Budget of $${totalBudget} reached; not starting new runs.`);
  }
  return rec;
}

async function main() {
  console.log(`Benchmark: ${queue.length} runs (${models} × ${taskIds} × ${configs} × ${runs}), parallel ${parallel}, budget $${totalBudget}`);
  console.log(`Work dir: ${workRoot}\nResults: ${runsFile}\n`);
  const workers = Array.from({ length: parallel }, async (_, worker) => {
    while (queue.length && !stopped) {
      const job = { ...queue.shift(), worker };
      await runOne(job);
    }
  });
  await Promise.all(workers);
  const md = summarize(runsFile);
  fs.writeFileSync(path.join(outDir, "summary.md"), md);
  console.log("\n" + md);
}

main();
