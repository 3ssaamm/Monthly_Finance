const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  PF_CONFIG,
  evalSimpleMathExpr,
  parseDateStrict,
  formatDateIso,
  normalizePersonName,
  categorizeDescription,
  computeWalletBalances
} = require("../src/Config");
const { parseNbeActiveBillGrid, buildMidoNbeSyncRows } = require("../src/SyncNBE");
const { normalizeLegacyExpenseRow, normalizeLegacyAbdoRow } = require("../src/Migration");

const TARGET_ID = "1fW72r2bvYswRtHyySlReRRkMgUVosDU7HqKAM-kdtZc";
const SCRATCH_DIR = path.resolve(__dirname, "..", ".tmp_bootstrap");

function runGsheets(args, isJson = true) {
  const env = { ...process.env, AGY_ACCOUNT: "muhammad.essam811@gmail.com" };
  const quoted = args.map(a => (/[\s&!]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : a));
  const out = execFileSync("gsheets.cmd", quoted, { env, encoding: "utf8", maxBuffer: 25 * 1024 * 1024, shell: true });
  return isJson ? JSON.parse(out) : out;
}

function readRange(ssId, range, formula = false) {
  const args = ["readonly", "read", ssId, range, "--json"];
  if (formula) args.splice(4, 0, "--value-render-option", "FORMULA");
  return runGsheets(args, true);
}

function parseNum(v) {
  const n = evalSimpleMathExpr(v);
  return isFinite(n) ? n : 0;
}

function main() {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  console.log("1/6 Reading legacy Financials (2024, 2025, Thndr)...");

  const fin2024 = readRange(PF_CONFIG.LEGACY_FINANCIALS_ID, "2024!A1:I12", false);
  const fin2025 = readRange(PF_CONFIG.LEGACY_FINANCIALS_ID, "2025!A1:F15", false);
  const finThndr = readRange(PF_CONFIG.LEGACY_FINANCIALS_ID, "Thndr!A1:K60", true);
  const fin2026 = readRange(PF_CONFIG.LEGACY_FINANCIALS_ID, "2026!A1:F15", false);

  const archiveRows = [];
  // 2024 June-Dec
  for (let i = 1; i < fin2024.length; i++) {
    const r = fin2024[i];
    const mNum = parseInt(r[1], 10);
    const mName = String(r[2] || "").trim();
    if (!mNum || !mName) continue;
    archiveRows.push([
      `2024-${String(mNum).padStart(2, "0")}`,
      2024,
      mName,
      parseNum(r[4]),
      parseNum(r[5]),
      parseNum(r[6]),
      parseNum(r[7]),
      "Migrated from Financials 2024"
    ]);
  }
  // 2025 Jan-Dec
  for (let i = 1; i <= 12; i++) {
    const r = fin2025[i];
    if (!r || !r[1]) continue;
    archiveRows.push([
      `2025-${String(i).padStart(2, "0")}`,
      2025,
      String(r[1]).trim(),
      parseNum(r[2]),
      parseNum(r[3]),
      0,
      parseNum(r[4]),
      "Migrated from Financials 2025"
    ]);
  }
  // 2026 Jan-Mar (archive only; Apr+ is live from Transactions)
  for (let i = 1; i <= 3; i++) {
    const r = fin2026[i];
    if (!r || !r[1]) continue;
    archiveRows.push([
      `2026-${String(i).padStart(2, "0")}`,
      2026,
      String(r[1]).trim(),
      parseNum(r[2]),
      parseNum(r[3]),
      0,
      parseNum(r[4]),
      "Migrated from Financials 2026 (Jan-Mar xlsx)"
    ]);
  }

  console.log("2/6 Reading April–November 2026 monthly sheets & Abdo ledger...");
  const transactions = [];
  const monthKeys = Object.keys(PF_CONFIG.LEGACY_2026_SHEETS).sort();
  for (const mKey of monthKeys) {
    const ssId = PF_CONFIG.LEGACY_2026_SHEETS[mKey];
    const sumGrid = readRange(ssId, "Summary!A1:D6", false);
    const expGrid = readRange(ssId, "Expenses!A1:E200", true);
    const incAmt = sumGrid[3] ? parseNum(sumGrid[3][2]) : 0;
    const mIdx = parseInt(mKey.slice(5, 7), 10) - 1;
    if (incAmt > 0) {
      transactions.push({
        date: `${mKey}-01`,
        monthKey: mKey,
        type: "Income",
        category: "Salary / Income",
        amount: incAmt,
        wallet: "Bank / InstaPay",
        details: `${PF_CONFIG.MONTH_NAMES[mIdx]} Salary / Income`,
        notes: "Migrated monthly income",
        sourceId: `MIG-INC-${mKey}`
      });
    }
    for (let i = 1; i < expGrid.length; i++) {
      const norm = normalizeLegacyExpenseRow(expGrid[i], mKey, i);
      if (norm) transactions.push(norm);
    }
  }

  // Loans: November Abdo + Dad (300)
  const abdoGrid = readRange(PF_CONFIG.LEGACY_2026_SHEETS["2026-11"], "Abdo!A1:E60", true);
  const loans = [];
  for (let i = 1; i < abdoGrid.length; i++) {
    const norm = normalizeLegacyAbdoRow(abdoGrid[i], i);
    if (norm) loans.push(norm);
  }
  loans.push({
    date: "2026-11-01",
    person: "Dad",
    direction: "Lent / Paid for Them",
    amount: 300,
    wallet: "Opening Balance",
    notes: "Migrated Dad receivable from November Summary",
    loanId: "MIG-LOAN-DAD-001"
  });

  // Personal Investments (Opening Principals)
  const personalInvestments = [
    { date: "2024-11-01", asset: "USD Cash", action: "Deposit", amount: 4920, wallet: "Opening Principal", notes: "$100 USD cost basis (Nov 2024)" },
    { date: "2026-01-01", asset: "Thndr Cloud", action: "Deposit", amount: 3000, wallet: "Opening Principal", notes: "Migrated Thndr Cloud principal" },
    { date: "2026-01-01", asset: "Thndr FI Funds", action: "Deposit", amount: 20000, wallet: "Opening Principal", notes: "Migrated Thndr FI principal" }
  ];

  // Family Custodial Thndr
  const familyThndr = [];
  for (let i = 1; i < finThndr.length; i++) {
    const r = finThndr[i];
    const person = normalizePersonName(r[1]);
    const amt = parseNum(r[2]);
    const action = String(r[3] || "").trim();
    const dObj = parseDateStrict(r[4], PF_CONFIG.TIMEZONE);
    const notes = String(r[5] || "").trim();
    if (!person || amt <= 0 || !action) continue;
    familyThndr.push({
      date: dObj ? formatDateIso(dObj) : "2026-01-01",
      person,
      action,
      amount: amt,
      notes,
      srcId: `MIG-FTHNDR-${String(i).padStart(3, "0")}`
    });
  }

  console.log("3/6 Reading NBE Credit Card V2 live snapshot & >= 2026-11 Mido items...");
  const nbeActiveGrid = readRange(PF_CONFIG.NBE_CREDIT_ID, "Active Bill & Reconciliation!A1:I30", false);
  const nbeForecastGrid = readRange(PF_CONFIG.NBE_CREDIT_ID, "Monthly History & Forecast!A1:M15", false);
  const nbeTxGrid = readRange(PF_CONFIG.NBE_CREDIT_ID, "Transactions!A1:G500", false);
  const nbeInstGrid = readRange(PF_CONFIG.NBE_CREDIT_ID, "Installments!A1:L100", false);

  const nbeSummary = parseNbeActiveBillGrid(nbeActiveGrid, nbeForecastGrid);
  const existingIds = new Set(transactions.map(t => t.sourceId));
  const syncedNbeRows = buildMidoNbeSyncRows({
    txRows: nbeTxGrid,
    instRows: nbeInstGrid,
    existingSourceIds: existingIds,
    syncStartMonth: PF_CONFIG.NBE_SYNC_START_MONTH,
    rules: PF_CONFIG.DEFAULT_CATEGORY_RULES,
    activeCycleMonthKey: "2026-11"
  });
  syncedNbeRows.forEach(r => transactions.push(r));
  console.log(`   Transactions migrated: ${transactions.length} (incl. ${syncedNbeRows.length} from NBE Card >= 2026-11), Loans: ${loans.length}, Family Thndr: ${familyThndr.length}`);

  // Calibrate Opening Bank & Cash Anchors so Nov 2026 ties out to 16,584.16 Bank & 120.00 Cash (0.00 diff)
  const deltaCheck = computeWalletBalances({
    bankAnchor: 0,
    cashAnchor: 0,
    transactions,
    loans,
    investments: personalInvestments
  });
  const calibratedBankAnchor = Math.round((16584.16 - deltaCheck.expectedBank) * 100) / 100;
  const calibratedCashAnchor = Math.round((120.00 - deltaCheck.expectedCash) * 100) / 100;
  console.log(`   Calibrated Anchors -> Bank: ${calibratedBankAnchor.toFixed(2)}, Cash: ${calibratedCashAnchor.toFixed(2)}`);

  console.log("4/6 Structuring tabs in Personal Financials...");
  const existingSheetsList = runGsheets(["readonly", "list-sheets", TARGET_ID, "--json"], true);
  const sheetIdMap = {};
  (existingSheetsList || []).forEach(s => { sheetIdMap[s.title] = s.id !== undefined ? s.id : s.sheetId; });

  const desiredTabs = [
    PF_CONFIG.SHEETS.DASHBOARD,
    PF_CONFIG.SHEETS.TRANSACTIONS,
    PF_CONFIG.SHEETS.LOANS,
    PF_CONFIG.SHEETS.INVESTMENTS,
    PF_CONFIG.SHEETS.BUDGETS,
    PF_CONFIG.SHEETS.YEARLY,
    PF_CONFIG.SHEETS.NBE_CACHE,
    PF_CONFIG.SHEETS.ARCHIVE
  ];

  const setupRequests = [];
  for (const title of desiredTabs) {
    if (sheetIdMap[title] === undefined) {
      setupRequests.push({ addSheet: { properties: { title } } });
    }
  }
  if (setupRequests.length > 0) {
    const addFile = path.join(SCRATCH_DIR, "add_sheets.json");
    fs.writeFileSync(addFile, JSON.stringify({ requests: setupRequests }, null, 2));
    runGsheets(["mutate", "raw-batch", TARGET_ID, "-f", addFile], false);
  }

  const updatedSheets = runGsheets(["readonly", "list-sheets", TARGET_ID, "--json"], true);
  const idByTitle = {};
  updatedSheets.forEach(s => { idByTitle[s.title] = s.id !== undefined ? s.id : s.sheetId; });

  const orgRequests = [];
  if (idByTitle["Sheet1"] !== undefined) {
    orgRequests.push({ deleteSheet: { sheetId: idByTitle["Sheet1"] } });
  }
  desiredTabs.forEach((title, idx) => {
    const isHidden = title === PF_CONFIG.SHEETS.NBE_CACHE || title === PF_CONFIG.SHEETS.ARCHIVE;
    orgRequests.push({
      updateSheetProperties: {
        properties: { sheetId: idByTitle[title], index: idx, hidden: isHidden },
        fields: "index,hidden"
      }
    });
  });
  // Resize Transactions rows if needed
  orgRequests.push({
    updateSheetProperties: {
      properties: { sheetId: idByTitle[PF_CONFIG.SHEETS.TRANSACTIONS], gridProperties: { rowCount: Math.max(1000, transactions.length + 200), columnCount: 12 } },
      fields: "gridProperties.rowCount,gridProperties.columnCount"
    }
  });
  const orgFile = path.join(SCRATCH_DIR, "org_sheets.json");
  fs.writeFileSync(orgFile, JSON.stringify({ requests: orgRequests }, null, 2));
  runGsheets(["mutate", "raw-batch", TARGET_ID, "-f", orgFile], false);

  console.log("5/6 Populating all values & native Formula-First formulas...");
  const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");

  // _Archive_Store data
  const archiveData = [
    ["Anchor Key", "Amount (EGP)"],
    ["Opening Bank Balance (Pre-Ledger Anchor)", calibratedBankAnchor],
    ["Opening Cash Balance (Pre-Ledger Anchor)", calibratedCashAnchor],
    ["Last Updated", nowStr],
    [],
    ["MonthKey", "Year", "Month", "Income", "Savings", "Debt", "Expenses", "Notes"],
    ...archiveRows
  ];

  // _NBE_Cache data
  const nbeCacheData = [
    ["Metric", "Value"],
    ["Active Billing Cycle", nbeSummary.activeCycle || "November 2026"],
    ["Statement Date", nbeSummary.statementDate || "2026-10-31"],
    ["Payment Due Date", nbeSummary.paymentDueDate || "November 27, 2026"],
    ["Payment Status", nbeSummary.paymentStatus || "⏳ Pending Payment"],
    ["Bank Closing Bill", nbeSummary.bankClosingBill],
    ["Mido Active Share Due", nbeSummary.midoShareDue],
    ["Mido Next Month Forecast", nbeSummary.midoNextForecast],
    ["Family Shares Excl Mido", nbeSummary.familyPendingShares],
    ["Last Synced At", nowStr],
    [],
    ["Member", "Purchases", "Installments", "Fees", "Unrecorded", "Credits", "Net Due"],
    ...nbeSummary.memberRows.map(m => [m.member, m.purchases, m.installments, m.fees, m.unrecorded, m.credits, m.netDue])
  ];

  // Budgets & Recurring data
  const budgetsData = [
    ["🎯 Personal Financials — Category Budgets, Recurring Bills & Auto-Rules"],
    ["Edit yellow cells to customize monthly category caps, 80% warning thresholds, and automatic NBE categorization rules."],
    ["📊 Monthly Category Budgets & Alert Thresholds", "", "", "", "", "", "⚙️ General Settings & Alert Target"],
    ["Category", "Monthly Budget (EGP)", "Warning %", "Email Alerts", "Notes", "", "Setting", "Value", "Description"],
    ...PF_CONFIG.DEFAULT_BUDGETS.map((b, idx) => {
      const settings = [
        ["Alert Email", PF_CONFIG.ALERT_EMAIL, "Destination for 80% / 100% budget alerts"],
        ["Target Monthly Savings (EGP)", 5000, "Monthly savings goal on Dashboard"],
        ["NBE Sync Start Month", PF_CONFIG.NBE_SYNC_START_MONTH, "Earliest month to auto-sync Mido card items"],
        ["NBE Credit Card Sheet ID", PF_CONFIG.NBE_CREDIT_ID, "Connected NBE Credit Card V2 spreadsheet"],
        ["Fast-Pace Margin %", 0.15, "Pace alert when % spent exceeds month % + margin"]
      ];
      const s = settings[idx] || ["", "", ""];
      return [b.category, b.budget, b.warnPct, b.emailAlert, b.notes, "", s[0], s[1], s[2]];
    }),
    ["TOTAL MONTHLY BUDGET", "=SUM(B5:B12)", "", "", ""],
    [],
    ["🔁 Monthly Recurring Fixed Bills", "", "", "", "", "", "🏷️ Auto-Category Keyword Rules (NBE Sync)"],
    ["Bill Name", "Category", "Expected (EGP)", "Due Day", "Match Keyword", "", "Keywords (| separated)", "Assigned Category", "Priority"],
    ...Array.from({ length: 8 }, (_, idx) => {
      const rec = PF_CONFIG.DEFAULT_RECURRING[idx];
      const rule = PF_CONFIG.DEFAULT_CATEGORY_RULES[idx];
      return [
        rec ? rec.name : "", rec ? rec.category : "", rec ? rec.expected : "", rec ? rec.dueDay : "", rec ? rec.keyword : "",
        "",
        rule ? rule.keywords : "", rule ? rule.category : "", rule ? rule.priority : ""
      ];
    })
  ];

  // Transactions data
  const txData = [
    ["#", "Date", "Month", "Type", "Category", "Amount (EGP)", "Wallet", "Details", "Notes", "_Source_ID"],
    ...transactions.map((t, idx) => {
      const r = idx + 2;
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
    })
  ];

  // Loans & People data
  const loanSummaryRows = [];
  for (let r = 5; r <= 12; r++) {
    loanSummaryRows.push([
      r === 5 ? '=IFERROR(SORT(UNIQUE(FILTER($C$17:$C$1000,$C$17:$C$1000<>""))),"")' : "",
      `=IF(A${r}="","",SUMIFS($E$17:$E$1000,$C$17:$C$1000,A${r},$D$17:$D$1000,"Lent / Paid for Them"))`,
      `=IF(A${r}="","",SUMIFS($E$17:$E$1000,$C$17:$C$1000,A${r},$D$17:$D$1000,"Repaid to Me"))`,
      `=IF(A${r}="","",B${r}-C${r})`,
      `=IF(A${r}="","",IFERROR(MAXIFS($B$17:$B$1000,$C$17:$C$1000,A${r}),""))`,
      `=IF(A${r}="","",IF(D${r}>0.01,"⏳ Owed to Me",IF(D${r}<-0.01,"🔄 I Owe Them","✅ Settled")))`
    ]);
  }
  const loansData = [
    ["🤝 Loans & People — Personal Receivables & Split-Bill Tracker"],
    ["Every loan given from Bank or Cash reduces your liquid balance automatically while keeping Net Worth intact. Any new person added below appears in the Summary automatically."],
    ["📋 Summary Matrix — Net Owed to Me"],
    ["Person", "Total Lent (+)", "Total Repaid (-)", "Net Owed to Me (EGP)", "Last Activity", "Status"],
    ...loanSummaryRows,
    ["TOTAL OWED TO ME", "=SUM(B5:B12)", "=SUM(C5:C12)", "=SUM(D5:D12)", "", '=IF(D13>0.01,"🟢 Active Receivables","✅ All Settled")'],
    [],
    ["📝 Loan & Repayment Ledger"],
    ["#", "Date", "Person", "Direction", "Amount (EGP)", "Wallet", "Notes", "_Loan_ID"],
    ...loans.map((l, idx) => {
      const r = 17 + idx;
      return [`=IF(B${r}="","",ROW()-16)`, l.date, l.person, l.direction, l.amount, l.wallet, l.notes, l.loanId];
    })
  ];

  // Investments & Thndr data
  const maxInvRows = Math.max(personalInvestments.length, familyThndr.length);
  const invLedgerRows = [];
  for (let i = 0; i < maxInvRows; i++) {
    const r = 13 + i;
    const p = personalInvestments[i];
    const f = familyThndr[i];
    invLedgerRows.push([
      p ? `=IF(B${r}="","",ROW()-12)` : "",
      p ? p.date : "",
      p ? p.asset : "",
      p ? p.action : "",
      p ? p.amount : "",
      p ? p.wallet : "",
      p ? p.notes : "",
      f ? `=IF(I${r}="","",ROW()-12)` : "",
      f ? f.date : "",
      f ? f.person : "",
      f ? f.action : "",
      f ? f.amount : "",
      f ? f.notes : "",
      f ? f.srcId : ""
    ]);
  }
  const investmentsData = [
    ["📈 Investments & Thndr — Personal Portfolio & Family Custodial Tracker"],
    ["Left: Your personal investments (included in Net Worth). Right: Family custodial Thndr funds (excluded from personal Net Worth)."],
    ["💼 Personal Investment Portfolio", "", "", "", "", "", "", "👨‍👩‍👧 Family Custodial Thndr (Separate)"],
    ["Asset", "Units / USD", "Net Principal (EGP)", "Market Value (EGP)", "Profit (EGP)", "ROI %", "", "Person", "Net Transacted (EGP)", "Actual Value (EGP)", "Interest / Profit (EGP)"],
    ["USD Cash", 100, '=SUMIFS($E$13:$E$1000,$C$13:$C$1000,A5,$D$13:$D$1000,"Deposit")-SUMIFS($E$13:$E$1000,$C$13:$C$1000,A5,$D$13:$D$1000,"Withdrawal")', '=B5*GOOGLEFINANCE("CURRENCY:USDEGP")', "=D5-C5", "=IF(C5>0,E5/C5,0)", "", "Dad", '=SUMIFS($L$13:$L$1000,$J$13:$J$1000,H5,$K$13:$K$1000,"Deposit")-SUMIFS($L$13:$L$1000,$J$13:$J$1000,H5,$K$13:$K$1000,"Withdraw")', 30911, "=J5-I5"],
    ["Thndr Cloud", "", '=SUMIFS($E$13:$E$1000,$C$13:$C$1000,A6,$D$13:$D$1000,"Deposit")-SUMIFS($E$13:$E$1000,$C$13:$C$1000,A6,$D$13:$D$1000,"Withdrawal")', 3071, "=D6-C6", "=IF(C6>0,E6/C6,0)", "", "Mum", '=SUMIFS($L$13:$L$1000,$J$13:$J$1000,H6,$K$13:$K$1000,"Deposit")-SUMIFS($L$13:$L$1000,$J$13:$J$1000,H6,$K$13:$K$1000,"Withdraw")', 71422, "=J6-I6"],
    ["Thndr FI Funds", "", '=SUMIFS($E$13:$E$1000,$C$13:$C$1000,A7,$D$13:$D$1000,"Deposit")-SUMIFS($E$13:$E$1000,$C$13:$C$1000,A7,$D$13:$D$1000,"Withdrawal")', 23066, "=D7-C7", "=IF(C7>0,E7/C7,0)", "", "Abdo", '=SUMIFS($L$13:$L$1000,$J$13:$J$1000,H7,$K$13:$K$1000,"Deposit")-SUMIFS($L$13:$L$1000,$J$13:$J$1000,H7,$K$13:$K$1000,"Withdraw")', 0, "=J7-I7"],
    ["TOTAL PERSONAL", "", "=SUM(C5:C7)", "=SUM(D5:D7)", "=SUM(E5:E7)", "=IF(C8>0,E8/C8,0)", "", "TOTAL FAMILY", "=SUM(I5:I7)", "=SUM(J5:J7)", "=SUM(K5:K7)"],
    [], [],
    ["📥 Personal Investment Transactions", "", "", "", "", "", "", "📥 Family Custodial Thndr Transactions"],
    ["#", "Date", "Asset", "Action", "Amount (EGP)", "Wallet", "Notes", "#", "Date", "Person", "Action", "Amount (EGP)", "Notes", "_Src_ID"],
    ...invLedgerRows
  ];

  // Dashboard data
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

  const dashData = [
    ["💰 Personal Financials — Live Monthly Command Center"],
    ["Select Year & Month below. All budgets, pace warnings, Bank/Cash tie-outs, NBE Credit Card dues, and Net Worth update automatically via formulas."],
    ["Active Year:", 2026, "Active Month:", "November", "", "MonthKey:", '=B3&"-"&TEXT(MONTH(DATEVALUE(D3&" 1, "&B3)),"00")', "", "Month Progress:", "", '=IF(TEXT(TODAY(),"yyyy-mm")=G3,DAY(TODAY())/DAY(EOMONTH(DATE(B3,MONTH(DATEVALUE(D3&" 1, "&B3)),1),0)),IF(DATE(B3,MONTH(DATEVALUE(D3&" 1, "&B3)),1)<TODAY(),1,0))', "Target Savings:", "='Budgets & Recurring'!H6", ""],
    [],
    ["Monthly Income", "", "Total Monthly Spend", "", "Monthly Net Saved", "", "Safe-to-Spend / Day", "", "Liquid Bank & Cash", "", "", "Personal Net Worth", "", ""],
    ['=SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Income")', "", '=SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Expense")-SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Reimbursement")', "", "=A6-C6", "", '=IF($K$3>=1,0,MAX(0,(C18-C6))/MAX(1,DAY(EOMONTH(DATE(B3,MONTH(DATEVALUE(D3&" 1, "&B3)),1),0))-IF(TEXT(TODAY(),"yyyy-mm")=G3,DAY(TODAY()),0)))', "", "=K10+K11", "", "", "=I6+'Investments & Thndr'!D8+'Loans & People'!D13-J20", "", ""],
    [],
    ["📊 Category Spending vs. Budget & Alert Status", "", "", "", "", "", "", "", "🏦 Live Bank & Cash Wallet Reconciliation"],
    ["Category", "Actual (EGP)", "Budget (EGP)", "Remaining", "% Used", "Progress", "Alert / Pace", "", "Wallet", "Opening Anchor", "Expected (EGP)", "Actual (Yellow)", "Variance", "Recon Status"],
    ...Array.from({ length: 8 }, (_, i) => {
      const r = 10 + i;
      const br = 5 + i;
      const left = [
        `='Budgets & Recurring'!A${br}`,
        `=SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Expense",Transactions!$E$2:$E,A${r})-SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Reimbursement",Transactions!$E$2:$E,A${r})`,
        `='Budgets & Recurring'!B${br}`,
        `=C${r}-B${r}`,
        `=IF(C${r}>0,B${r}/C${r},0)`,
        `=IF(C${r}<=0,"",SPARKLINE(MIN(E${r},1),{"charttype","bar";"max",1;"color1",IF(E${r}>=1,"#d93025",IF(E${r}>='Budgets & Recurring'!C${br},"#f9ab00","#1b5e20"))}))`,
        `=IF(C${r}<=0,"—",IF(E${r}>=1,"🚨 OVER BUDGET",IF(E${r}>='Budgets & Recurring'!C${br},"⚠️ Near Limit",IF(AND($K$3>0,$K$3<1,E${r}>$K$3+'Budgets & Recurring'!$H$9),"🔥 Fast Pace","✅ On Track"))))`
      ];
      let right = [];
      if (i === 0) right = ["Bank / InstaPay", "='_Archive_Store'!B2", bankExpectedFormula, 16584.16, "=L10-K10", '=IF(ABS(M10)<0.05,"✅ Balanced","⚠️ Diff")'];
      else if (i === 1) right = ["Cash on Hand", "='_Archive_Store'!B3", cashExpectedFormula, 120.00, "=L11-K11", '=IF(ABS(M11)<0.05,"✅ Balanced","⚠️ Diff")'];
      else if (i === 2) right = ["TOTAL LIQUID", "=SUM(J10:J11)", "=SUM(K10:K11)", "=SUM(L10:L11)", "=SUM(M10:M11)", '=IF(ABS(M12)<0.05,"✅ All Tied Out","⚠️ Check Diff")'];
      else if (i === 4) right = ["Month Spend by Wallet:", "Bank / InstaPay", "Cash", "NBE Credit Card", "Loan Receivables", "Personal Invest."];
      else if (i === 5) right = ["=$G$3", '=SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Expense",Transactions!$G$2:$G,"Bank / InstaPay")', '=SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Expense",Transactions!$G$2:$G,"Cash")', '=SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Expense",Transactions!$G$2:$G,"NBE Credit Card")', "='Loans & People'!D13", "='Investments & Thndr'!D8"];
      else if (i === 7) right = ["💳 Live NBE Credit Card V2 & Wealth Snapshot"];
      return [...left, "", ...right];
    }),
    ["TOTAL", "=SUM(B10:B17)", "=SUM(C10:C17)", "=SUM(D10:D17)", "=IF(C18>0,B18/C18,0)", "", '=IF(E18>=1,"🚨 Over Total Budget",IF(E18>=0.8,"⚠️ Near Total Cap","✅ Healthy"))', "", "Metric", "Value", "Detail", "Metric", "Value", "Profit / Status"],
    ["", "", "", "", "", "", "", "", "Active Card Cycle", "='_NBE_Cache'!B2", "='_NBE_Cache'!B5", "USD Cash ($100)", "='Investments & Thndr'!D5", "='Investments & Thndr'!E5"],
    ["🔁 Monthly Recurring Fixed Bills Checklist", "", "", "", "", "", "", "", "Mido Card Share Due", "='_NBE_Cache'!B7", "='_NBE_Cache'!B4", "Thndr Cloud", "='Investments & Thndr'!D6", "='Investments & Thndr'!E6"],
    ["Bill Name", "Category", "Expected (EGP)", "Paid This Month", "Due Day", "Match Keyword", "Status", "", "Mido Next Forecast", "='_NBE_Cache'!B8", "Next Cycle Est.", "Thndr FI Funds", "='Investments & Thndr'!D7", "='Investments & Thndr'!E7"],
    ...Array.from({ length: 7 }, (_, i) => {
      const r = 22 + i;
      const rr = 17 + i;
      const left = [
        `='Budgets & Recurring'!A${rr}`,
        `='Budgets & Recurring'!B${rr}`,
        `='Budgets & Recurring'!C${rr}`,
        `=SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"Expense",Transactions!$H$2:$H,"*"&F${r}&"*")`,
        `='Budgets & Recurring'!D${rr}`,
        `='Budgets & Recurring'!E${rr}`,
        `=IF(D${r}>=C${r}*0.5,"✅ Paid",IF(AND($K$3>0,DAY(TODAY())>E${r}),"⏰ Due / Check","⏳ Upcoming"))`
      ];
      let right = [];
      if (i === 0) right = ["Total Bank Closing Bill", "='_NBE_Cache'!B6", "Full Card Statement", "Abdo Loan Owed", "='Loans & People'!D5", "='Loans & People'!F5"];
      else if (i === 1) right = ["Family Shares (Excl Mido)", "='_NBE_Cache'!B9", "='_NBE_Cache'!B10", "Dad & Others", "='Loans & People'!D13-'Loans & People'!D5", '=IF(M23>0,"⏳ Pending","✅ Settled")'];
      return [...left, "", ...right];
    })
  ];

  // Yearly & Analytics data
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
  const lastTimelineRow = 4 + timeline.length;
  const years = [2024, 2025, 2026, 2027];
  const yearlyData = [
    ["📅 Yearly Summary & Visual Analytics (2024–2027)"],
    ["Historical totals (Jun 2024–Mar 2026) from _Archive_Store seamlessly combined with live formula rollups (Apr 2026+) from Transactions."],
    ["📆 Monthly Historical & Live Ledger Rollup", "", "", "", "", "", "", "", "📊 Annual Totals Summary"],
    ["MonthKey", "Year", "Month", "Income (EGP)", "Expenses (EGP)", "Net Cash Flow", "Cumulative Flow", "", "Year", "Total Income", "Total Expenses", "Net Cash Flow", "Savings Rate %", "Archive Savings"],
    ...timeline.map((row, idx) => {
      if (idx < years.length) {
        const y = years[idx];
        const r = 5 + idx;
        return [
          ...row,
          "",
          y,
          `=SUMIFS($D$5:$D$${lastTimelineRow},$B$5:$B$${lastTimelineRow},I${r})`,
          `=SUMIFS($E$5:$E$${lastTimelineRow},$B$5:$B$${lastTimelineRow},I${r})`,
          `=J${r}-K${r}`,
          `=IF(J${r}>0,L${r}/J${r},0)`,
          `=IF(I${r}<=2026,SUMIFS('_Archive_Store'!$E$7:$E$28,'_Archive_Store'!$B$7:$B$28,I${r}),0)`
        ];
      }
      return row;
    })
  ];

  const batchPayload = [
    { op: "write", range: `'${PF_CONFIG.SHEETS.ARCHIVE}'!A1`, data: archiveData },
    { op: "write", range: `'${PF_CONFIG.SHEETS.NBE_CACHE}'!A1`, data: nbeCacheData },
    { op: "write", range: `'${PF_CONFIG.SHEETS.BUDGETS}'!A1`, data: budgetsData },
    { op: "write", range: `'${PF_CONFIG.SHEETS.TRANSACTIONS}'!A1`, data: txData },
    { op: "write", range: `'${PF_CONFIG.SHEETS.LOANS}'!A1`, data: loansData },
    { op: "write", range: `'${PF_CONFIG.SHEETS.INVESTMENTS}'!A1`, data: investmentsData },
    { op: "write", range: `'${PF_CONFIG.SHEETS.DASHBOARD}'!A1`, data: dashData },
    { op: "write", range: `'${PF_CONFIG.SHEETS.YEARLY}'!A1`, data: yearlyData }
  ];
  const batchFile = path.join(SCRATCH_DIR, "write_all.json");
  fs.writeFileSync(batchFile, JSON.stringify(batchPayload, null, 2));
  runGsheets(["mutate", "batch", TARGET_ID, "-f", batchFile], false);

  console.log("6/6 Applying formatting, validations, conditional rules, widths, and 3 native charts...");
  const hex = h => {
    const clean = h.replace("#", "");
    return {
      red: parseInt(clean.slice(0, 2), 16) / 255,
      green: parseInt(clean.slice(2, 4), 16) / 255,
      blue: parseInt(clean.slice(4, 6), 16) / 255
    };
  };
  const C = PF_CONFIG.COLORS;
  const reqs = [];

  const merge = (shId, r1, r2, c1, c2) => reqs.push({ mergeCells: { range: { sheetId: shId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 }, mergeType: "MERGE_ALL" } });
  const style = (shId, r1, r2, c1, c2, cell, fields) => reqs.push({ repeatCell: { range: { sheetId: shId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 }, cell, fields } });
  const numFmt = (shId, r1, r2, c1, c2, pattern, type = "NUMBER") => style(shId, r1, r2, c1, c2, { userEnteredFormat: { numberFormat: { type, pattern } } }, "userEnteredFormat.numberFormat");
  const bg = (shId, r1, r2, c1, c2, colorHex) => style(shId, r1, r2, c1, c2, { userEnteredFormat: { backgroundColor: hex(colorHex) } }, "userEnteredFormat.backgroundColor");
  const banner = (shId, cols, widths, freezeRows) => {
    merge(shId, 0, 1, 0, cols);
    merge(shId, 1, 2, 0, cols);
    style(shId, 0, 1, 0, cols, { userEnteredFormat: { backgroundColor: hex(C.PRIMARY), textFormat: { foregroundColor: hex("#ffffff"), bold: true, fontSize: 13 }, verticalAlignment: "MIDDLE" } }, "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)");
    style(shId, 1, 2, 0, cols, { userEnteredFormat: { textFormat: { italic: true, fontSize: 9, foregroundColor: hex(C.TEXT_MUTED) } } }, "userEnteredFormat.textFormat");
    reqs.push({ updateSheetProperties: { properties: { sheetId: shId, gridProperties: { frozenRowCount: freezeRows } }, fields: "gridProperties.frozenRowCount" } });
    widths.forEach((w, idx) => reqs.push({ updateDimensionProperties: { range: { sheetId: shId, dimension: "COLUMNS", startIndex: idx, endIndex: idx + 1 }, properties: { pixelSize: w }, fields: "pixelSize" } }));
  };

  // Dashboard styling
  const dId = idByTitle[PF_CONFIG.SHEETS.DASHBOARD];
  banner(dId, 14, [165, 110, 115, 110, 75, 115, 135, 22, 180, 115, 145, 130, 115, 125], 3);
  bg(dId, 2, 3, 0, 14, C.PRIMARY_LIGHT);
  style(dId, 2, 3, 0, 14, { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 }, verticalAlignment: "MIDDLE" } }, "userEnteredFormat(textFormat,verticalAlignment)");
  bg(dId, 2, 3, 1, 2, C.INPUT_BG);
  bg(dId, 2, 3, 3, 4, C.INPUT_BG);
  numFmt(dId, 2, 3, 10, 11, "0.0%", "PERCENT");
  numFmt(dId, 2, 3, 12, 13, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");
  merge(dId, 4, 5, 0, 2); merge(dId, 4, 5, 2, 4); merge(dId, 4, 5, 4, 6); merge(dId, 4, 5, 6, 8); merge(dId, 4, 5, 8, 11); merge(dId, 4, 5, 11, 14);
  merge(dId, 5, 6, 0, 2); merge(dId, 5, 6, 2, 4); merge(dId, 5, 6, 4, 6); merge(dId, 5, 6, 6, 8); merge(dId, 5, 6, 8, 11); merge(dId, 5, 6, 11, 14);
  style(dId, 4, 5, 0, 14, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 }, horizontalAlignment: "CENTER" } }, "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)");
  style(dId, 5, 6, 0, 14, { userEnteredFormat: { backgroundColor: hex("#ffffff"), textFormat: { bold: true, fontSize: 12 }, horizontalAlignment: "CENTER", numberFormat: { type: "CURRENCY", pattern: PF_CONFIG.CURRENCY_FORMAT } } }, "userEnteredFormat");
  merge(dId, 7, 8, 0, 7); merge(dId, 7, 8, 8, 14);
  bg(dId, 7, 8, 0, 7, C.PRIMARY_LIGHT); bg(dId, 7, 8, 8, 14, C.PRIMARY_LIGHT);
  style(dId, 7, 8, 0, 14, { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 } } }, "userEnteredFormat.textFormat");
  style(dId, 8, 9, 0, 7, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 } } }, "userEnteredFormat(backgroundColor,textFormat)");
  style(dId, 8, 9, 8, 14, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 } } }, "userEnteredFormat(backgroundColor,textFormat)");
  numFmt(dId, 9, 18, 1, 4, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");
  numFmt(dId, 9, 18, 4, 5, "0.0%", "PERCENT");
  style(dId, 17, 18, 0, 7, { userEnteredFormat: { backgroundColor: hex(C.SUBHEADER), textFormat: { bold: true } } }, "userEnteredFormat(backgroundColor,textFormat)");
  bg(dId, 9, 11, 11, 12, C.INPUT_BG);
  numFmt(dId, 9, 12, 9, 13, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");
  style(dId, 11, 12, 8, 14, { userEnteredFormat: { backgroundColor: hex(C.SUBHEADER), textFormat: { bold: true } } }, "userEnteredFormat(backgroundColor,textFormat)");
  style(dId, 13, 14, 8, 14, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 } } }, "userEnteredFormat(backgroundColor,textFormat)");
  numFmt(dId, 14, 15, 9, 14, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");
  merge(dId, 16, 17, 8, 14);
  bg(dId, 16, 17, 8, 14, C.INFO_BG);
  style(dId, 16, 17, 8, 14, { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 } } }, "userEnteredFormat.textFormat");
  style(dId, 17, 18, 8, 14, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 } } }, "userEnteredFormat(backgroundColor,textFormat)");
  numFmt(dId, 19, 23, 9, 10, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");
  numFmt(dId, 18, 23, 12, 13, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");
  numFmt(dId, 18, 22, 13, 14, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");
  merge(dId, 19, 20, 0, 7);
  bg(dId, 19, 20, 0, 7, C.PRIMARY_LIGHT);
  style(dId, 19, 20, 0, 7, { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 } } }, "userEnteredFormat.textFormat");
  style(dId, 20, 21, 0, 7, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 } } }, "userEnteredFormat(backgroundColor,textFormat)");
  numFmt(dId, 21, 28, 2, 4, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");

  // Clear existing conditional formats on Dashboard and existing charts on Yearly so re-runs are 100% idempotent
  const ssInfo = runGsheets(["readonly", "info", TARGET_ID, "--json"], true);
  (ssInfo.sheets || []).forEach(sh => {
    const shId = sh.properties && sh.properties.sheetId;
    if (shId === dId && Array.isArray(sh.conditionalFormats)) {
      for (let ci = sh.conditionalFormats.length - 1; ci >= 0; ci--) {
        reqs.push({ deleteConditionalFormatRule: { sheetId: dId, index: ci } });
      }
    }
    if (shId === idByTitle[PF_CONFIG.SHEETS.YEARLY] && Array.isArray(sh.charts)) {
      sh.charts.forEach(ch => {
        reqs.push({ deleteEmbeddedObject: { objectId: ch.chartId } });
      });
    }
  });

  // Dashboard validations & conditional formatting
  reqs.push({ setDataValidation: { range: { sheetId: dId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 2 }, rule: { condition: { type: "ONE_OF_LIST", values: ["2024", "2025", "2026", "2027"].map(v => ({ userEnteredValue: v })) }, showCustomUi: true } } });
  reqs.push({ setDataValidation: { range: { sheetId: dId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 3, endColumnIndex: 4 }, rule: { condition: { type: "ONE_OF_LIST", values: PF_CONFIG.MONTH_NAMES.map(v => ({ userEnteredValue: v })) }, showCustomUi: true } } });
  [
    ["OVER BUDGET", C.ALERT_BG, C.ALERT_FG, 9, 18, 6, 7],
    ["Near Limit", C.WARN_BG, C.WARN_FG, 9, 18, 6, 7],
    ["Fast Pace", C.WARN_BG, C.WARN_FG, 9, 18, 6, 7],
    ["On Track", C.OK_BG, C.OK_FG, 9, 18, 6, 7],
    ["Balanced", C.OK_BG, C.OK_FG, 9, 12, 13, 14],
    ["Tied Out", C.OK_BG, C.OK_FG, 9, 12, 13, 14],
    ["Diff", C.ALERT_BG, C.ALERT_FG, 9, 12, 13, 14]
  ].forEach(([txt, bgHex, fgHex, r1, r2, c1, c2]) => {
    reqs.push({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [{ sheetId: dId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 }],
          booleanRule: {
            condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: txt }] },
            format: { backgroundColor: hex(bgHex), textFormat: { foregroundColor: hex(fgHex), bold: true } }
          }
        }
      }
    });
  });

  // Transactions styling
  const tId = idByTitle[PF_CONFIG.SHEETS.TRANSACTIONS];
  style(tId, 0, 1, 0, 10, { userEnteredFormat: { backgroundColor: hex(C.PRIMARY), textFormat: { foregroundColor: hex("#ffffff"), bold: true, fontSize: 10 }, verticalAlignment: "MIDDLE" } }, "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)");
  reqs.push({ updateSheetProperties: { properties: { sheetId: tId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } });
  [45, 105, 85, 130, 125, 125, 135, 240, 220, 155].forEach((w, idx) => reqs.push({ updateDimensionProperties: { range: { sheetId: tId, dimension: "COLUMNS", startIndex: idx, endIndex: idx + 1 }, properties: { pixelSize: w }, fields: "pixelSize" } }));
  numFmt(tId, 1, 1000, 1, 2, "yyyy-mm-dd", "DATE");
  numFmt(tId, 1, 1000, 5, 6, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");
  style(tId, 1, 1000, 9, 10, { userEnteredFormat: { textFormat: { foregroundColor: hex(C.TEXT_MUTED), fontSize: 8 } } }, "userEnteredFormat.textFormat");
  reqs.push({ setDataValidation: { range: { sheetId: tId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 3, endColumnIndex: 4 }, rule: { condition: { type: "ONE_OF_LIST", values: PF_CONFIG.TX_TYPES.map(v => ({ userEnteredValue: v })) }, showCustomUi: true } } });
  reqs.push({ setDataValidation: { range: { sheetId: tId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 4, endColumnIndex: 5 }, rule: { condition: { type: "ONE_OF_LIST", values: PF_CONFIG.TX_CATEGORIES.map(v => ({ userEnteredValue: v })) }, showCustomUi: true } } });
  reqs.push({ setDataValidation: { range: { sheetId: tId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 6, endColumnIndex: 7 }, rule: { condition: { type: "ONE_OF_LIST", values: PF_CONFIG.WALLETS.map(v => ({ userEnteredValue: v })) }, showCustomUi: true } } });

  // Loans styling
  const lId = idByTitle[PF_CONFIG.SHEETS.LOANS];
  banner(lId, 8, [135, 110, 125, 170, 130, 145, 250, 155], 16);
  merge(lId, 2, 3, 0, 6); bg(lId, 2, 3, 0, 6, C.PRIMARY_LIGHT); style(lId, 2, 3, 0, 6, { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 } } }, "userEnteredFormat.textFormat");
  style(lId, 3, 4, 0, 6, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 } } }, "userEnteredFormat(backgroundColor,textFormat)");
  numFmt(lId, 4, 13, 1, 4, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");
  numFmt(lId, 4, 12, 4, 5, "yyyy-mm-dd", "DATE");
  style(lId, 12, 13, 0, 6, { userEnteredFormat: { backgroundColor: hex(C.SUBHEADER), textFormat: { bold: true } } }, "userEnteredFormat(backgroundColor,textFormat)");
  merge(lId, 14, 15, 0, 8); bg(lId, 14, 15, 0, 8, C.PRIMARY_LIGHT); style(lId, 14, 15, 0, 8, { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 } } }, "userEnteredFormat.textFormat");
  style(lId, 15, 16, 0, 8, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 } } }, "userEnteredFormat(backgroundColor,textFormat)");
  numFmt(lId, 16, 1000, 1, 2, "yyyy-mm-dd", "DATE");
  numFmt(lId, 16, 1000, 4, 5, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");
  reqs.push({ setDataValidation: { range: { sheetId: lId, startRowIndex: 16, endRowIndex: 1000, startColumnIndex: 3, endColumnIndex: 4 }, rule: { condition: { type: "ONE_OF_LIST", values: PF_CONFIG.LOAN_DIRECTIONS.map(v => ({ userEnteredValue: v })) }, showCustomUi: true } } });
  reqs.push({ setDataValidation: { range: { sheetId: lId, startRowIndex: 16, endRowIndex: 1000, startColumnIndex: 5, endColumnIndex: 6 }, rule: { condition: { type: "ONE_OF_LIST", values: PF_CONFIG.LOAN_WALLETS.map(v => ({ userEnteredValue: v })) }, showCustomUi: true } } });

  // Investments styling
  const iId = idByTitle[PF_CONFIG.SHEETS.INVESTMENTS];
  banner(iId, 14, [125, 100, 135, 135, 120, 120, 160, 135, 135, 135, 140, 120, 175, 125], 12);
  merge(iId, 2, 3, 0, 6); bg(iId, 2, 3, 0, 6, C.PRIMARY_LIGHT); style(iId, 2, 3, 0, 6, { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 } } }, "userEnteredFormat.textFormat");
  merge(iId, 2, 3, 7, 11); bg(iId, 2, 3, 7, 11, C.INFO_BG); style(iId, 2, 3, 7, 11, { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 } } }, "userEnteredFormat.textFormat");
  style(iId, 3, 4, 0, 6, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 } } }, "userEnteredFormat(backgroundColor,textFormat)");
  style(iId, 3, 4, 7, 11, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 } } }, "userEnteredFormat(backgroundColor,textFormat)");
  numFmt(iId, 4, 5, 1, 2, PF_CONFIG.USD_FORMAT, "CURRENCY"); bg(iId, 4, 5, 1, 2, C.INPUT_BG);
  bg(iId, 5, 7, 3, 4, C.INPUT_BG); bg(iId, 4, 7, 9, 10, C.INPUT_BG);
  numFmt(iId, 4, 8, 2, 5, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");
  numFmt(iId, 4, 8, 5, 6, "0.0%", "PERCENT");
  numFmt(iId, 4, 8, 8, 11, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");
  style(iId, 7, 8, 0, 6, { userEnteredFormat: { backgroundColor: hex(C.SUBHEADER), textFormat: { bold: true } } }, "userEnteredFormat(backgroundColor,textFormat)");
  style(iId, 7, 8, 7, 11, { userEnteredFormat: { backgroundColor: hex(C.SUBHEADER), textFormat: { bold: true } } }, "userEnteredFormat(backgroundColor,textFormat)");
  merge(iId, 10, 11, 0, 7); bg(iId, 10, 11, 0, 7, C.PRIMARY_LIGHT); style(iId, 10, 11, 0, 7, { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 } } }, "userEnteredFormat.textFormat");
  merge(iId, 10, 11, 7, 14); bg(iId, 10, 11, 7, 14, C.INFO_BG); style(iId, 10, 11, 7, 14, { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 } } }, "userEnteredFormat.textFormat");
  style(iId, 11, 12, 0, 14, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 } } }, "userEnteredFormat(backgroundColor,textFormat)");
  numFmt(iId, 12, 500, 1, 2, "yyyy-mm-dd", "DATE"); numFmt(iId, 12, 500, 4, 5, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");
  numFmt(iId, 12, 500, 8, 9, "yyyy-mm-dd", "DATE"); numFmt(iId, 12, 500, 11, 12, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");

  // Budgets styling
  const bId = idByTitle[PF_CONFIG.SHEETS.BUDGETS];
  banner(bId, 9, [175, 150, 95, 95, 250, 22, 235, 265, 230], 4);
  merge(bId, 2, 3, 0, 5); bg(bId, 2, 3, 0, 5, C.PRIMARY_LIGHT); style(bId, 2, 3, 0, 5, { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 } } }, "userEnteredFormat.textFormat");
  merge(bId, 2, 3, 6, 9); bg(bId, 2, 3, 6, 9, C.PRIMARY_LIGHT); style(bId, 2, 3, 6, 9, { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 } } }, "userEnteredFormat.textFormat");
  style(bId, 3, 4, 0, 5, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 } } }, "userEnteredFormat(backgroundColor,textFormat)");
  style(bId, 3, 4, 6, 9, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 } } }, "userEnteredFormat(backgroundColor,textFormat)");
  numFmt(bId, 4, 13, 1, 2, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY"); bg(bId, 4, 12, 1, 3, C.INPUT_BG);
  numFmt(bId, 4, 12, 2, 3, "0%", "PERCENT");
  style(bId, 4, 12, 3, 4, { dataValidation: { condition: { type: "BOOLEAN" } } }, "dataValidation");
  style(bId, 12, 13, 0, 5, { userEnteredFormat: { backgroundColor: hex(C.SUBHEADER), textFormat: { bold: true } } }, "userEnteredFormat(backgroundColor,textFormat)");
  bg(bId, 4, 9, 7, 8, C.INPUT_BG); numFmt(bId, 5, 6, 7, 8, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY"); numFmt(bId, 8, 9, 7, 8, "0%", "PERCENT");
  merge(bId, 14, 15, 0, 5); bg(bId, 14, 15, 0, 5, C.PRIMARY_LIGHT); style(bId, 14, 15, 0, 5, { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 } } }, "userEnteredFormat.textFormat");
  merge(bId, 14, 15, 6, 9); bg(bId, 14, 15, 6, 9, C.PRIMARY_LIGHT); style(bId, 14, 15, 6, 9, { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 } } }, "userEnteredFormat.textFormat");
  style(bId, 15, 16, 0, 5, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 } } }, "userEnteredFormat(backgroundColor,textFormat)");
  style(bId, 15, 16, 6, 9, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 } } }, "userEnteredFormat(backgroundColor,textFormat)");
  numFmt(bId, 16, 23, 2, 3, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY"); bg(bId, 16, 23, 2, 3, C.INPUT_BG);

  // Yearly & Analytics styling + 3 Charts
  const yId = idByTitle[PF_CONFIG.SHEETS.YEARLY];
  banner(yId, 14, [85, 60, 95, 120, 120, 120, 125, 22, 65, 115, 115, 115, 95, 115], 4);
  merge(yId, 2, 3, 0, 7); bg(yId, 2, 3, 0, 7, C.PRIMARY_LIGHT); style(yId, 2, 3, 0, 7, { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 } } }, "userEnteredFormat.textFormat");
  merge(yId, 2, 3, 8, 14); bg(yId, 2, 3, 8, 14, C.PRIMARY_LIGHT); style(yId, 2, 3, 8, 14, { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 } } }, "userEnteredFormat.textFormat");
  style(yId, 3, 4, 0, 7, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 } } }, "userEnteredFormat(backgroundColor,textFormat)");
  style(yId, 3, 4, 8, 14, { userEnteredFormat: { backgroundColor: hex(C.HEADER), textFormat: { bold: true, fontSize: 9 } } }, "userEnteredFormat(backgroundColor,textFormat)");
  numFmt(yId, 4, lastTimelineRow, 3, 7, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");
  numFmt(yId, 4, 8, 9, 12, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");
  numFmt(yId, 4, 8, 13, 14, PF_CONFIG.CURRENCY_FORMAT, "CURRENCY");
  numFmt(yId, 4, 8, 12, 13, "0.0%", "PERCENT");

  // Add 3 native charts on Yearly & Analytics
  reqs.push({
    addChart: {
      chart: {
        spec: {
          title: "2026 Monthly Income vs. Expenses (EGP)",
          basicChart: {
            chartType: "COLUMN",
            legendPosition: "TOP_LEGEND",
            headerCount: 0,
            domains: [{ domain: { sourceRange: { sources: [{ sheetId: yId, startRowIndex: 23, endRowIndex: 35, startColumnIndex: 2, endColumnIndex: 3 }] } } }],
            series: [
              { series: { sourceRange: { sources: [{ sheetId: yId, startRowIndex: 23, endRowIndex: 35, startColumnIndex: 3, endColumnIndex: 4 }] } }, color: hex("#1b5e20") },
              { series: { sourceRange: { sources: [{ sheetId: yId, startRowIndex: 23, endRowIndex: 35, startColumnIndex: 4, endColumnIndex: 5 }] } }, color: hex("#d93025") }
            ]
          }
        },
        position: { overlayPosition: { anchorCell: { sheetId: yId, rowIndex: 10, columnIndex: 8 }, widthPixels: 630, heightPixels: 260 } }
      }
    }
  });
  reqs.push({
    addChart: {
      chart: {
        spec: {
          title: "Active Month: Actual vs. Budget by Category",
          basicChart: {
            chartType: "BAR",
            legendPosition: "TOP_LEGEND",
            headerCount: 1,
            domains: [{ domain: { sourceRange: { sources: [{ sheetId: dId, startRowIndex: 8, endRowIndex: 17, startColumnIndex: 0, endColumnIndex: 1 }] } } }],
            series: [
              { series: { sourceRange: { sources: [{ sheetId: dId, startRowIndex: 8, endRowIndex: 17, startColumnIndex: 1, endColumnIndex: 2 }] } }, color: hex("#1967d2") },
              { series: { sourceRange: { sources: [{ sheetId: dId, startRowIndex: 8, endRowIndex: 17, startColumnIndex: 2, endColumnIndex: 3 }] } }, color: hex("#bdc1c6") }
            ]
          }
        },
        position: { overlayPosition: { anchorCell: { sheetId: yId, rowIndex: 24, columnIndex: 8 }, widthPixels: 630, heightPixels: 260 } }
      }
    }
  });
  reqs.push({
    addChart: {
      chart: {
        spec: {
          title: "Cumulative Cash Flow Growth (2024–2026)",
          basicChart: {
            chartType: "AREA",
            legendPosition: "NO_LEGEND",
            headerCount: 1,
            domains: [{ domain: { sourceRange: { sources: [{ sheetId: yId, startRowIndex: 3, endRowIndex: 35, startColumnIndex: 0, endColumnIndex: 1 }] } } }],
            series: [
              { series: { sourceRange: { sources: [{ sheetId: yId, startRowIndex: 3, endRowIndex: 35, startColumnIndex: 6, endColumnIndex: 7 }] } }, color: hex("#1b5e20") }
            ]
          }
        },
        position: { overlayPosition: { anchorCell: { sheetId: yId, rowIndex: 38, columnIndex: 8 }, widthPixels: 630, heightPixels: 260 } }
      }
    }
  });

  const fmtFile = path.join(SCRATCH_DIR, "format_all.json");
  fs.writeFileSync(fmtFile, JSON.stringify({ requests: reqs }, null, 2));
  runGsheets(["mutate", "raw-batch", TARGET_ID, "-f", fmtFile], false);

  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
  console.log("✅ Personal Financials built, migrated, calibrated, formatted, and charted!");
}

main();
