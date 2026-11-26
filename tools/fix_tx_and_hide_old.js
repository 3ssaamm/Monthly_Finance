#!/usr/bin/env node
/**
 * Non-destructively repairs live Transactions & Budgets sheets:
 * 1. Moves stray Quick-Entry rows from 1001..1003 back up to contiguous rows 462..464 and clears 1001..1003.
 * 2. Syncs any missing NBE Credit Card V2 Mido transactions >= 2026-11 (such as T-00378 "Amazon (coffee)") via buildMidoNbeSyncRows.
 * 3. Stores Budgets & Recurring!H7 ("NBE Sync Start Month") as plain-text "2026-11" so Sheets never turns it into a Date serial.
 * 4. Hides older months (Col C != active Dashboard month 2026-11) on Transactions, keeping active month + blank entry rows visible.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { PF_CONFIG, evalSimpleMathExpr } = require("../src/Config");
const { buildMidoNbeSyncRows } = require("../src/SyncNBE");

const SS_ID = PF_CONFIG.MASTER_SPREADSHEET_ID;
const NBE_ID = PF_CONFIG.NBE_CREDIT_ID;
const ACCOUNT = "muhammad.essam811@gmail.com";

function runGsheets(args) {
  const env = { ...process.env, AGY_ACCOUNT: ACCOUNT };
  const quoted = args.map(a => (/[\s&!()"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
  return execFileSync("gsheets", quoted, { env, encoding: "utf8", shell: true });
}

function cellVal(v, numFmt) {
  let userEnteredValue;
  if (typeof v === "string" && v.startsWith("=")) {
    userEnteredValue = { formulaValue: v };
  } else if (typeof v === "number") {
    userEnteredValue = { numberValue: v };
  } else {
    userEnteredValue = { stringValue: String(v === null || v === undefined ? "" : v) };
  }
  const c = { userEnteredValue };
  if (numFmt) c.userEnteredFormat = { numberFormat: numFmt };
  return c;
}

function main() {
  const sheets = JSON.parse(runGsheets(["readonly", "list-sheets", SS_ID, "--json"]));
  const findId = name => {
    const m = sheets.find(s => s.title === name);
    if (!m) throw new Error("Sheet not found: " + name);
    return m.id !== undefined ? m.id : m.sheetId;
  };
  const txId = findId(PF_CONFIG.SHEETS.TRANSACTIONS);
  const budgetsId = findId(PF_CONFIG.SHEETS.BUDGETS);

  const activeMonthKey = String(
    JSON.parse(runGsheets(["readonly", "read", SS_ID, "'Monthly Dashboard'!G3", "--json"]))[0][0] || "2026-11"
  ).trim();

  const existingAll = JSON.parse(runGsheets(["readonly", "read", SS_ID, "Transactions!A1:J1020", "--json"]));
  const strayRows = JSON.parse(
    runGsheets(["readonly", "read", SS_ID, "Transactions!A1001:J1010", "--value-render-option", "UNFORMATTED_VALUE", "--json"])
  ) || [];
  const validStray = strayRows.filter(r => r && r[1]);
  console.log("Stray rows found at 1001+:", validStray.length);

  // Verify target rows 462..465 have blank Date (col B)
  for (let r = 462; r <= 465; r++) {
    const rowArr = existingAll[r - 1] || [];
    if (String(rowArr[1] || "").trim() !== "") {
      throw new Error(`Expected blank Date at Transactions row ${r}, found: ${rowArr[1]}`);
    }
  }

  // Collect existing _Source_IDs (including stray ones we're about to move)
  const existingSourceIds = new Set();
  existingAll.forEach((r, idx) => {
    if (idx === 0) return;
    const id = String((r && r[9]) || "").trim();
    if (id) existingSourceIds.add(id);
  });

  // Read live NBE Credit Card V2 Transactions & Installments + Budgets keyword rules
  const nbeTxRows = JSON.parse(runGsheets(["readonly", "read", NBE_ID, "Transactions!A1:G500", "--json"]));
  const nbeInstRows = JSON.parse(runGsheets(["readonly", "read", NBE_ID, "Installments!A1:L100", "--json"]));
  const ruleRowsRaw = JSON.parse(runGsheets(["readonly", "read", SS_ID, "'Budgets & Recurring'!G17:I30", "--json"])) || [];
  const rules = ruleRowsRaw
    .filter(r => r && String(r[0] || "").trim() && String(r[1] || "").trim())
    .map(r => ({ keywords: String(r[0]).trim(), category: String(r[1]).trim(), priority: Number(r[2] || 99) }));

  const nbeToAppend = buildMidoNbeSyncRows({
    txRows: nbeTxRows,
    instRows: nbeInstRows,
    existingSourceIds,
    syncStartMonth: PF_CONFIG.NBE_SYNC_START_MONTH,
    rules: rules.length ? rules : PF_CONFIG.DEFAULT_CATEGORY_RULES,
    activeCycleMonthKey: activeMonthKey
  });
  console.log("New NBE Mido items to sync:", nbeToAppend.map(x => `${x.sourceId}:${x.details}:${x.amount}:${x.category}`));

  const requests = [];

  // Build compacted rows starting at row 462 (0-indexed 461): stray rows + newly synced NBE rows
  const formattedMoved = validStray.map(r => {
    let isoDate = String(r[1]);
    if (typeof r[1] === "number" && r[1] > 30000) {
      const utcMs = Math.round((r[1] - 25569) * 86400 * 1000);
      const d = new Date(utcMs);
      isoDate = d.toISOString().slice(0, 10);
    }
    const amt = typeof r[5] === "number" ? r[5] : evalSimpleMathExpr(r[5]);
    return {
      date: isoDate,
      monthKey: isoDate.slice(0, 7),
      type: String(r[3] || ""),
      category: String(r[4] || ""),
      amount: amt,
      wallet: String(r[6] || ""),
      details: String(r[7] || ""),
      notes: String(r[8] || ""),
      sourceId: String(r[9] || "")
    };
  });

  const combined = formattedMoved.concat(nbeToAppend);
  if (combined.length > 0) {
    const startRow1 = 462;
    const rowsPayload = combined.map((item, idx) => {
      const r = startRow1 + idx;
      return {
        values: [
          cellVal(`=IF(B${r}="","",ROW()-1)`),
          cellVal(item.date, { type: "DATE", pattern: "yyyy-mm-dd" }),
          cellVal(`=IF(B${r}="","",TEXT(B${r},"yyyy-mm"))`),
          cellVal(item.type),
          cellVal(item.category),
          cellVal(item.amount, { type: "CURRENCY", pattern: PF_CONFIG.CURRENCY_FORMAT }),
          cellVal(item.wallet),
          cellVal(item.details),
          cellVal(item.notes),
          cellVal(item.sourceId)
        ]
      };
    });
    requests.push({
      updateCells: {
        range: { sheetId: txId, startRowIndex: startRow1 - 1, endRowIndex: startRow1 - 1 + combined.length, startColumnIndex: 0, endColumnIndex: 10 },
        rows: rowsPayload,
        fields: "userEnteredValue,userEnteredFormat.numberFormat"
      }
    });
  }

  // Clear stray rows 1001..1010 completely
  if (validStray.length > 0) {
    requests.push({
      updateCells: {
        range: { sheetId: txId, startRowIndex: 1000, endRowIndex: 1010, startColumnIndex: 0, endColumnIndex: 10 },
        fields: "userEnteredValue"
      }
    });
  }

  // Fix Budgets & Recurring!H7 to explicit plain-text "2026-11" so Sheets stops turning it into Date 46327
  requests.push({
    updateCells: {
      range: { sheetId: budgetsId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 7, endColumnIndex: 8 },
      rows: [{
        values: [{
          userEnteredValue: { stringValue: PF_CONFIG.NBE_SYNC_START_MONTH },
          userEnteredFormat: { numberFormat: { type: "TEXT", pattern: "@" } }
        }]
      }],
      fields: "userEnteredValue,userEnteredFormat.numberFormat"
    }
  });

  // Hide old-month rows in Transactions (unhide all first, then hide non-active populated rows)
  requests.push({
    updateDimensionProperties: {
      range: { sheetId: txId, dimension: "ROWS", startIndex: 1, endIndex: 1020 },
      properties: { hiddenByUser: false },
      fields: "hiddenByUser"
    }
  });

  // Build updated month map covering existing rows 2..461 + newly placed rows 462..(461+combined.length)
  const hideIntervals = [];
  let curStart = -1;
  let curEnd = -1;
  const maxCheckRow = Math.max(461 + combined.length, existingAll.length);
  for (let r1 = 2; r1 <= maxCheckRow; r1++) {
    let dateVal = "";
    let mKey = "";
    if (r1 >= 462 && r1 < 462 + combined.length) {
      const item = combined[r1 - 462];
      dateVal = item.date;
      mKey = item.monthKey;
    } else if (r1 < 1001) {
      const row = existingAll[r1 - 1] || [];
      dateVal = String(row[1] || "").trim();
      mKey = String(row[2] || "").trim();
    }
    const hide = Boolean(dateVal && mKey && mKey !== activeMonthKey);
    const idx0 = r1 - 1;
    if (hide) {
      if (curStart === -1) {
        curStart = idx0;
        curEnd = idx0 + 1;
      } else {
        curEnd = idx0 + 1;
      }
    } else if (curStart !== -1) {
      hideIntervals.push([curStart, curEnd]);
      curStart = -1;
      curEnd = -1;
    }
  }
  if (curStart !== -1) hideIntervals.push([curStart, curEnd]);

  let totalHidden = 0;
  hideIntervals.forEach(([s, e]) => {
    totalHidden += (e - s);
    requests.push({
      updateDimensionProperties: {
        range: { sheetId: txId, dimension: "ROWS", startIndex: s, endIndex: e },
        properties: { hiddenByUser: true },
        fields: "hiddenByUser"
      }
    });
  });
  console.log(`Hiding ${totalHidden} old-month row(s) in intervals:`, hideIntervals.map(([s, e]) => `${s + 1}..${e}`).join(", "));

  const tmp = path.join(os.tmpdir(), `pf_fix_tx_${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ requests }), "utf8");
  try {
    console.log(runGsheets(["mutate", "raw-batch", SS_ID, "-f", tmp]).trim());
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }

  console.log("=== VERIFY TRANSACTIONS TAIL (460..467) ===");
  console.log(runGsheets(["readonly", "read", SS_ID, "Transactions!A460:J467", "--json"]));
  console.log("=== VERIFY CLEARED STRAY AREA (1001..1005) ===");
  console.log(runGsheets(["readonly", "read", SS_ID, "Transactions!A1001:J1005", "--json"]));
  console.log("=== VERIFY FOOD SPEND (B10) & TOTAL SPEND (C6) ===");
  console.log(runGsheets(["readonly", "read", SS_ID, "'Monthly Dashboard'!A10:D10", "--json"]));
  console.log(runGsheets(["readonly", "read", SS_ID, "'Monthly Dashboard'!C6:N6", "--json"]));
}

main();
