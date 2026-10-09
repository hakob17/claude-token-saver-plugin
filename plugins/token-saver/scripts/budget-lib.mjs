// Monthly budget tracking, shared by the status line (which records spend) and
// the budget-watch hook (which warns). Self-contained: the installer copies this
// file next to the status line script.
//
// Data lives in ~/.claude/token-saver/:
//   budget.json                       { "limit": 100, "resetDay": 1 }
//   spend/<period>/<sessionId>.json   { "cost": 1.23, "base": 0, "at": "..." }
//   warned.json                       { "period": "2026-10", "level": 80 }
//
// One file per session per period, so sessions running in parallel never
// overwrite each other's numbers. A session's spend in a period is cost - base,
// where base is what that session had already spent in earlier periods.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DIR = process.env.TOKEN_SAVER_HOME || path.join(os.homedir(), ".claude", "token-saver");
const SPEND = path.join(DIR, "spend");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

export function readConfig() {
  const cfg = readJson(path.join(DIR, "budget.json"), {});
  const envLimit = Number(process.env.TOKEN_SAVER_BUDGET);
  const limit = Number.isFinite(envLimit) && envLimit > 0 ? envLimit : Number(cfg.limit) || 0;
  const resetDay = Math.min(28, Math.max(1, Number(cfg.resetDay) || 1));
  return { limit, resetDay };
}

// Budget period key: the YYYY-MM in which the current period started.
export function periodKey(resetDay = 1, now = new Date()) {
  let y = now.getFullYear(), m = now.getMonth();
  if (now.getDate() < resetDay) {
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
  }
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

function previousPeriod(key) {
  let [y, m] = key.split("-").map(Number);
  m -= 1;
  if (m < 1) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

const safe = (id) => String(id || "unknown").replace(/[^A-Za-z0-9_-]/g, "_");

// Record a session's running cost (as reported by Claude Code) for this period.
export function recordSession(sessionId, cost, { resetDay } = readConfig()) {
  if (!sessionId || !Number.isFinite(cost)) return;
  const period = periodKey(resetDay);
  const file = path.join(SPEND, period, `${safe(sessionId)}.json`);
  let entry = readJson(file, null);
  if (!entry) {
    // A session that started in an earlier period: only count what's new.
    const prev = readJson(path.join(SPEND, previousPeriod(period), `${safe(sessionId)}.json`), null);
    entry = { cost: 0, base: prev ? prev.cost : 0 };
  }
  if (cost < entry.cost) entry.base = 0; // counter reset (shouldn't happen)
  if (cost === entry.cost && entry.at) return;
  entry.cost = cost;
  entry.at = new Date().toISOString();
  writeJson(file, entry);
}

export function periodTotal(period = periodKey(readConfig().resetDay)) {
  const dir = path.join(SPEND, period);
  let total = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const e = readJson(path.join(dir, f), null);
      if (e) total += Math.max(0, (e.cost || 0) - (e.base || 0));
    }
  } catch {}
  return total;
}

export function readWarned() {
  return readJson(path.join(DIR, "warned.json"), {});
}
export function writeWarned(data) {
  try { writeJson(path.join(DIR, "warned.json"), data); } catch {}
}

// Remove spend data older than ~4 months.
export function prune(keep = 4) {
  try {
    const periods = fs.readdirSync(SPEND).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort();
    for (const p of periods.slice(0, Math.max(0, periods.length - keep))) fs.rmSync(path.join(SPEND, p), { recursive: true, force: true });
  } catch {}
}
