const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { PF_CONFIG } = require("../src/Config");

const TARGET_ID = PF_CONFIG.MASTER_SPREADSHEET_ID;
const SCRATCH_DIR = path.resolve(__dirname, "..", ".tmp_upgrade");

function runGsheets(args, isJson = true) {
  const env = { ...process.env, AGY_ACCOUNT: "muhammad.essam811@gmail.com" };
  const quoted = args.map(a => (/[\s&!]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : a));
  const out = execFileSync("gsheets.cmd", quoted, { env, encoding: "utf8", maxBuffer: 25 * 1024 * 1024, shell: true });
  return isJson ? JSON.parse(out) : out;
}

function hex(h) {
  const clean = h.replace("#", "");
  return {
    red: parseInt(clean.slice(0, 2), 16) / 255,
    green: parseInt(clean.slice(2, 4), 16) / 255,
    blue: parseInt(clean.slice(4, 6), 16) / 255
  };
}

function main() {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  const sheetsList = runGsheets(["readonly", "list-sheets", TARGET_ID, "--json"], true);
  const idByTitle = {};
  sheetsList.forEach(s => { idByTitle[s.title] = s.id !== undefined ? s.id : s.sheetId; });

  const oldInvTitle = idByTitle["Investments & Thndr"] !== undefined ? "Investments & Thndr" : "Investments";
  const invId = idByTitle[oldInvTitle];
  const txId = idByTitle[PF_CONFIG.SHEETS.TRANSACTIONS];
  const loanId = idByTitle[PF_CONFIG.SHEETS.LOANS];
  const budId = idByTitle[PF_CONFIG.SHEETS.BUDGETS];

  if (invId === undefined || txId === undefined || loanId === undefined || budId === undefined) {
    throw new Error("Missing expected sheet IDs: " + JSON.stringify(idByTitle));
  }

  console.log("1/4 Renaming Investments tab, removing Family Thndr columns (H:N), and updating banner...");
  const prepReqs = [];
  if (oldInvTitle !== "Investments") {
    prepReqs.push({
      updateSheetProperties: {
        properties: { sheetId: invId, title: "Investments" },
        fields: "title"
      }
    });
  }
  // Unmerge old A1:N1, A2:N2, H3:K3, H11:N11
  [
    [0, 1, 0, 14],
    [1, 2, 0, 14],
    [2, 3, 7, 11],
    [10, 11, 7, 14]
  ].forEach(([r1, r2, c1, c2]) => {
    prepReqs.push({
      unmergeCells: {
        range: { sheetId: invId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 }
      }
    });
  });

  const prepFile = path.join(SCRATCH_DIR, "prep.json");
  fs.writeFileSync(prepFile, JSON.stringify({ requests: prepReqs }, null, 2));
  runGsheets(["mutate", "raw-batch", TARGET_ID, "-f", prepFile], false);

  // Clear H1:N1000 on Investments
  runGsheets(["mutate", "clear", TARGET_ID, "'Investments'!H1:N1000"], false);

  console.log("2/4 Reading live populated row counts so zero user entries are touched...");
  const txB = runGsheets(["readonly", "read", TARGET_ID, "Transactions!A2:B1000", "--json"], true);
  let lastTxDataRow = 1;
  txB.forEach((r, idx) => {
    if (String(r[1] || "").trim() !== "") lastTxDataRow = idx + 2;
  });

  const loanB = runGsheets(["readonly", "read", TARGET_ID, "'Loans & People'!A17:B500", "--json"], true);
  let lastLoanDataRow = 16;
  loanB.forEach((r, idx) => {
    if (String(r[1] || "").trim() !== "") lastLoanDataRow = idx + 17;
  });

  const invAB = runGsheets(["readonly", "read", TARGET_ID, "'Investments'!A13:B500", "--json"], true);
  let lastInvDataRow = 12;
  invAB.forEach((r, idx) => {
    if (String(r[1] || "").trim() !== "") lastInvDataRow = idx + 13;
  });
  console.log(`   Last populated rows -> Transactions: ${lastTxDataRow}, Loans: ${lastLoanDataRow}, Investments: ${lastInvDataRow}`);

  console.log("3/4 Updating Personal Investments formulas and pre-filling helper formulas in empty rows...");
  const invSumFormulas = [5, 6, 7].map(r => [
    `=MAX(0,SUMIFS($E$13:$E$1000,$C$13:$C$1000,A${r},$D$13:$D$1000,"Deposit")-SUMIFS($E$13:$E$1000,$C$13:$C$1000,A${r},$D$13:$D$1000,"Withdrawal"))`
  ]);
  const invProfitRoi = [5, 6, 7].map(r => [
    `=D${r}+SUMIFS($E$13:$E$1000,$C$13:$C$1000,A${r},$D$13:$D$1000,"Withdrawal")-SUMIFS($E$13:$E$1000,$C$13:$C$1000,A${r},$D$13:$D$1000,"Deposit")`,
    `=IF(SUMIFS($E$13:$E$1000,$C$13:$C$1000,A${r},$D$13:$D$1000,"Deposit")>0,E${r}/SUMIFS($E$13:$E$1000,$C$13:$C$1000,A${r},$D$13:$D$1000,"Deposit"),0)`
  ]);

  const batchOps = [
    { op: "write", range: "'Investments'!A1:A2", data: [
      ["📈 Personal Investments — USD & Thndr Portfolio"],
      ["Track your personal USD & Thndr positions. Deposits/Withdrawals from Bank or Cash update Expected Bank/Cash automatically; edit yellow cells to update market value."]
    ]},
    { op: "write", range: "'Investments'!E4", data: [["Total Profit (EGP)"]] },
    { op: "write", range: "'Investments'!C5:C7", data: invSumFormulas },
    { op: "write", range: "'Investments'!E5:F7", data: invProfitRoi }
  ];

  // Fill Investments A13:A500 where A is currently blank (preserves Date/Asset/Action/Amount/Wallet/Notes!)
  const invColAFills = [];
  for (let r = 13; r <= 500; r++) {
    invColAFills.push([`=IF(B${r}="","",ROW()-12)`]);
  }
  batchOps.push({ op: "write", range: "'Investments'!A13:A500", data: invColAFills });

  // Fill Transactions empty rows below lastTxDataRow
  const txStartEmpty = lastTxDataRow + 1;
  if (txStartEmpty <= 1000) {
    const txA = [];
    const txC = [];
    for (let r = txStartEmpty; r <= 1000; r++) {
      txA.push([`=IF(B${r}="","",ROW()-1)`]);
      txC.push([`=IF(B${r}="","",TEXT(B${r},"yyyy-mm"))`]);
    }
    batchOps.push({ op: "write", range: `Transactions!A${txStartEmpty}:A1000`, data: txA });
    batchOps.push({ op: "write", range: `Transactions!C${txStartEmpty}:C1000`, data: txC });
  }

  // Fill Loans empty rows below lastLoanDataRow
  const loanStartEmpty = lastLoanDataRow + 1;
  if (loanStartEmpty <= 500) {
    const loanA = [];
    for (let r = loanStartEmpty; r <= 500; r++) {
      loanA.push([`=IF(B${r}="","",ROW()-16)`]);
    }
    batchOps.push({ op: "write", range: `'Loans & People'!A${loanStartEmpty}:A500`, data: loanA });
  }

  const batchFile = path.join(SCRATCH_DIR, "write_updates.json");
  fs.writeFileSync(batchFile, JSON.stringify(batchOps, null, 2));
  runGsheets(["mutate", "batch", TARGET_ID, "-f", batchFile], false);

  console.log("4/4 Applying dropdowns, date pickers, and clean 7-column Investments layout...");
  const C = PF_CONFIG.COLORS;
  const reqs = [];

  // Investments clean 7-col layout (trim columns H:Z -> keep 8 cols A:H)
  reqs.push({
    updateSheetProperties: {
      properties: { sheetId: invId, gridProperties: { columnCount: 8, frozenRowCount: 12 } },
      fields: "gridProperties.columnCount,gridProperties.frozenRowCount"
    }
  });
  reqs.push({ mergeCells: { range: { sheetId: invId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 }, mergeType: "MERGE_ALL" } });
  reqs.push({ mergeCells: { range: { sheetId: invId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 7 }, mergeType: "MERGE_ALL" } });
  reqs.push({
    repeatCell: {
      range: { sheetId: invId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
      cell: { userEnteredFormat: { backgroundColor: hex(C.PRIMARY), textFormat: { foregroundColor: hex("#ffffff"), bold: true, fontSize: 13 }, verticalAlignment: "MIDDLE" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)"
    }
  });
  reqs.push({
    repeatCell: {
      range: { sheetId: invId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 7 },
      cell: { userEnteredFormat: { textFormat: { italic: true, fontSize: 9, foregroundColor: hex(C.TEXT_MUTED) } } },
      fields: "userEnteredFormat.textFormat"
    }
  });
  [75, 115, 145, 135, 135, 150, 240, 24].forEach((w, idx) => {
    reqs.push({
      updateDimensionProperties: {
        range: { sheetId: invId, dimension: "COLUMNS", startIndex: idx, endIndex: idx + 1 },
        properties: { pixelSize: w },
        fields: "pixelSize"
      }
    });
  });

  const addListDropdown = (sheetId, r1, r2, c1, c2, values, strict) => {
    reqs.push({
      setDataValidation: {
        range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 },
        rule: {
          condition: { type: "ONE_OF_LIST", values: values.map(v => ({ userEnteredValue: v })) },
          showCustomUi: true,
          strict: Boolean(strict)
        }
      }
    });
  };
  const addRangeDropdown = (sheetId, r1, r2, c1, c2, formulaRange, strict) => {
    reqs.push({
      setDataValidation: {
        range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 },
        rule: {
          condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: formulaRange }] },
          showCustomUi: true,
          strict: Boolean(strict)
        }
      }
    });
  };
  const addDateValidation = (sheetId, r1, r2, c1, c2) => {
    reqs.push({
      setDataValidation: {
        range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 },
        rule: {
          condition: { type: "DATE_IS_VALID" },
          strict: false
        }
      }
    });
  };

  // Investments dropdowns & formatting on B13:G500
  addDateValidation(invId, 12, 500, 1, 2);
  addRangeDropdown(invId, 12, 500, 2, 3, "='Investments'!$A$5:$A$7", false);
  addListDropdown(invId, 12, 500, 3, 4, PF_CONFIG.INV_ACTIONS, true);
  addListDropdown(invId, 12, 500, 5, 6, PF_CONFIG.INV_WALLETS, true);
  reqs.push({
    repeatCell: {
      range: { sheetId: invId, startRowIndex: 12, endRowIndex: 500, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" } } },
      fields: "userEnteredFormat.numberFormat"
    }
  });
  reqs.push({
    repeatCell: {
      range: { sheetId: invId, startRowIndex: 12, endRowIndex: 500, startColumnIndex: 4, endColumnIndex: 5 },
      cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: PF_CONFIG.CURRENCY_FORMAT } } },
      fields: "userEnteredFormat.numberFormat"
    }
  });

  // Transactions dropdowns & date validation on B2:G1000
  addDateValidation(txId, 1, 1000, 1, 2);
  addListDropdown(txId, 1, 1000, 3, 4, PF_CONFIG.TX_TYPES, true);
  addListDropdown(txId, 1, 1000, 4, 5, PF_CONFIG.TX_CATEGORIES, false);
  addListDropdown(txId, 1, 1000, 6, 7, PF_CONFIG.WALLETS, true);

  // Loans & People dropdowns (including Person range dropdown!)
  addDateValidation(loanId, 16, 500, 1, 2);
  addRangeDropdown(loanId, 16, 500, 2, 3, "='Loans & People'!$A$5:$A$12", false);
  addListDropdown(loanId, 16, 500, 3, 4, PF_CONFIG.LOAN_DIRECTIONS, true);
  addListDropdown(loanId, 16, 500, 5, 6, PF_CONFIG.LOAN_WALLETS, true);

  // Budgets & Recurring category dropdowns
  addRangeDropdown(budId, 16, 30, 1, 2, "='Budgets & Recurring'!$A$5:$A$12", false);
  addRangeDropdown(budId, 16, 30, 7, 8, "='Budgets & Recurring'!$A$5:$A$12", false);

  const fmtFile = path.join(SCRATCH_DIR, "format_upgrade.json");
  fs.writeFileSync(fmtFile, JSON.stringify({ requests: reqs }, null, 2));
  runGsheets(["mutate", "raw-batch", TARGET_ID, "-f", fmtFile], false);

  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
  console.log("✅ Live sheet upgraded: Family Thndr removed, dropdowns & helper formulas active across all ledgers!");
}

main();
