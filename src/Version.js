/**
 * Auto-stamped code version metadata for Personal Financials.
 * Updated automatically by tools/stamp_version.js before clasp push.
 */
function getCodeVersionInfo() {
  return {
    gitSha: "006341c",
    dirty: true,
    stampedAt: "2026-11-25T23:07:08.510Z"
  };
}

function getCodeVersion() {
  const info = getCodeVersionInfo();
  const sha = (info && info.gitSha) ? String(info.gitSha).trim() : "unknown";
  return info && info.dirty ? (sha + "*") : sha;
}
