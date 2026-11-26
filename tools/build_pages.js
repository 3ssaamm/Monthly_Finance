#!/usr/bin/env node
/**
 * Builds the standalone, banner-free GitHub Pages PWA inside docs/ directly from WebApp.html.
 * Never embeds DEFAULT_WEBAPP_KEY into static artifacts.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { PF_CONFIG } = require("../src/Config");

const ROOT = path.resolve(__dirname, "..");
const SRC_HTML = path.join(ROOT, "WebApp.html");
const DOCS_DIR = path.join(ROOT, "docs");

function assertReplace(source, target, replacement, label) {
  if (typeof target === "string") {
    if (source.indexOf(target) === -1) {
      throw new Error(`Expected marker not found in WebApp.html: ${label}`);
    }
    return source.replace(target, replacement);
  }
  if (!target.test(source)) {
    throw new Error(`Expected pattern not matched in WebApp.html: ${label}`);
  }
  return source.replace(target, replacement);
}

/**
 * Generates a valid 180x180 RGBA PNG icon (#1b5e20 rounded badge with a crisp white wallet/coin glyph).
 */
function buildAppleTouchIconPng(size) {
  const w = size;
  const h = size;
  const raw = Buffer.alloc(h * (1 + w * 4));

  const bgR = 0x1b, bgG = 0x5e, bgB = 0x20;
  const fgR = 0xff, fgG = 0xff, fgB = 0xff;
  const accR = 0xc8, accG = 0xe6, accB = 0xc9;

  function inRoundedRect(x, y, rx, ry, rw, rh, rad) {
    if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false;
    const cx = x < rx + rad ? rx + rad : (x >= rx + rw - rad ? rx + rw - rad - 1 : x);
    const cy = y < ry + rad ? ry + rad : (y >= ry + rh - rad ? ry + rh - rad - 1 : y);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= rad * rad;
  }

  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + w * 4);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < w; x++) {
      let r = bgR, g = bgG, b = bgB;

      // Subtle darker emerald outer frame border
      if (!inRoundedRect(x, y, 6, 6, w - 12, h - 12, 30)) {
        r = 0x14; g = 0x48; b = 0x18;
      }

      // Main white wallet card body (36..144 x 48..132)
      if (inRoundedRect(x, y, 36, 48, 108, 84, 16)) {
        r = fgR; g = fgG; b = fgB;
      }

      // Inner flap / card top stripe cutout
      if (inRoundedRect(x, y, 48, 60, 84, 14, 6)) {
        r = accR; g = accG; b = accB;
      }

      // Green coin clasp notch on the right side of the wallet
      const dx = x - 122;
      const dy = y - 96;
      if (dx * dx + dy * dy <= 14 * 14) {
        r = bgR; g = bgG; b = bgB;
      }
      if (dx * dx + dy * dy <= 7 * 7) {
        r = fgR; g = fgG; b = fgB;
      }

      const px = rowStart + 1 + x * 4;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = 255;
    }
  }

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function build() {
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }

  let html = fs.readFileSync(SRC_HTML, "utf8").replace(/\r\n/g, "\n");

  // 1. Replace Apps Script <base> tag with PWA title & icons
  html = assertReplace(
    html,
    '  <base target="_top">',
    [
      '  <meta charset="utf-8">',
      '  <title>Personal Financials — Quick Entry</title>',
      '  <meta name="theme-color" content="#1b5e20">',
      '  <link rel="manifest" href="./manifest.json">',
      '  <link rel="apple-touch-icon" href="./apple-touch-icon.png">',
      '  <link rel="icon" type="image/svg+xml" href="./icon.svg">'
    ].join("\n"),
    "<base target=\"_top\">"
  );

  // 2. Replace template-injected constants with static browser bootstrap (NO secret key embedded)
  const templateVarsRegex = /\s*const INITIAL_KEY = cleanStr\(<\?!=\s*JSON\.stringify\(initialKey \|\| ""\)\s*\?>\);\r?\n\s*const EXEC_URL = cleanStr\(<\?!=\s*JSON\.stringify\(execUrl \|\| ""\)\s*\?>\);\r?\n\s*const INITIAL_STATE = <\?!=\s*initialStateJson \|\| "null"\s*\?>;/;
  const staticVarsReplacement = `
    const URL_PARAMS = new URLSearchParams(window.location.search);
    const INITIAL_KEY = cleanStr(URL_PARAMS.get("k") || "");
    if (INITIAL_KEY && window.history && window.history.replaceState) {
      try { window.history.replaceState({}, document.title, window.location.pathname); } catch (_) {}
    }
    const EXEC_URL = ${JSON.stringify(PF_CONFIG.WEBAPP_EXEC_URL)};
    const INITIAL_STATE = (function () {
      try {
        const cached = localStorage.getItem("pf_cached_state");
        return cached ? JSON.parse(cached) : null;
      } catch (_) { return null; }
    })();`;
  html = assertReplace(html, templateVarsRegex, staticVarsReplacement, "templateVars");

  // 3. Cache state inside renderState(s) for 0ms instant reopen on iPhone
  html = assertReplace(
    html,
    "    function renderState(s) {\n      showAppBody();\n      state = s;",
    "    function renderState(s) {\n      showAppBody();\n      state = s;\n      try { localStorage.setItem(\"pf_cached_state\", JSON.stringify(s)); } catch (_) {}",
    "renderState(s)"
  );

  // 4. Always refresh state in background when key is present & clear stale cache on auth failure
  const bootRegex = /\s*if \(INITIAL_STATE\) \{\r?\n\s*renderState\(INITIAL_STATE\);\r?\n\s*\} else if \(accessKey\) \{\r?\n\s*callBackend\("getState", \{\}\)\r?\n\s*\.then\(res => renderState\(res\.state\)\)\r?\n\s*\.catch\(\(\) => showLockScreen\("Open using your private link \(\?k=\.\.\.\) or enter your key\."\)\);\r?\n\s*\} else \{\r?\n\s*showLockScreen\("Open using your private link \(\?k=\.\.\.\) or enter your key\."\);\r?\n\s*\}/;
  const staticBootReplacement = `
    if (accessKey) {
      if (INITIAL_STATE) {
        renderState(INITIAL_STATE);
      }
      callBackend("getState", {})
        .then(res => renderState(res.state))
        .catch(err => {
          const msg = String((err && err.message) || err || "");
          if (/Unauthorized/i.test(msg) || !INITIAL_STATE) {
            try { localStorage.removeItem("pf_cached_state"); } catch (_) {}
            showLockScreen("Open using your private link (?k=...) or enter your key.");
          }
        });
    } else {
      showLockScreen("Open using your private link (?k=...) or enter your key.");
    }`;
  html = assertReplace(html, bootRegex, staticBootReplacement, "bootBlock");

  if (html.indexOf("<?") !== -1) {
    throw new Error("Unrendered Apps Script template tag detected in generated docs/index.html");
  }
  if (PF_CONFIG.DEFAULT_WEBAPP_KEY && html.indexOf(PF_CONFIG.DEFAULT_WEBAPP_KEY) !== -1) {
    throw new Error("Security violation: DEFAULT_WEBAPP_KEY must never appear in docs/index.html");
  }

  fs.writeFileSync(path.join(DOCS_DIR, "index.html"), html.replace(/\r\n/g, "\n"), "utf8");
  fs.writeFileSync(path.join(DOCS_DIR, ".nojekyll"), "", "utf8");

  const manifest = {
    name: "Personal Financials",
    short_name: "Financials",
    start_url: "./",
    display: "standalone",
    background_color: "#f6f8f7",
    theme_color: "#1b5e20",
    icons: [
      { src: "./icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "./apple-touch-icon.png", sizes: "180x180", type: "image/png" }
    ]
  };
  fs.writeFileSync(path.join(DOCS_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">',
    '  <rect width="180" height="180" rx="38" fill="#1b5e20"/>',
    '  <rect x="36" y="48" width="108" height="84" rx="16" fill="#ffffff"/>',
    '  <rect x="48" y="60" width="84" height="14" rx="6" fill="#c8e6c9"/>',
    '  <circle cx="122" cy="96" r="14" fill="#1b5e20"/>',
    '  <circle cx="122" cy="96" r="7" fill="#ffffff"/>',
    '</svg>'
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(DOCS_DIR, "icon.svg"), svg, "utf8");

  fs.writeFileSync(path.join(DOCS_DIR, "apple-touch-icon.png"), buildAppleTouchIconPng(180));
  console.log("Built banner-free GitHub Pages PWA into docs/");
}

build();
