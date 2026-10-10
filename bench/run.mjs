#!/usr/bin/env node
// A/B benchmark: Claude Code without vs with the token-saver plugin.
//
//   node bench/run.mjs [--models sonnet,opus] [--tasks fix,feature,explain,rename]
//                      [--runs 3] [--parallel 3] [--budget 25] [--run-budget 3]
//                      [--configs baseline,plugin] [--out bench/results]
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
const taskIds = (args.tasks || Object.keys(TASKS).join(",")).split(",");
const configs = (args.configs || "baseline,plugin").split(",");
const runs = Number(args.runs || 3);
const parallel = Number(args.parallel || 3);
const totalBudget = Number(args.budget || 25);
const runBudget = Number(args["run-budget"] || 3);
const outDir = path.resolve(args.out || path.join(here, "results"));
const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ts-bench-"));
fs.mkdirSync(outDir, { recursive: true });
const runsFile = path.join(outDir, "runs.jsonl");

// Session-specific env from a parent Claude Code session must not leak into the
// benchmark sessions (both configs get the same cleaned env, so it stays fair).
function cleanEnv(extra) {
  const env = { ...process.env, ...extra };
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

function runOne(job) {
  return new Promise((resolve) => {
    const task = TASKS[job.task];
    const id = `${job.model}-${job.task}-${job.config}-r${job.rep}`;
    const dir = path.join(workRoot, id);
    buildFixture(dir, task.fixture);
    execSync(`git init -q && git add -A && git -c user.name=bench -c user.email=bench@example.com commit -qm fixture`, { cwd: dir });

    const cliArgs = [
      "-p", task.prompt,
      "--output-format", "json",
      "--model", job.model,
      "--permission-mode", "bypassPermissions",
      "--setting-sources", "project",
      "--max-budget-usd", String(runBudget),
    ];
    // Config names: baseline | plugin | effort-<level> | plugin+effort-<level>
    if (job.config.startsWith("plugin")) cliArgs.push("--plugin-dir", PLUGIN_DIR);
    const eff = job.config.match(/effort-(low|medium|high|xhigh|max)/);
    if (eff) cliArgs.push("--effort", eff[1]);

    const started = Date.now();
    const child = spawn("claude", cliArgs, {
      cwd: dir,
      env: cleanEnv({ CLAUDE_PLUGIN_DATA: path.join(dir, ".plugin-data"), IS_SANDBOX: "1" }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), 20 * 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      let res = {};
      try { res = JSON.parse(stdout.trim().split("\n").pop()); } catch { res = { is_error: true, result: (stderr || stdout).slice(-500) }; }
      const check = task.check(dir, res.result);
      const rec = {
        id, ...job, at: new Date().toISOString(), exit: code,
        cost_usd: res.total_cost_usd ?? null,
        turns: res.num_turns ?? null,
        duration_ms: res.duration_ms ?? Date.now() - started,
        usage: res.usage ?? null,
        modelUsage: res.modelUsage ?? null,
        is_error: !!res.is_error, subtype: res.subtype ?? null,
        quality_ok: check.ok, quality: check.detail,
        result_excerpt: String(res.result ?? "").slice(0, 400),
      };
      fs.appendFileSync(runsFile, JSON.stringify(rec) + "\n");
      spent += rec.cost_usd || 0;
      done += 1;
      console.log(
        `[${done}/${TOTAL}] ${id.padEnd(34)} $${(rec.cost_usd ?? 0).toFixed(3).padStart(6)}  ` +
          `turns ${String(rec.turns ?? "?").padStart(3)}  ${check.ok ? "PASS" : "FAIL"}  ${check.detail}   (total $${spent.toFixed(2)})`
      );
      if (spent >= totalBudget && !stopped) {
        stopped = true;
        console.log(`Budget of $${totalBudget} reached; not starting new runs.`);
      }
      resolve(rec);
    });
  });
}

async function main() {
  console.log(`Benchmark: ${queue.length} runs (${models} × ${taskIds} × ${configs} × ${runs}), parallel ${parallel}, budget $${totalBudget}`);
  console.log(`Work dir: ${workRoot}\nResults: ${runsFile}\n`);
  const workers = Array.from({ length: parallel }, async () => {
    while (queue.length && !stopped) {
      const job = queue.shift();
      await runOne(job);
    }
  });
  await Promise.all(workers);
  const md = summarize(runsFile);
  fs.writeFileSync(path.join(outDir, "summary.md"), md);
  console.log("\n" + md);
}

main();
