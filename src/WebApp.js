/**
 * Web App & Sidebar API for Quick Mobile Entry + Live Budget Status Feedback.
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile("WebApp")
    .setTitle("Personal Financials — Quick Entry")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, maximum-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function showQuickEntrySidebar() {
  const html = HtmlService.createHtmlOutputFromFile("WebApp")
    .setTitle("💰 Quick Entry & Budgets")
    .setWidth(380);
  SpreadsheetApp.getUi().showSidebar(html);
}

function apiGetDashboardState() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss.getSheetByName(PF_CONFIG.SHEETS.DASHBOARD);
  const cfg = readBudgetsConfigFromSheet_(ss);

  const currentMonthKey = Utilities.formatDate(new Date(), PF_CONFIG.TIMEZONE, "yyyy-MM");
  const activeMonthKey = (dash ? String(dash.getRange("G3").getDisplayValue() || "").trim() : "") || currentMonthKey;

  const spentByCat = getSpentByCategoryForMonth_(ss, activeMonthKey);
  const progress = getCurrentCairoMonthProgress_(activeMonthKey);
  const statuses = evaluateBudgetStatuses(cfg.budgets, spentByCat, progress, cfg.fastPaceMargin);

  let expectedBank = 0;
  let expectedCash = 0;
  let midoCardDue = 0;
  let totalIncome = 0;
  let totalSpend = 0;
  if (dash) {
    totalIncome = Number(dash.getRange("A6").getValue() || 0);
    totalSpend = Number(dash.getRange("C6").getValue() || 0);
    expectedBank = Number(dash.getRange("K10").getValue() || 0);
    expectedCash = Number(dash.getRange("K11").getValue() || 0);
    midoCardDue = Number(dash.getRange("J20").getValue() || 0);
  }

  const loanSheet = ss.getSheetByName(PF_CONFIG.SHEETS.LOANS);
  const people = [];
  if (loanSheet) {
    const sumVals = loanSheet.getRange("A5:D12").getValues();
    sumVals.forEach(r => {
      const name = String(r[0] || "").trim();
      if (name) {
        people.push({ name, balance: Number(r[3] || 0) });
      }
    });
  }

  return {
    monthKey: activeMonthKey,
    today: Utilities.formatDate(new Date(), PF_CONFIG.TIMEZONE, "yyyy-MM-dd"),
    totalIncome,
    totalSpend,
    expectedBank,
    expectedCash,
    midoCardDue,
    categories: PF_CONFIG.CATEGORIES,
    txTypes: PF_CONFIG.TX_TYPES,
    wallets: PF_CONFIG.WALLETS,
    budgets: statuses,
    people
  };
}

function apiLogTransaction(payload) {
  if (!payload) throw new Error("Missing transaction payload.");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const txSheet = ss.getSheetByName(PF_CONFIG.SHEETS.TRANSACTIONS);
  if (!txSheet) throw new Error("Transactions sheet not found.");

  const amount = evalSimpleMathExpr(payload.amount);
  if (!isFinite(amount) || amount <= 0) {
    throw new Error("Invalid amount. Enter a positive number or expression like 120+45.");
  }

  const dateStr = payload.date || Utilities.formatDate(new Date(), PF_CONFIG.TIMEZONE, "yyyy-MM-dd");
  const dObj = parseDateStrict(dateStr, PF_CONFIG.TIMEZONE);
  const isoDate = dObj ? formatDateIso(dObj) : Utilities.formatDate(new Date(), PF_CONFIG.TIMEZONE, "yyyy-MM-dd");
  const monthKey = isoDate.slice(0, 7);

  const type = String(payload.type || "Expense").trim();
  const category = String(payload.category || (type === "Income" ? "Salary / Income" : "Personal")).trim();
  const wallet = String(payload.wallet || "Bank / InstaPay").trim();
  const details = String(payload.details || "").trim();
  const notes = String(payload.notes || "Logged via Quick Entry").trim();
  const sourceId = `APP-${Date.now()}`;

  const lastRow = Math.max(1, txSheet.getLastRow());
  const nextRow = lastRow + 1;
  txSheet.getRange(nextRow, 1, 1, 10).setValues([[
    `=IF(B${nextRow}="","",ROW()-1)`,
    isoDate,
    `=IF(B${nextRow}="","",TEXT(B${nextRow},"yyyy-mm"))`,
    type,
    category,
    amount,
    wallet,
    details,
    notes,
    sourceId
  ]]);
  txSheet.getRange(nextRow, 2).setNumberFormat("yyyy-mm-dd");
  txSheet.getRange(nextRow, 6).setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  SpreadsheetApp.flush();

  const alertRes = checkAndSendBudgetAlerts(ss, monthKey, false);
  const catStatus = (alertRes.statuses || []).find(s => s.category === category) || null;
  const state = apiGetDashboardState();

  return {
    ok: true,
    amount,
    isoDate,
    category,
    catStatus,
    alertTriggered: (alertRes.triggeredAlerts || []).length > 0,
    state
  };
}

function apiLogLoan(payload) {
  if (!payload) throw new Error("Missing loan payload.");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const loanSheet = ss.getSheetByName(PF_CONFIG.SHEETS.LOANS);
  if (!loanSheet) throw new Error("Loans & People sheet not found.");

  const amount = evalSimpleMathExpr(payload.amount);
  if (!isFinite(amount) || amount <= 0) {
    throw new Error("Invalid loan amount.");
  }

  const person = normalizePersonName(payload.person);
  if (!person) throw new Error("Person name is required.");

  const dateStr = payload.date || Utilities.formatDate(new Date(), PF_CONFIG.TIMEZONE, "yyyy-MM-dd");
  const dObj = parseDateStrict(dateStr, PF_CONFIG.TIMEZONE);
  const isoDate = dObj ? formatDateIso(dObj) : Utilities.formatDate(new Date(), PF_CONFIG.TIMEZONE, "yyyy-MM-dd");

  const direction = String(payload.direction || "Lent / Paid for Them").trim();
  const wallet = String(payload.wallet || "Bank / InstaPay").trim();
  const notes = String(payload.notes || "Logged via Quick Entry").trim();
  const loanId = `APP-LOAN-${Date.now()}`;

  const nextRow = Math.max(17, loanSheet.getLastRow() + 1);
  loanSheet.getRange(nextRow, 1, 1, 8).setValues([[
    `=IF(B${nextRow}="","",ROW()-16)`,
    isoDate,
    person,
    direction,
    amount,
    wallet,
    notes,
    loanId
  ]]);
  loanSheet.getRange(nextRow, 2).setNumberFormat("yyyy-mm-dd");
  loanSheet.getRange(nextRow, 5).setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  SpreadsheetApp.flush();

  return {
    ok: true,
    person,
    amount,
    direction,
    state: apiGetDashboardState()
  };
}
