const assert = require("assert");
const { evaluateBudgetStatuses, buildAlertKey } = require("../src/Alerts");
const { isValidWebAppKey } = require("../src/Config");

const budgets = [
  { category: "Entertainment", budget: 3500, warnPct: 0.8, emailAlert: true },
  { category: "Food", budget: 1000, warnPct: 0.8, emailAlert: true },
  { category: "Personal", budget: 4500, warnPct: 0.8, emailAlert: true },
  { category: "Family", budget: 2500, warnPct: 0.8, emailAlert: true }
];

const spent = {
  Entertainment: 2900, // 82.8% -> Near Limit
  Food: 1150,          // 115% -> Over Budget
  Personal: 2700,      // 60% at 30% month progress -> Fast Pace (0.60 > 0.30 + 0.15)
  Family: 800          // 32% -> On Track
};

const statuses = evaluateBudgetStatuses(budgets, spent, 0.30, 0.15);
const byCat = Object.fromEntries(statuses.map(s => [s.category, s]));

assert.strictEqual(byCat.Entertainment.severity, "warn");
assert.strictEqual(byCat.Entertainment.shouldWarn80, true);
assert.strictEqual(byCat.Entertainment.shouldWarn100, false);
assert.strictEqual(byCat.Entertainment.remaining, 600);

assert.strictEqual(byCat.Food.severity, "over");
assert.strictEqual(byCat.Food.shouldWarn100, true);
assert.strictEqual(byCat.Food.shouldWarn80, false);
assert.strictEqual(byCat.Food.remaining, -150);

assert.strictEqual(byCat.Personal.severity, "pace");
assert.strictEqual(byCat.Family.severity, "ok");

// Idempotency key stability
assert.strictEqual(buildAlertKey("2026-11", "Entertainment", "80"), "PF_ALERT_2026-11_ENTERTAINMENT_80");
assert.strictEqual(buildAlertKey("2026-11", "Food", "100"), "PF_ALERT_2026-11_FOOD_100");

// WebApp access key guard
assert.strictEqual(isValidWebAppKey("pf_mido_9f83c7a2d4e1b6085c3a91e7", "pf_mido_9f83c7a2d4e1b6085c3a91e7"), true);
assert.strictEqual(isValidWebAppKey("  pf_mido_9f83c7a2d4e1b6085c3a91e7 ", "pf_mido_9f83c7a2d4e1b6085c3a91e7"), true);
assert.strictEqual(isValidWebAppKey("", "pf_mido_9f83c7a2d4e1b6085c3a91e7"), false);
assert.strictEqual(isValidWebAppKey("wrong_key", "pf_mido_9f83c7a2d4e1b6085c3a91e7"), false);

console.log("16 assertions passed (budgets, alerts & WebApp key auth).");
