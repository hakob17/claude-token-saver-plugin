#!/usr/bin/env node
// token-saver installer.
//   node install.mjs              install plugin + recommended user settings
//   node install.mjs --no-settings   plugin only, leave ~/.claude/settings.json alone
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
const statusDest = path.join(claudeDir, "token-saver-statusline.mjs");
const args = new Set(process.argv.slice(2));

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
  fs.rmSync(statusDest, { force: true });
  console.log("token-saver removed.");
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

  fs.copyFileSync(path.join(here, "statusline.mjs"), statusDest);

  s.model ??= "sonnet"; // Sonnet by default; /model opus when you really need it
  s.effortLevel ??= "medium"; // less thinking spend on routine work; --effort high when needed
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
Check spend anytime with /cost.`);

function printManual() {
  console.log(`
Couldn't run the claude CLI. Inside Claude Code, run:
  /plugin marketplace add ${here}
  /plugin install token-saver@token-saver-marketplace`);
}
