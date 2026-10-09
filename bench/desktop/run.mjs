#!/usr/bin/env node
// A/B benchmark for the token-saver-desktop plugin.
//
//   node bench/desktop/run.mjs [--models sonnet,opus] [--runs 3] [--parallel 4]
//                              [--budget 15] [--run-budget 2] [--only single|conversation]
//
// Single-message tasks: baseline vs plugin.
// 9-message conversation: baseline vs plugin vs plugin + /handoff after message 5
// (then /resume in a fresh session for messages 6-9).
//
// Runs headless Claude Code (`claude -p`) as a stand-in for the desktop app: same
// models and plugin mechanism, but a different system prompt and tool set, so
// treat the numbers as indicative.
//
// Note: for a resumed session (--resume), Claude Code reports total_cost_usd as
// the running total for the whole session, so per-message cost is the
// difference from the previous message in the same session.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeMaterial } from "./fixture.mjs";
import { SINGLE, CONVERSATION } from "./scenarios.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(here, "../../plugins/token-saver-desktop");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] == null ? "true" : all[i + 1]]);
    return acc;
  }, [])
);
const models = (args.models || "sonnet,opus").split(",");
const runs = Number(args.runs || 3);
const parallel = Number(args.parallel || 4);
const totalBudget = Number(args.budget || 15);
const callBudget = Number(args["run-budget"] || 2);
const only = args.only || "all";
const outDir = path.resolve(args.out || path.join(here, "results"));
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "runs.jsonl");
const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ts-desk-"));

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

let spent = 0, stopped = false;
function addSpent(x) {
  spent += x;
  if (spent >= totalBudget) stopped = true;
}

function claude(dir, prompt, { model, plugin, resume }) {
  const a = ["-p", prompt, "--output-format", "json", "--model", model, "--permission-mode", "bypassPermissions",
    "--setting-sources", "project", "--max-budget-usd", String(callBudget)];
  if (plugin) a.push("--plugin-dir", PLUGIN_DIR);
  if (resume) a.push("--resume", resume);
  return new Promise((resolve) => {
    const child = spawn("claude", a, { cwd: dir, env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => child.kill("SIGTERM"), 15 * 60_000);
    child.on("close", () => {
      clearTimeout(t);
      let r;
      try { r = JSON.parse(out.trim().split("\n").pop()); } catch { r = { is_error: true, result: (err || out).slice(-400) }; }
      resolve({
        cost: r.total_cost_usd ?? 0, session: r.session_id, result: String(r.result ?? ""), turns: r.num_turns,
        out_tokens: r.usage?.output_tokens ?? 0,
        in_tokens: (r.usage?.input_tokens || 0) + (r.usage?.cache_read_input_tokens || 0) + (r.usage?.cache_creation_input_tokens || 0),
        error: !!r.is_error,
      });
    });
  });
}

function record(rec) {
  fs.appendFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), ...rec }) + "\n");
}

async function runSingle(job) {
  const dir = path.join(workRoot, `${job.model}-${job.task}-${job.config}-r${job.rep}`);
  writeMaterial(dir);
  const r = await claude(dir, SINGLE[job.task].prompt, { model: job.model, plugin: job.config === "plugin" });
  addSpent(r.cost);
  const c = SINGLE[job.task].check(dir, r.result);
  record({ kind: "single", ...job, cost: r.cost, out_tokens: r.out_tokens, in_tokens: r.in_tokens, ok: c.ok, detail: c.detail, error: r.error });
  console.log(`${job.model.padEnd(6)} ${job.task.padEnd(8)} ${job.config.padEnd(15)} r${job.rep}  $${r.cost.toFixed(3)}  out ${r.out_tokens}  ${c.ok ? "PASS" : "FAIL"} ${c.detail}  (total $${spent.toFixed(2)})`);
}

function extractNote(text) {
  const m = text.match(/```[a-z]*\n([\s\S]*?)```/);
  return (m ? m[1] : text).trim();
}

async function runConversation(job) {
  const dir = path.join(workRoot, `${job.model}-conv-${job.config}-r${job.rep}`);
  writeMaterial(dir);
  const plugin = job.config !== "baseline";
  const turns = [];
  let session = null, cum = 0, total = 0, late = 0, checks = [], handoffCost = 0, noteWords = 0;
  for (let i = 0; i < CONVERSATION.turns.length; i++) {
    const t = CONVERSATION.turns[i];
    let prompt = t.q;
    if (job.config === "plugin-handoff" && i === CONVERSATION.handoffAfter) {
      const h = await claude(dir, "/token-saver-desktop:handoff", { model: job.model, plugin, resume: session });
      handoffCost = h.cost - cum;
      addSpent(handoffCost); total += handoffCost; late += handoffCost;
      const note = extractNote(h.result);
      noteWords = note.split(/\s+/).length;
      session = null; cum = 0; // fresh chat
      prompt = `/token-saver-desktop:resume ${t.q}\n\n${note}`;
    }
    const r = await claude(dir, prompt, { model: job.model, plugin, resume: session });
    const cost = r.cost - cum;
    cum = r.cost;
    session = r.session;
    addSpent(cost);
    total += cost;
    if (i >= CONVERSATION.handoffAfter) late += cost;
    const ok = t.check ? t.check(r.result) : null;
    if (t.check) checks.push(ok);
    turns.push({ n: i + 1, cost, in_tokens: r.in_tokens, out_tokens: r.out_tokens, ok });
    if (r.error) break;
  }
  const passed = checks.filter(Boolean).length;
  record({ kind: "conversation", ...job, cost: total, cost_after_handoff_point: late, handoff_cost: handoffCost, note_words: noteWords,
    ok: passed === checks.length, detail: `checks ${passed}/${checks.length}`, turns });
  console.log(`${job.model.padEnd(6)} conversation ${job.config.padEnd(15)} r${job.rep}  $${total.toFixed(3)} (msgs 6-9: $${late.toFixed(3)})  ${passed}/${checks.length} checks  (total $${spent.toFixed(2)})`);
}

const done = new Set();
if (fs.existsSync(outFile))
  for (const l of fs.readFileSync(outFile, "utf8").split("\n").filter(Boolean)) {
    const o = JSON.parse(l);
    done.add(`${o.kind}|${o.model}|${o.task || ""}|${o.config}|${o.rep}`);
    spent += o.cost || 0;
  }
const queue = [];
for (let r = 1; r <= runs; r++)
  for (const model of models) {
    if (only !== "single") for (const config of ["baseline", "plugin", "plugin-handoff"]) if (!done.has(`conversation|${model}||${config}|${r}`)) queue.push(() => runConversation({ model, config, rep: r }));
    if (only !== "conversation")
      for (const task of Object.keys(SINGLE))
        for (const config of ["baseline", "plugin"])
          if (!done.has(`single|${model}|${task}|${config}|${r}`)) queue.push(() => runSingle({ model, task, config, rep: r }));
  }

console.log(`Already done: ${done.size} jobs ($${spent.toFixed(2)}). Remaining: ${queue.length} jobs, parallel ${parallel}, budget $${totalBudget}\nResults: ${outFile}\n`);
await Promise.all(Array.from({ length: parallel }, async () => {
  while (queue.length && !stopped) await queue.shift()();
}));
if (stopped) console.log(`Budget of $${totalBudget} reached; remaining jobs skipped.`);
console.log(`Done. Spent $${spent.toFixed(2)}.`);
