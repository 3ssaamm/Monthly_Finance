/**
 * Category Budget Evaluation, Pace Warnings, and Idempotent Email Alerts.
 */

if (typeof require === "function" && typeof PF_CONFIG === "undefined") {
  Object.assign(global, require("./Config"));
}

function evaluateBudgetStatuses(budgets, spentByCategory, monthProgress, fastPaceMargin) {
  const progress = typeof monthProgress === "number" && isFinite(monthProgress) ? monthProgress : 0;
  const margin = typeof fastPaceMargin === "number" && isFinite(fastPaceMargin) ? fastPaceMargin : 0.15;

  return (budgets || []).map(b => {
    const category = String(b.category || "").trim();
    const budget = Number(b.budget || 0);
    const warnPct = Number(b.warnPct || 0.8);
    const emailAlert = Boolean(b.emailAlert !== false);
    const spent = Math.round(Number((spentByCategory && spentByCategory[category]) || 0) * 100) / 100;
    const remaining = Math.round((budget - spent) * 100) / 100;
    const pct = budget > 0 ? spent / budget : 0;

    let status = "✅ On Track";
    let severity = "ok";
    if (budget <= 0) {
      status = "—";
      severity = "none";
    } else if (pct >= 1) {
      status = "🚨 OVER BUDGET";
      severity = "over";
    } else if (pct >= warnPct) {
      status = "⚠️ Near Limit";
      severity = "warn";
    } else if (progress > 0 && progress < 1 && pct > progress + margin) {
      status = "🔥 Fast Pace";
      severity = "pace";
    }

    return {
      category,
      budget,
      warnPct,
      emailAlert,
      spent,
      remaining,
      pct,
      status,
      severity,
      shouldWarn80: emailAlert && budget > 0 && pct >= warnPct && pct < 1,
      shouldWarn100: emailAlert && budget > 0 && pct >= 1
    };
  });
}

function buildAlertKey(monthKey, category, level) {
  return `PF_ALERT_${String(monthKey || "").trim()}_${String(category || "").trim().toUpperCase()}_${level}`;
}

function readBudgetsConfigFromSheet_(ss) {
  const sheet = ss.getSheetByName(PF_CONFIG.SHEETS.BUDGETS);
  if (!sheet) {
    return {
      alertEmail: PF_CONFIG.ALERT_EMAIL,
      fastPaceMargin: 0.15,
      syncStartMonth: PF_CONFIG.NBE_SYNC_START_MONTH,
      nbeCreditId: PF_CONFIG.NBE_CREDIT_ID,
      budgets: PF_CONFIG.DEFAULT_BUDGETS,
      rules: PF_CONFIG.DEFAULT_CATEGORY_RULES
    };
  }

  const budgetRows = sheet.getRange(5, 1, 8, 5).getValues();
  const budgets = budgetRows
    .filter(r => String(r[0] || "").trim() !== "")
    .map(r => ({
      category: String(r[0]).trim(),
      budget: Number(r[1] || 0),
      warnPct: Number(r[2] || 0.8),
      emailAlert: r[3] !== false && String(r[3]).toUpperCase() !== "FALSE",
      notes: String(r[4] || "").trim()
    }));

  const settingRows = sheet.getRange(5, 7, 5, 2).getValues();
  const settingsMap = {};
  settingRows.forEach(r => {
    const k = String(r[0] || "").trim();
    if (k) settingsMap[k] = r[1];
  });

  const lastRuleRow = Math.max(17, sheet.getLastRow());
  const ruleRows = sheet.getRange(17, 7, lastRuleRow - 16, 3).getValues();
  const rules = ruleRows
    .filter(r => String(r[0] || "").trim() && String(r[1] || "").trim())
    .map(r => ({
      keywords: String(r[0]).trim(),
      category: String(r[1]).trim(),
      priority: Number(r[2] || 99)
    }));

  return {
    alertEmail: String(settingsMap["Alert Email"] || PF_CONFIG.ALERT_EMAIL).trim(),
    targetSavings: Number(settingsMap["Target Monthly Savings (EGP)"] || 5000),
    syncStartMonth: String(settingsMap["NBE Sync Start Month"] || PF_CONFIG.NBE_SYNC_START_MONTH).trim(),
    nbeCreditId: String(settingsMap["NBE Credit Card Sheet ID"] || PF_CONFIG.NBE_CREDIT_ID).trim(),
    fastPaceMargin: Number(settingsMap["Fast-Pace Margin %"] || 0.15),
    budgets: budgets.length ? budgets : PF_CONFIG.DEFAULT_BUDGETS,
    rules: rules.length ? rules : PF_CONFIG.DEFAULT_CATEGORY_RULES
  };
}

function getSpentByCategoryForMonth_(ss, monthKey) {
  const txSheet = ss.getSheetByName(PF_CONFIG.SHEETS.TRANSACTIONS);
  const spent = {};
  if (!txSheet || txSheet.getLastRow() < 2) return spent;

  const rows = txSheet.getRange(2, 1, txSheet.getLastRow() - 1, 10).getValues();
  rows.forEach(r => {
    const mKey = String(r[2] || "").trim() || toMonthKey(r[1], PF_CONFIG.TIMEZONE);
    if (mKey !== monthKey) return;
    const type = String(r[3] || "").trim();
    const cat = String(r[4] || "").trim();
    const amt = Number(r[5] || 0);
    if (!cat || !isFinite(amt)) return;
    if (type === "Expense") {
      spent[cat] = (spent[cat] || 0) + amt;
    } else if (type === "Reimbursement") {
      spent[cat] = (spent[cat] || 0) - amt;
    }
  });
  return spent;
}

function getCurrentCairoMonthProgress_(monthKey) {
  const now = new Date();
  const currentMonthKey = Utilities.formatDate(now, PF_CONFIG.TIMEZONE, "yyyy-MM");
  if (monthKey < currentMonthKey) return 1;
  if (monthKey > currentMonthKey) return 0;
  const day = parseInt(Utilities.formatDate(now, PF_CONFIG.TIMEZONE, "d"), 10);
  const y = parseInt(monthKey.slice(0, 4), 10);
  const m = parseInt(monthKey.slice(5, 7), 10);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return daysInMonth > 0 ? day / daysInMonth : 0;
}

function checkAndSendBudgetAlerts(ss, optMonthKey, optDryRun) {
  const targetSs = ss || getMasterSpreadsheet_();
  const cfg = readBudgetsConfigFromSheet_(targetSs);
  const dash = targetSs.getSheetByName(PF_CONFIG.SHEETS.DASHBOARD);
  const monthKey = optMonthKey || (dash ? String(dash.getRange("G3").getDisplayValue() || "").trim() : "") ||
    Utilities.formatDate(new Date(), PF_CONFIG.TIMEZONE, "yyyy-MM");

  const spentByCat = getSpentByCategoryForMonth_(targetSs, monthKey);
  const progress = getCurrentCairoMonthProgress_(monthKey);
  const statuses = evaluateBudgetStatuses(cfg.budgets, spentByCat, progress, cfg.fastPaceMargin);

  const props = (typeof PropertiesService !== "undefined" && PropertiesService.getDocumentProperties)
    ? PropertiesService.getDocumentProperties()
    : null;

  const triggeredAlerts = [];
  statuses.forEach(st => {
    const level = st.shouldWarn100 ? "100" : (st.shouldWarn80 ? "80" : null);
    if (!level) return;

    const key = buildAlertKey(monthKey, st.category, level);
    const alreadySent = props ? props.getProperty(key) : null;
    if (!alreadySent) {
      triggeredAlerts.push({ ...st, level, key });
    }
  });

  if (triggeredAlerts.length > 0 && !optDryRun && cfg.alertEmail && typeof MailApp !== "undefined") {
    const rowsHtml = triggeredAlerts.map(a => {
      const badgeColor = a.level === "100" ? "#c5221f" : "#b06000";
      const pctText = (a.pct * 100).toFixed(1) + "%";
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:bold;">${a.category}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">EGP ${a.spent.toFixed(2)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">EGP ${a.budget.toFixed(2)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">EGP ${a.remaining.toFixed(2)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;color:${badgeColor};font-weight:bold;">${pctText} (${a.status})</td>
      </tr>`;
    }).join("");

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;border:1px solid #dadce0;border-radius:8px;overflow:hidden;">
        <div style="background:#1b5e20;color:#fff;padding:16px 20px;">
          <h2 style="margin:0;font-size:18px;">Personal Financials — Budget Threshold Alert (${monthKey})</h2>
        </div>
        <div style="padding:16px 20px;color:#202124;">
          <p style="margin-top:0;">One or more spending categories crossed your budget alert threshold:</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f1f3f4;text-align:left;">
                <th style="padding:8px 12px;">Category</th>
                <th style="padding:8px 12px;">Spent</th>
                <th style="padding:8px 12px;">Budget</th>
                <th style="padding:8px 12px;">Remaining</th>
                <th style="padding:8px 12px;">Status</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          <p style="margin-top:16px;font-size:12px;color:#5f6368;">
            Open <a href="${targetSs.getUrl()}">Personal Financials</a> to review your Monthly Dashboard or adjust budgets in <b>Budgets &amp; Recurring</b>.
          </p>
        </div>
      </div>`;

    MailApp.sendEmail({
      to: cfg.alertEmail,
      subject: `[Personal Financials] Budget Alert (${monthKey}): ${triggeredAlerts.map(a => a.category).join(", ")}`,
      htmlBody
    });

    if (props) {
      triggeredAlerts.forEach(a => props.setProperty(a.key, new Date().toISOString()));
    }
  }

  return { monthKey, statuses, triggeredAlerts };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    evaluateBudgetStatuses,
    buildAlertKey
  };
}
