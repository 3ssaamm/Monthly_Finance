const assert = require("assert");
const { categorizeDescription } = require("../src/Config");
const { parseNbeActiveBillGrid, buildMidoNbeSyncRows } = require("../src/SyncNBE");
const { normalizeLegacyExpenseRow, normalizeLegacyAbdoRow } = require("../src/Migration");

// 1. Auto-categorization
assert.strictEqual(categorizeDescription("BUFFALO BURGER ALEX"), "Food");
assert.strictEqual(categorizeDescription("FAWRY*CAVALLI CAFE"), "Entertainment");
assert.strictEqual(categorizeDescription("AMAZON EG PRIME"), "Entertainment");
assert.strictEqual(categorizeDescription("GYM MEMBERSHIP"), "Personal");
assert.strictEqual(categorizeDescription("WE-FBB-Pre Giza"), "Family");
assert.strictEqual(categorizeDescription("UBER DOWNTOWN"), "Transportation");

// 2. Legacy expense row normalization (negative -> Reimbursement, Credit tag -> NBE Credit Card)
const reimb = normalizeLegacyExpenseRow(["18", "Entertainment", "=-(800+230)", "2026-11-15", "Gehad & Basmala"], "2026-11", 18);
assert.strictEqual(reimb.type, "Reimbursement");
assert.strictEqual(reimb.amount, 1030);
assert.strictEqual(reimb.sourceId, "MIG-2026-11-018");

const ccExp = normalizeLegacyExpenseRow(["29", "Entertainment", "2929", "2026-10-27", "Out Credit"], "2026-10", 29);
assert.strictEqual(ccExp.type, "Expense");
assert.strictEqual(ccExp.wallet, "NBE Credit Card");

// 3. Abdo ledger normalization & skipping unlabeled CC scratchpad rows
assert.strictEqual(normalizeLegacyAbdoRow(["1", 20168.64, "Credit", "", ""], 1).direction, "Lent / Paid for Them");
assert.strictEqual(normalizeLegacyAbdoRow(["2", 2500, "Debit", "2026-09-28", "Rest"], 2).direction, "Repaid to Me");
assert.strictEqual(normalizeLegacyAbdoRow(["14", 7000, "", "", "Paid for Credit Card"], 14), null);

// 4. NBE Active Bill parsing & 2026-11 sync cutover guard
const activeGrid = [
  ["Statement Date:", "2026-10-31", "Bank Closing Bill:", "32,618.95"],
  ["Payment Due Date:", "November 27, 2026", "Family Shares Total:", "32,619.44"],
  ["Active Billing Cycle:", "November 2026", "", "", "", "", "Payment Status:", "Pending Payment"],
  ["1", "Abdo", "—", "1,110.86", "—", "—", "—", "1,110.86"],
  ["6", "Mido", "6,945.89", "1,484.61", "—", "307.93", "9.27", "8,729.16"]
];
const forecastGrid = [
  [], [], [],
  ["Family Member", "November 2026\n(Active)", "December 2026\n(Forecast)"],
  ["Mido", "8,729.16", "8,339.77"]
];
const parsed = parseNbeActiveBillGrid(activeGrid, forecastGrid);
assert.strictEqual(parsed.midoShareDue, 8729.16);
assert.strictEqual(parsed.midoNextForecast, 8339.77);
assert.strictEqual(parsed.familyPendingShares, 1110.86);

const synced = buildMidoNbeSyncRows({
  txRows: [
    ["#", "Date", "Desc", "Payer", "Amount", "", "_Row_ID"],
    ["1", "2026-10-15", "Old Oct Coffee", "Mido", 50, "", "T-00100"], // Before 2026-11 -> skipped!
    ["2", "2026-11-12", "Buffalo Burger", "Mido", 450, "", "T-00350"],
    ["3", "2026-11-13", "Already Synced", "Mido", 100, "", "T-00351"],
    ["4", "2026-11-14", "Mai Uber", "Mai", 90, "", "T-00352"]
  ],
  instRows: [],
  existingSourceIds: new Set(["NBE-TX-T-00351"]),
  syncStartMonth: "2026-11",
  activeCycleMonthKey: "2026-11"
});
assert.strictEqual(synced.length, 1);
assert.strictEqual(synced[0].sourceId, "NBE-TX-T-00350");
assert.strictEqual(synced[0].category, "Food");
assert.strictEqual(synced[0].wallet, "NBE Credit Card");

console.log("17 assertions passed (NBE sync & migration).");
