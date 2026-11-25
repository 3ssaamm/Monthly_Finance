/**
 * Legacy Data Migration Helpers (Financials 2024-2026 + Monthly Sheets Apr-Nov 2026).
 * Pure normalization helpers are exported for Node tests and tools/bootstrap_sheet.js.
 */

if (typeof require === "function" && typeof PF_CONFIG === "undefined") {
  Object.assign(global, require("./Config"));
}

function normalizeLegacyExpenseRow(rawRow, monthKey, rowIndex) {
  if (!rawRow) return null;
  const rawCat = String(rawRow[1] || "").trim();
  const rawAmt = evalSimpleMathExpr(rawRow[2]);
  if (!rawCat || !isFinite(rawAmt) || rawAmt === 0) return null;

  const parsedDate = parseDateStrict(rawRow[3], PF_CONFIG.TIMEZONE);
  const isoDate = parsedDate ? formatDateIso(parsedDate) : `${monthKey}-15`;
  const details = String(rawRow[4] || "").trim() || "Legacy Entry";

  const isReimbursement = rawAmt < 0;
  const type = isReimbursement ? "Reimbursement" : "Expense";
  const amount = Math.round(Math.abs(rawAmt) * 100) / 100;

  let wallet = "Bank / InstaPay";
  if (/credit/i.test(details) && !/phone credit/i.test(details)) {
    wallet = "NBE Credit Card";
  }

  const category = PF_CONFIG.CATEGORIES.indexOf(rawCat) !== -1
    ? rawCat
    : categorizeDescription(`${rawCat} ${details}`);

  return {
    date: isoDate,
    monthKey,
    type,
    category,
    amount,
    wallet,
    details,
    notes: isReimbursement ? "Migrated reimbursement / offset" : "Migrated from monthly sheet",
    sourceId: `MIG-${monthKey}-${String(rowIndex).padStart(3, "0")}`
  };
}

function normalizeLegacyAbdoRow(rawRow, rowIndex) {
  if (!rawRow) return null;
  const rawAmt = evalSimpleMathExpr(rawRow[1]);
  if (!isFinite(rawAmt) || rawAmt === 0) return null;

  const dc = String(rawRow[2] || "").trim().toLowerCase();
  const parsedDate = parseDateStrict(rawRow[3], PF_CONFIG.TIMEZONE);
  const isoDate = parsedDate ? formatDateIso(parsedDate) : "2026-10-01";
  const notes = String(rawRow[4] || "").trim();

  // In Abdo's legacy tab: "Credit" meant money Abdo owes Mido; "Debit" meant repayments/offsets;
  // Row 15 "7000 Paid for Credit Card" was unlabeled (skip as reference note, or track remaining 1520).
  if (!dc) {
    return null;
  }

  const direction = dc === "credit" ? "Lent / Paid for Them" : "Repaid to Me";
  const wallet = rowIndex === 1
    ? "Opening Balance"
    : (/cash/i.test(notes) ? "Cash" : (dc === "debit" ? "Bank / InstaPay" : "Opening Balance"));

  return {
    date: isoDate,
    person: "Abdo",
    direction,
    amount: Math.round(Math.abs(rawAmt) * 100) / 100,
    wallet,
    notes: notes || "Migrated from Abdo ledger",
    loanId: `MIG-LOAN-ABDO-${String(rowIndex).padStart(3, "0")}`
  };
}

function runHistoricalMigration(optSs) {
  const ss = optSs || getMasterSpreadsheet_();
  const txSheet = ss.getSheetByName(PF_CONFIG.SHEETS.TRANSACTIONS);
  const loanSheet = ss.getSheetByName(PF_CONFIG.SHEETS.LOANS);
  const invSheet = ss.getSheetByName(PF_CONFIG.SHEETS.INVESTMENTS);
  const archiveSheet = ss.getSheetByName(PF_CONFIG.SHEETS.ARCHIVE);

  const existingTxIds = new Set();
  if (txSheet && txSheet.getLastRow() >= 2) {
    txSheet.getRange(2, 10, txSheet.getLastRow() - 1, 1).getValues().forEach(r => {
      if (r[0]) existingTxIds.add(String(r[0]).trim());
    });
  }

  const existingLoanIds = new Set();
  if (loanSheet && loanSheet.getLastRow() >= 17) {
    loanSheet.getRange(17, 8, loanSheet.getLastRow() - 16, 1).getValues().forEach(r => {
      if (r[0]) existingLoanIds.add(String(r[0]).trim());
    });
  }

  const newTx = [];
  const monthKeys = Object.keys(PF_CONFIG.LEGACY_2026_SHEETS).sort();
  monthKeys.forEach(mKey => {
    const fileId = PF_CONFIG.LEGACY_2026_SHEETS[mKey];
    const srcSs = SpreadsheetApp.openById(fileId);
    const sumSheet = srcSs.getSheetByName("Summary");
    const expSheet = srcSs.getSheetByName("Expenses");

    if (sumSheet) {
      const incomeVal = evalSimpleMathExpr(sumSheet.getRange("C4").getValue());
      const incId = `MIG-INC-${mKey}`;
      if (isFinite(incomeVal) && incomeVal > 0 && !existingTxIds.has(incId)) {
        newTx.push({
          date: `${mKey}-01`,
          type: "Income",
          category: "Salary / Income",
          amount: incomeVal,
          wallet: "Bank / InstaPay",
          details: `${PF_CONFIG.MONTH_NAMES[parseInt(mKey.slice(5, 7), 10) - 1]} Salary / Income`,
          notes: "Migrated monthly income",
          sourceId: incId
        });
      }
    }

    if (expSheet && expSheet.getLastRow() >= 2) {
      const expRows = expSheet.getRange(2, 1, expSheet.getLastRow() - 1, 5).getValues();
      expRows.forEach((row, idx) => {
        const norm = normalizeLegacyExpenseRow(row, mKey, idx + 1);
        if (norm && !existingTxIds.has(norm.sourceId)) {
          newTx.push(norm);
        }
      });
    }
  });

  if (newTx.length > 0 && txSheet) {
    const startRow = Math.max(2, txSheet.getLastRow() + 1);
    const values = newTx.map((t, idx) => {
      const r = startRow + idx;
      return [
        `=IF(B${r}="","",ROW()-1)`,
        t.date,
        `=IF(B${r}="","",TEXT(B${r},"yyyy-mm"))`,
        t.type,
        t.category,
        t.amount,
        t.wallet,
        t.details,
        t.notes,
        t.sourceId
      ];
    });
    txSheet.getRange(startRow, 1, values.length, 10).setValues(values);
    txSheet.getRange(startRow, 2, values.length, 1).setNumberFormat("yyyy-mm-dd");
    txSheet.getRange(startRow, 6, values.length, 1).setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  }

  // Migrate November Abdo + Dad (300) loans if missing
  const novSs = SpreadsheetApp.openById(PF_CONFIG.LEGACY_2026_SHEETS["2026-11"]);
  const abdoSheet = novSs.getSheetByName("Abdo");
  const newLoans = [];
  if (abdoSheet && abdoSheet.getLastRow() >= 2) {
    const abdoRows = abdoSheet.getRange(2, 1, abdoSheet.getLastRow() - 1, 5).getValues();
    abdoRows.forEach((row, idx) => {
      const norm = normalizeLegacyAbdoRow(row, idx + 1);
      if (norm && !existingLoanIds.has(norm.loanId)) {
        newLoans.push(norm);
      }
    });
  }
  if (!existingLoanIds.has("MIG-LOAN-DAD-001")) {
    newLoans.push({
      date: "2026-11-01",
      person: "Dad",
      direction: "Lent / Paid for Them",
      amount: 300,
      wallet: "Opening Balance",
      notes: "Migrated Dad receivable from November Summary",
      loanId: "MIG-LOAN-DAD-001"
    });
  }

  if (newLoans.length > 0 && loanSheet) {
    const startRow = Math.max(17, loanSheet.getLastRow() + 1);
    const values = newLoans.map((l, idx) => {
      const r = startRow + idx;
      return [
        `=IF(B${r}="","",ROW()-16)`,
        l.date,
        l.person,
        l.direction,
        l.amount,
        l.wallet,
        l.notes,
        l.loanId
      ];
    });
    loanSheet.getRange(startRow, 1, values.length, 8).setValues(values);
    loanSheet.getRange(startRow, 2, values.length, 1).setNumberFormat("yyyy-mm-dd");
    loanSheet.getRange(startRow, 5, values.length, 1).setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  }

  return {
    addedTransactions: newTx.length,
    addedLoans: newLoans.length,
    archiveReady: Boolean(archiveSheet),
    investmentsReady: Boolean(invSheet)
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeLegacyExpenseRow,
    normalizeLegacyAbdoRow
  };
}
