/**
 * Central configuration, constants, and pure parsing/categorization helpers.
 * NOTE: Apps Script V8 file load order is arbitrary — only read PF_CONFIG inside function bodies.
 */

const PF_CONFIG = {
  SPREADSHEET_TITLE: "Personal Financials",
  MASTER_SPREADSHEET_ID: "1fW72r2bvYswRtHyySlReRRkMgUVosDU7HqKAM-kdtZc",
  TIMEZONE: "Africa/Cairo",
  CURRENCY_FORMAT: '"EGP "#,##0.00',
  USD_FORMAT: '"$"#,##0.00',
  ALERT_EMAIL: "muhammad.essam811@gmail.com",
  EMAIL_RECIPIENTS: ["muhammad.essam811@gmail.com", "midoessam704@gmail.com"],
  DEFAULT_WEBAPP_KEY: "",
  WEBAPP_EXEC_URL: "https://script.google.com/macros/s/AKfycbx5TOdjYW66TCIjmWC8QSMZQKVj6q1oal4BJVJSMtUFRy_cxNxN8SeT3ek_EdyuCUEIpA/exec",
  GITHUB_PAGES_URL: "https://3ssaamm.github.io/Monthly_Finance/",
  NBE_CREDIT_ID: "1MLFFa0JI0jatCW1ZE6TXrnA4EjU5p0jY9EWQhxPO8Sc",
  LEGACY_FINANCIALS_ID: "1ZmHxw__xSKC-HFz85svsjuppi1G79-7hG9R-h8Yr4gk",
  NBE_SYNC_START_MONTH: "2026-11",
  LEGACY_2026_SHEETS: {
    "2026-04": "1puIvtqiD3wau0-zqj8HGlE1uMt_TKBcCYXs6TDMHQkw",
    "2026-05": "1skSHYNHzpvTYirh5mBeiKxVsmtyYHxq-iQgT87f9PH0",
    "2026-06": "1fJzOuIdid-TdjI_nO9sLOH1pmt-afOhOiQOuQKZw0JU",
    "2026-07": "1I10pMnYiGod27_PIVVzG_i1mdm9PVGseNZDWAqXYaNo",
    "2026-08": "1GJME9FHJY2pautV1cxkbxCJ4NA1mUaoPYhmxLsmjVHI",
    "2026-09": "12plsEzs4UHI_HsYwhIUGAwO2pFegOtFThBVk_feNVL0",
    "2026-10": "1PWXycT6N7fSm1NaGm98hHsBLZEDbUJgsEOMutHkgK8k",
    "2026-11": "1LSkFtcsyfZ-ooyB3hllaEXfWkURVKTt_0x3ALHfNJeM"
  },
  SHEETS: {
    DASHBOARD: "Monthly Dashboard",
    TRANSACTIONS: "Transactions",
    LOANS: "Loans & People",
    INVESTMENTS: "Investments",
    BUDGETS: "Budgets & Recurring",
    YEARLY: "Yearly & Analytics",
    NBE_CACHE: "_NBE_Cache",
    ARCHIVE: "_Archive_Store"
  },
  COLORS: {
    PRIMARY: "#1b5e20",
    PRIMARY_DARK: "#124116",
    PRIMARY_LIGHT: "#e8f5e9",
    HEADER: "#f1f3f4",
    SUBHEADER: "#e8eaed",
    INPUT_BG: "#fffde7",
    OK_BG: "#d9ead3",
    OK_FG: "#137333",
    WARN_BG: "#fff2cc",
    WARN_FG: "#b06000",
    ALERT_BG: "#fce8e6",
    ALERT_FG: "#c5221f",
    INFO_BG: "#e8f0fe",
    INFO_FG: "#1967d2",
    BORDER: "#dadce0",
    ROW_ALT: "#fafafa",
    TEXT_MUTED: "#5f6368"
  },
  CATEGORIES: [
    "Food",
    "Transportation",
    "Family",
    "Education",
    "Personal",
    "Entertainment",
    "Presents",
    "Donation"
  ],
  TX_CATEGORIES: [
    "Food",
    "Transportation",
    "Family",
    "Education",
    "Personal",
    "Entertainment",
    "Presents",
    "Donation",
    "Salary / Income",
    "Transfer"
  ],
  TX_TYPES: [
    "Expense",
    "Income",
    "Reimbursement",
    "Cash Withdrawal",
    "Bank Deposit",
    "CC Bill Payment"
  ],
  WALLETS: [
    "Bank / InstaPay",
    "Cash",
    "NBE Credit Card"
  ],
  LOAN_DIRECTIONS: [
    "Lent / Paid for Them",
    "Repaid to Me"
  ],
  LOAN_WALLETS: [
    "Bank / InstaPay",
    "Cash",
    "NBE Credit Card",
    "Opening Balance"
  ],
  PERSONAL_ASSETS: [
    "USD Cash",
    "Thndr Cloud",
    "Thndr FI Funds"
  ],
  INV_ACTIONS: [
    "Deposit",
    "Withdrawal"
  ],
  INV_WALLETS: [
    "Bank / InstaPay",
    "Cash",
    "Opening Principal"
  ],
  DEFAULT_BUDGETS: [
    { category: "Food", budget: 1000, warnPct: 0.8, emailAlert: true, notes: "Groceries, coffee, snacks, quick meals" },
    { category: "Transportation", budget: 400, warnPct: 0.8, emailAlert: true, notes: "Uber, Careem, transit" },
    { category: "Family", budget: 2500, warnPct: 0.8, emailAlert: true, notes: "Mum, rent share, electricity, cleaning, internet" },
    { category: "Education", budget: 500, warnPct: 0.8, emailAlert: true, notes: "Courses, books, subscriptions" },
    { category: "Personal", budget: 4500, warnPct: 0.8, emailAlert: true, notes: "Gym, phone installment, Vodafone, shopping" },
    { category: "Entertainment", budget: 3500, warnPct: 0.8, emailAlert: true, notes: "Outings, cafes, Prime, games" },
    { category: "Presents", budget: 500, warnPct: 0.8, emailAlert: true, notes: "Gifts and occasions" },
    { category: "Donation", budget: 500, warnPct: 0.8, emailAlert: true, notes: "Charity and donations" }
  ],
  DEFAULT_RECURRING: [
    { name: "Phone Installment", category: "Personal", expected: 3000, dueDay: 7, keyword: "phone" },
    { name: "Gym Membership", category: "Personal", expected: 800, dueDay: 11, keyword: "gym" },
    { name: "Phone Credit / Vodafone", category: "Personal", expected: 165, dueDay: 7, keyword: "phone credit" },
    { name: "Amazon Prime", category: "Entertainment", expected: 29, dueDay: 10, keyword: "prime" },
    { name: "Mum / Family Support", category: "Family", expected: 1300, dueDay: 10, keyword: "mum" },
    { name: "Rent Share", category: "Family", expected: 200, dueDay: 10, keyword: "rent" },
    { name: "Electricity & Cleaning", category: "Family", expected: 400, dueDay: 11, keyword: "electricity" }
  ],
  DEFAULT_CATEGORY_RULES: [
    { keywords: "buffalo|fathalla|indomi|egg|milk|coffee|coco|drink|bread|abo ahmed|sahl|restaurant|shawerma|kfc|mcdonald|kababgy|chocolate|krispy|mahfouz", category: "Food", priority: 1 },
    { keywords: "cavalli|out|rabit|prime|cinema|steam|epic|youtube|spotify|playstation|cafe|roastery|frenzy|old street|el rayes", category: "Entertainment", priority: 2 },
    { keywords: "amazon|noon|vodafone|gym|phone|shaving|instapay|fawry|shirt|laptop|basata|pharmacy|shein|queblinic|khattab", category: "Personal", priority: 3 },
    { keywords: "mum|dad|rent|electricity|cleaning|we-fbb|internet|zoza|tooth|homeland", category: "Family", priority: 4 },
    { keywords: "uber|careem|shatbi|metro|bus|indrive|swvl|total|chillout", category: "Transportation", priority: 5 },
    { keywords: "nadia|raoon|charity|zakat|donation|resala", category: "Donation", priority: 6 },
    { keywords: "gift|torta|present|flower", category: "Presents", priority: 7 },
    { keywords: "course|book|udemy|coursera|linkedin", category: "Education", priority: 8 }
  ],
  MONTH_NAMES: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ]
};

/**
 * Safely parses numeric values or simple arithmetic expressions like "=276+110-1.71" without eval().
 */
function evalSimpleMathExpr(raw) {
  if (typeof raw === "number") return isFinite(raw) ? raw : NaN;
  const s = String(raw === null || raw === undefined ? "" : raw)
    .replace(/EGP|£|\$|,/gi, "")
    .replace(/[\u00A0\s]+/g, "")
    .trim();
  if (!s) return NaN;

  const expr = s.startsWith("=") ? s.slice(1) : s;
  if (!/^[0-9+\-*/().]+$/.test(expr)) return NaN;

  const tokens = expr.match(/(\d+(?:\.\d+)?|\+|\-|\*|\/|\(|\))/g);
  if (!tokens || tokens.join("") !== expr) return NaN;

  let pos = 0;
  function peek() { return tokens[pos]; }
  function consume() { return tokens[pos++]; }

  function parseExpression() {
    let val = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const rhs = parseTerm();
      val = op === "+" ? val + rhs : val - rhs;
    }
    return val;
  }

  function parseTerm() {
    let val = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = consume();
      const rhs = parseFactor();
      if (op === "/") {
        if (rhs === 0) throw new Error("Division by zero");
        val = val / rhs;
      } else {
        val = val * rhs;
      }
    }
    return val;
  }

  function parseFactor() {
    const tok = peek();
    if (tok === "+") { consume(); return parseFactor(); }
    if (tok === "-") { consume(); return -parseFactor(); }
    if (tok === "(") {
      consume();
      const val = parseExpression();
      if (consume() !== ")") throw new Error("Mismatched parentheses");
      return val;
    }
    const num = Number(consume());
    if (!isFinite(num)) throw new Error("Invalid number");
    return num;
  }

  try {
    const out = parseExpression();
    if (pos !== tokens.length || !isFinite(out)) return NaN;
    return Math.round(out * 100) / 100;
  } catch (e) {
    return NaN;
  }
}

/**
 * Parses Date objects, Sheets serial numbers, ISO strings, and English date strings into YYYY-MM-DD.
 */
function parseDateStrict(rawDate, tz) {
  if (rawDate === null || rawDate === undefined || rawDate === "") return null;
  const targetTz = tz || "Africa/Cairo";

  if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
    if (typeof Utilities !== "undefined" && Utilities.formatDate) {
      const iso = Utilities.formatDate(rawDate, targetTz, "yyyy-MM-dd");
      const p = iso.split("-").map(Number);
      return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12, 0, 0));
    }
    return new Date(Date.UTC(rawDate.getUTCFullYear(), rawDate.getUTCMonth(), rawDate.getUTCDate(), 12, 0, 0));
  }

  if (typeof rawDate === "number" && rawDate > 30000) {
    const utcMs = Math.round((rawDate - 25569) * 86400 * 1000);
    const dObj = new Date(utcMs);
    if (!isNaN(dObj.getTime())) {
      return new Date(Date.UTC(dObj.getUTCFullYear(), dObj.getUTCMonth(), dObj.getUTCDate(), 12, 0, 0));
    }
  }

  const s = String(rawDate).trim();
  if (!s) return null;

  const isoMatch = s.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
  if (isoMatch) {
    return new Date(Date.UTC(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10), 12, 0, 0));
  }

  const dmyMatch = s.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{4})/);
  if (dmyMatch) {
    let day = parseInt(dmyMatch[1], 10);
    let month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    if (parseInt(dmyMatch[2], 10) > 12 && day <= 12) {
      day = parseInt(dmyMatch[2], 10);
      month = parseInt(dmyMatch[1], 10) - 1;
    }
    return new Date(Date.UTC(year, month, day, 12, 0, 0));
  }

  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mdyWord = s.match(/(?:[a-zA-Z]+,\s*)?([a-zA-Z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (mdyWord) {
    const mIdx = months.indexOf(mdyWord[1].toLowerCase().slice(0, 3));
    if (mIdx >= 0) {
      return new Date(Date.UTC(parseInt(mdyWord[3], 10), mIdx, parseInt(mdyWord[2], 10), 12, 0, 0));
    }
  }

  const dmyWord = s.match(/(\d{1,2})[-\/\.\s]+([a-zA-Z]{3,9})[-\/\.\s]+(\d{2,4})/);
  if (dmyWord) {
    const mIdx = months.indexOf(dmyWord[2].toLowerCase().slice(0, 3));
    if (mIdx >= 0) {
      let y = parseInt(dmyWord[3], 10);
      if (y < 100) y += 2000;
      return new Date(Date.UTC(y, mIdx, parseInt(dmyWord[1], 10), 12, 0, 0));
    }
  }

  const ts = Date.parse(s);
  if (!isNaN(ts)) {
    const dObj = new Date(ts);
    return new Date(Date.UTC(dObj.getUTCFullYear(), dObj.getUTCMonth(), dObj.getUTCDate(), 12, 0, 0));
  }
  return null;
}

function formatDateIso(dateObj) {
  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return "";
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toMonthKey(rawDate, tz) {
  const d = parseDateStrict(rawDate, tz);
  if (!d) return "";
  return formatDateIso(d).slice(0, 7);
}

function normalizePersonName(name) {
  const raw = String(name || "").replace(/[\u00A0\s]+/g, " ").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const aliases = {
    abdo: "Abdo",
    abdelrahman: "Abdo",
    dad: "Dad",
    baba: "Dad",
    mum: "Mum",
    mom: "Mum",
    mama: "Mum",
    houda: "Houda",
    hoda: "Houda",
    nourween: "Nourween",
    hager: "Hager",
    mai: "Mai",
    zoza: "Zoza",
    muhanad: "Muhanad",
    mido: "Mido"
  };
  return aliases[lower] || (raw.charAt(0).toUpperCase() + raw.slice(1));
}

function categorizeDescription(desc, customRules) {
  const text = String(desc || "").toLowerCase().trim();
  if (!text) return "Personal";
  const rules = (customRules && customRules.length) ? customRules : PF_CONFIG.DEFAULT_CATEGORY_RULES;
  const sorted = rules.slice().sort((a, b) => (a.priority || 99) - (b.priority || 99));
  for (let i = 0; i < sorted.length; i++) {
    const kwStr = String(sorted[i].keywords || "").trim();
    if (!kwStr) continue;
    const parts = kwStr.split("|").map(k => k.trim().toLowerCase()).filter(Boolean);
    for (let j = 0; j < parts.length; j++) {
      if (text.indexOf(parts[j]) !== -1) {
        return sorted[i].category;
      }
    }
  }
  return "Personal";
}

function computeWalletBalances(params) {
  const bankAnchor = Number(params.bankAnchor || 0);
  const cashAnchor = Number(params.cashAnchor || 0);
  const transactions = params.transactions || [];
  const loans = params.loans || [];
  const investments = params.investments || [];

  let bankDelta = 0;
  let cashDelta = 0;

  transactions.forEach(tx => {
    const amt = Number(tx.amount || 0);
    if (!isFinite(amt) || amt === 0) return;
    const type = String(tx.type || "").trim();
    const wallet = String(tx.wallet || "").trim();

    if (type === "Income" || type === "Reimbursement") {
      if (wallet === "Bank / InstaPay") bankDelta += amt;
      else if (wallet === "Cash") cashDelta += amt;
    } else if (type === "Expense" || type === "CC Bill Payment") {
      if (wallet === "Bank / InstaPay") bankDelta -= amt;
      else if (wallet === "Cash") cashDelta -= amt;
    } else if (type === "Cash Withdrawal") {
      bankDelta -= amt;
      cashDelta += amt;
    } else if (type === "Bank Deposit") {
      cashDelta -= amt;
      bankDelta += amt;
    }
  });

  loans.forEach(loan => {
    const amt = Number(loan.amount || 0);
    if (!isFinite(amt) || amt === 0) return;
    const dir = String(loan.direction || "").trim();
    const wallet = String(loan.wallet || "").trim();
    const sign = dir === "Repaid to Me" ? 1 : (dir === "Lent / Paid for Them" ? -1 : 0);
    if (wallet === "Bank / InstaPay") bankDelta += sign * amt;
    else if (wallet === "Cash") cashDelta += sign * amt;
  });

  investments.forEach(inv => {
    const amt = Number(inv.amount || 0);
    if (!isFinite(amt) || amt === 0) return;
    const action = String(inv.action || "").trim();
    const wallet = String(inv.wallet || "").trim();
    const sign = action === "Withdrawal" ? 1 : (action === "Deposit" ? -1 : 0);
    if (wallet === "Bank / InstaPay") bankDelta += sign * amt;
    else if (wallet === "Cash") cashDelta += sign * amt;
  });

  return {
    expectedBank: Math.round((bankAnchor + bankDelta) * 100) / 100,
    expectedCash: Math.round((cashAnchor + cashDelta) * 100) / 100,
    bankDelta: Math.round(bankDelta * 100) / 100,
    cashDelta: Math.round(cashDelta * 100) / 100
  };
}

function normalizeTransactionPayload(payload) {
  const p = payload || {};
  const validTypes = PF_CONFIG.TX_TYPES;
  const rawType = String(p.type || "Expense").trim();
  const type = validTypes.indexOf(rawType) !== -1 ? rawType : "Expense";
  const rawCat = String(p.category || "").trim();
  const rawWallet = String(p.wallet || "").trim();
  const rawDetails = String(p.details || "").trim();

  if (type === "Cash Withdrawal") {
    return {
      type,
      category: "Transfer",
      wallet: "Bank / InstaPay",
      details: rawDetails || "ATM Cash Withdrawal",
      affectsBudget: false
    };
  }
  if (type === "Bank Deposit") {
    return {
      type,
      category: "Transfer",
      wallet: "Cash",
      details: rawDetails || "Bank Cash Deposit",
      affectsBudget: false
    };
  }
  if (type === "CC Bill Payment") {
    return {
      type,
      category: "Transfer",
      wallet: rawWallet === "Cash" ? "Cash" : "Bank / InstaPay",
      details: rawDetails || "NBE Credit Card Bill Payment",
      affectsBudget: false
    };
  }
  if (type === "Income") {
    return {
      type,
      category: "Salary / Income",
      wallet: rawWallet === "Cash" ? "Cash" : "Bank / InstaPay",
      details: rawDetails || "Income",
      affectsBudget: false
    };
  }
  return {
    type,
    category: rawCat || "Personal",
    wallet: rawWallet || "Bank / InstaPay",
    details: rawDetails,
    affectsBudget: true
  };
}

function getMasterSpreadsheet_() {
  try {
    const active = (typeof SpreadsheetApp !== "undefined" && SpreadsheetApp.getActiveSpreadsheet)
      ? SpreadsheetApp.getActiveSpreadsheet()
      : null;
    if (active) return active;
  } catch (_) {}
  return SpreadsheetApp.openById(PF_CONFIG.MASTER_SPREADSHEET_ID);
}

function isValidWebAppKey(candidate, expectedKey) {
  const c = String(candidate || "").trim().replace(/^["']+|["']+$/g, "");
  const e = String(expectedKey || "").trim();
  if (!c || !e || c.length !== e.length) return false;
  let diff = 0;
  for (let i = 0; i < e.length; i++) {
    diff |= c.charCodeAt(i) ^ e.charCodeAt(i);
  }
  return diff === 0;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PF_CONFIG,
    evalSimpleMathExpr,
    parseDateStrict,
    formatDateIso,
    toMonthKey,
    normalizePersonName,
    categorizeDescription,
    computeWalletBalances,
    normalizeTransactionPayload,
    getMasterSpreadsheet_,
    isValidWebAppKey
  };
}
