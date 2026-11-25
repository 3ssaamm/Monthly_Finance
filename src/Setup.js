/**
 * Formula-First Workbook Builder & Formatter for Personal Financials.
 * Builds all 8 sheets idempotently without wiping existing user ledger rows.
 */

function getOrCreateSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function buildAllSheets(optSs) {
  const ss = optSs || SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetLocale("en_US");
  ss.setSpreadsheetTimeZone(PF_CONFIG.TIMEZONE);

  const archive = getOrCreateSheet_(ss, PF_CONFIG.SHEETS.ARCHIVE);
  const nbeCache = getOrCreateSheet_(ss, PF_CONFIG.SHEETS.NBE_CACHE);
  const budgets = getOrCreateSheet_(ss, PF_CONFIG.SHEETS.BUDGETS);
  const tx = getOrCreateSheet_(ss, PF_CONFIG.SHEETS.TRANSACTIONS);
  const loans = getOrCreateSheet_(ss, PF_CONFIG.SHEETS.LOANS);
  const inv = getOrCreateSheet_(ss, PF_CONFIG.SHEETS.INVESTMENTS);
  const dash = getOrCreateSheet_(ss, PF_CONFIG.SHEETS.DASHBOARD);
  const yearly = getOrCreateSheet_(ss, PF_CONFIG.SHEETS.YEARLY);

  setupArchiveSheet_(archive);
  setupNbeCacheSheet_(nbeCache);
  setupBudgetsSheet_(budgets);
  setupTransactionsSheet_(tx);
  setupLoansSheet_(loans);
  setupInvestmentsSheet_(inv);
  setupDashboardSheet_(dash);
  setupYearlySheet_(yearly);

  const defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  // Order visible tabs cleanly, then hide system sheets
  const order = [
    PF_CONFIG.SHEETS.DASHBOARD,
    PF_CONFIG.SHEETS.TRANSACTIONS,
    PF_CONFIG.SHEETS.LOANS,
    PF_CONFIG.SHEETS.INVESTMENTS,
    PF_CONFIG.SHEETS.BUDGETS,
    PF_CONFIG.SHEETS.YEARLY,
    PF_CONFIG.SHEETS.NBE_CACHE,
    PF_CONFIG.SHEETS.ARCHIVE
  ];
  order.forEach((name, idx) => {
    const s = ss.getSheetByName(name);
    if (s) {
      ss.setActiveSheet(s);
      ss.moveActiveSheet(idx + 1);
    }
  });
  nbeCache.hideSheet();
  archive.hideSheet();
  ss.setActiveSheet(dash);
  return ss;
}

function setupArchiveSheet_(sheet) {
  if (sheet.getLastRow() >= 4) return;
  sheet.clear();
  sheet.getRange("A1:B4").setValues([
    ["Anchor Key", "Amount (EGP)"],
    ["Opening Bank Balance (Pre-Ledger Anchor)", 0],
    ["Opening Cash Balance (Pre-Ledger Anchor)", 0],
    ["Last Updated", Utilities.formatDate(new Date(), PF_CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm")]
  ]);
  sheet.getRange("A1:B1").setFontWeight("bold").setBackground(PF_CONFIG.COLORS.HEADER);
  sheet.getRange("B2:B3").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);

  sheet.getRange("A6:H6").setValues([
    ["MonthKey", "Year", "Month", "Income", "Savings", "Debt", "Expenses", "Notes"]
  ]).setFontWeight("bold").setBackground(PF_CONFIG.COLORS.HEADER);
}

function setupNbeCacheSheet_(sheet) {
  if (sheet.getLastRow() >= 10) return;
  sheet.clear();
  sheet.getRange("A1:B10").setValues([
    ["Metric", "Value"],
    ["Active Billing Cycle", "—"],
    ["Statement Date", "—"],
    ["Payment Due Date", "—"],
    ["Payment Status", "—"],
    ["Bank Closing Bill", 0],
    ["Mido Active Share Due", 0],
    ["Mido Next Month Forecast", 0],
    ["Family Shares Excl Mido", 0],
    ["Last Synced At", "Never"]
  ]);
  sheet.getRange("A1:B1").setFontWeight("bold").setBackground(PF_CONFIG.COLORS.HEADER);
  sheet.getRange("B6:B9").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
}

function setupBudgetsSheet_(sheet) {
  if (sheet.getLastRow() >= 23) return;
  sheet.clear();
  const C = PF_CONFIG.COLORS;

  sheet.getRange("A1:I1").merge()
    .setValue("🎯 Personal Financials — Category Budgets, Recurring Bills & Auto-Rules")
    .setFontWeight("bold").setFontSize(13).setBackground(C.PRIMARY).setFontColor("#ffffff");
  sheet.getRange("A2:I2").merge()
    .setValue("Edit yellow cells to customize monthly category caps, 80% warning thresholds, and automatic NBE categorization rules.")
    .setFontStyle("italic").setFontSize(9).setFontColor(C.TEXT_MUTED);

  sheet.getRange("A3:E3").merge().setValue("📊 Monthly Category Budgets & Alert Thresholds")
    .setFontWeight("bold").setFontSize(10).setBackground(C.PRIMARY_LIGHT);
  sheet.getRange("G3:I3").merge().setValue("⚙️ General Settings & Alert Target")
    .setFontWeight("bold").setFontSize(10).setBackground(C.PRIMARY_LIGHT);

  sheet.getRange("A4:E4").setValues([["Category", "Monthly Budget (EGP)", "Warning %", "Email Alerts", "Notes"]])
    .setFontWeight("bold").setBackground(C.HEADER);
  sheet.getRange("G4:I4").setValues([["Setting", "Value", "Description"]])
    .setFontWeight("bold").setBackground(C.HEADER);

  const bRows = PF_CONFIG.DEFAULT_BUDGETS.map(b => [b.category, b.budget, b.warnPct, b.emailAlert, b.notes]);
  sheet.getRange(5, 1, bRows.length, 5).setValues(bRows);
  sheet.getRange(5, 2, bRows.length, 1).setNumberFormat(PF_CONFIG.CURRENCY_FORMAT).setBackground(C.INPUT_BG);
  sheet.getRange(5, 3, bRows.length, 1).setNumberFormat("0%").setBackground(C.INPUT_BG);
  sheet.getRange(5, 4, bRows.length, 1).insertCheckboxes();
  sheet.getRange("A13:E13").setValues([["TOTAL MONTHLY BUDGET", "=SUM(B5:B12)", "", "", ""]])
    .setFontWeight("bold").setBackground(C.SUBHEADER);
  sheet.getRange("B13").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);

  const sRows = [
    ["Alert Email", PF_CONFIG.ALERT_EMAIL, "Destination for 80% / 100% budget alerts"],
    ["Target Monthly Savings (EGP)", 5000, "Monthly savings goal on Dashboard"],
    ["NBE Sync Start Month", PF_CONFIG.NBE_SYNC_START_MONTH, "Earliest month to auto-sync Mido card items"],
    ["NBE Credit Card Sheet ID", PF_CONFIG.NBE_CREDIT_ID, "Connected NBE Credit Card V2 spreadsheet"],
    ["Fast-Pace Margin %", 0.15, "Pace alert when % spent exceeds month % + margin"]
  ];
  sheet.getRange(5, 7, sRows.length, 3).setValues(sRows);
  sheet.getRange("H5:H9").setBackground(C.INPUT_BG);
  sheet.getRange("H6").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  sheet.getRange("H9").setNumberFormat("0%");

  sheet.getRange("A15:E15").merge().setValue("🔁 Monthly Recurring Fixed Bills")
    .setFontWeight("bold").setFontSize(10).setBackground(C.PRIMARY_LIGHT);
  sheet.getRange("G15:I15").merge().setValue("🏷️ Auto-Category Keyword Rules (NBE Sync)")
    .setFontWeight("bold").setFontSize(10).setBackground(C.PRIMARY_LIGHT);

  sheet.getRange("A16:E16").setValues([["Bill Name", "Category", "Expected (EGP)", "Due Day", "Match Keyword"]])
    .setFontWeight("bold").setBackground(C.HEADER);
  sheet.getRange("G16:I16").setValues([["Keywords (| separated)", "Assigned Category", "Priority"]])
    .setFontWeight("bold").setBackground(C.HEADER);

  const recRows = PF_CONFIG.DEFAULT_RECURRING.map(r => [r.name, r.category, r.expected, r.dueDay, r.keyword]);
  sheet.getRange(17, 1, recRows.length, 5).setValues(recRows);
  sheet.getRange(17, 3, recRows.length, 1).setNumberFormat(PF_CONFIG.CURRENCY_FORMAT).setBackground(C.INPUT_BG);

  const ruleRows = PF_CONFIG.DEFAULT_CATEGORY_RULES.map(r => [r.keywords, r.category, r.priority]);
  sheet.getRange(17, 7, ruleRows.length, 3).setValues(ruleRows);

  sheet.setFrozenRows(4);
  [175, 150, 95, 90, 260, 24, 240, 265, 230].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

function setupTransactionsSheet_(sheet) {
  const C = PF_CONFIG.COLORS;
  if (sheet.getLastRow() < 1 || String(sheet.getRange("B1").getValue()) !== "Date") {
    sheet.clear();
    sheet.getRange("A1:J1").setValues([
      ["#", "Date", "Month", "Type", "Category", "Amount (EGP)", "Wallet", "Details", "Notes", "_Source_ID"]
    ]).setFontWeight("bold").setBackground(C.PRIMARY).setFontColor("#ffffff");
  }

  const maxRows = Math.max(200, sheet.getMaxRows());
  const formulas = [];
  for (let r = 2; r <= Math.min(maxRows, 500); r++) {
    formulas.push([`=IF(B${r}="","",ROW()-1)`]);
  }
  // Only populate helper formulas in empty rows if sheet is newly initialized
  if (sheet.getLastRow() <= 1) {
    const monthFormulas = [];
    for (let r = 2; r <= 200; r++) {
      monthFormulas.push([`=IF(B${r}="","",TEXT(B${r},"yyyy-mm"))`]);
    }
    sheet.getRange(2, 1, formulas.slice(0, 199).length, 1).setFormulas(formulas.slice(0, 199));
    sheet.getRange(2, 3, monthFormulas.length, 1).setFormulas(monthFormulas);
  }

  const typeRule = SpreadsheetApp.newDataValidation().requireValueInList(PF_CONFIG.TX_TYPES, true).setAllowInvalid(false).build();
  const catRule = SpreadsheetApp.newDataValidation().requireValueInList(PF_CONFIG.TX_CATEGORIES, true).setAllowInvalid(true).build();
  const walletRule = SpreadsheetApp.newDataValidation().requireValueInList(PF_CONFIG.WALLETS, true).setAllowInvalid(false).build();
  sheet.getRange("D2:D1000").setDataValidation(typeRule);
  sheet.getRange("E2:E1000").setDataValidation(catRule);
  sheet.getRange("G2:G1000").setDataValidation(walletRule);

  sheet.getRange("B2:B1000").setNumberFormat("yyyy-mm-dd");
  sheet.getRange("F2:F1000").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  sheet.getRange("J1:J1000").setFontColor(C.TEXT_MUTED).setFontSize(8);
  sheet.setFrozenRows(1);
  [45, 105, 85, 125, 125, 125, 135, 230, 220, 145].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

function setupLoansSheet_(sheet) {
  if (sheet.getLastRow() >= 16) return;
  sheet.clear();
  const C = PF_CONFIG.COLORS;

  sheet.getRange("A1:H1").merge()
    .setValue("🤝 Loans & People — Personal Receivables & Split-Bill Tracker")
    .setFontWeight("bold").setFontSize(13).setBackground(C.PRIMARY).setFontColor("#ffffff");
  sheet.getRange("A2:H2").merge()
    .setValue("Every loan given from Bank or Cash reduces your liquid balance automatically while keeping Net Worth intact. Any new person added below appears in the Summary automatically.")
    .setFontStyle("italic").setFontSize(9).setFontColor(C.TEXT_MUTED);

  sheet.getRange("A3:F3").merge().setValue("📋 Summary Matrix — Net Owed to Me")
    .setFontWeight("bold").setFontSize(10).setBackground(C.PRIMARY_LIGHT);
  sheet.getRange("A4:F4").setValues([["Person", "Total Lent (+)", "Total Repaid (-)", "Net Owed to Me (EGP)", "Last Activity", "Status"]])
    .setFontWeight("bold").setBackground(C.HEADER);

  sheet.getRange("A5").setFormula('=IFERROR(SORT(UNIQUE(FILTER($C$17:$C$1000,$C$17:$C$1000<>""))),"")');
  for (let r = 5; r <= 12; r++) {
    sheet.getRange(r, 2, 1, 5).setFormulas([[
      `=IF(A${r}="","",SUMIFS($E$17:$E$1000,$C$17:$C$1000,A${r},$D$17:$D$1000,"Lent / Paid for Them"))`,
      `=IF(A${r}="","",SUMIFS($E$17:$E$1000,$C$17:$C$1000,A${r},$D$17:$D$1000,"Repaid to Me"))`,
      `=IF(A${r}="","",B${r}-C${r})`,
      `=IF(A${r}="","",IFERROR(MAXIFS($B$17:$B$1000,$C$17:$C$1000,A${r}),""))`,
      `=IF(A${r}="","",IF(D${r}>0.01,"⏳ Owed to Me",IF(D${r}<-0.01,"🔄 I Owe Them","✅ Settled")))`
    ]]);
  }
  sheet.getRange("B5:D13").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  sheet.getRange("E5:E12").setNumberFormat("yyyy-mm-dd");
  sheet.getRange("A13:F13").setValues([[
    "TOTAL OWED TO ME", "=SUM(B5:B12)", "=SUM(C5:C12)", "=SUM(D5:D12)", "", '=IF(D13>0.01,"🟢 Active Receivables","✅ All Settled")'
  ]]).setFontWeight("bold").setBackground(C.SUBHEADER);

  sheet.getRange("A15:H15").merge().setValue("📝 Loan & Repayment Ledger")
    .setFontWeight("bold").setFontSize(10).setBackground(C.PRIMARY_LIGHT);
  sheet.getRange("A16:H16").setValues([["#", "Date", "Person", "Direction", "Amount (EGP)", "Wallet", "Notes", "_Loan_ID"]])
    .setFontWeight("bold").setBackground(C.HEADER);

  const dirRule = SpreadsheetApp.newDataValidation().requireValueInList(PF_CONFIG.LOAN_DIRECTIONS, true).setAllowInvalid(false).build();
  const walRule = SpreadsheetApp.newDataValidation().requireValueInList(PF_CONFIG.LOAN_WALLETS, true).setAllowInvalid(false).build();
  sheet.getRange("D17:D1000").setDataValidation(dirRule);
  sheet.getRange("F17:F1000").setDataValidation(walRule);
  sheet.getRange("B17:B1000").setNumberFormat("yyyy-mm-dd");
  sheet.getRange("E17:E1000").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  sheet.getRange("H16:H1000").setFontColor(C.TEXT_MUTED).setFontSize(8);

  sheet.setFrozenRows(16);
  [135, 110, 125, 170, 130, 145, 250, 155].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

function setupInvestmentsSheet_(sheet) {
  if (sheet.getLastRow() >= 12) return;
  sheet.clear();
  const C = PF_CONFIG.COLORS;

  sheet.getRange("A1:N1").merge()
    .setValue("📈 Investments & Thndr — Personal Portfolio & Family Custodial Tracker")
    .setFontWeight("bold").setFontSize(13).setBackground(C.PRIMARY).setFontColor("#ffffff");
  sheet.getRange("A2:N2").merge()
    .setValue("Left: Your personal investments (included in Net Worth). Right: Family custodial Thndr funds (excluded from personal Net Worth).")
    .setFontStyle("italic").setFontSize(9).setFontColor(C.TEXT_MUTED);

  sheet.getRange("A3:F3").merge().setValue("💼 Personal Investment Portfolio")
    .setFontWeight("bold").setFontSize(10).setBackground(C.PRIMARY_LIGHT);
  sheet.getRange("H3:K3").merge().setValue("👨‍👩‍👧 Family Custodial Thndr (Separate)")
    .setFontWeight("bold").setFontSize(10).setBackground(C.INFO_BG);

  sheet.getRange("A4:F4").setValues([["Asset", "Units / USD", "Net Principal (EGP)", "Market Value (EGP)", "Profit (EGP)", "ROI %"]])
    .setFontWeight("bold").setBackground(C.HEADER);
  sheet.getRange("H4:K4").setValues([["Person", "Net Transacted (EGP)", "Actual Value (EGP)", "Interest / Profit (EGP)"]])
    .setFontWeight("bold").setBackground(C.HEADER);

  sheet.getRange("A5:F8").setValues([
    ["USD Cash", 100, '=SUMIFS($E$13:$E$1000,$C$13:$C$1000,A5,$D$13:$D$1000,"Deposit")-SUMIFS($E$13:$E$1000,$C$13:$C$1000,A5,$D$13:$D$1000,"Withdrawal")', '=B5*GOOGLEFINANCE("CURRENCY:USDEGP")', "=D5-C5", "=IF(C5>0,E5/C5,0)"],
    ["Thndr Cloud", "", '=SUMIFS($E$13:$E$1000,$C$13:$C$1000,A6,$D$13:$D$1000,"Deposit")-SUMIFS($E$13:$E$1000,$C$13:$C$1000,A6,$D$13:$D$1000,"Withdrawal")', 3071, "=D6-C6", "=IF(C6>0,E6/C6,0)"],
    ["Thndr FI Funds", "", '=SUMIFS($E$13:$E$1000,$C$13:$C$1000,A7,$D$13:$D$1000,"Deposit")-SUMIFS($E$13:$E$1000,$C$13:$C$1000,A7,$D$13:$D$1000,"Withdrawal")', 23066, "=D7-C7", "=IF(C7>0,E7/C7,0)"],
    ["TOTAL PERSONAL", "", "=SUM(C5:C7)", "=SUM(D5:D7)", "=SUM(E5:E7)", "=IF(C8>0,E8/C8,0)"]
  ]);
  sheet.getRange("B5").setNumberFormat(PF_CONFIG.USD_FORMAT).setBackground(C.INPUT_BG);
  sheet.getRange("D6:D7").setBackground(C.INPUT_BG);
  sheet.getRange("C5:E8").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  sheet.getRange("F5:F8").setNumberFormat("0.0%");
  sheet.getRange("A8:F8").setFontWeight("bold").setBackground(C.SUBHEADER);

  sheet.getRange("H5:K8").setValues([
    ["Dad", '=SUMIFS($L$13:$L$1000,$J$13:$J$1000,H5,$K$13:$K$1000,"Deposit")-SUMIFS($L$13:$L$1000,$J$13:$J$1000,H5,$K$13:$K$1000,"Withdraw")', 30911, "=J5-I5"],
    ["Mum", '=SUMIFS($L$13:$L$1000,$J$13:$J$1000,H6,$K$13:$K$1000,"Deposit")-SUMIFS($L$13:$L$1000,$J$13:$J$1000,H6,$K$13:$K$1000,"Withdraw")', 71422, "=J6-I6"],
    ["Abdo", '=SUMIFS($L$13:$L$1000,$J$13:$J$1000,H7,$K$13:$K$1000,"Deposit")-SUMIFS($L$13:$L$1000,$J$13:$J$1000,H7,$K$13:$K$1000,"Withdraw")', 0, "=J7-I7"],
    ["TOTAL FAMILY", "=SUM(I5:I7)", "=SUM(J5:J7)", "=SUM(K5:K7)"]
  ]);
  sheet.getRange("J5:J7").setBackground(C.INPUT_BG);
  sheet.getRange("I5:K8").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  sheet.getRange("H8:K8").setFontWeight("bold").setBackground(C.SUBHEADER);

  sheet.getRange("A11:G11").merge().setValue("📥 Personal Investment Transactions")
    .setFontWeight("bold").setFontSize(10).setBackground(C.PRIMARY_LIGHT);
  sheet.getRange("H11:N11").merge().setValue("📥 Family Custodial Thndr Transactions")
    .setFontWeight("bold").setFontSize(10).setBackground(C.INFO_BG);

  sheet.getRange("A12:G12").setValues([["#", "Date", "Asset", "Action", "Amount (EGP)", "Wallet", "Notes"]])
    .setFontWeight("bold").setBackground(C.HEADER);
  sheet.getRange("H12:N12").setValues([["#", "Date", "Person", "Action", "Amount (EGP)", "Notes", "_Src_ID"]])
    .setFontWeight("bold").setBackground(C.HEADER);

  const assetRule = SpreadsheetApp.newDataValidation().requireValueInList(PF_CONFIG.PERSONAL_ASSETS, true).setAllowInvalid(true).build();
  const actRule = SpreadsheetApp.newDataValidation().requireValueInList(PF_CONFIG.INV_ACTIONS, true).setAllowInvalid(false).build();
  const walRule = SpreadsheetApp.newDataValidation().requireValueInList(PF_CONFIG.INV_WALLETS, true).setAllowInvalid(false).build();
  sheet.getRange("C13:C500").setDataValidation(assetRule);
  sheet.getRange("D13:D500").setDataValidation(actRule);
  sheet.getRange("F13:F500").setDataValidation(walRule);
  sheet.getRange("B13:B500").setNumberFormat("yyyy-mm-dd");
  sheet.getRange("I13:I1000").setNumberFormat("yyyy-mm-dd");
  sheet.getRange("E13:E500").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  sheet.getRange("L13:L1000").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);

  sheet.setFrozenRows(12);
  [125, 100, 135, 135, 120, 120, 160, 135, 135, 135, 140, 120, 175, 125].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

function setupDashboardSheet_(sheet) {
  const C = PF_CONFIG.COLORS;
  sheet.clear();
  sheet.setHiddenGridlines(false);

  sheet.getRange("A1:N1").merge()
    .setValue("💰 Personal Financials — Live Monthly Command Center")
    .setFontWeight("bold").setFontSize(14).setBackground(C.PRIMARY).setFontColor("#ffffff");
  sheet.getRange("A2:N2").merge()
    .setValue("Select Year & Month below. All budgets, pace warnings, Bank/Cash tie-outs, NBE Credit Card dues, and Net Worth update automatically via formulas.")
    .setFontStyle("italic").setFontSize(9).setFontColor(C.TEXT_MUTED);

  // Row 3 Controls
  sheet.getRange("A3:N3").setBackground(C.PRIMARY_LIGHT).setFontSize(10);
  sheet.getRange("A3").setValue("Active Year:").setFontWeight("bold");
  sheet.getRange("B3").setValue(2026).setFontWeight("bold").setBackground(C.INPUT_BG).setHorizontalAlignment("center");
  sheet.getRange("C3").setValue("Active Month:").setFontWeight("bold");
  sheet.getRange("D3").setValue("November").setFontWeight("bold").setBackground(C.INPUT_BG).setHorizontalAlignment("center");
  sheet.getRange("F3").setValue("MonthKey:").setFontWeight("bold");
  sheet.getRange("G3").setFormula('=B3&"-"&TEXT(MONTH(DATEVALUE(D3&" 1, "&B3)),"00")').setFontWeight("bold").setHorizontalAlignment("center");
  sheet.getRange("I3").setValue("Month Progress:").setFontWeight("bold");
  sheet.getRange("K3").setFormula('=IF(TEXT(TODAY(),"yyyy-mm")=G3,DAY(TODAY())/DAY(EOMONTH(DATE(B3,MONTH(DATEVALUE(D3&" 1, "&B3)),1),0)),IF(DATE(B3,MONTH(DATEVALUE(D3&" 1, "&B3)),1)<TODAY(),1,0))')
    .setNumberFormat("0.0%").setFontWeight("bold");
  sheet.getRange("L3").setValue("Target Savings:").setFontWeight("bold");
  sheet.getRange("M3").setFormula("='Budgets & Recurring'!H6").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT).setFontWeight("bold");

  const yearRule = SpreadsheetApp.newDataValidation().requireValueInList(["2024", "2025", "2026", "2027"], true).build();
  const monthRule = SpreadsheetApp.newDataValidation().requireValueInList(PF_CONFIG.MONTH_NAMES, true).build();
  sheet.getRange("B3").setDataValidation(yearRule);
  sheet.getRange("D3").setDataValidation(monthRule);

  // Executive KPI Banner (Rows 5-6)
  sheet.getRange("A5:B5").merge().setValue("Monthly Income");
  sheet.getRange("C5:D5").merge().setValue("Total Monthly Spend");
  sheet.getRange("E5:F5").merge().setValue("Monthly Net Saved");
  sheet.getRange("G5:H5").merge().setValue("Safe-to-Spend / Day");
  sheet.getRange("I5:K5").merge().setValue("Liquid Bank & Cash");
  sheet.getRange("L5:N5").merge().setValue("Personal Net Worth");
  sheet.getRange("A5:N5").setFontWeight("bold").setFontSize(9).setBackground(C.HEADER).setHorizontalAlignment("center");

  sheet.getRange("A6:B6").merge().setFormula('=SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Income")');
  sheet.getRange("C6:D6").merge().setFormula('=SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Expense")-SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Reimbursement")');
  sheet.getRange("E6:F6").merge().setFormula("=A6-C6");
  sheet.getRange("G6:H6").merge().setFormula('=IF($K$3>=1,0,MAX(0,(C18-C6))/MAX(1,DAY(EOMONTH(DATE(B3,MONTH(DATEVALUE(D3&" 1, "&B3)),1),0))-IF(TEXT(TODAY(),"yyyy-mm")=G3,DAY(TODAY()),0)))');
  sheet.getRange("I6:K6").merge().setFormula("=K10+K11");
  sheet.getRange("L6:N6").merge().setFormula("=I6+'Investments & Thndr'!D8+'Loans & People'!D13-J20");
  sheet.getRange("A6:N6").setFontWeight("bold").setFontSize(12).setNumberFormat(PF_CONFIG.CURRENCY_FORMAT).setHorizontalAlignment("center").setBackground("#ffffff");

  // Left Panel: Category Budget vs Actual (Rows 8-18, Cols A-G)
  sheet.getRange("A8:G8").merge().setValue("📊 Category Spending vs. Budget & Alert Status")
    .setFontWeight("bold").setFontSize(10).setBackground(C.PRIMARY_LIGHT);
  sheet.getRange("A9:G9").setValues([["Category", "Actual (EGP)", "Budget (EGP)", "Remaining", "% Used", "Progress", "Alert / Pace"]])
    .setFontWeight("bold").setFontSize(9).setBackground(C.HEADER);

  for (let i = 0; i < 8; i++) {
    const r = 10 + i;
    const br = 5 + i;
    sheet.getRange(r, 1, 1, 7).setFormulas([[
      `='Budgets & Recurring'!A${br}`,
      `=SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Expense",Transactions!$E$2:$E,A${r})-SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Reimbursement",Transactions!$E$2:$E,A${r})`,
      `='Budgets & Recurring'!B${br}`,
      `=C${r}-B${r}`,
      `=IF(C${r}>0,B${r}/C${r},0)`,
      `=IF(C${r}<=0,"",SPARKLINE(MIN(E${r},1),{"charttype","bar";"max",1;"color1",IF(E${r}>=1,"#d93025",IF(E${r}>='Budgets & Recurring'!C${br},"#f9ab00","#1b5e20"))}))`,
      `=IF(C${r}<=0,"—",IF(E${r}>=1,"🚨 OVER BUDGET",IF(E${r}>='Budgets & Recurring'!C${br},"⚠️ Near Limit",IF(AND($K$3>0,$K$3<1,E${r}>$K$3+'Budgets & Recurring'!$H$9),"🔥 Fast Pace","✅ On Track"))))`
    ]]);
  }
  sheet.getRange("A18:G18").setValues([[
    "TOTAL", "=SUM(B10:B17)", "=SUM(C10:C17)", "=SUM(D10:D17)", "=IF(C18>0,B18/C18,0)", "", '=IF(E18>=1,"🚨 Over Total Budget",IF(E18>=0.8,"⚠️ Near Total Cap","✅ Healthy"))'
  ]]).setFontWeight("bold").setBackground(C.SUBHEADER);
  sheet.getRange("B10:D18").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  sheet.getRange("E10:E18").setNumberFormat("0.0%");

  // Left Lower Panel: Recurring Bills Checklist (Rows 20-28, Cols A-G)
  sheet.getRange("A20:G20").merge().setValue("🔁 Monthly Recurring Fixed Bills Checklist")
    .setFontWeight("bold").setFontSize(10).setBackground(C.PRIMARY_LIGHT);
  sheet.getRange("A21:G21").setValues([["Bill Name", "Category", "Expected (EGP)", "Paid This Month", "Due Day", "Match Keyword", "Status"]])
    .setFontWeight("bold").setFontSize(9).setBackground(C.HEADER);
  for (let i = 0; i < 7; i++) {
    const r = 22 + i;
    const rr = 17 + i;
    sheet.getRange(r, 1, 1, 7).setFormulas([[
      `='Budgets & Recurring'!A${rr}`,
      `='Budgets & Recurring'!B${rr}`,
      `='Budgets & Recurring'!C${rr}`,
      `=SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Expense",Transactions!$H$2:$H,"*"&F${r}&"*")`,
      `='Budgets & Recurring'!D${rr}`,
      `='Budgets & Recurring'!E${rr}`,
      `=IF(D${r}>=C${r}*0.5,"✅ Paid",IF(AND($K$3>0,DAY(TODAY())>E${r}),"⏰ Due / Check","⏳ Upcoming"))`
    ]]);
  }
  sheet.getRange("C22:D28").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);

  // Right Top Panel: Live Bank & Cash Reconciliation (Rows 8-15, Cols I-N)
  sheet.getRange("I8:N8").merge().setValue("🏦 Live Bank & Cash Wallet Reconciliation")
    .setFontWeight("bold").setFontSize(10).setBackground(C.PRIMARY_LIGHT);
  sheet.getRange("I9:N9").setValues([["Wallet", "Opening Anchor", "Expected (EGP)", "Actual (Yellow)", "Variance", "Recon Status"]])
    .setFontWeight("bold").setFontSize(9).setBackground(C.HEADER);

  const bankExpectedFormula =
    "='_Archive_Store'!B2" +
    '+SUMIFS(Transactions!$F$2:$F,Transactions!$D$2:$D,"Income",Transactions!$G$2:$G,"Bank / InstaPay")' +
    '+SUMIFS(Transactions!$F$2:$F,Transactions!$D$2:$D,"Reimbursement",Transactions!$G$2:$G,"Bank / InstaPay")' +
    '+SUMIFS(Transactions!$F$2:$F,Transactions!$D$2:$D,"Bank Deposit")' +
    '-SUMIFS(Transactions!$F$2:$F,Transactions!$D$2:$D,"Expense",Transactions!$G$2:$G,"Bank / InstaPay")' +
    '-SUMIFS(Transactions!$F$2:$F,Transactions!$D$2:$D,"CC Bill Payment",Transactions!$G$2:$G,"Bank / InstaPay")' +
    '-SUMIFS(Transactions!$F$2:$F,Transactions!$D$2:$D,"Cash Withdrawal")' +
    '+SUMIFS(\'Loans & People\'!$E$17:$E,\'Loans & People\'!$D$17:$D,"Repaid to Me",\'Loans & People\'!$F$17:$F,"Bank / InstaPay")' +
    '-SUMIFS(\'Loans & People\'!$E$17:$E,\'Loans & People\'!$D$17:$D,"Lent / Paid for Them",\'Loans & People\'!$F$17:$F,"Bank / InstaPay")' +
    '+SUMIFS(\'Investments & Thndr\'!$E$13:$E,\'Investments & Thndr\'!$D$13:$D,"Withdrawal",\'Investments & Thndr\'!$F$13:$F,"Bank / InstaPay")' +
    '-SUMIFS(\'Investments & Thndr\'!$E$13:$E,\'Investments & Thndr\'!$D$13:$D,"Deposit",\'Investments & Thndr\'!$F$13:$F,"Bank / InstaPay")';

  const cashExpectedFormula =
    "='_Archive_Store'!B3" +
    '+SUMIFS(Transactions!$F$2:$F,Transactions!$D$2:$D,"Income",Transactions!$G$2:$G,"Cash")' +
    '+SUMIFS(Transactions!$F$2:$F,Transactions!$D$2:$D,"Reimbursement",Transactions!$G$2:$G,"Cash")' +
    '+SUMIFS(Transactions!$F$2:$F,Transactions!$D$2:$D,"Cash Withdrawal")' +
    '-SUMIFS(Transactions!$F$2:$F,Transactions!$D$2:$D,"Expense",Transactions!$G$2:$G,"Cash")' +
    '-SUMIFS(Transactions!$F$2:$F,Transactions!$D$2:$D,"CC Bill Payment",Transactions!$G$2:$G,"Cash")' +
    '-SUMIFS(Transactions!$F$2:$F,Transactions!$D$2:$D,"Bank Deposit")' +
    '+SUMIFS(\'Loans & People\'!$E$17:$E,\'Loans & People\'!$D$17:$D,"Repaid to Me",\'Loans & People\'!$F$17:$F,"Cash")' +
    '-SUMIFS(\'Loans & People\'!$E$17:$E,\'Loans & People\'!$D$17:$D,"Lent / Paid for Them",\'Loans & People\'!$F$17:$F,"Cash")' +
    '+SUMIFS(\'Investments & Thndr\'!$E$13:$E,\'Investments & Thndr\'!$D$13:$D,"Withdrawal",\'Investments & Thndr\'!$F$13:$F,"Cash")' +
    '-SUMIFS(\'Investments & Thndr\'!$E$13:$E,\'Investments & Thndr\'!$D$13:$D,"Deposit",\'Investments & Thndr\'!$F$13:$F,"Cash")';

  sheet.getRange("I10:N11").setValues([
    ["Bank / InstaPay", "='_Archive_Store'!B2", bankExpectedFormula, 16584.16, "=L10-K10", '=IF(ABS(M10)<0.05,"✅ Balanced","⚠️ Diff")'],
    ["Cash on Hand", "='_Archive_Store'!B3", cashExpectedFormula, 120.00, "=L11-K11", '=IF(ABS(M11)<0.05,"✅ Balanced","⚠️ Diff")']
  ]);
  sheet.getRange("I12:N12").setValues([
    ["TOTAL LIQUID", "=SUM(J10:J11)", "=SUM(K10:K11)", "=SUM(L10:L11)", "=SUM(M10:M11)", '=IF(ABS(M12)<0.05,"✅ All Tied Out","⚠️ Check Diff")']
  ]).setFontWeight("bold").setBackground(C.SUBHEADER);
  sheet.getRange("L10:L11").setBackground(C.INPUT_BG);
  sheet.getRange("J10:M12").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);

  // Spend by Wallet Breakdown (Rows 14-15, Cols I-N)
  sheet.getRange("I14:N14").setValues([["Month Spend by Wallet:", "Bank / InstaPay", "Cash", "NBE Credit Card", "Loan Receivables", "Personal Invest."]])
    .setFontWeight("bold").setFontSize(9).setBackground(C.HEADER);
  sheet.getRange("I15:N15").setFormulas([[
    "=$G$3",
    '=SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Expense",Transactions!$G$2:$G,"Bank / InstaPay")',
    '=SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Expense",Transactions!$G$2:$G,"Cash")',
    '=SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Expense",Transactions!$G$2:$G,"NBE Credit Card")',
    "='Loans & People'!D13",
    "='Investments & Thndr'!D8"
  ]]);
  sheet.getRange("J15:N15").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);

  // Right Lower Panel: Live NBE Credit Card V2 & Wealth Snapshot (Rows 17-28, Cols I-N)
  sheet.getRange("I17:N17").merge().setValue("💳 Live NBE Credit Card V2 & Wealth Snapshot")
    .setFontWeight("bold").setFontSize(10).setBackground(C.INFO_BG);
  sheet.getRange("I18:N18").setValues([["Metric", "Value", "Detail", "Metric", "Value", "Profit / Status"]])
    .setFontWeight("bold").setFontSize(9).setBackground(C.HEADER);

  sheet.getRange("I19:N23").setValues([
    ["Active Card Cycle", "='_NBE_Cache'!B2", "='_NBE_Cache'!B5", "USD Cash ($100)", "='Investments & Thndr'!D5", "='Investments & Thndr'!E5"],
    ["Mido Card Share Due", "='_NBE_Cache'!B7", "='_NBE_Cache'!B4", "Thndr Cloud", "='Investments & Thndr'!D6", "='Investments & Thndr'!E6"],
    ["Mido Next Forecast", "='_NBE_Cache'!B8", "Next Cycle Est.", "Thndr FI Funds", "='Investments & Thndr'!D7", "='Investments & Thndr'!E7"],
    ["Total Bank Closing Bill", "='_NBE_Cache'!B6", "Full Card Statement", "Abdo Loan Owed", "='Loans & People'!D5", "='Loans & People'!F5"],
    ["Family Shares (Excl Mido)", "='_NBE_Cache'!B9", "='_NBE_Cache'!B10", "Dad & Others", "='Loans & People'!D13-'Loans & People'!D5", '=IF(M23>0,"⏳ Pending","✅ Settled")']
  ]);
  sheet.getRange("J20:J23").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  sheet.getRange("M19:N22").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  sheet.getRange("M23").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);

  sheet.setFrozenRows(3);
  [165, 110, 115, 110, 75, 115, 135, 22, 180, 115, 145, 130, 115, 125].forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // Conditional formatting for Alert/Pace & Recon badges
  const rules = [];
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains("OVER BUDGET").setBackground(C.ALERT_BG).setFontColor(C.ALERT_FG).setBold(true).setRanges([sheet.getRange("G10:G18")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains("Near Limit").setBackground(C.WARN_BG).setFontColor(C.WARN_FG).setBold(true).setRanges([sheet.getRange("G10:G18")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains("Fast Pace").setBackground(C.WARN_BG).setFontColor(C.WARN_FG).setBold(true).setRanges([sheet.getRange("G10:G18")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains("On Track").setBackground(C.OK_BG).setFontColor(C.OK_FG).setRanges([sheet.getRange("G10:G18")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains("Balanced").setBackground(C.OK_BG).setFontColor(C.OK_FG).setBold(true).setRanges([sheet.getRange("N10:N12")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains("Tied Out").setBackground(C.OK_BG).setFontColor(C.OK_FG).setBold(true).setRanges([sheet.getRange("N10:N12")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains("Diff").setBackground(C.ALERT_BG).setFontColor(C.ALERT_FG).setBold(true).setRanges([sheet.getRange("N10:N12")]).build());
  sheet.setConditionalFormatRules(rules);
}

function setupYearlySheet_(sheet) {
  const C = PF_CONFIG.COLORS;
  sheet.clear();

  sheet.getRange("A1:N1").merge()
    .setValue("📅 Yearly Summary & Visual Analytics (2024–2027)")
    .setFontWeight("bold").setFontSize(13).setBackground(C.PRIMARY).setFontColor("#ffffff");
  sheet.getRange("A2:N2").merge()
    .setValue("Historical totals (Jun 2024–Mar 2026) from _Archive_Store seamlessly combined with live formula rollups (Apr 2026+) from Transactions.")
    .setFontStyle("italic").setFontSize(9).setFontColor(C.TEXT_MUTED);

  sheet.getRange("A3:G3").merge().setValue("📆 Monthly Historical & Live Ledger Rollup")
    .setFontWeight("bold").setFontSize(10).setBackground(C.PRIMARY_LIGHT);
  sheet.getRange("I3:N3").merge().setValue("📊 Annual Totals Summary")
    .setFontWeight("bold").setFontSize(10).setBackground(C.PRIMARY_LIGHT);

  sheet.getRange("A4:G4").setValues([["MonthKey", "Year", "Month", "Income (EGP)", "Expenses (EGP)", "Net Cash Flow", "Cumulative Flow"]])
    .setFontWeight("bold").setBackground(C.HEADER);
  sheet.getRange("I4:N4").setValues([["Year", "Total Income", "Total Expenses", "Net Cash Flow", "Savings Rate %", "Archive Savings"]])
    .setFontWeight("bold").setBackground(C.HEADER);

  const timeline = [];
  for (let y = 2024; y <= 2027; y++) {
    const startM = y === 2024 ? 6 : 1;
    for (let m = startM; m <= 12; m++) {
      const mKey = `${y}-${String(m).padStart(2, "0")}`;
      const r = 5 + timeline.length;
      const isArchive = mKey <= "2026-03";
      const incFormula = isArchive
        ? `=IFERROR(INDEX('_Archive_Store'!$D$7:$D$28,MATCH(A${r},'_Archive_Store'!$A$7:$A$28,0)),0)`
        : `=SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,A${r},Transactions!$D$2:$D,"Income")`;
      const expFormula = isArchive
        ? `=IFERROR(INDEX('_Archive_Store'!$G$7:$G$28,MATCH(A${r},'_Archive_Store'!$A$7:$A$28,0)),0)`
        : `=SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,A${r},Transactions!$D$2:$D,"Expense")-SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,A${r},Transactions!$D$2:$D,"Reimbursement")`;
      const cumFormula = timeline.length === 0 ? `=F${r}` : `=G${r - 1}+F${r}`;
      timeline.push([mKey, y, PF_CONFIG.MONTH_NAMES[m - 1], incFormula, expFormula, `=D${r}-E${r}`, cumFormula]);
    }
  }
  sheet.getRange(5, 1, timeline.length, 7).setValues(timeline);
  sheet.getRange(5, 4, timeline.length, 4).setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);

  const years = [2024, 2025, 2026, 2027];
  const lastTimelineRow = 4 + timeline.length;
  const annualRows = years.map((y, idx) => {
    const r = 5 + idx;
    return [
      y,
      `=SUMIFS($D$5:$D$${lastTimelineRow},$B$5:$B$${lastTimelineRow},I${r})`,
      `=SUMIFS($E$5:$E$${lastTimelineRow},$B$5:$B$${lastTimelineRow},I${r})`,
      `=J${r}-K${r}`,
      `=IF(J${r}>0,L${r}/J${r},0)`,
      `=IF(I${r}<=2026,SUMIFS('_Archive_Store'!$E$7:$E$28,'_Archive_Store'!$B$7:$B$28,I${r}),0)`
    ];
  });
  sheet.getRange(5, 9, annualRows.length, 6).setValues(annualRows);
  sheet.getRange("J5:L8").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  sheet.getRange("N5:N8").setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  sheet.getRange("M5:M8").setNumberFormat("0.0%");

  sheet.setFrozenRows(4);
  [85, 60, 95, 120, 120, 120, 125, 22, 65, 115, 115, 115, 95, 115].forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // Charts (placed cleanly in I11, I25, I39)
  sheet.getCharts().forEach(c => sheet.removeChart(c));
  const c1 = sheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sheet.getRange("C24:E35"))
    .setPosition(11, 9, 0, 0)
    .setOption("title", "2026 Monthly Income vs. Expenses (EGP)")
    .setOption("colors", ["#1b5e20", "#d93025"])
    .setOption("width", 620)
    .setOption("height", 260)
    .build();
  const dash = sheet.getParent().getSheetByName(PF_CONFIG.SHEETS.DASHBOARD);
  const c2 = sheet.newChart()
    .setChartType(Charts.ChartType.BAR)
    .addRange(dash.getRange("A9:C17"))
    .setPosition(25, 9, 0, 0)
    .setOption("title", "Active Month: Actual vs. Budget by Category")
    .setOption("colors", ["#1967d2", "#dadce0"])
    .setOption("width", 620)
    .setOption("height", 260)
    .build();
  const c3 = sheet.newChart()
    .setChartType(Charts.ChartType.AREA)
    .addRange(sheet.getRange(`A4:A${lastTimelineRow}`))
    .addRange(sheet.getRange(`G4:G${lastTimelineRow}`))
    .setPosition(39, 9, 0, 0)
    .setOption("title", "Cumulative Cash Flow Growth (2024–2026)")
    .setOption("colors", ["#1b5e20"])
    .setOption("width", 620)
    .setOption("height", 260)
    .build();
  sheet.insertChart(c1);
  sheet.insertChart(c2);
  sheet.insertChart(c3);
}
