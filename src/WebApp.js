/**
 * Web App, JSON API (doGet/doPost), Safari Mobile Quick-Entry & Email Link Helper.
 */

function getExpectedWebAppKey_() {
  try {
    if (typeof PropertiesService !== "undefined" && PropertiesService.getScriptProperties) {
      const saved = PropertiesService.getScriptProperties().getProperty("PF_WEBAPP_KEY");
      if (saved && String(saved).trim()) return String(saved).trim();
    }
  } catch (_) {}
  return PF_CONFIG.DEFAULT_WEBAPP_KEY;
}

function assertWebAppAuth_(key, isSidebar) {
  if (isSidebar === true) return;
  if (!isValidWebAppKey(key, getExpectedWebAppKey_())) {
    throw new Error("Unauthorized: invalid or missing Mobile Access Key.");
  }
}

function resolveExecUrl_(optExecUrl) {
  const passed = String(optExecUrl || "").trim();
  if (passed) return passed;
  try {
    const svcUrl = ScriptApp.getService().getUrl();
    if (svcUrl && String(svcUrl).trim()) return String(svcUrl).trim();
  } catch (_) {}
  return PF_CONFIG.WEBAPP_EXEC_URL || "";
}

function getMobileQuickEntryUrl_(optExecUrl) {
  const base = resolveExecUrl_(optExecUrl);
  if (!base) return "";
  const sep = base.indexOf("?") === -1 ? "?" : "&";
  return `${base}${sep}k=${encodeURIComponent(getExpectedWebAppKey_())}`;
}

function doGet(e) {
  const urlKey = String((e && e.parameter && e.parameter.k) || "").trim();
  const expectedKey = getExpectedWebAppKey_();
  const authorized = isValidWebAppKey(urlKey, expectedKey);

  const template = HtmlService.createTemplateFromFile("WebApp");
  template.initialKey = authorized ? urlKey : "";
  template.execUrl = resolveExecUrl_("");
  template.initialStateJson = authorized ? JSON.stringify(apiGetDashboardState(urlKey, true)) : "null";

  return template.evaluate()
    .setTitle("Personal Financials — Quick Entry")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  let req = {};
  try {
    const raw = e && e.postData && e.postData.contents ? String(e.postData.contents) : "{}";
    req = JSON.parse(raw);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "Invalid JSON body." }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const action = String(req.action || "").trim();
    const key = String(req.key || "").trim();
    const payload = req.payload || {};

    let result;
    if (action === "getState") {
      result = { ok: true, state: apiGetDashboardState(key, false) };
    } else if (action === "logTransaction") {
      result = apiLogTransaction({ ...payload, key });
    } else if (action === "logLoan") {
      result = apiLogLoan({ ...payload, key });
    } else if (action === "logInvestment") {
      result = apiLogInvestment({ ...payload, key });
    } else if (action === "sendEmail") {
      assertWebAppAuth_(key, false);
      result = { ok: true, ...sendMobileLinkEmail(payload.execUrl) };
    } else {
      throw new Error("Unsupported action: " + action);
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message || String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function showQuickEntrySidebar() {
  const key = getExpectedWebAppKey_();
  const template = HtmlService.createTemplateFromFile("WebApp");
  template.initialKey = key;
  template.execUrl = resolveExecUrl_("");
  template.initialStateJson = JSON.stringify(apiGetDashboardState(key, true));

  const html = template.evaluate()
    .setTitle("💰 Quick Entry & Budgets")
    .setWidth(380);
  SpreadsheetApp.getUi().showSidebar(html);
}

function apiGetDashboardState(key, isSidebar) {
  assertWebAppAuth_(key, isSidebar);
  const ss = getMasterSpreadsheet_();
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

  const invSheet = ss.getSheetByName(PF_CONFIG.SHEETS.INVESTMENTS);
  const investments = [];
  if (invSheet) {
    const invVals = invSheet.getRange("A5:F7").getValues();
    invVals.forEach(r => {
      const asset = String(r[0] || "").trim();
      if (asset) {
        investments.push({
          asset,
          units: r[1] === "" ? null : Number(r[1] || 0),
          principal: Number(r[2] || 0),
          marketValue: Number(r[3] || 0),
          profit: Number(r[4] || 0)
        });
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
    assets: PF_CONFIG.PERSONAL_ASSETS,
    budgets: statuses,
    people,
    investments
  };
}

function apiLogTransaction(payload) {
  if (!payload) throw new Error("Missing transaction payload.");
  assertWebAppAuth_(payload.key, Boolean(payload.isSidebar));

  const ss = getMasterSpreadsheet_();
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
  const state = apiGetDashboardState(payload.key, Boolean(payload.isSidebar));

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
  assertWebAppAuth_(payload.key, Boolean(payload.isSidebar));

  const ss = getMasterSpreadsheet_();
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
    state: apiGetDashboardState(payload.key, Boolean(payload.isSidebar))
  };
}

function apiLogInvestment(payload) {
  if (!payload) throw new Error("Missing investment payload.");
  assertWebAppAuth_(payload.key, Boolean(payload.isSidebar));

  const ss = getMasterSpreadsheet_();
  const invSheet = ss.getSheetByName(PF_CONFIG.SHEETS.INVESTMENTS);
  if (!invSheet) throw new Error("Investments sheet not found.");

  const asset = String(payload.asset || "").trim();
  if (!asset) throw new Error("Asset is required.");

  const mode = String(payload.mode || "Deposit").trim();
  const dateStr = payload.date || Utilities.formatDate(new Date(), PF_CONFIG.TIMEZONE, "yyyy-MM-dd");
  const dObj = parseDateStrict(dateStr, PF_CONFIG.TIMEZONE);
  const isoDate = dObj ? formatDateIso(dObj) : Utilities.formatDate(new Date(), PF_CONFIG.TIMEZONE, "yyyy-MM-dd");

  let loggedAmount = 0;
  if (mode === "Deposit" || mode === "Withdrawal") {
    const amount = evalSimpleMathExpr(payload.amount);
    if (!isFinite(amount) || amount <= 0) {
      throw new Error("Invalid transfer amount.");
    }
    loggedAmount = amount;
    const wallet = String(payload.wallet || "Bank / InstaPay").trim();
    const notes = String(payload.notes || "Logged via Quick Entry").trim();

    const colB = invSheet.getRange("B13:B500").getValues();
    let nextRow = 13;
    for (let i = 0; i < colB.length; i++) {
      if (String(colB[i][0] || "").trim() === "") {
        nextRow = 13 + i;
        break;
      }
      nextRow = 13 + i + 1;
    }
    invSheet.getRange(nextRow, 1, 1, 7).setValues([[
      `=IF(B${nextRow}="","",ROW()-12)`,
      isoDate,
      asset,
      mode,
      amount,
      wallet,
      notes
    ]]);
    invSheet.getRange(nextRow, 2).setNumberFormat("yyyy-mm-dd");
    invSheet.getRange(nextRow, 5).setNumberFormat(PF_CONFIG.CURRENCY_FORMAT);
  }

  // Optional market value / USD units update
  if (payload.newMarketValue !== undefined && String(payload.newMarketValue).trim() !== "") {
    const val = evalSimpleMathExpr(payload.newMarketValue);
    if (!isFinite(val) || val < 0) throw new Error("Invalid market value / USD units.");
    const assetRows = invSheet.getRange("A5:A7").getValues();
    for (let i = 0; i < assetRows.length; i++) {
      if (String(assetRows[i][0] || "").trim() === asset) {
        const targetRow = 5 + i;
        if (asset === "USD Cash") {
          invSheet.getRange(targetRow, 2).setValue(val);
        } else {
          invSheet.getRange(targetRow, 4).setValue(val);
        }
        break;
      }
    }
  }

  SpreadsheetApp.flush();
  return {
    ok: true,
    asset,
    mode,
    amount: loggedAmount,
    state: apiGetDashboardState(payload.key, Boolean(payload.isSidebar))
  };
}

function sendMobileLinkEmail(optExecUrl) {
  const url = getMobileQuickEntryUrl_(optExecUrl);
  if (!url) throw new Error("Mobile Web App URL is not configured yet.");

  const ss = getMasterSpreadsheet_();
  const sheetUrl = ss.getUrl();
  const recipients = PF_CONFIG.EMAIL_RECIPIENTS || [PF_CONFIG.ALERT_EMAIL];

  const htmlBody = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #dadce0;border-radius:12px;overflow:hidden;">
      <div style="background:#1b5e20;color:#ffffff;padding:18px 22px;">
        <h2 style="margin:0;font-size:18px;">💰 Personal Financials — iPhone Quick Entry</h2>
      </div>
      <div style="padding:20px 22px;color:#202124;line-height:1.5;">
        <p style="margin-top:0;">Your Mobile Quick-Entry app is now configured to open directly in <b>iPhone Safari</b> without Google cookie/redirect issues.</p>
        <p style="margin:22px 0;text-align:center;">
          <a href="${url}" style="display:inline-block;background:#1b5e20;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:10px;font-size:15px;">
            📱 Open Quick Entry in Safari
          </a>
        </p>
        <div style="background:#f1f3f4;border-radius:8px;padding:12px;font-size:12px;word-break:break-all;color:#3c4043;">
          <b>Direct Link:</b><br>${url}
        </div>
        <p style="font-size:13px;color:#5f6368;margin-top:16px;">
          <b>iPhone Safari Tip:</b><br>
          1. If Mail/Gmail opens an in-app preview, tap the <b>Safari compass icon</b> at the bottom-right (or hold the button &rarr; <i>Open in Safari</i>).<br>
          2. In Safari, tap <b>Share</b> &rarr; <b>Add to Home Screen</b> for a 1-tap app icon.
        </p>
        <p style="font-size:12px;color:#5f6368;margin-bottom:0;">
          Master Workbook: <a href="${sheetUrl}">Open Personal Financials Sheet</a>
        </p>
      </div>
    </div>`;

  MailApp.sendEmail({
    to: recipients.join(","),
    subject: "📱 Personal Financials — Your iPhone Safari Quick-Entry Link",
    htmlBody
  });

  return { recipients, url };
}
