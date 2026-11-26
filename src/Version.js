/**
 * Auto-stamped code version metadata for Personal Financials.
 * Updated automatically by tools/stamp_version.js before clasp push.
 */
function getCodeVersionInfo() {
  return {
    gitSha: "81afbb6",
    dirty: true,
    stampedAt: "2026-11-26T19:15:39.261Z"
  };
}

function getCodeVersion() {
  const info = getCodeVersionInfo();
  const sha = (info && info.gitSha) ? String(info.gitSha).trim() : "unknown";
  return info && info.dirty ? (sha + "*") : sha;
}
