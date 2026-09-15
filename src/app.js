/**
 * app.js
 *
 * UI controller. This file owns DOM wiring only — all math lives in
 * engine/calculationEngine.js and all persistence lives in
 * data/settingsStore.js (local cache) and backend (synced source of truth).
 * Nothing here calls localStorage directly for instrument data.
 */

import {
  calculateTrade,
  resolveDesiredProfit,
  isInstrumentSettingsComplete,
} from "./engine/calculationEngine.js";
import { getInstrument, validateInstrument, loadInstruments } from "./data/settingsStore.js";
import { fetchSettings, saveSettings } from "./api.js";
import { initLogin, showLoginScreen, handleLogout as loginHandleLogout } from "./login.js";

// ---------------------------------------------------------------------------
// Temporary, in-memory trade session state (NOT persisted — see spec §29).
// ---------------------------------------------------------------------------
const tradeSession = {
  instrumentSymbol: null,
  capital: null,
  targetMode: "double", // 'double' | 'custom'
  customProfit: null,
  entry: null,
  sl: null,
  tp: null,
  direction: "buy", // 'buy' | 'sell'
};

// A working, unsaved copy of instrument settings while the Settings page is
// open. Populated from the backend on first load and every time the user
// navigates to Settings.
let settingsDraft = [];

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const el = (id) => document.getElementById(id);

const navLinks = document.querySelectorAll(".nav__link");
const viewPanels = document.querySelectorAll("[data-view-panel]");

const instrumentSelect = el("instrument");
const instrumentStatus = el("instrument-status");
const capitalInput = el("capital");
const customProfitField = el("custom-profit-field");
const desiredProfitInput = el("desired-profit");
const entryInput = el("entry");
const slInput = el("sl");
const tpInput = el("tp");
const calculateBtn = el("calculate-btn");
const resetBtn = el("reset-btn");
const errorsList = el("errors");

const heroResult = el("hero-result");
const resultLotSize = el("result-lot-size");
const resultRrBadge = el("result-rr-badge");
const emptyNote = el("empty-note");
const resultGrid = el("result-grid");

const settingsTable = el("settings-table");
const addInstrumentBtn = el("add-instrument-btn");
const updateSettingsBtn = el("update-settings-btn");
const settingsSaveStatus = el("settings-save-status");
const toastEl = el("toast");

// ---------------------------------------------------------------------------
// Button-press feedback: vibration where the device/browser supports it
// (mainly Android Chrome — iOS Safari does not implement the Vibration API),
// plus an on-screen toast so every button press is confirmed on every device.
// ---------------------------------------------------------------------------
function vibrate(pattern = 12) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Some browsers throw if vibration is blocked (e.g. tab not focused) —
      // never let feedback break the app.
    }
  }
}

let toastTimeout;
function showToast(message, variant = "default") {
  clearTimeout(toastTimeout);
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastEl.className = `toast toast--${variant}`;
  // Force a reflow so the transition re-triggers on repeated toasts.
  void toastEl.offsetWidth;
  toastEl.classList.add("is-visible");
  toastTimeout = setTimeout(() => {
    toastEl.classList.remove("is-visible");
    setTimeout(() => {
      toastEl.hidden = true;
    }, 200);
  }, 2200);
}

/** Success/neutral tap: single short buzz. Error: two short buzzes. */
const HAPTIC_OK = 12;
const HAPTIC_ERROR = [15, 60, 15];

// ---------------------------------------------------------------------------
// Formatting helpers (display only — never used in the math)
// ---------------------------------------------------------------------------
const fmtMoney = (n) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtUnits = (n, unitType) =>
  `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unitType === "tick" ? "ticks" : "pips"}`;

const fmtLots = (n) => n.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".0000").padEnd(6, "0");

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
navLinks.forEach((link) => {
  link.addEventListener("click", async () => {
    vibrate(HAPTIC_OK);
    const target = link.dataset.view;
    navLinks.forEach((l) => l.classList.toggle("is-active", l === link));
    viewPanels.forEach((panel) => {
      panel.hidden = panel.dataset.viewPanel !== target;
    });
    if (target === "settings") {
      settingsSaveStatus.textContent = "";
      await loadSettingsDraft();
      renderSettingsTable();
    }
    // Reset the calculate form when switching back to dashboard
    if (target === "dashboard") {
      showErrors([]);
      clearResults();
    }
  });
});

// Logout button
const logoutBtn = el("logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await loginHandleLogout();
  });
}

// Listen for logout dispatched from login.js
window.addEventListener("ts-logout", () => {
  setAuth(false);
});

// ---------------------------------------------------------------------------
// Dashboard: instrument select
// ---------------------------------------------------------------------------
async function populateInstrumentSelect() {
  const instruments = loadInstruments();
  const previous = instrumentSelect.value;
  instrumentSelect.innerHTML = "";
  instruments.forEach((instrument) => {
    const option = document.createElement("option");
    option.value = instrument.symbol;
    option.textContent = instrument.symbol;
    instrumentSelect.appendChild(option);
  });
  const stillExists = instruments.some((i) => i.symbol === previous);
  instrumentSelect.value = stillExists ? previous : instruments[0]?.symbol || "";
  tradeSession.instrumentSymbol = instrumentSelect.value || null;
  updateInstrumentStatus();
}

function updateInstrumentStatus() {
  const instrument = getInstrument(tradeSession.instrumentSymbol);
  const complete = isInstrumentSettingsComplete(instrument);
  instrumentStatus.textContent = complete
    ? "✓ Instrument settings loaded"
    : "⚠ Instrument settings incomplete — configure it in Settings";
  instrumentStatus.classList.toggle("is-ok", complete);
  instrumentStatus.classList.toggle("is-warn", !complete);
}

instrumentSelect.addEventListener("change", () => {
  tradeSession.instrumentSymbol = instrumentSelect.value;
  updateInstrumentStatus();
});

// ---------------------------------------------------------------------------
// Dashboard: segmented controls (direction, target mode)
// ---------------------------------------------------------------------------
document.querySelectorAll("[data-direction]").forEach((btn) => {
  btn.addEventListener("click", () => {
    vibrate(HAPTIC_OK);
    tradeSession.direction = btn.dataset.direction;
    document.querySelectorAll("[data-direction]").forEach((b) => {
      const active = b === btn;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-checked", String(active));
    });
  });
});

document.querySelectorAll("[data-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    vibrate(HAPTIC_OK);
    tradeSession.targetMode = btn.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((b) => {
      const active = b === btn;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-checked", String(active));
    });
    customProfitField.hidden = tradeSession.targetMode !== "custom";
  });
});

// ---------------------------------------------------------------------------
// Dashboard: calculate / reset
// ---------------------------------------------------------------------------
function showErrors(errors) {
  errorsList.innerHTML = "";
  errors.forEach((message) => {
    const li = document.createElement("li");
    li.textContent = message;
    errorsList.appendChild(li);
  });
  errorsList.hidden = errors.length === 0;
}

function clearResults() {
  resultLotSize.textContent = "—";
  resultRrBadge.textContent = "";
  resultRrBadge.classList.remove("is-warn");
  [
    "result-sl-distance",
    "result-tp-distance",
    "result-required-risk",
    "result-theoretical-lot",
    "result-profit-tp",
    "result-loss-sl",
    "result-capital-tp",
    "result-capital-sl",
  ].forEach((id) => (el(id).textContent = "—"));
  emptyNote.hidden = false;
  resultGrid.style.opacity = "0.45";
}

function renderResult(result, instrument) {
  emptyNote.hidden = true;
  resultGrid.style.opacity = "1";

  resultLotSize.textContent = fmtLots(result.lotSize);
  resultRrBadge.textContent = `RR 1:${result.rr.toFixed(2)}${result.rrBelowThreshold ? " — below 1:2" : ""}`;
  resultRrBadge.classList.toggle("is-warn", result.rrBelowThreshold);

  el("result-sl-distance").textContent = fmtUnits(result.slUnits, instrument.unitType);
  el("result-tp-distance").textContent = fmtUnits(result.tpUnits, instrument.unitType);
  el("result-required-risk").textContent = fmtMoney(result.requiredRisk);
  el("result-theoretical-lot").textContent = result.theoreticalLotSize.toFixed(4);
  el("result-profit-tp").textContent = `+${fmtMoney(result.expectedProfit)}`;
  el("result-loss-sl").textContent = `-${fmtMoney(result.expectedLoss)}`;
  el("result-capital-tp").textContent = fmtMoney(result.capitalAfterTP);
  el("result-capital-sl").textContent = fmtMoney(result.capitalAfterSL);
}

calculateBtn.addEventListener("click", async () => {
  const instrument = getInstrument(tradeSession.instrumentSymbol);

  tradeSession.capital = capitalInput.value === "" ? NaN : Number(capitalInput.value);
  tradeSession.customProfit =
    desiredProfitInput.value === "" ? NaN : Number(desiredProfitInput.value);
  tradeSession.entry = entryInput.value === "" ? NaN : Number(entryInput.value);
  tradeSession.sl = slInput.value === "" ? NaN : Number(slInput.value);
  tradeSession.tp = tpInput.value === "" ? NaN : Number(tpInput.value);

  let desiredProfit;
  try {
    desiredProfit = resolveDesiredProfit(
      tradeSession.targetMode,
      tradeSession.capital,
      tradeSession.customProfit
    );
  } catch {
    desiredProfit = NaN;
  }

  const { valid, errors, result } = calculateTrade({
    instrumentSettings: instrument,
    capital: tradeSession.capital,
    desiredProfit,
    entry: tradeSession.entry,
    sl: tradeSession.sl,
    tp: tradeSession.tp,
    direction: tradeSession.direction,
  });

  if (!valid) {
    vibrate(HAPTIC_ERROR);
    showToast("Check the highlighted inputs", "error");
    showErrors(errors);
    clearResults();
    return;
  }

  vibrate(HAPTIC_OK);
  showToast("Lot size calculated", "success");
  showErrors([]);
  renderResult(result, instrument);
});

resetBtn.addEventListener("click", () => {
  vibrate(HAPTIC_OK);
  showToast("Trade inputs reset");
  capitalInput.value = "";
  desiredProfitInput.value = "";
  entryInput.value = "";
  slInput.value = "";
  tpInput.value = "";
  showErrors([]);
  clearResults();
});

// ---------------------------------------------------------------------------
// Settings page — fetch from backend, not localStorage
// ---------------------------------------------------------------------------
async function loadSettingsDraft() {
  try {
    const result = await fetchSettings();
    if (result.ok && Array.isArray(result.settings)) {
      settingsDraft = result.settings.map((i) => ({ ...i }));
      // Sync the local cache so loadInstruments() downstream works.
      const stored = JSON.parse(localStorage.getItem("tradesizer.instruments.v1") || "[]");
      if (JSON.stringify(stored) !== JSON.stringify(result.settings)) {
        localStorage.setItem("tradesizer.instruments.v1", JSON.stringify(result.settings));
      }
    }
  } catch {
    // Fallback to local cache if backend is unreachable.
    settingsDraft = loadInstruments().map((i) => ({ ...i }));
  }
}

function renderSettingsTable() {
  settingsTable.innerHTML = "";
  settingsDraft.forEach((instrument, index) => {
    settingsTable.appendChild(buildInstrumentRow(instrument, index));
  });
}

function buildInstrumentRow(instrument, index) {
  const row = document.createElement("div");
  row.className = "instrument-row";
  row.setAttribute("role", "row");

  row.innerHTML = `
    <div class="instrument-row__head">
      <input class="instrument-row__symbol" data-field="symbol" value="${escapeHtml(
        instrument.symbol || ""
      )}" placeholder="SYMBOL" />
      <button type="button" class="instrument-row__remove" data-remove>Remove</button>
    </div>
    <div class="instrument-row__grid">
      <div class="instrument-row__field">
        <label>Unit</label>
        <select data-field="unitType">
          <option value="pip" ${instrument.unitType === "pip" ? "selected" : ""}>Pip</option>
          <option value="tick" ${instrument.unitType === "tick" ? "selected" : ""}>Tick</option>
        </select>
      </div>
      <div class="instrument-row__field">
        <label>Pip/tick size</label>
        <input type="number" step="any" data-field="pipSize" value="${valueOrEmpty(instrument.pipSize)}" />
      </div>
      <div class="instrument-row__field">
        <label>Value / unit / 1 lot</label>
        <input type="number" step="any" data-field="pipValue" value="${valueOrEmpty(instrument.pipValue)}" />
      </div>
      <div class="instrument-row__field">
        <label>Minimum lot</label>
        <input type="number" step="any" data-field="minLot" value="${valueOrEmpty(instrument.minLot)}" />
      </div>
      <div class="instrument-row__field">
        <label>Maximum lot</label>
        <input type="number" step="any" data-field="maxLot" value="${valueOrEmpty(instrument.maxLot)}" />
      </div>
      <div class="instrument-row__field">
        <label>Volume step</label>
        <input type="number" step="any" data-field="volumeStep" value="${valueOrEmpty(instrument.volumeStep)}" />
      </div>
    </div>
  `;

  row.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const field = input.dataset.field;
      const raw = input.value;
      settingsDraft[index][field] =
        field === "symbol" || field === "unitType" ? raw : raw === "" ? NaN : Number(raw);
    });
  });

  row.querySelector("[data-remove]").addEventListener("click", () => {
    vibrate(HAPTIC_OK);
    showToast(`${instrument.symbol || "Instrument"} removed from the draft`);
    settingsDraft.splice(index, 1);
    renderSettingsTable();
  });

  return row;
}

function valueOrEmpty(v) {
  return Number.isFinite(v) ? v : "";
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

addInstrumentBtn.addEventListener("click", () => {
  vibrate(HAPTIC_OK);
  showToast("New instrument row added");
  settingsDraft.push({
    symbol: "",
    unitType: "pip",
    pipSize: NaN,
    pipValue: NaN,
    minLot: 0.01,
    maxLot: 100,
    volumeStep: 0.01,
  });
  renderSettingsTable();
});

updateSettingsBtn.addEventListener("click", async () => {
  // Normalise symbols (trim, uppercase) before validating/saving.
  const normalised = settingsDraft.map((i) => ({
    ...i,
    symbol: (i.symbol || "").trim().toUpperCase(),
  }));

  const symbols = normalised.map((i) => i.symbol);
  const duplicates = symbols.filter((s, i) => s && symbols.indexOf(s) !== i);

  let allErrors = [];
  normalised.forEach((instrument) => {
    const { valid, errors } = validateInstrument(instrument);
    if (!valid) allErrors = allErrors.concat(errors);
  });
  if (duplicates.length > 0) {
    allErrors.push(`Duplicate instrument symbol(s): ${[...new Set(duplicates)].join(", ")}`);
  }

  if (allErrors.length > 0) {
    vibrate(HAPTIC_ERROR);
    showToast("Settings not saved — fix the errors below", "error");
    settingsSaveStatus.textContent = allErrors.join(" ");
    settingsSaveStatus.classList.remove("is-ok");
    settingsSaveStatus.classList.add("is-error");
    return; // atomic — nothing is saved if anything is invalid
  }

  // Save to the backend (synced source of truth).
  try {
    const result = await saveSettings(normalised);
    if (!result.ok) {
      vibrate(HAPTIC_ERROR);
      showToast("Settings not saved — fix the errors below", "error");
      settingsSaveStatus.textContent = result.error || "Unknown error";
      settingsSaveStatus.classList.remove("is-ok");
      settingsSaveStatus.classList.add("is-error");
      return;
    }
  } catch (err) {
    vibrate(HAPTIC_ERROR);
    showToast("Save failed — check your connection", "error");
    settingsSaveStatus.textContent = err.message;
    settingsSaveStatus.classList.remove("is-ok");
    settingsSaveStatus.classList.add("is-error");
    return;
  }

  vibrate(HAPTIC_OK);
  showToast("Settings updated", "success");
  settingsDraft = normalised.map((i) => ({ ...i }));
  renderSettingsTable();
  settingsSaveStatus.textContent = "✓ Settings updated. The dashboard now uses these values.";
  settingsSaveStatus.classList.remove("is-error");
  settingsSaveStatus.classList.add("is-ok");

  // Immediately propagate to the dashboard from the backend.
  await populateInstrumentSelect();
});

// ---------------------------------------------------------------------------
// Auth: login / logout
// ---------------------------------------------------------------------------
async function setAuth(loggedIn) {
  const logoutBtn = el("logout-btn");
  if (loggedIn) {
    if (logoutBtn) logoutBtn.hidden = false;
    await loadSettingsDraft();
    await populateInstrumentSelect();
    showToast("Signed in", "success");
  } else {
    if (logoutBtn) logoutBtn.hidden = true;
    clearResults();
    instrumentSelect.innerHTML = "";
    tradeSession.instrumentSymbol = null;
    updateInstrumentStatus();
    settingsDraft = [];
  }
}

window.addEventListener("ts-login", async () => {
  await setAuth(true);
});

// ---------------------------------------------------------------------------
// PWA: register the service worker for offline caching
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('ServiceWorker registered:', registration.scope);
    } catch (err) {
      console.warn('ServiceWorker registration failed:', err);
    }
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
initLogin();
clearResults();
