// Benchmark tasks. Each has a realistic prompt and an automatic quality check,
// so a cheaper run that breaks things doesn't count as a win.
import { execSync } from "node:child_process";

const BASE_TESTS = 238;

function runTests(dir) {
  try {
    const out = execSync(`node --test --test-reporter=tap "test/**/*.test.js"`, {
      cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000,
    });
    return parseTap(out);
  } catch (e) {
    return parseTap(String(e.stdout || ""));
  }
}
function parseTap(out) {
  const pass = Number((out.match(/^# pass (\d+)/m) || [])[1] || 0);
  const fail = Number((out.match(/^# fail (\d+)/m) || [])[1] || 0);
  return { pass, fail };
}
function sh(dir, cmd) {
  try {
    return execSync(cmd, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    return String(e.stdout || "");
  }
}

export const TASKS = {
  fix: {
    title: "Fix failing tests",
    fixture: { bug: true },
    prompt: "Some tests are failing. Find the cause and fix it in the source code. Don't change the tests.",
    check(dir) {
      const t = runTests(dir);
      const testsTouched = sh(dir, "git diff --name-only HEAD -- test/").trim();
      const ok = t.fail === 0 && t.pass >= BASE_TESTS && !testsTouched;
      return { ok, detail: `tests ${t.pass} pass / ${t.fail} fail${testsTouched ? ", tests modified" : ""}` };
    },
  },

  feature: {
    title: "Add refund feature + API + tests",
    fixture: { bug: false },
    prompt:
      "Add refund support to the wallet: refund a previous DEBIT by its transaction id. A refund credits the amount back, " +
      "can happen only once per transaction, and must be rejected for CREDIT entries and unknown ids. Expose it in the API " +
      "as POST /wallet/:userId/refund with body { transactionId }. Add tests and make sure the whole test suite passes.",
    check(dir) {
      const t = runTests(dir);
      const svc = sh(dir, "grep -c refund src/wallet/walletService.js").trim();
      const api = sh(dir, "grep -c refund src/api/handlers.js").trim();
      const ok = t.fail === 0 && t.pass > BASE_TESTS && Number(svc) > 0 && Number(api) > 0;
      return { ok, detail: `tests ${t.pass} pass / ${t.fail} fail (+${t.pass - BASE_TESTS} new), refund in service:${svc > 0} api:${api > 0}` };
    },
  },

  bigfeature: {
    title: "Large feature: bonus / wagering module",
    fixture: { bug: false },
    prompt:
      "Add a bonus module. An operator can grant a bonus to an account: amount, wagering multiplier (e.g. 10 means the player " +
      "must stake 10x the bonus amount) and an expiry time. Bonus funds are tracked separately from the cash balance. Every bet " +
      "the account places counts its stake toward wagering progress of its active bonuses. When the requirement is met, the bonus " +
      "amount is converted into real wallet balance (credited) and the bonus is marked COMPLETED. Bonuses past expiry are FORFEITED " +
      "(use the clock util) and can also be forfeited manually. Expose it in the API: POST /bonuses (grant, body { userId, amount, " +
      "multiplier, expiresAt }), GET /bonuses/:userId (list with progress), POST /bonuses/:id/forfeit. Put the code in src/bonus/. " +
      "Add thorough tests (granting, progress from bets, completion, expiry, manual forfeit, validation, API) and make sure the " +
      "whole test suite passes.",
    check(dir) {
      const t = runTests(dir);
      const files = sh(dir, "ls src/bonus 2>/dev/null | wc -l").trim();
      const api = Number(sh(dir, "grep -c bonus src/api/handlers.js").trim());
      const betsHook = Number(sh(dir, "(grep -rli bonus src/bets; grep -rlE 'placeBet|bets/' src/bonus) 2>/dev/null | wc -l").trim());
      const ok = t.fail === 0 && t.pass >= BASE_TESTS + 8 && Number(files) > 0 && api > 0 && betsHook > 0;
      return { ok, detail: `tests ${t.pass} pass / ${t.fail} fail (+${t.pass - BASE_TESTS} new), src/bonus files:${files}, api:${api > 0}, bets integration:${betsHook > 0}` };
    },
  },

  explain: {
    title: "Explain where/how payout is computed",
    fixture: { bug: false },
    prompt:
      "How is the payout for a winning bet calculated, and which rounding mode is used? Point me to the exact function. Don't change any files.",
    check(dir, result) {
      const text = String(result || "");
      const where = /computePayout|settlementService/.test(text);
      const mode = /HALF_EVEN|half[\s_-]?even|banker/i.test(text);
      const untouched = !sh(dir, "git status --porcelain").trim();
      return { ok: where && mode && untouched, detail: `names function:${where} rounding:${mode} untouched:${untouched}` };
    },
  },

  rename: {
    title: "Rename userId -> accountId across src/ and test/",
    fixture: { bug: false },
    prompt:
      "Rename userId to accountId everywhere in src/ and test/ — identifiers, object fields, route params, error fields and " +
      "messages, function names like findByUserId. Keep all tests passing.",
    check(dir) {
      const t = runTests(dir);
      const left = Number(sh(dir, "grep -rio userid src test | wc -l").trim());
      const ok = t.fail === 0 && t.pass >= BASE_TESTS && left === 0;
      return { ok, detail: `tests ${t.pass} pass / ${t.fail} fail, userId left: ${left}` };
    },
  },
};
