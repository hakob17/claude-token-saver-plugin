#!/usr/bin/env node
// token-saver installer.
//   node install.mjs              install plugin + recommended user settings
//   node install.mjs --no-settings   plugin only, leave ~/.claude/settings.json alone
//   node install.mjs --budget 100 [--reset-day 15]   also set a monthly budget
//   node install.mjs --effort medium  default effort to set (low | medium | high; default: low)
//   node install.mjs --uninstall     remove plugin and restore settings backup
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const claudeDir = path.join(os.homedir(), ".claude");
const settingsFile = path.join(claudeDir, "settings.json");
const backupFile = path.join(claudeDir, "settings.json.token-saver-backup");
const toolDir = path.join(claudeDir, "token-saver");
const statusDest = path.join(toolDir, "statusline.mjs");
const legacyStatus = path.join(claudeDir, "token-saver-statusline.mjs");
const argv = process.argv.slice(2);
const args = new Set(argv);
const argVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

function run(cmd) {
  try {
    execSync(cmd, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}
function hasClaude() {
  try {
    execSync(process.platform === "win32" ? "where claude" : "command -v claude", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (args.has("--uninstall")) {
  if (hasClaude()) {
    run("claude plugin uninstall token-saver@token-saver-marketplace");
    run("claude plugin marketplace remove token-saver-marketplace");
  }
  if (fs.existsSync(backupFile)) {
    fs.copyFileSync(backupFile, settingsFile);
    fs.rmSync(backupFile);
    console.log("Restored ~/.claude/settings.json from backup.");
  }
  for (const f of [statusDest, path.join(toolDir, "budget-lib.mjs"), legacyStatus]) fs.rmSync(f, { force: true });
  console.log("token-saver removed. Spend history and budget are kept in ~/.claude/token-saver/ (delete it to remove them).");
  process.exit(0);
}

// 1) Recommended settings (merged, never clobbering your own values except where noted)
if (!args.has("--no-settings")) {
  fs.mkdirSync(claudeDir, { recursive: true });
  let s = {};
  if (fs.existsSync(settingsFile)) {
    s = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    if (!fs.existsSync(backupFile)) fs.copyFileSync(settingsFile, backupFile);
  }

  fs.mkdirSync(toolDir, { recursive: true });
  fs.copyFileSync(path.join(here, "plugins/token-saver/scripts/statusline.mjs"), statusDest);
  fs.copyFileSync(path.join(here, "plugins/token-saver/scripts/budget-lib.mjs"), path.join(toolDir, "budget-lib.mjs"));
  fs.rmSync(legacyStatus, { force: true });

  s.model ??= "sonnet"; // Sonnet by default; /model opus when you really need it
  // Effort: benchmarks showed low effort costs 26% less on Opus and 12% less on
  // Sonnet than the default (medium), with all quality checks passing but fewer
  // tests written on big features. Use /token-saver:deep for a high-effort pass.
  // Opus 5.5 ignores the top-level effortLevel in user settings, so set it per model.
  const effort = argVal("--effort") || "low";
  if (["low", "medium", "high", "xhigh"].includes(effort)) {
    // Earlier token-saver versions wrote effortLevel "medium" (a no-op default);
    // replace that, but keep any value the user chose themselves.
    const ours = s.effortLevel === "medium" && fs.existsSync(backupFile) && !JSON.parse(fs.readFileSync(backupFile, "utf8")).effortLevel;
    if (ours || argVal("--effort")) s.effortLevel = effort;
    else s.effortLevel ??= effort;
    s.modelSettings ??= {};
    for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) {
      s.modelSettings[id] ??= {};
      if (argVal("--effort")) s.modelSettings[id].effortLevel = effort;
      else s.modelSettings[id].effortLevel ??= effort;
    }
  }
  s.statusLine = {
    type: "command",
    command: `node "${statusDest.replace(/\\/g, "/")}"`,
    padding: 0,
  };
  s.permissions ??= {};
  const deny = new Set(s.permissions.deny || []);
  [
    "Read(**/node_modules/**)",
    "Read(**/target/**)",
    "Read(**/build/**)",
    "Read(**/.gradle/**)",
    "Read(**/dist/**)",
    "Read(**/*.min.js)",
    "Read(**/package-lock.json)",
    "Read(**/yarn.lock)",
  ].forEach((r) => deny.add(r));
  s.permissions.deny = [...deny];

  fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2) + "\n");
  console.log(`Updated ${settingsFile} (backup: ${path.basename(backupFile)})`);
}

// Monthly budget
if (argVal("--budget")) {
  const limit = Number(argVal("--budget"));
  const resetDay = Number(argVal("--reset-day") || 1);
  if (limit > 0) {
    fs.mkdirSync(toolDir, { recursive: true });
    fs.writeFileSync(path.join(toolDir, "budget.json"), JSON.stringify({ limit, resetDay }) + "\n");
    console.log(`Monthly budget set: $${limit}, resets on day ${resetDay}.`);
  }
}

// 2) Plugin
if (hasClaude()) {
  const ok =
    run(`claude plugin marketplace add "${here}"`) &&
    run("claude plugin install token-saver@token-saver-marketplace");
  if (!ok) printManual();
} else {
  printManual();
}

console.log(`
Done. Restart Claude Code. New commands:
  /token-saver:handoff   save a compact note, then /clear
  /token-saver:resume    continue from that note in a fresh context
  /token-saver:find      cheap Haiku codebase search
  /token-saver:grunt     cheap Haiku mechanical edits
  /token-saver:review-diff  review only the git diff
  /token-saver:budget    set or check your monthly budget (e.g. /token-saver:budget 100)
  /token-saver:deep      run one request at high effort (hard bugs, big features)
Check spend anytime with /cost; the status line shows this month's total.`);

function printManual() {
  console.log(`
Couldn't run the claude CLI. Inside Claude Code, run:
  /plugin marketplace add ${here}
  /plugin install token-saver@token-saver-marketplace`);
}
