// Builds the benchmark sample project: a small wallet / betting backend in plain
// Node (no dependencies), deliberately shaped like a real repo:
//   - ~20 source modules + tests (node:test)
//   - one large legacy module (~100 KB) that's tempting to read in full
//   - large data fixtures and an app log
//   - a verbose test run (hundreds of test lines)
// Usage: buildFixture(dir, { bug: true|false })
import fs from "node:fs";
import path from "node:path";

function w(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content.replace(/^\n/, ""));
}

export function buildFixture(root, { bug = false } = {}) {
  fs.mkdirSync(root, { recursive: true });

  w(root, "package.json", JSON.stringify({
    name: "wallet-service", version: "1.4.0", private: true, type: "module",
    scripts: { test: "node --test --test-reporter=spec \"test/**/*.test.js\"" },
  }, null, 2) + "\n");

  w(root, "README.md", `
# wallet-service

Accounts, wallets, bets and settlement for a small betting backend.

- \`src/accounts\` — account registry
- \`src/wallet\` — balances and ledger
- \`src/bets\` — placing and cancelling bets
- \`src/settlement\` — settling bets and paying out
- \`src/api\` — request handlers and routing
- \`src/reports\` — legacy reporting (do not extend)

Run tests with \`npm test\`.
`);

  w(root, "src/money.js", `
// All amounts are integer minor units (cents).
export const RoundingMode = Object.freeze({ HALF_UP: "HALF_UP", HALF_EVEN: "HALF_EVEN", DOWN: "DOWN" });

export function toMinor(major) {
  return Math.round(Number(major) * 100);
}

export function fromMinor(minor) {
  return (minor / 100).toFixed(2);
}

export function round(value, mode = RoundingMode.HALF_UP) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (mode === RoundingMode.DOWN) return floor;
  if (Math.abs(diff - 0.5) < 1e-9) {
    if (mode === RoundingMode.HALF_EVEN) return floor % 2 === 0 ? floor : floor + 1;
    return floor + 1;
  }
  return Math.round(value);
}

export function assertAmount(amount) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RangeError(\`Invalid amount: \${amount}\`);
  }
}
`);

  w(root, "src/util/ids.js", `
let counter = 0;
export function nextId(prefix) {
  counter += 1;
  return \`\${prefix}_\${String(counter).padStart(6, "0")}\`;
}
export function resetIds() {
  counter = 0;
}
`);

  w(root, "src/util/clock.js", `
let fixed = null;
export function now() {
  return fixed ?? Date.now();
}
export function setNow(ms) {
  fixed = ms;
}
`);

  w(root, "src/util/validation.js", `
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}
export function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(\`\${field} is required\`);
  }
  return value;
}
export function requireInt(value, field) {
  if (!Number.isInteger(value)) throw new ValidationError(\`\${field} must be an integer\`);
  return value;
}
`);

  w(root, "src/errors.js", `
export class NotFoundError extends Error {
  constructor(what, id) {
    super(\`\${what} not found: \${id}\`);
    this.name = "NotFoundError";
  }
}
export class InsufficientFundsError extends Error {
  constructor(userId, balance, amount) {
    super(\`Insufficient funds for \${userId}: balance \${balance}, requested \${amount}\`);
    this.name = "InsufficientFundsError";
    this.userId = userId;
  }
}
export class StateError extends Error {
  constructor(message) {
    super(message);
    this.name = "StateError";
  }
}
`);

  w(root, "src/accounts/accountRepository.js", `
const accounts = new Map();

export function save(account) {
  accounts.set(account.userId, account);
  return account;
}
export function findByUserId(userId) {
  return accounts.get(userId) ?? null;
}
export function all() {
  return [...accounts.values()];
}
export function clear() {
  accounts.clear();
}
`);

  w(root, "src/accounts/accountService.js", `
import * as repo from "./accountRepository.js";
import { NotFoundError } from "../errors.js";
import { requireString } from "../util/validation.js";
import { now } from "../util/clock.js";

export function openAccount(userId, { currency = "EUR", name = "" } = {}) {
  requireString(userId, "userId");
  if (repo.findByUserId(userId)) throw new Error(\`Account already exists: \${userId}\`);
  return repo.save({ userId, currency, name, createdAt: now(), status: "ACTIVE" });
}

export function getAccount(userId) {
  const account = repo.findByUserId(userId);
  if (!account) throw new NotFoundError("Account", userId);
  return account;
}

export function closeAccount(userId) {
  const account = getAccount(userId);
  account.status = "CLOSED";
  return repo.save(account);
}
`);

  w(root, "src/wallet/ledger.js", `
import { nextId } from "../util/ids.js";
import { now } from "../util/clock.js";

const entries = [];

export function record(userId, type, amount, ref = null) {
  const entry = { id: nextId("tx"), userId, type, amount, ref, at: now() };
  entries.push(entry);
  return entry;
}
export function forUser(userId) {
  return entries.filter((e) => e.userId === userId);
}
export function findById(id) {
  return entries.find((e) => e.id === id) ?? null;
}
export function clear() {
  entries.length = 0;
}
`);

  const debitCheck = bug
    ? `  // balance check happens in the API layer\n`
    : `  if (current < amount) throw new InsufficientFundsError(userId, current, amount);\n`;

  w(root, "src/wallet/walletService.js", `
import { assertAmount } from "../money.js";
import { getAccount } from "../accounts/accountService.js";
import { InsufficientFundsError, StateError } from "../errors.js";
import * as ledger from "./ledger.js";

const balances = new Map();

function ensureActive(userId) {
  const account = getAccount(userId);
  if (account.status !== "ACTIVE") throw new StateError(\`Account \${userId} is \${account.status}\`);
}

export function balance(userId) {
  getAccount(userId);
  return balances.get(userId) ?? 0;
}

export function credit(userId, amount, ref = null) {
  ensureActive(userId);
  assertAmount(amount);
  balances.set(userId, balance(userId) + amount);
  return ledger.record(userId, "CREDIT", amount, ref);
}

export function debit(userId, amount, ref = null) {
  ensureActive(userId);
  assertAmount(amount);
  const current = balance(userId);
${debitCheck}  balances.set(userId, current - amount);
  return ledger.record(userId, "DEBIT", amount, ref);
}

export function history(userId) {
  getAccount(userId);
  return ledger.forUser(userId);
}

export function reset() {
  balances.clear();
  ledger.clear();
}
`);

  w(root, "src/bets/odds.js", `
// Decimal odds helpers. Odds are stored as integer thousandths (2.150 -> 2150).
export function parseOdds(text) {
  const value = Number(text);
  if (!Number.isFinite(value) || value < 1.01) throw new RangeError(\`Invalid odds: \${text}\`);
  return Math.round(value * 1000);
}
export function formatOdds(thousandths) {
  return (thousandths / 1000).toFixed(3);
}
export function impliedProbability(thousandths) {
  return 1000 / thousandths;
}
`);

  w(root, "src/bets/betRepository.js", `
const bets = new Map();
export function save(bet) {
  bets.set(bet.id, bet);
  return bet;
}
export function findById(id) {
  return bets.get(id) ?? null;
}
export function forUser(userId) {
  return [...bets.values()].filter((b) => b.userId === userId);
}
export function clear() {
  bets.clear();
}
`);

  w(root, "src/bets/betService.js", `
import * as repo from "./betRepository.js";
import { debit, credit } from "../wallet/walletService.js";
import { nextId } from "../util/ids.js";
import { now } from "../util/clock.js";
import { NotFoundError, StateError } from "../errors.js";
import { requireString, requireInt } from "../util/validation.js";

export function placeBet(userId, { selection, odds, stake }) {
  requireString(selection, "selection");
  requireInt(odds, "odds");
  requireInt(stake, "stake");
  const id = nextId("bet");
  debit(userId, stake, id);
  return repo.save({ id, userId, selection, odds, stake, status: "OPEN", placedAt: now() });
}

export function getBet(id) {
  const bet = repo.findById(id);
  if (!bet) throw new NotFoundError("Bet", id);
  return bet;
}

export function cancelBet(id) {
  const bet = getBet(id);
  if (bet.status !== "OPEN") throw new StateError(\`Bet \${id} is \${bet.status}\`);
  credit(bet.userId, bet.stake, id);
  bet.status = "CANCELLED";
  return repo.save(bet);
}

export function betsFor(userId) {
  return repo.forUser(userId);
}
`);

  w(root, "src/settlement/settlementService.js", `
import { getBet } from "../bets/betService.js";
import { save } from "../bets/betRepository.js";
import { credit } from "../wallet/walletService.js";
import { round, RoundingMode } from "../money.js";
import { StateError } from "../errors.js";

// Payout = stake * decimal odds, in minor units.
// Rounded HALF_EVEN (banker's rounding) so systematic rounding doesn't favour either side.
export function computePayout(stake, odds) {
  return round((stake * odds) / 1000, RoundingMode.HALF_EVEN);
}

export function settle(betId, outcome) {
  const bet = getBet(betId);
  if (bet.status !== "OPEN") throw new StateError(\`Bet \${betId} is \${bet.status}\`);
  if (outcome === "WON") {
    const payout = computePayout(bet.stake, bet.odds);
    credit(bet.userId, payout, betId);
    bet.payout = payout;
    bet.status = "WON";
  } else if (outcome === "LOST") {
    bet.payout = 0;
    bet.status = "LOST";
  } else if (outcome === "VOID") {
    credit(bet.userId, bet.stake, betId);
    bet.payout = bet.stake;
    bet.status = "VOID";
  } else {
    throw new RangeError(\`Unknown outcome: \${outcome}\`);
  }
  return save(bet);
}
`);

  w(root, "src/api/handlers.js", `
import { openAccount, getAccount } from "../accounts/accountService.js";
import { balance, credit, debit, history } from "../wallet/walletService.js";
import { placeBet, cancelBet, getBet } from "../bets/betService.js";
import { settle } from "../settlement/settlementService.js";
import { ValidationError } from "../util/validation.js";
import { NotFoundError, InsufficientFundsError, StateError } from "../errors.js";

function ok(body, status = 200) {
  return { status, body };
}

export function toResponse(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ValidationError || e instanceof RangeError) return { status: 400, body: { error: e.message } };
    if (e instanceof NotFoundError) return { status: 404, body: { error: e.message } };
    if (e instanceof InsufficientFundsError) return { status: 409, body: { error: e.message } };
    if (e instanceof StateError) return { status: 409, body: { error: e.message } };
    throw e;
  }
}

export const handlers = {
  "POST /accounts": (req) => ok(openAccount(req.body.userId, req.body), 201),
  "GET /accounts/:userId": (req) => ok(getAccount(req.params.userId)),
  "GET /wallet/:userId/balance": (req) => ok({ userId: req.params.userId, balance: balance(req.params.userId) }),
  "GET /wallet/:userId/history": (req) => ok(history(req.params.userId)),
  "POST /wallet/:userId/credit": (req) => ok(credit(req.params.userId, req.body.amount, req.body.ref), 201),
  "POST /wallet/:userId/debit": (req) => ok(debit(req.params.userId, req.body.amount, req.body.ref), 201),
  "POST /bets": (req) => ok(placeBet(req.body.userId, req.body), 201),
  "GET /bets/:id": (req) => ok(getBet(req.params.id)),
  "POST /bets/:id/cancel": (req) => ok(cancelBet(req.params.id)),
  "POST /bets/:id/settle": (req) => ok(settle(req.params.id, req.body.outcome)),
};
`);

  w(root, "src/api/router.js", `
import { handlers, toResponse } from "./handlers.js";

const routes = Object.entries(handlers).map(([key, handler]) => {
  const [method, pattern] = key.split(" ");
  const names = [];
  const regex = new RegExp("^" + pattern.replace(/:(\\w+)/g, (_, n) => (names.push(n), "([^/]+)")) + "$");
  return { method, regex, names, handler };
});

export function dispatch({ method, path, body = {} }) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.regex);
    if (!m) continue;
    const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    return toResponse(() => r.handler({ params, body }));
  }
  return { status: 404, body: { error: \`No route for \${method} \${path}\` } };
}
`);

  // --- Large legacy module: ~2,400 lines / ~100 KB of repetitive reporting code.
  let legacy = `// LEGACY reporting module (2016). Do not extend; scheduled for removal.
// Generated per-market report builders. Rounding here is report-only (HALF_UP) and
// does NOT affect real payouts.
import { round, RoundingMode, fromMinor } from "../money.js";
`;
  const markets = ["football", "tennis", "basketball", "hockey", "esports", "golf", "cricket", "rugby", "baseball", "darts", "snooker", "boxing"];
  const periods = ["daily", "weekly", "monthly", "quarterly", "yearly"];
  for (const m of markets) {
    for (const p of periods) {
      for (const kind of ["turnover", "payout", "margin", "exposure"]) {
        const fn = `${p}${m[0].toUpperCase()}${m.slice(1)}${kind[0].toUpperCase()}${kind.slice(1)}Report`;
        legacy += `
/**
 * ${p} ${kind} report for ${m}.
 * Groups settled bets by userId and sums ${kind}. Report-only rounding: HALF_UP.
 */
export function ${fn}(bets, { currency = "EUR", includeVoid = false } = {}) {
  const byUser = new Map();
  for (const bet of bets) {
    if (bet.market && bet.market !== "${m}") continue;
    if (!includeVoid && bet.status === "VOID") continue;
    const userId = bet.userId;
    const row = byUser.get(userId) ?? { userId, count: 0, total: 0 };
    row.count += 1;
    row.total += ${kind === "payout" ? "bet.payout ?? 0" : kind === "turnover" ? "bet.stake" : kind === "margin" ? "bet.stake - (bet.payout ?? 0)" : "round((bet.stake * bet.odds) / 1000, RoundingMode.HALF_UP)"};
    byUser.set(userId, row);
  }
  return [...byUser.values()].map((row) => ({
    ...row,
    currency,
    period: "${p}",
    market: "${m}",
    display: fromMinor(round(row.total, RoundingMode.HALF_UP)),
  }));
}
`;
      }
    }
  }
  w(root, "src/reports/legacyReports.js", legacy);

  // --- Big data fixture and log
  const fixture = [];
  for (let i = 0; i < 2500; i++) {
    fixture.push({
      id: `bet_${String(i).padStart(6, "0")}`, userId: `user_${i % 97}`, market: markets[i % markets.length],
      selection: `sel_${i % 13}`, odds: 1100 + ((i * 37) % 4000), stake: 100 + ((i * 53) % 9900),
      status: ["WON", "LOST", "VOID"][i % 3], payout: i % 3 === 0 ? 1000 + i : 0,
    });
  }
  w(root, "data/fixtures.json", JSON.stringify(fixture, null, 2));
  let log = "";
  for (let i = 0; i < 15000; i++) {
    log += `2026-09-${String((i % 28) + 1).padStart(2, "0")}T10:${String(i % 60).padStart(2, "0")}:00Z INFO  [settlement] settled bet_${String(i).padStart(6, "0")} user_${i % 97} outcome=${["WON", "LOST", "VOID"][i % 3]} payout=${i % 3 === 0 ? 1000 + i : 0}\n`;
  }
  w(root, "logs/app.log", log);

  // --- Tests
  w(root, "test/helpers.js", `
import { clear as clearAccounts } from "../src/accounts/accountRepository.js";
import { reset as resetWallet } from "../src/wallet/walletService.js";
import { clear as clearBets } from "../src/bets/betRepository.js";
import { resetIds } from "../src/util/ids.js";
import { setNow } from "../src/util/clock.js";

export function resetAll() {
  clearAccounts();
  resetWallet();
  clearBets();
  resetIds();
  setNow(1_700_000_000_000);
}
`);

  w(root, "test/money.test.js", `
import { test } from "node:test";
import assert from "node:assert/strict";
import { round, RoundingMode, toMinor, fromMinor, assertAmount } from "../src/money.js";

test("toMinor / fromMinor round-trip", () => {
  assert.equal(toMinor("12.34"), 1234);
  assert.equal(fromMinor(1234), "12.34");
});
test("HALF_EVEN rounds ties to even", () => {
  assert.equal(round(2.5, RoundingMode.HALF_EVEN), 2);
  assert.equal(round(3.5, RoundingMode.HALF_EVEN), 4);
});
test("HALF_UP rounds ties up", () => {
  assert.equal(round(2.5, RoundingMode.HALF_UP), 3);
});
test("assertAmount rejects non-positive", () => {
  assert.throws(() => assertAmount(0), RangeError);
  assert.throws(() => assertAmount(-5), RangeError);
  assert.throws(() => assertAmount(1.5), RangeError);
});
`);

  w(root, "test/wallet.test.js", `
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetAll } from "./helpers.js";
import { openAccount, closeAccount } from "../src/accounts/accountService.js";
import { balance, credit, debit, history } from "../src/wallet/walletService.js";
import { InsufficientFundsError, StateError } from "../src/errors.js";

beforeEach(() => {
  resetAll();
  openAccount("alice");
});

test("credit increases balance", () => {
  credit("alice", 500);
  assert.equal(balance("alice"), 500);
});
test("debit decreases balance", () => {
  credit("alice", 500);
  debit("alice", 200);
  assert.equal(balance("alice"), 300);
});
test("debit beyond balance is rejected", () => {
  credit("alice", 100);
  assert.throws(() => debit("alice", 101), InsufficientFundsError);
  assert.equal(balance("alice"), 100);
});
test("history records entries in order", () => {
  credit("alice", 500);
  debit("alice", 200);
  assert.deepEqual(history("alice").map((e) => e.type), ["CREDIT", "DEBIT"]);
});
test("closed accounts cannot transact", () => {
  closeAccount("alice");
  assert.throws(() => credit("alice", 10), StateError);
});
`);

  w(root, "test/bets.test.js", `
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetAll } from "./helpers.js";
import { openAccount } from "../src/accounts/accountService.js";
import { balance, credit } from "../src/wallet/walletService.js";
import { placeBet, cancelBet } from "../src/bets/betService.js";
import { settle, computePayout } from "../src/settlement/settlementService.js";
import { parseOdds } from "../src/bets/odds.js";

beforeEach(() => {
  resetAll();
  openAccount("bob");
  credit("bob", 10_000);
});

test("placing a bet debits the stake", () => {
  placeBet("bob", { selection: "home", odds: parseOdds("2.5"), stake: 1000 });
  assert.equal(balance("bob"), 9000);
});
test("cancelling refunds the stake", () => {
  const bet = placeBet("bob", { selection: "home", odds: 2500, stake: 1000 });
  cancelBet(bet.id);
  assert.equal(balance("bob"), 10_000);
});
test("winning bet pays stake * odds", () => {
  const bet = placeBet("bob", { selection: "home", odds: 2500, stake: 1000 });
  settle(bet.id, "WON");
  assert.equal(balance("bob"), 9000 + 2500);
});
test("void bet returns stake", () => {
  const bet = placeBet("bob", { selection: "home", odds: 2500, stake: 1000 });
  settle(bet.id, "VOID");
  assert.equal(balance("bob"), 10_000);
});
test("payout uses banker's rounding", () => {
  assert.equal(computePayout(5, 1500), 8); // 7.5 -> 8 (even)
  assert.equal(computePayout(3, 1500), 4); // 4.5 -> 4 (even)
});
`);

  // Many generated cases -> long, verbose test output.
  let oddsTests = `
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOdds, formatOdds, impliedProbability } from "../src/bets/odds.js";
import { computePayout } from "../src/settlement/settlementService.js";
`;
  for (let i = 0; i < 220; i++) {
    const odds = 1010 + i * 37;
    const stake = 100 + i * 13;
    oddsTests += `
test("odds case ${i}: ${(odds / 1000).toFixed(3)} @ stake ${stake}", () => {
  assert.equal(parseOdds("${(odds / 1000).toFixed(3)}"), ${odds});
  assert.equal(formatOdds(${odds}), "${(odds / 1000).toFixed(3)}");
  assert.ok(impliedProbability(${odds}) > 0);
  assert.ok(computePayout(${stake}, ${odds}) >= ${stake});
});
`;
  }
  w(root, "test/odds.test.js", oddsTests);

  w(root, "test/api.test.js", `
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetAll } from "./helpers.js";
import { dispatch } from "../src/api/router.js";

beforeEach(() => resetAll());

test("open account, credit, read balance", () => {
  assert.equal(dispatch({ method: "POST", path: "/accounts", body: { userId: "carol" } }).status, 201);
  assert.equal(dispatch({ method: "POST", path: "/wallet/carol/credit", body: { amount: 700 } }).status, 201);
  assert.deepEqual(dispatch({ method: "GET", path: "/wallet/carol/balance" }).body, { userId: "carol", balance: 700 });
});
test("unknown account is 404", () => {
  assert.equal(dispatch({ method: "GET", path: "/accounts/nobody" }).status, 404);
});
test("overdraft via API is 409", () => {
  dispatch({ method: "POST", path: "/accounts", body: { userId: "dave" } });
  assert.equal(dispatch({ method: "POST", path: "/wallet/dave/debit", body: { amount: 1 } }).status, 409);
});
test("unknown route is 404", () => {
  assert.equal(dispatch({ method: "GET", path: "/nope" }).status, 404);
});
`);

  w(root, ".gitignore", "node_modules/\n");
}
