/**
 * Live Integration with NBE Credit Card V2:
 * - Reads Active Bill & Reconciliation, Monthly History & Forecast, Transactions, and Installments.
 * - Updates _NBE_Cache for instant Dashboard KPI & Credit Card Obligation tracking.
 * - Idempotently syncs Mido's personal purchases & active monthly installment EMIs from NBE Sync Start Month onward.
 */

if (typeof require === "function" && typeof PF_CONFIG === "undefined") {
  Object.assign(global, require("./Config"));
}

function parseNbeMoneyCell_(val) {
  if (typeof val === "number") return isFinite(val) ? val : 0;
  const s = String(val || "").replace(/EGP|£|,/gi, "").trim();
  if (!s || s === "—" || s === "-") return 0;
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

function parseNbeActiveBillGrid(activeGrid, forecastGrid) {
  const summary = {
    statementDate: "",
    paymentDueDate: "",
    activeCycle: "",
    paymentStatus: "",
    bankClosingBill: 0,
    familySharesTotal: 0,
    totalCardUtilized: 0,
    availableLimit: 0,
    midoShareDue: 0,
    midoNextForecast: 0,
    familyPendingShares: 0,
    memberRows: []
  };

  (activeGrid || []).forEach(row => {
    for (let c = 0; c < row.length - 1; c++) {
      const label = String(row[c] || "").trim().replace(/:$/, "");
      const val = row[c + 1];
      if (label === "Statement Date") summary.statementDate = formatDateIso(parseDateStrict(val)) || String(val || "").trim();
      else if (label === "Payment Due Date") summary.paymentDueDate = formatHumanDate(val) || String(val || "").trim();
      else if (label === "Active Billing Cycle") summary.activeCycle = formatMonthYear(val) || String(val || "").trim();
      else if (label === "Payment Status") summary.paymentStatus = String(val || "").trim();
      else if (label === "Bank Closing Bill") summary.bankClosingBill = parseNbeMoneyCell_(val);
      else if (label === "Family Shares Total") summary.familySharesTotal = parseNbeMoneyCell_(val);
      else if (label === "Total Card Utilized") summary.totalCardUtilized = parseNbeMoneyCell_(val);
      else if (label === "Available Limit Now") summary.availableLimit = parseNbeMoneyCell_(val);
    }

    const first = String(row[0] || "").trim();
    if (/^\d+$/.test(first) && row[1]) {
      const member = normalizePersonName(row[1]);
      const purchases = parseNbeMoneyCell_(row[2]);
      const installments = parseNbeMoneyCell_(row[3]);
      const fees = parseNbeMoneyCell_(row[4]);
      const unrecorded = parseNbeMoneyCell_(row[5]);
      const credits = parseNbeMoneyCell_(row[6]);
      const netDue = parseNbeMoneyCell_(row[7]);
      summary.memberRows.push({ member, purchases, installments, fees, unrecorded, credits, netDue });
      if (member === "Mido") {
        summary.midoShareDue = netDue;
      } else {
        summary.familyPendingShares = Math.round((summary.familyPendingShares + netDue) * 100) / 100;
      }
    }
  });

  if (forecastGrid && forecastGrid.length >= 5) {
    const header = forecastGrid[3] || [];
    let nextIdx = -1;
    for (let i = 0; i < header.length; i++) {
      if (String(header[i] || "").indexOf("(Forecast)") !== -1) {
        nextIdx = i;
        break;
      }
    }
    if (nextIdx >= 0) {
      for (let r = 4; r < forecastGrid.length; r++) {
        if (normalizePersonName(forecastGrid[r][0]) === "Mido") {
          summary.midoNextForecast = parseNbeMoneyCell_(forecastGrid[r][nextIdx]);
          break;
        }
      }
    }
  }

  return summary;
}

function buildMidoNbeSyncRows(params) {
  const txRows = params.txRows || [];
  const instRows = params.instRows || [];
  const existingSourceIds = params.existingSourceIds || new Set();
  const syncStartMonth = toMonthKey(params.syncStartMonth, PF_CONFIG.TIMEZONE) || String(params.syncStartMonth || "2026-11").trim();
  const rules = params.rules || PF_CONFIG.DEFAULT_CATEGORY_RULES;
  const activeCycleMonthKey = params.activeCycleMonthKey || syncStartMonth;

  const newRows = [];

  for (let i = 1; i < txRows.length; i++) {
    const r = txRows[i];
    const payer = normalizePersonName(r[3]);
    if (payer !== "Mido") continue;

    const dObj = parseDateStrict(r[1], PF_CONFIG.TIMEZONE);
    if (!dObj) continue;
    const isoDate = formatDateIso(dObj);
    const monthKey = isoDate.slice(0, 7);
    if (monthKey < syncStartMonth) continue;

    const desc = String(r[2] || "").trim();
    const amount = parseNbeMoneyCell_(r[4]);
    if (amount === 0) continue;

    const rowId = String(r[6] || "").trim() || `${isoDate}_${amount.toFixed(2)}_${desc.slice(0, 18)}`;
    const sourceId = `NBE-TX-${rowId}`;
    if (existingSourceIds.has(sourceId)) continue;

    const isRefund = amount < 0 || /refund|cashback|reversal/i.test(desc);
    const type = isRefund ? "Reimbursement" : "Expense";
    const category = categorizeDescription(desc, rules);

    newRows.push({
      date: isoDate,
      monthKey,
      type,
      category,
      amount: Math.abs(amount),
      wallet: "NBE Credit Card",
      details: desc || "NBE Card Purchase",
      notes: "Synced from NBE Credit Card V2",
      sourceId
    });
  }

  // Only sync active installments for months AFTER 2026-11 if current cycle > 2026-11,
  // or if activeCycleMonthKey >= syncStartMonth and user wants active EMI tracking:
  // Note: 2026-11 cycle EMI (1,484.61) belongs to the Oct 31 closing bill due Nov 27,
  // while transactions >= 2026-11-01 represent new Nov spending on the Dec 2026 cycle.
  if (activeCycleMonthKey > syncStartMonth) {
    for (let i = 1; i < instRows.length; i++) {
      const r = instRows[i];
      const payer = normalizePersonName(r[8]);
      const status = String(r[10] || "").trim();
      if (payer !== "Mido" || status.toLowerCase() !== "ongoing") continue;

      const emi = parseNbeMoneyCell_(r[7]);
      if (emi <= 0) continue;
      const instId = String(r[11] || `ROW${i}`).trim();
      const sourceId = `NBE-EMI-${activeCycleMonthKey}-${instId}`;
      if (existingSourceIds.has(sourceId)) continue;

      const desc = String(r[2] || "Installment").trim();
      newRows.push({
        date: `${activeCycleMonthKey}-01`,
        monthKey: activeCycleMonthKey,
        type: "Expense",
        category: categorizeDescription(desc, rules),
        amount: emi,
        wallet: "NBE Credit Card",
        details: `${desc} (EMI ${String(r[9] || "").trim()})`,
        notes: "Active NBE Installment EMI",
        sourceId
      });
    }
  }

  return newRows;
}

function syncFromNbeCreditCard(optSs) {
  const ss = optSs || getMasterSpreadsheet_();
  const cfg = readBudgetsConfigFromSheet_(ss);
  const nbeId = cfg.nbeCreditId || PF_CONFIG.NBE_CREDIT_ID;
  const nbeSs = SpreadsheetApp.openById(nbeId);

  const activeSheet = nbeSs.getSheetByName("Active Bill & Reconciliation");
  const forecastSheet = nbeSs.getSheetByName("Monthly History & Forecast");
  const nbeTxSheet = nbeSs.getSheetByName("Transactions");
  const nbeInstSheet = nbeSs.getSheetByName("Installments");

  const activeGrid = activeSheet ? activeSheet.getRange(1, 1, Math.min(35, activeSheet.getLastRow()), 9).getValues() : [];
  const forecastGrid = forecastSheet ? forecastSheet.getRange(1, 1, Math.min(20, forecastSheet.getLastRow()), 13).getValues() : [];
  const nbeSummary = parseNbeActiveBillGrid(activeGrid, forecastGrid);

  // Write snapshot into _NBE_Cache
  const cacheSheet = ss.getSheetByName(PF_CONFIG.SHEETS.NBE_CACHE);
  if (cacheSheet) {
    const nowStr = Utilities.formatDate(new Date(), PF_CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm");
    const kvRows = [
      ["Metric", "Value"],
      ["Active Billing Cycle", nbeSummary.activeCycle || "—"],
      ["Statement Date", nbeSummary.statementDate || "—"],
      ["Payment Due Date", nbeSummary.paymentDueDate || "—"],
      ["Payment Status", nbeSummary.paymentStatus || "—"],
      ["Bank Closing Bill", nbeSummary.bankClosingBill],
      ["Mido Active Share Due", nbeSummary.midoShareDue],
      ["Mido Next Month Forecast", nbeSummary.midoNextForecast],
      ["Family Shares Excl Mido", nbeSummary.familyPendingShares],
      ["Last Synced At", nowStr]
    ];
    cacheSheet.getRange(1, 1, kvRows.length, 2).setValues(kvRows);

    const memberHeader = [["Member", "Purchases", "Installments", "Fees", "Unrecorded", "Credits", "Net Due"]];
    cacheSheet.getRange(12, 1, 1, 7).setValues(memberHeader);
    if (nbeSummary.memberRows.length > 0) {
      const mValues = nbeSummary.memberRows.map(m => [
        m.member, m.purchases, m.installments, m.fees, m.unrecorded, m.credits, m.netDue
      ]);
      cacheSheet.getRange(13, 1, mValues.length, 7).setValues(mValues);
    }
  }

  // Idempotent sync of Mido's NBE Credit Card transactions >= syncStartMonth
  const txSheet = ss.getSheetByName(PF_CONFIG.SHEETS.TRANSACTIONS);
  const existingSourceIds = new Set();
  if (txSheet && txSheet.getLastRow() >= 2) {
    const ids = txSheet.getRange(2, 10, txSheet.getLastRow() - 1, 1).getValues();
    ids.forEach(r => {
      const id = String(r[0] || "").trim();
      if (id) existingSourceIds.add(id);
    });
  }

  const nbeTxRows = nbeTxSheet && nbeTxSheet.getLastRow() >= 2
    ? nbeTxSheet.getRange(1, 1, nbeTxSheet.getLastRow(), 7).getValues()
    : [];
  const nbeInstRows = nbeInstSheet && nbeInstSheet.getLastRow() >= 2
    ? nbeInstSheet.getRange(1, 1, nbeInstSheet.getLastRow(), 12).getValues()
    : [];

  const toAppend = buildMidoNbeSyncRows({
    txRows: nbeTxRows,
    instRows: nbeInstRows,
    existingSourceIds,
    syncStartMonth: cfg.syncStartMonth,
    rules: cfg.rules,
    activeCycleMonthKey: Utilities.formatDate(new Date(), PF_CONFIG.TIMEZONE, "yyyy-MM")
  });

  if (toAppend.length > 0 && txSheet) {
    const startRow = getNextEmptyLedgerRow_(txSheet, 2, 2);
    const out = toAppend.map((item, idx) => {
      const r = startRow + idx;
      return [
        `=IF(B${r}="","",ROW()-1)`,
        item.date,
        `=IF(B${r}="","",TEXT(B${r},"yyyy-mm"))`,
        item.type,
        item.category,
        item.amount,
        item.wallet,
        item.details,
        item.notes,
        item.sourceId
      ];
    });
    txSheet.getRange(startRow, 1, out.length, 10).setValues(out);
    txSheet.getRange(startRow, 2, out.length, 1).setNumberFormat("yyyy-mm-dd");
    txSheet.getRange(startRow, 6, out.length, 1).setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  }

  return { nbeSummary, addedCount: toAppend.length };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseNbeActiveBillGrid,
    buildMidoNbeSyncRows
  };
}
