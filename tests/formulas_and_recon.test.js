const assert = require("assert");
const {
  evalSimpleMathExpr,
  parseDateStrict,
  formatDateIso,
  toMonthKey,
  computeWalletBalances
} = require("../src/Config");

// 1. Math expression parser
assert.strictEqual(evalSimpleMathExpr("=276+110+38+15+5+20+10-1.71"), 472.29);
assert.strictEqual(evalSimpleMathExpr("-(800+230)"), -1030);
assert.strictEqual(evalSimpleMathExpr("EGP 1,301.60"), 1301.6);
assert.strictEqual(evalSimpleMathExpr("£245.17"), 245.17);
assert.ok(Number.isNaN(evalSimpleMathExpr("process.exit(1)")));

// 2. Date parsing & monthKey
assert.strictEqual(formatDateIso(parseDateStrict("Saturday, November 7, 2026")), "2026-11-07");
assert.strictEqual(formatDateIso(parseDateStrict(46336)), "2026-11-10");
assert.strictEqual(toMonthKey("2026-10-31"), "2026-10");

// 3. Double-entry wallet reconciliation math
const recon = computeWalletBalances({
  bankAnchor: 10000,
  cashAnchor: 500,
  transactions: [
    { type: "Income", wallet: "Bank / InstaPay", amount: 20500 },
    { type: "Expense", wallet: "Bank / InstaPay", amount: 3000 },
    { type: "Expense", wallet: "Cash", amount: 150 },
    { type: "Expense", wallet: "NBE Credit Card", amount: 900 }, // Does NOT hit Bank or Cash immediately
    { type: "Reimbursement", wallet: "Bank / InstaPay", amount: 500 },
    { type: "Cash Withdrawal", wallet: "Bank / InstaPay", amount: 1000 },
    { type: "CC Bill Payment", wallet: "Bank / InstaPay", amount: 4000 }
  ],
  loans: [
    { direction: "Lent / Paid for Them", wallet: "Bank / InstaPay", amount: 1500 },
    { direction: "Repaid to Me", wallet: "Bank / InstaPay", amount: 700 },
    { direction: "Lent / Paid for Them", wallet: "Opening Balance", amount: 20000 } // Historical opening should not alter bank
  ],
  investments: [
    { action: "Deposit", wallet: "Bank / InstaPay", amount: 2000 },
    { action: "Withdrawal", wallet: "Bank / InstaPay", amount: 500 },
    { action: "Deposit", wallet: "Opening Principal", amount: 23000 } // Historical opening should not alter bank
  ]
});

// Bank: 10000 + 20500 - 3000 + 500 - 1000 - 4000 - 1500 + 700 - 2000 + 500 = 20700
// Cash: 500 - 150 + 1000 = 1350
assert.strictEqual(recon.expectedBank, 20700);
assert.strictEqual(recon.expectedCash, 1350);

console.log("9 assertions passed (formulas & wallet reconciliation).");
