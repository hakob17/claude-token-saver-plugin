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
// Build/test command for the native task; returns { ok, tail } and never throws.
function build(dir, cmd, timeout = 20 * 60_000) {
  try {
    const out = execSync(cmd, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout, env: NATIVE_ENV, maxBuffer: 64 << 20 });
    return { ok: true, tail: out.slice(-300) };
  } catch (e) {
    return { ok: false, tail: String(e.stdout || "").slice(-300) + String(e.stderr || "").slice(-300) };
  }
}
const HOME = process.env.HOME;
// One simulator per parallel worker, so concurrent runs don't fight over a device.
const IOS_SIMS = (process.env.BENCH_IOS_SIMS || "iPhone 16,iPhone 16 Plus").split(",");
const simFor = (job) => IOS_SIMS[(job?.worker || 0) % IOS_SIMS.length];
const NATIVE_ENV = process.env;
const iosTest = (sim) => `xcodebuild test -project ios/HomePlanner.xcodeproj -scheme HomePlanner -destination 'platform=iOS Simulator,name=${sim},OS=27.0' -derivedDataPath build/ios -collect-test-diagnostics never CODE_SIGNING_ALLOWED=NO -quiet`;

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

  // Greenfield, two native apps. Opt-in: long and expensive (run with --tasks homeplanner).
  homeplanner: {
    title: "Native iOS home planner with LLM assistant",
    optIn: true,
    timeoutMin: 0, // no cap: a native build-and-fix loop can run long
    fixture: { empty: true },
    // Three user turns in one session, as a person would build it. Turn boundaries
    // are where the routing proxy may switch models. iOS only.
    turns: [
      (job) =>
        "We're building a native iOS home planner app (SwiftUI) in this empty repo. Users draw their house outline, rooms and " +
        "garden on a 2D canvas: walls/areas as polygons on a snapping grid, drag to move vertices, dimensions in metres and room " +
        "areas shown. Plans are saved and loaded locally as JSON; later an AI assistant will edit plans, so define the plan JSON " +
        "format now and document it in docs/plan-format.md. Put the app in ios/HomePlanner.xcodeproj with scheme HomePlanner and a " +
        "unit test target, with tests for geometry (area, snapping, polygon validity) and plan JSON round-trip. It must pass: " +
        iosTest(simFor(job)) + "\nOther builds share this Mac: use only the " + simFor(job) + " simulator, and never shut down, " +
        "erase or delete other simulators (no 'simctl shutdown all').",
      (job) =>
        "Add a small catalogue of furniture and garden items (e.g. sofa, bed, table, tree, flower bed, vegetable patch): place them " +
        "on the plan, move, rotate and delete them, and save them in the plan JSON (update docs/plan-format.md). Add tests for " +
        "placement and serialisation. It must pass: " + iosTest(simFor(job)),
      (job) =>
        "Add the AI assistant: a panel that sends the current plan JSON plus the user's request (e.g. 'arrange the living room', " +
        "'plan a vegetable garden') to the Anthropic Messages API and applies the suggested plan changes. The API key is entered in a " +
        "settings screen (never hard-code or commit a key). Keep the LLM client behind a protocol with a fake used by tests, and test " +
        "applying suggestions. Then make the app ready to install: it must build, install and launch on the iOS simulator. It must " +
        "pass: " + iosTest(simFor(job)) + ". Add a README with build and install steps.",
    ],
    check(dir, _result, job) {
      const sim = simFor(job);
      const ios = build(dir, iosTest(sim));
      const g = (pat) => Number(sh(dir, `grep -rlE '${pat}' ios 2>/dev/null | wc -l`).trim());
      const features = {
        canvas: g("Canvas|Path\\(|DragGesture") > 0,
        garden: g("[Gg]arden") > 0,
        catalogue: g("[Ss]ofa|[Ff]urniture") > 0,
        llm: g("api\\.anthropic\\.com|/v1/messages") > 0,
        no_key: !sh(dir, "git ls-files -co --exclude-standard | xargs grep -lE 'sk-ant-(api|oat|admin)[0-9]{2}-[A-Za-z0-9_-]{40,}' 2>/dev/null").trim(),
      };
      const testFiles = g("XCTestCase|@Test");
      // Ready to install: the built app installs and launches on the simulator.
      const app = sh(dir, "ls -d build/ios/Build/Products/Debug-iphonesimulator/*.app 2>/dev/null | head -1").trim();
      // The simulator by name on iOS 27.0 (names repeat across runtimes).
      const udid = sh(dir, `xcrun simctl list devices 'iOS 27.0' | grep -F '    ${sim} (' | grep -oE '[0-9A-F-]{36}' | head -1`).trim();
      const bundle = app && sh(dir, `/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${app}/Info.plist"`).trim();
      features.installable = !!bundle && build(dir, `xcrun simctl boot "${udid}" 2>/dev/null; xcrun simctl install "${udid}" "${app}" && xcrun simctl launch "${udid}" ${bundle}`, 120_000).ok;
      const swiftLines = Number(sh(dir, "find ios -name '*.swift' | xargs cat 2>/dev/null | wc -l").trim());
      const ok = ios.ok && testFiles > 0 && Object.values(features).every(Boolean);
      const missing = Object.entries(features).filter(([, v]) => !v).map(([k]) => k);
      return { ok, detail: `build+test:${ios.ok} test files:${testFiles} swift lines:${swiftLines}${missing.length ? " missing:" + missing.join(",") : ""}` };
    },
  },

  // Greenfield web app built from one fixed plan (bench/fixture/webshop-PLAN.md), so every variant
  // builds the same thing. Graded by a black-box acceptance test the builds never see.
  webshop: {
    title: "Coffee shop website + backend + admin from a fixed plan",
    optIn: true,
    timeoutMin: 0,
    fixture: { empty: true, files: { "docs/PLAN.md": "fixture/webshop-PLAN.md" } },
    turns: [
      (job) =>
        "docs/PLAN.md is the full product plan for this repo. Start with the backend: Node.js project, data storage with seed data, " +
        "and the public API (products, guides, orders) exactly as in the API contract, with automated tests. `npm test` must pass.\n" +
        `Another build shares this machine: when you run the server yourself, use PORT=${4100 + (job?.worker || 0) * 10} (and nearby ports for tests), never 3000.`,
      "Next, build the landing page (`/` and `/guides/:slug`) and the shop (`/shop`: catalogue with roast filter, product detail, " +
        "cart, checkout) as described in docs/PLAN.md, using the API. Keep `npm test` passing.",
      "Finally, build the admin panel (`/admin`) and the admin API from docs/PLAN.md. Then go through docs/PLAN.md and make sure " +
        "every part is implemented, `npm install && npm start` works with PORT, DATA_DIR and ADMIN_PASSWORD, and `npm test` passes. " +
        "Add a README with how to run it.",
    ],
    check(dir) {
      let res = {};
      try {
        res = JSON.parse(execSync(`node "${new URL("./webshop-check.mjs", import.meta.url).pathname}" "${dir}"`,
          { encoding: "utf8", timeout: 15 * 60_000, stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").pop());
      } catch (e) { res = { passed: 0, total: 37, failed: ["checker crashed"], testsPass: false }; }
      const ok = res.testsPass && res.total > 0 && res.passed === res.total;
      return { ok, detail: `acceptance ${res.passed}/${res.total}, npm test:${res.testsPass}${res.failed?.length ? " failed: " + res.failed.join("; ") : ""}` };
    },
  },

  // A realistic mixed session on the same plan: the three build turns with simple questions in
  // between, the way people actually work. Built to test routing by task complexity.
  mixed: {
    title: "Coffee shop website, mixed session (builds + questions)",
    optIn: true,
    timeoutMin: 0,
    fixture: { empty: true, files: { "docs/PLAN.md": "fixture/webshop-PLAN.md" } },
    get turns() {
      const [build1, build2, build3] = TASKS.webshop.turns;
      return [
        build1,
        "What does POST /api/orders return when there isn't enough stock, and where in the code is that handled?",
        build2,
        "How is the cart stored in the browser? Just explain, don't change anything.",
        build3,
        "Where is the admin password configured, and what's the default?",
        "List the npm scripts in package.json and what each one does.",
      ];
    },
    check(dir, result, job) { return TASKS.webshop.check(dir, result, job); },
  },
};
