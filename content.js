
// ==== SAFETY GUARD: never run on scanner/QI apps ====
const DISABLE_ON = [
  /#OutboundVerificationScan/i,
  /\/QIValidation/i,
  /OutboundVerificationScan/i,
];
if (DISABLE_ON.some(r => r.test(location.href) || r.test(location.hash))) {
  console.log("[EWM Dot Monitor] disabled on QI/scanner page:", location.href);
  // 不注册任何监听器，避免干扰扫码输入
  throw new Error("EWM Dot Monitor disabled on QI/scanner page");
}

console.log("[EWM Dot Monitor] injected:", location.href, "top?", window.top === window);

// =====================
// CONFIG
// =====================

// Scanning
const PERIODIC_SCAN_MS = 2500;
const SCAN_DEBOUNCE_MS = 200;

// Toasts (1-line only)
const ENABLE_TOAST = true;
const TOAST_HIDE_MS = 5000;
const TOAST_COOLDOWN_MS = 8000; // avoid spam

// Borders
const PERSIST_BORDERS = true;
const OUTLINE_RED = "#d13438";
const OUTLINE_YELLOW = "#ffb900";

// Release All lock behavior
// IMPORTANT: once locked, it stays locked until refresh.
const ENABLE_LOCK_RELEASE_ALL = true;

// Candidate selector for status icons (works for both pages)
const ICON_CANDIDATE_SELECTOR =
  'svg[data-sap-ls-svg-inline="true"][ct="IMG"], svg[title^="Status"]';

// Old style (Status text)
const RE_GREEN = /status\s*green/i;
const RE_YELLOW = /status\s*yellow/i;
const RE_RED = /status\s*red/i;

// New style icon suffix + ledx styles
const ICON_LEDR = /ledr/i;
const ICON_LEDY = /ledy/i;
const ICON_LEDG = /ledg/i;
const ICON_RED = /(?:^|[_#])[^"' ]*_r(?:\b|$)/i;
const ICON_YELLOW = /(?:^|[_#])[^"' ]*_y(?:\b|$)/i;
const ICON_GREEN = /(?:^|[_#])[^"' ]*_g(?:\b|$)/i;

// STRICT Release All identifiers (your exact button)
const RELEASE_ALL_EXACT_TITLE = "Release all simulated waves. (F9)";
const RELEASE_ALL_TARGET_SID = "wnd[0]/tbar[1]/btn[9]";
const RELEASE_ALL_TOOLBAR_SUFFIX = "btn[9]-r";

// =====================
// STATE
// =====================
let cssInjected = false;
let observerStarted = false;
let scanTimer = null;

const persistedBad = new WeakSet();

// Current scan results (not sticky)
let hasRedNow = false;
let hasYellowNow = false;

// Sticky lock: once true, NEVER becomes false until refresh
let releaseAllLocked = false;

// Cache button node (SAP may rerender; we re-find if detached)
let cachedReleaseAllBtn = null;

// Toast spam control
let lastToastAt = 0;
let lastToastType = ""; // "red"|"yellow"

// =====================
// CSS + Toast
// =====================
function injectCssOnce() {
  if (cssInjected) return;
  cssInjected = true;

  const style = document.createElement("style");
  style.id = "ewm-dot-monitor-style";
  style.textContent = `
    .ewmDotBadRed { outline: 4px solid ${OUTLINE_RED} !important; outline-offset: 2px !important; }
    .ewmDotBadYellow { outline: 4px solid ${OUTLINE_YELLOW} !important; outline-offset: 2px !important; }

    .ewmReleaseLocked {
      opacity: 0.45 !important;
      filter: grayscale(35%) !important;
      cursor: not-allowed !important;
    }

    #ewm-toast {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 999999;
      color: #fff;
      padding: 10px 12px;
      border-radius: 8px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.2);
      max-width: 520px;
      font-size: 13px;
      line-height: 1.25;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: none;
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  if (!document.getElementById("ewm-toast")) {
    const toast = document.createElement("div");
    toast.id = "ewm-toast";
    document.documentElement.appendChild(toast);
  }
}

function showToastOneLine(type, message) {
  if (!ENABLE_TOAST) return;

  const now = Date.now();
  if (now - lastToastAt < TOAST_COOLDOWN_MS && type === lastToastType) return;

  lastToastAt = now;
  lastToastType = type;

  injectCssOnce();
  const toast = document.getElementById("ewm-toast");
  if (!toast) return;

  const bg =
    type === "yellow" ? OUTLINE_YELLOW :
    type === "green" ? "#107c10" :
    OUTLINE_RED;

  toast.style.background = bg;
  toast.textContent = message;
  toast.style.display = "block";

  setTimeout(() => {
    toast.style.display = "none";
  }, TOAST_HIDE_MS);
}

// =====================
// Icon helpers
// =====================
function getUseHref(svg) {
  const useEl = svg?.querySelector?.("use");
  if (!useEl) return "";
  return (
    useEl.getAttribute("href") ||
    useEl.getAttributeNS("http://www.w3.org/1999/xlink", "href") ||
    ""
  );
}

function getIconFromLsdata(svg) {
  const lsdata = svg.getAttribute("lsdata") || "";
  const m = lsdata.match(/svg#([a-z0-9_]+)/i);
  return m ? m[1] : "";
}

function classifyIcon(svg) {
  const title = svg.getAttribute("title") || "";
  const lsdata = svg.getAttribute("lsdata") || "";
  const href = getUseHref(svg);
  const iconFromLsdata = getIconFromLsdata(svg);

  const combinedText = `${title} ${lsdata}`.toLowerCase();
  const combinedIcon = `${href} ${iconFromLsdata}`.toLowerCase();

  // Old style
  if (RE_RED.test(combinedText)) return "red";
  if (RE_YELLOW.test(combinedText)) return "yellow";
  if (RE_GREEN.test(combinedText)) return "green";

  // New style
  if (ICON_LEDR.test(combinedIcon) || ICON_RED.test(combinedIcon)) return "red";
  if (ICON_LEDY.test(combinedIcon) || ICON_YELLOW.test(combinedIcon)) return "yellow";
  if (ICON_LEDG.test(combinedIcon) || ICON_GREEN.test(combinedIcon)) return "green";

  return "unknown";
}

// =====================
// Borders (persistent)
// =====================
function applyBordersToAll(icons) {
  injectCssOnce();

  for (const svg of icons) {
    const state = classifyIcon(svg);
    const alreadyPersisted = persistedBad.has(svg);

    if (state === "red") {
      svg.classList.add("ewmDotBadRed");
      svg.classList.remove("ewmDotBadYellow");
      if (PERSIST_BORDERS) persistedBad.add(svg);
      continue;
    }

    if (state === "yellow") {
      svg.classList.add("ewmDotBadYellow");
      svg.classList.remove("ewmDotBadRed");
      if (PERSIST_BORDERS) persistedBad.add(svg);
      continue;
    }

    // green/unknown
    if (!PERSIST_BORDERS) {
      svg.classList.remove("ewmDotBadRed", "ewmDotBadYellow");
    } else {
      if (!alreadyPersisted) svg.classList.remove("ewmDotBadRed", "ewmDotBadYellow");
    }
  }
}

// =====================
// Release All strict finder + lock
// =====================
function findReleaseAllButtonStrict() {
  if (cachedReleaseAllBtn && document.contains(cachedReleaseAllBtn)) return cachedReleaseAllBtn;

  // 1) SID in lsdata (most stable, avoids wrong button)
  let el = Array.from(document.querySelectorAll(`[ct="B"][role="button"][lsdata]`))
    .find(x => (x.getAttribute("lsdata") || "").includes(RELEASE_ALL_TARGET_SID));
  if (el) return (cachedReleaseAllBtn = el);

  // 2) Exact title
  el = document.querySelector(`[ct="B"][role="button"][title="${CSS.escape(RELEASE_ALL_EXACT_TITLE)}"]`);
  if (el) return (cachedReleaseAllBtn = el);

  // 3) toolbar suffix
  el = Array.from(document.querySelectorAll(`[ct="B"][role="button"][data-toolbaritem-id]`))
    .find(x => (x.getAttribute("data-toolbaritem-id") || "").endsWith(RELEASE_ALL_TOOLBAR_SUFFIX));
  if (el) return (cachedReleaseAllBtn = el);

  return null;
}

function applyReleaseAllLockedStyle() {
  if (!ENABLE_LOCK_RELEASE_ALL) return;
  if (!releaseAllLocked) return;

  const btn = findReleaseAllButtonStrict();
  if (!btn) return;

  injectCssOnce();

  // Keep it looking disabled
  btn.classList.add("ewmReleaseLocked");
  btn.setAttribute("aria-disabled", "true");
  btn.dataset.ewmLocked = "1";

  if (!btn.dataset.ewmOrigTitle) btn.dataset.ewmOrigTitle = btn.getAttribute("title") || "";
  btn.setAttribute("title", "Locked by monitor (refresh to re-enable).");

  // Don’t allow tab focus
  btn.setAttribute("tabindex", "-1");
}

// =====================
// HARD BLOCKERS (click/pointer + F9)
// =====================
function hardBlockEvent(e, toastMsg) {
  try { e.preventDefault(); } catch {}
  try { e.stopPropagation(); } catch {}
  try { e.stopImmediatePropagation(); } catch {}
  showToastOneLine("red", toastMsg);
}

function hookHardBlockersEarly() {
  // Block pointer/mouse/click BEFORE SAP "Press" handler
  const blockPointer = (e) => {
    if (!ENABLE_LOCK_RELEASE_ALL) return;
    if (!releaseAllLocked) return;

    const btn = findReleaseAllButtonStrict();
    if (!btn) return;

    const t = e.target;
    const inside = (t === btn) || (btn.contains && btn.contains(t));
    if (!inside) return;

    hardBlockEvent(e, "Release All is locked (refresh to re-enable).");
  };

  // Capture phase (earliest)
  document.addEventListener("pointerdown", blockPointer, true);
  document.addEventListener("mousedown", blockPointer, true);
  document.addEventListener("mouseup", blockPointer, true);
  document.addEventListener("touchstart", blockPointer, true);
  document.addEventListener("click", blockPointer, true);

  // F9 blocker
  const keyHandler = (e) => {
    const isF9 = (e.key === "F9") || (e.code === "F9") || (e.keyCode === 120);
    if (!isF9) return;

    // only if the release-all exists in this document and lock is active
    if (!ENABLE_LOCK_RELEASE_ALL || !releaseAllLocked) return;
    if (!findReleaseAllButtonStrict()) return;

    hardBlockEvent(e, "F9 blocked — Release All is locked.");
  };

  window.addEventListener("keydown", keyHandler, { capture: true });
  window.addEventListener("keypress", keyHandler, { capture: true });
  window.addEventListener("keyup", keyHandler, { capture: true });

  document.addEventListener("keydown", keyHandler, true);
  document.addEventListener("keypress", keyHandler, true);
  document.addEventListener("keyup", keyHandler, true);

  console.log("[EWM Dot Monitor] hard blockers attached (pointer/mouse/click + F9).");
}

// Hook immediately (works best with run_at=document_start)
hookHardBlockersEarly();

// =====================
// Scan + Act
// =====================
function scanAndAct() {
  const icons = Array.from(document.querySelectorAll(ICON_CANDIDATE_SELECTOR));
  if (!icons.length) {
    // Even if icons aren't currently in DOM (virtualized), keep re-applying lock style.
    applyReleaseAllLockedStyle();
    return;
  }

  applyBordersToAll(icons);

  // Compute current state
  hasRedNow = false;
  hasYellowNow = false;

  for (const svg of icons) {
    const s = classifyIcon(svg);
    if (s === "red") hasRedNow = true;
    else if (s === "yellow") hasYellowNow = true;
    if (hasRedNow && hasYellowNow) break;
  }

  // Sticky lock rule:
  // Once any red/yellow is ever seen -> lock permanently until refresh.
  if (ENABLE_LOCK_RELEASE_ALL && !releaseAllLocked && (hasRedNow || hasYellowNow)) {
    releaseAllLocked = true;

    // One-line toast (simple)
    if (hasRedNow) showToastOneLine("red", "🔴 RED detected — Release All locked.");
    else showToastOneLine("yellow", "🟡 YELLOW detected — Release All locked.");
  } else {
    // If already locked, keep it locked (do not unlock)
    // Optional: if you want a yellow->red upgrade toast when already locked:
    if (releaseAllLocked && hasRedNow) {
      // Only show if last toast wasn't red recently
      showToastOneLine("red", "🔴 RED detected — Release All locked.");
    }
  }

  // Apply lock style continuously (SAP may rerender toolbar)
  applyReleaseAllLockedStyle();
}

function scheduleScan() {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scanAndAct();
  }, SCAN_DEBOUNCE_MS);
}

// =====================
// Observer + forever boot
// =====================
function startObserver() {
  if (observerStarted) return;
  observerStarted = true;

  const obs = new MutationObserver(scheduleScan);
  obs.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["title", "lsdata", "class", "style", "href", "xlink:href"]
  });

  // Periodic scan forever (also re-locks button after SAP rerender)
  setInterval(scheduleScan, PERIODIC_SCAN_MS);

  console.log("[EWM Dot Monitor] monitoring started in:", location.href);
  scheduleScan();
}

// Boot: start observer once either icons or the toolbar button exists.
// This ensures the lock can apply even before icons render.
setInterval(() => {
  if (observerStarted) return;

  const iconCount = document.querySelectorAll(ICON_CANDIDATE_SELECTOR).length;
  const btnExists = !!findReleaseAllButtonStrict();

  if (iconCount > 0 || btnExists) {
    startObserver();
  }
}, 800);