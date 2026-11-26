/**
 * Auto-stamped code version metadata for Personal Financials.
 * Updated automatically by tools/stamp_version.js before clasp push.
 */
function getCodeVersionInfo() {
  return {
    gitSha: "1d8df70",
    dirty: true,
    stampedAt: "2026-11-26T18:51:28.078Z"
  };
}

function getCodeVersion() {
  const info = getCodeVersionInfo();
  const sha = (info && info.gitSha) ? String(info.gitSha).trim() : "unknown";
  return info && info.dirty ? (sha + "*") : sha;
}
