/**
 * Personal Financials — Main Entrypoint, Custom Menu, Triggers & onEdit Handler.
 */

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("💰 Personal Finance")
    .addItem("📧 Email Mobile Link to My iPhone", "menuSendMobileLinkEmail")
    .addItem("📱 Open Quick-Entry Sidebar", "showQuickEntrySidebar")
    .addItem("🔄 Sync NBE Credit Card V2", "menuSyncNbeCard")
    .addItem("🔔 Check Budget Alerts Now", "menuCheckBudgetAlerts")
    .addSeparator()
    .addItem("🏗️ Build / Repair All Sheets", "menuBuildAllSheets")
    .addItem("📦 Run Historical Migration", "menuRunMigration")
    .addItem("⏰ Enable Daily Auto-Sync & Alerts", "menuInstallDailyTriggers")
    .addItem("🔗 Show Mobile Web App Info", "menuShowWebAppInfo")
    .addToUi();
}

function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const name = sheet.getName();

  if (name === PF_CONFIG.SHEETS.TRANSACTIONS) {
    const row = e.range.getRow();
    if (row >= 2) {
      const monthCell = sheet.getRange(row, 3);
      if (!monthCell.getFormula()) {
        monthCell.setFormula(`=IF(B${row}="","",TEXT(B${row},"yyyy-mm"))`);
      }
      const numCell = sheet.getRange(row, 1);
      if (!numCell.getFormula()) {
        numCell.setFormula(`=IF(B${row}="","",ROW()-1)`);
      }
      const typeVal = String(sheet.getRange(row, 4).getValue() || "").trim();
      if (typeVal === "Expense") {
        try {
          const monthKey = String(monthCell.getDisplayValue() || "").trim() ||
            Utilities.formatDate(new Date(), PF_CONFIG.TIMEZONE, "yyyy-MM");
          checkAndSendBudgetAlerts(e.source, monthKey, false);
        } catch (_) {}
      }
    }
  } else if (name === PF_CONFIG.SHEETS.LOANS) {
    const row = e.range.getRow();
    if (row >= 17) {
      const numCell = sheet.getRange(row, 1);
      if (!numCell.getFormula()) {
        numCell.setFormula(`=IF(B${row}="","",ROW()-16)`);
      }
    }
  } else if (name === PF_CONFIG.SHEETS.INVESTMENTS) {
    const row = e.range.getRow();
    if (row >= 13) {
      const numCell = sheet.getRange(row, 1);
      if (!numCell.getFormula()) {
        numCell.setFormula(`=IF(B${row}="","",ROW()-12)`);
      }
    }
  }
}

function menuBuildAllSheets() {
  buildAllSheets(SpreadsheetApp.getActiveSpreadsheet());
  SpreadsheetApp.getUi().alert("✅ All sheets, formulas, and charts built/repaired.");
}

function menuSyncNbeCard() {
  const res = syncFromNbeCreditCard(SpreadsheetApp.getActiveSpreadsheet());
  SpreadsheetApp.getUi().alert(
    `✅ Synced NBE Credit Card V2.\n` +
    `• Active Cycle: ${res.nbeSummary.activeCycle}\n` +
    `• Mido Share Due: EGP ${res.nbeSummary.midoShareDue.toFixed(2)}\n` +
    `• New Mido Items Added: ${res.addedCount}`
  );
}

function menuCheckBudgetAlerts() {
  const res = checkAndSendBudgetAlerts(SpreadsheetApp.getActiveSpreadsheet(), null, false);
  const warns = (res.statuses || []).filter(s => s.severity === "over" || s.severity === "warn" || s.severity === "pace");
  const msg = warns.length
    ? warns.map(w => `• ${w.category}: ${(w.pct * 100).toFixed(0)}% (${w.status})`).join("\n")
    : "All categories are on track!";
  SpreadsheetApp.getUi().alert(`Budget Check (${res.monthKey}):\n\n${msg}\n\nNew emails sent: ${res.triggeredAlerts.length}`);
}

function menuRunMigration() {
  const res = runHistoricalMigration(SpreadsheetApp.getActiveSpreadsheet());
  SpreadsheetApp.getUi().alert(
    `✅ Historical Migration Complete.\n` +
    `• Added Transactions: ${res.addedTransactions}\n` +
    `• Added Loans: ${res.addedLoans}`
  );
}

function dailyAutoSyncAndAlerts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  syncFromNbeCreditCard(ss);
  checkAndSendBudgetAlerts(ss, null, false);
}

function menuInstallDailyTriggers() {
  const existing = ScriptApp.getProjectTriggers();
  existing.forEach(t => {
    if (t.getHandlerFunction() === "dailyAutoSyncAndAlerts") {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger("dailyAutoSyncAndAlerts")
    .timeBased()
    .everyDays(1)
    .atHour(21)
    .inTimezone(PF_CONFIG.TIMEZONE)
    .create();
  SpreadsheetApp.getUi().alert("✅ Daily 9:00 PM Cairo trigger installed for NBE Credit Card sync & budget alerts.");
}

function menuSendMobileLinkEmail() {
  const res = sendMobileLinkEmail();
  SpreadsheetApp.getUi().alert(
    `✅ Mobile Safari Quick-Entry link emailed to:\n${res.recipients.join(", ")}\n\nLink:\n${res.url}`
  );
}

function menuShowWebAppInfo() {
  let url = "";
  try {
    url = getMobileQuickEntryUrl_();
  } catch (_) {}
  SpreadsheetApp.getUi().alert(
    url
      ? `📱 iPhone Safari Quick-Entry Link:\n\n${url}\n\nOpen in Safari on your iPhone and tap Share → Add to Home Screen!`
      : "Open Extensions → Apps Script → Deploy → Manage Deployments to view your Web App URL."
  );
}
