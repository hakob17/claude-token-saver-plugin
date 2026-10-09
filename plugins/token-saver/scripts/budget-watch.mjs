// UserPromptSubmit: warn (once per level per budget period) when this period's
// spend crosses 50%, 80%, 95% and 100% of the monthly budget.
// Spend is recorded by the token-saver status line; without it there's no data.
import { readStdin, addContext } from "./lib.mjs";
import { readConfig, periodKey, periodTotal, readWarned, writeWarned } from "./budget-lib.mjs";

readStdin();
const { limit, resetDay } = readConfig();
if (!limit) process.exit(0);

const period = periodKey(resetDay);
const spent = periodTotal(period);
const pct = (spent / limit) * 100;
const level = [100, 95, 80, 50].find((l) => pct >= l);
if (!level) process.exit(0);

const warned = readWarned();
if (warned.period === period && warned.level >= level) process.exit(0);
writeWarned({ period, level });

const money = `$${spent.toFixed(2)} of $${limit} (${Math.round(pct)}%)`;
const tips = {
  50: "",
  80: " Suggest switching to Sonnet (/model sonnet) for routine work and starting fresh sessions per task.",
  95: " Suggest switching to Sonnet or Haiku for anything routine, and keeping requests small and precise.",
  100: " The budget is used up; anything further may exceed the company limit.",
};
addContext(
  "UserPromptSubmit",
  `[token-saver budget] This month's Claude spend is ${money}. Begin your reply with ONE short line telling the user this.${tips[level]} Then answer normally.`
);
