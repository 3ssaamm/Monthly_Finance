#!/usr/bin/env node
/**
 * Non-destructively upgrades the live Monthly Dashboard lower-right panel (I17:N31)
 * into two clean, scannable cards (Live NBE Credit Card V2 + Personal Investments & Receivables)
 * and cleans raw JS date strings stored in _NBE_Cache!B2 / B4.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { PF_CONFIG, formatMonthYear, formatHumanDate } = require("../src/Config");

const SS_ID = PF_CONFIG.MASTER_SPREADSHEET_ID;
const ACCOUNT = "muhammad.essam811@gmail.com";

function runGsheets(args) {
  const env = { ...process.env, AGY_ACCOUNT: ACCOUNT };
  const quoted = args.map(a => (/[\s&!()"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
  const stdout = execFileSync("gsheets", quoted, { env, encoding: "utf8", shell: true });
  return stdout;
}

function hexRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    red: parseInt(clean.slice(0, 2), 16) / 255,
    green: parseInt(clean.slice(2, 4), 16) / 255,
    blue: parseInt(clean.slice(4, 6), 16) / 255
  };
}

function strCell(v, opts = {}) {
  const isFormula = typeof v === "string" && v.startsWith("=");
  const userEnteredValue = isFormula
    ? { formulaValue: v }
    : (typeof v === "number" ? { numberValue: v } : { stringValue: String(v) });
  const cell = { userEnteredValue };
  const userEnteredFormat = {};
  if (opts.bg) userEnteredFormat.backgroundColor = hexRgb(opts.bg);
  if (opts.fg || opts.bold || opts.italic || opts.fontSize) {
    userEnteredFormat.textFormat = {};
    if (opts.fg) userEnteredFormat.textFormat.foregroundColor = hexRgb(opts.fg);
    if (opts.bold !== undefined) userEnteredFormat.textFormat.bold = opts.bold;
    if (opts.italic !== undefined) userEnteredFormat.textFormat.italic = opts.italic;
    if (opts.fontSize) userEnteredFormat.textFormat.fontSize = opts.fontSize;
  }
  if (opts.hAlign) userEnteredFormat.horizontalAlignment = opts.hAlign;
  if (opts.vAlign) userEnteredFormat.verticalAlignment = opts.vAlign;
  if (opts.numFmt) userEnteredFormat.numberFormat = opts.numFmt;
  if (Object.keys(userEnteredFormat).length > 0) {
    cell.userEnteredFormat = userEnteredFormat;
  }
  return cell;
}

function borderGrid(sheetId, r1, r2, c1, c2, colorHex, style) {
  const b = { style: style || "SOLID", color: hexRgb(colorHex) };
  return {
    updateBorders: {
      range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 },
      top: b,
      bottom: b,
      left: b,
      right: b,
      innerHorizontal: b,
      innerVertical: b
    }
  };
}

function borderOuter(sheetId, r1, r2, c1, c2, colorHex) {
  const b = { style: "SOLID_MEDIUM", color: hexRgb(colorHex) };
  return {
    updateBorders: {
      range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 },
      top: b,
      bottom: b,
      left: b,
      right: b
    }
  };
}

function cfTextContainsRule(sheetId, r1, r2, c1, c2, text, bgHex, fgHex, bold) {
  return {
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [{ sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 }],
        booleanRule: {
          condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: text }] },
          format: {
            backgroundColor: hexRgb(bgHex),
            textFormat: { foregroundColor: hexRgb(fgHex), bold: Boolean(bold) }
          }
        }
      }
    }
  };
}

function main() {
  const sheets = JSON.parse(runGsheets(["readonly", "list-sheets", SS_ID, "--json"]));
  const findId = name => {
    const m = sheets.find(s => s.title === name);
    if (!m) throw new Error("Sheet not found: " + name);
    return m.id !== undefined ? m.id : m.sheetId;
  };
  const dashId = findId(PF_CONFIG.SHEETS.DASHBOARD);
  const cacheId = findId(PF_CONFIG.SHEETS.NBE_CACHE);

  const cacheVals = JSON.parse(runGsheets(["readonly", "read", SS_ID, "'_NBE_Cache'!A1:B10", "--json"]));
  const rawCycle = cacheVals[1] ? cacheVals[1][1] : "";
  const rawDue = cacheVals[3] ? cacheVals[3][1] : "";
  const cleanCycle = formatMonthYear(rawCycle, PF_CONFIG.TIMEZONE) || String(rawCycle || "").trim() || "November 2026";
  const cleanDue = formatHumanDate(rawDue, PF_CONFIG.TIMEZONE) || String(rawDue || "").trim() || "Nov 27, 2026";

  const C = PF_CONFIG.COLORS;
  const CURR_FMT = { type: "CURRENCY", pattern: PF_CONFIG.CURRENCY_FORMAT };
  const PCT_FMT = { type: "PERCENT", pattern: "0.0%" };

  const requests = [];

  // 1. Clean raw date strings in _NBE_Cache!B2 and _NBE_Cache!B4
  requests.push({
    updateCells: {
      range: { sheetId: cacheId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 2 },
      rows: [{ values: [strCell(cleanCycle)] }],
      fields: "userEnteredValue"
    }
  });
  requests.push({
    updateCells: {
      range: { sheetId: cacheId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 1, endColumnIndex: 2 },
      rows: [{ values: [strCell(cleanDue)] }],
      fields: "userEnteredValue"
    }
  });

  // 2. Unmerge I17:N31 and clear borders before applying two-card design
  requests.push({
    unmergeCells: { range: { sheetId: dashId, startRowIndex: 16, endRowIndex: 31, startColumnIndex: 8, endColumnIndex: 14 } }
  });
  requests.push({
    updateBorders: {
      range: { sheetId: dashId, startRowIndex: 16, endRowIndex: 31, startColumnIndex: 8, endColumnIndex: 14 },
      top: { style: "NONE" }, bottom: { style: "NONE" }, left: { style: "NONE" }, right: { style: "NONE" },
      innerHorizontal: { style: "NONE" }, innerVertical: { style: "NONE" }
    }
  });

  // 3. Build rows I17:N31 (startRowIndex=16, endRowIndex=31, startColumnIndex=8, endColumnIndex=14)
  const noteStyle = { bg: "#ffffff", fg: C.TEXT_MUTED, italic: true, fontSize: 9, vAlign: "MIDDLE", hAlign: "LEFT" };
  const labelStyle = { bg: "#ffffff", fg: "#202124", fontSize: 10, vAlign: "MIDDLE", hAlign: "LEFT" };
  const valCurr = { bg: "#ffffff", fg: "#202124", fontSize: 10, vAlign: "MIDDLE", hAlign: "CENTER", numFmt: CURR_FMT };
  const statusCenter = { bg: "#ffffff", fg: "#202124", fontSize: 10, vAlign: "MIDDLE", hAlign: "CENTER" };

  const rows = [
    // Row 17: Card 1 Banner (I17:N17 merged)
    { values: [
      strCell("💳 Live NBE Credit Card V2", { bg: C.INFO_FG, fg: "#ffffff", bold: true, fontSize: 10, vAlign: "MIDDLE" }),
      strCell("", { bg: C.INFO_FG }), strCell("", { bg: C.INFO_FG }), strCell("", { bg: C.INFO_FG }),
      strCell("", { bg: C.INFO_FG }), strCell("", { bg: C.INFO_FG })
    ]},
    // Row 18: Card 1 Headers (L18:N18 merged)
    { values: [
      strCell("Card Metric", { bg: C.INFO_BG, fg: C.INFO_FG, bold: true, fontSize: 9, vAlign: "MIDDLE" }),
      strCell("Value", { bg: C.INFO_BG, fg: C.INFO_FG, bold: true, fontSize: 9, vAlign: "MIDDLE", hAlign: "CENTER" }),
      strCell("Date / Status", { bg: C.INFO_BG, fg: C.INFO_FG, bold: true, fontSize: 9, vAlign: "MIDDLE", hAlign: "CENTER" }),
      strCell("Breakdown & Notes", { bg: C.INFO_BG, fg: C.INFO_FG, bold: true, fontSize: 9, vAlign: "MIDDLE" }),
      strCell("", { bg: C.INFO_BG }), strCell("", { bg: C.INFO_BG })
    ]},
    // Row 19: Active Billing Cycle
    { values: [
      strCell("Active Billing Cycle", labelStyle),
      strCell("='_NBE_Cache'!B2", { ...statusCenter }),
      strCell('=IF(J20<=0.01,"✅ Mido Paid",\'_NBE_Cache\'!B5)', { ...statusCenter }),
      strCell('="Statement: "&TEXT(\'_NBE_Cache\'!B3,"yyyy-mm-dd")&"  •  Synced: "&TEXT(\'_NBE_Cache\'!B10,"mmm d, hh:mm")', noteStyle),
      strCell("", noteStyle), strCell("", noteStyle)
    ]},
    // Row 20: Mido Share Due Now (Hero row)
    { values: [
      strCell("Mido Share Due Now", { ...labelStyle, bg: "#f1f8f4", bold: true }),
      strCell('=IF(ISNUMBER(SEARCH("Paid",\'_NBE_Cache\'!B5)),0,MAX(0,\'_NBE_Cache\'!B7-SUMIFS(Transactions!$F$2:$F,Transactions!$C$2:$C,$G$3,Transactions!$D$2:$D,"CC Bill Payment")))', { ...valCurr, bg: "#f1f8f4", bold: true }),
      strCell("='_NBE_Cache'!B4", { ...statusCenter, bg: "#f1f8f4" }),
      strCell('=IF(J20<=0.01,"✅ Settled (original share EGP "&TEXT(\'_NBE_Cache\'!B7,"#,##0.00")&")","⏳ Remaining of EGP "&TEXT(\'_NBE_Cache\'!B7,"#,##0.00")&" share")', { ...noteStyle, bg: "#f1f8f4" }),
      strCell("", { ...noteStyle, bg: "#f1f8f4" }), strCell("", { ...noteStyle, bg: "#f1f8f4" })
    ]},
    // Row 21: Mido Next Cycle Forecast
    { values: [
      strCell("Mido Next Cycle Forecast", { ...labelStyle, bg: C.ROW_ALT }),
      strCell("='_NBE_Cache'!B8", { ...valCurr, bg: C.ROW_ALT }),
      strCell("Next Cycle Est.", { ...statusCenter, bg: C.ROW_ALT }),
      strCell("Estimated Mido purchases + installments next month", { ...noteStyle, bg: C.ROW_ALT }),
      strCell("", { ...noteStyle, bg: C.ROW_ALT }), strCell("", { ...noteStyle, bg: C.ROW_ALT })
    ]},
    // Row 22: Full Bank Closing Bill
    { values: [
      strCell("Full Bank Closing Bill", labelStyle),
      strCell("='_NBE_Cache'!B6", valCurr),
      strCell('="Family: EGP "&TEXT(\'_NBE_Cache\'!B9,"#,##0.00")', statusCenter),
      strCell('="Full NBE statement (Mido "&TEXT(IF(J22>0,\'_NBE_Cache\'!B7/J22,0),"0.0%")&"  •  Family "&TEXT(IF(J22>0,\'_NBE_Cache\'!B9/J22,0),"0.0%")&")"', noteStyle),
      strCell("", noteStyle), strCell("", noteStyle)
    ]},
    // Row 23: Clean Blank Spacer
    { values: [
      strCell("", { bg: "#ffffff" }), strCell("", { bg: "#ffffff" }), strCell("", { bg: "#ffffff" }),
      strCell("", { bg: "#ffffff" }), strCell("", { bg: "#ffffff" }), strCell("", { bg: "#ffffff" })
    ]},
    // Row 24: Card 2 Banner (I24:N24 merged)
    { values: [
      strCell("📈 Personal Investments & Receivables", { bg: C.PRIMARY, fg: "#ffffff", bold: true, fontSize: 10, vAlign: "MIDDLE" }),
      strCell("", { bg: C.PRIMARY }), strCell("", { bg: C.PRIMARY }), strCell("", { bg: C.PRIMARY }),
      strCell("", { bg: C.PRIMARY }), strCell("", { bg: C.PRIMARY })
    ]},
    // Row 25: Card 2 Headers
    { values: [
      strCell("Asset / Person", { bg: C.PRIMARY_LIGHT, fg: C.PRIMARY_DARK, bold: true, fontSize: 9, vAlign: "MIDDLE" }),
      strCell("Principal / Lent", { bg: C.PRIMARY_LIGHT, fg: C.PRIMARY_DARK, bold: true, fontSize: 9, vAlign: "MIDDLE", hAlign: "RIGHT" }),
      strCell("Current Value", { bg: C.PRIMARY_LIGHT, fg: C.PRIMARY_DARK, bold: true, fontSize: 9, vAlign: "MIDDLE", hAlign: "RIGHT" }),
      strCell("Profit / Repaid", { bg: C.PRIMARY_LIGHT, fg: C.PRIMARY_DARK, bold: true, fontSize: 9, vAlign: "MIDDLE", hAlign: "RIGHT" }),
      strCell("Return %", { bg: C.PRIMARY_LIGHT, fg: C.PRIMARY_DARK, bold: true, fontSize: 9, vAlign: "MIDDLE", hAlign: "RIGHT" }),
      strCell("Status", { bg: C.PRIMARY_LIGHT, fg: C.PRIMARY_DARK, bold: true, fontSize: 9, vAlign: "MIDDLE", hAlign: "CENTER" })
    ]},
    // Row 26: USD Cash ($100)
    { values: [
      strCell("USD Cash ($100)", labelStyle),
      strCell("=Investments!C5", { ...valCurr, hAlign: "RIGHT" }),
      strCell("=Investments!D5", { ...valCurr, hAlign: "RIGHT", bold: true }),
      strCell("=Investments!E5", { ...valCurr, hAlign: "RIGHT" }),
      strCell("=Investments!F5", { bg: "#ffffff", vAlign: "MIDDLE", hAlign: "RIGHT", numFmt: PCT_FMT }),
      strCell('=IF(K26>0,"💵 Active","✅ Closed")', statusCenter)
    ]},
    // Row 27: Thndr Cloud
    { values: [
      strCell("Thndr Cloud", { ...labelStyle, bg: C.ROW_ALT }),
      strCell("=Investments!C6", { ...valCurr, bg: C.ROW_ALT, hAlign: "RIGHT" }),
      strCell("=Investments!D6", { ...valCurr, bg: C.ROW_ALT, hAlign: "RIGHT", bold: true }),
      strCell("=Investments!E6", { ...valCurr, bg: C.ROW_ALT, hAlign: "RIGHT" }),
      strCell("=Investments!F6", { bg: C.ROW_ALT, vAlign: "MIDDLE", hAlign: "RIGHT", numFmt: PCT_FMT }),
      strCell('=IF(K27>0,"📈 Active","✅ Closed")', { ...statusCenter, bg: C.ROW_ALT })
    ]},
    // Row 28: Thndr FI Funds
    { values: [
      strCell("Thndr FI Funds", labelStyle),
      strCell("=Investments!C7", { ...valCurr, hAlign: "RIGHT" }),
      strCell("=Investments!D7", { ...valCurr, hAlign: "RIGHT", bold: true }),
      strCell("=Investments!E7", { ...valCurr, hAlign: "RIGHT" }),
      strCell("=Investments!F7", { bg: "#ffffff", vAlign: "MIDDLE", hAlign: "RIGHT", numFmt: PCT_FMT }),
      strCell('=IF(K28>0,"📈 Active","✅ Closed")', statusCenter)
    ]},
    // Row 29: Abdo (Loan Receivable)
    { values: [
      strCell("Abdo (Loan Receivable)", { ...labelStyle, bg: C.ROW_ALT }),
      strCell("='Loans & People'!B5", { ...valCurr, bg: C.ROW_ALT, hAlign: "RIGHT" }),
      strCell("='Loans & People'!D5", { ...valCurr, bg: C.ROW_ALT, hAlign: "RIGHT", bold: true }),
      strCell("='Loans & People'!C5", { ...valCurr, bg: C.ROW_ALT, hAlign: "RIGHT" }),
      strCell("=IF(J29>0,L29/J29,0)", { bg: C.ROW_ALT, vAlign: "MIDDLE", hAlign: "RIGHT", numFmt: PCT_FMT }),
      strCell("='Loans & People'!F5", { ...statusCenter, bg: C.ROW_ALT })
    ]},
    // Row 30: Dad & Others (Loans)
    { values: [
      strCell("Dad & Others (Loans)", labelStyle),
      strCell("='Loans & People'!B13-'Loans & People'!B5", { ...valCurr, hAlign: "RIGHT" }),
      strCell("='Loans & People'!D13-'Loans & People'!D5", { ...valCurr, hAlign: "RIGHT", bold: true }),
      strCell("='Loans & People'!C13-'Loans & People'!C5", { ...valCurr, hAlign: "RIGHT" }),
      strCell("=IF(J30>0,L30/J30,0)", { bg: "#ffffff", vAlign: "MIDDLE", hAlign: "RIGHT", numFmt: PCT_FMT }),
      strCell('=IF(K30>0.01,"⏳ Owed to Me","✅ Settled")', statusCenter)
    ]},
    // Row 31: TOTAL WEALTH ASSETS
    { values: [
      strCell("TOTAL WEALTH ASSETS", { bg: C.SUBHEADER, fg: "#202124", bold: true, fontSize: 10, vAlign: "MIDDLE" }),
      strCell("=SUM(J26:J30)", { bg: C.SUBHEADER, fg: "#202124", bold: true, fontSize: 10, vAlign: "MIDDLE", hAlign: "RIGHT", numFmt: CURR_FMT }),
      strCell("=SUM(K26:K30)", { bg: C.SUBHEADER, fg: "#202124", bold: true, fontSize: 10, vAlign: "MIDDLE", hAlign: "RIGHT", numFmt: CURR_FMT }),
      strCell("=Investments!E8", { bg: C.SUBHEADER, fg: "#202124", bold: true, fontSize: 10, vAlign: "MIDDLE", hAlign: "RIGHT", numFmt: CURR_FMT }),
      strCell("=IF(Investments!C8>0,Investments!E8/Investments!C8,0)", { bg: C.SUBHEADER, fg: "#202124", bold: true, fontSize: 10, vAlign: "MIDDLE", hAlign: "RIGHT", numFmt: PCT_FMT }),
      strCell('=IF(K31>0,"🟢 Growing","—")', { bg: C.SUBHEADER, fg: "#202124", bold: true, fontSize: 10, vAlign: "MIDDLE", hAlign: "CENTER" })
    ]}
  ];

  requests.push({
    updateCells: {
      range: { sheetId: dashId, startRowIndex: 16, endRowIndex: 31, startColumnIndex: 8, endColumnIndex: 14 },
      rows,
      fields: "userEnteredValue,userEnteredFormat"
    }
  });

  // 4. Merge banner & Breakdown/Notes cells
  requests.push({ mergeCells: { range: { sheetId: dashId, startRowIndex: 16, endRowIndex: 17, startColumnIndex: 8, endColumnIndex: 14 }, mergeType: "MERGE_ALL" } });
  for (let r = 17; r <= 21; r++) {
    requests.push({ mergeCells: { range: { sheetId: dashId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 11, endColumnIndex: 14 }, mergeType: "MERGE_ALL" } });
  }
  requests.push({ mergeCells: { range: { sheetId: dashId, startRowIndex: 23, endRowIndex: 24, startColumnIndex: 8, endColumnIndex: 14 }, mergeType: "MERGE_ALL" } });

  // 5. Borders & row/col dimensions
  requests.push(borderGrid(dashId, 16, 22, 8, 14, C.BORDER, "SOLID"));
  requests.push(borderOuter(dashId, 16, 22, 8, 14, C.INFO_FG));
  requests.push(borderGrid(dashId, 23, 31, 8, 14, C.BORDER, "SOLID"));
  requests.push(borderOuter(dashId, 23, 31, 8, 14, C.PRIMARY));

  requests.push({
    updateDimensionProperties: {
      range: { sheetId: dashId, dimension: "COLUMNS", startIndex: 8, endIndex: 9 },
      properties: { pixelSize: 185 },
      fields: "pixelSize"
    }
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId: dashId, dimension: "COLUMNS", startIndex: 9, endIndex: 10 },
      properties: { pixelSize: 125 },
      fields: "pixelSize"
    }
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId: dashId, dimension: "COLUMNS", startIndex: 13, endIndex: 14 },
      properties: { pixelSize: 135 },
      fields: "pixelSize"
    }
  });

  // 6. Status badge conditional formatting for Card 1 (K19) and Card 2 (N26:N31)
  requests.push(cfTextContainsRule(dashId, 18, 19, 10, 11, "Paid", C.OK_BG, C.OK_FG, true));
  requests.push(cfTextContainsRule(dashId, 18, 19, 10, 11, "Pending", C.WARN_BG, C.WARN_FG, true));
  requests.push(cfTextContainsRule(dashId, 25, 31, 13, 14, "Active", C.OK_BG, C.OK_FG, true));
  requests.push(cfTextContainsRule(dashId, 25, 31, 13, 14, "Settled", C.OK_BG, C.OK_FG, true));
  requests.push(cfTextContainsRule(dashId, 25, 31, 13, 14, "Growing", C.OK_BG, C.OK_FG, true));
  requests.push(cfTextContainsRule(dashId, 25, 31, 13, 14, "Closed", C.SUBHEADER, C.TEXT_MUTED, false));
  requests.push(cfTextContainsRule(dashId, 25, 31, 13, 14, "Owed", C.WARN_BG, C.WARN_FG, true));

  const tmpFile = path.join(os.tmpdir(), `pf_dash_cards_${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify({ requests }), "utf8");
  try {
    console.log(runGsheets(["mutate", "raw-batch", SS_ID, "-f", tmpFile]).trim());
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }

  console.log("=== VERIFY CARDS (I17:N31) ===");
  console.log(runGsheets(["readonly", "read", SS_ID, "'Monthly Dashboard'!I17:N31", "--json"]));
  console.log("=== VERIFY NET WORTH (L6) ===");
  console.log(runGsheets(["readonly", "read", SS_ID, "'Monthly Dashboard'!L6", "--json"]));
}

main();
