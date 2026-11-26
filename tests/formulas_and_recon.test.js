const fs = require("fs");
const path = require("path");
const assert = require("assert");
const {
  PF_CONFIG,
  evalSimpleMathExpr,
  parseDateStrict,
  formatDateIso,
  toMonthKey,
  computeWalletBalances,
  normalizeTransactionPayload,
  computeRemainingCardDue,
  computeCalibratedAnchor
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

// 4. Transaction payload normalization (transfers & income ignore budget category)
const cw = normalizeTransactionPayload({ type: "Cash Withdrawal", category: "Food", wallet: "Cash", details: "" });
assert.deepStrictEqual(cw, {
  type: "Cash Withdrawal",
  category: "Transfer",
  wallet: "Bank / InstaPay",
  details: "ATM Cash Withdrawal",
  affectsBudget: false
});

const cwCustom = normalizeTransactionPayload({ type: "Cash Withdrawal", category: "Entertainment", details: "NBE ATM Gleem" });
assert.strictEqual(cwCustom.category, "Transfer");
assert.strictEqual(cwCustom.wallet, "Bank / InstaPay");
assert.strictEqual(cwCustom.details, "NBE ATM Gleem");
assert.strictEqual(cwCustom.affectsBudget, false);

const bd = normalizeTransactionPayload({ type: "Bank Deposit", category: "Personal", wallet: "Bank / InstaPay" });
assert.deepStrictEqual(bd, {
  type: "Bank Deposit",
  category: "Transfer",
  wallet: "Cash",
  details: "Bank Cash Deposit",
  affectsBudget: false
});

const ccPay = normalizeTransactionPayload({ type: "CC Bill Payment", category: "Personal", wallet: "NBE Credit Card" });
assert.strictEqual(ccPay.category, "Transfer");
assert.strictEqual(ccPay.wallet, "Bank / InstaPay");
assert.strictEqual(ccPay.affectsBudget, false);

const ccPayCash = normalizeTransactionPayload({ type: "CC Bill Payment", category: "Food", wallet: "Cash", details: "Paid branch" });
assert.strictEqual(ccPayCash.wallet, "Cash");
assert.strictEqual(ccPayCash.details, "Paid branch");

const inc = normalizeTransactionPayload({ type: "Income", category: "Food", wallet: "NBE Credit Card", details: "Bonus" });
assert.deepStrictEqual(inc, {
  type: "Income",
  category: "Salary / Income",
  wallet: "Bank / InstaPay",
  details: "Bonus",
  affectsBudget: false
});

const exp = normalizeTransactionPayload({ type: "Expense", category: "Food", wallet: "NBE Credit Card", details: "Coffee" });
assert.deepStrictEqual(exp, {
  type: "Expense",
  category: "Food",
  wallet: "NBE Credit Card",
  details: "Coffee",
  affectsBudget: true
});

const reimb = normalizeTransactionPayload({ type: "Reimbursement", category: "Entertainment", wallet: "Bank / InstaPay", details: "Abdo" });
assert.strictEqual(reimb.affectsBudget, true);
assert.strictEqual(reimb.category, "Entertainment");

// 5. GitHub Pages PWA build artifacts safety & integrity
const docsDir = path.resolve(__dirname, "..", "docs");
const docsHtmlPath = path.join(docsDir, "index.html");
const docsHtml = fs.readFileSync(docsHtmlPath, "utf8");
assert.ok(docsHtml.indexOf(PF_CONFIG.WEBAPP_EXEC_URL) !== -1, "docs/index.html must include WEBAPP_EXEC_URL");
assert.ok(docsHtml.indexOf("./manifest.json") !== -1, "docs/index.html must link manifest.json");
assert.strictEqual(docsHtml.indexOf("<?"), -1, "docs/index.html must have no unrendered Apps Script template tags");
assert.strictEqual(PF_CONFIG.DEFAULT_WEBAPP_KEY, "", "DEFAULT_WEBAPP_KEY must stay empty in source");
assert.strictEqual(docsHtml.indexOf("pf_mido_"), -1, "docs/index.html must never embed any access key");
assert.ok(fs.existsSync(path.join(docsDir, ".nojekyll")), "docs/.nojekyll must exist");
const manifestJson = JSON.parse(fs.readFileSync(path.join(docsDir, "manifest.json"), "utf8"));
assert.strictEqual(manifestJson.display, "standalone");
const iconBuf = fs.readFileSync(path.join(docsDir, "apple-touch-icon.png"));
assert.deepStrictEqual(Array.from(iconBuf.slice(0, 4)), [0x89, 0x50, 0x4e, 0x47]);
assert.ok(docsHtml.indexOf("ccQuickAmounts") !== -1, "docs/index.html must include CC quick fill controls");
assert.ok(docsHtml.indexOf("submitReconcile") !== -1, "docs/index.html must include wallet reconciliation control");

// 6. Live Card Due & Bank/Cash Opening Anchor Calibration
assert.strictEqual(computeRemainingCardDue(8729.16, 0, "⏳ Pending Payment"), 8729.16);
assert.strictEqual(computeRemainingCardDue(8729.16, 5000, "⏳ Pending Payment"), 3729.16);
assert.strictEqual(computeRemainingCardDue(8729.16, 8729.16, "⏳ Pending Payment"), 0);
assert.strictEqual(computeRemainingCardDue(8729.16, 32618.95, "⏳ Pending Payment"), 0);
assert.strictEqual(computeRemainingCardDue(8729.16, 0, "✅ Paid"), 0);
assert.strictEqual(computeCalibratedAnchor(-35019.42, 20280.16, 627.78), -54671.8);

console.log("40 assertions passed (formulas, wallet reconciliation, payload normalization, card due & Pages PWA build).");
