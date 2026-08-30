/**
 * settingsStore.js
 *
 * The ONLY module in this app allowed to talk to localStorage.
 *
 * Every other module (UI, calculation engine) goes through the functions
 * exported here. This is deliberate: it means the storage backend can be
 * swapped for a real API/database later by rewriting this one file, without
 * touching the calculation engine or the UI components.
 *
 * Data model:
 *   Instrument configuration (persistent) — symbol, unitType, pipSize,
 *   pipValue, minLot, maxLot, volumeStep.
 *
 *   Trade calculation state (temporary, per-session) is NOT stored here —
 *   see tradeSession below, which intentionally lives only in memory.
 */

import { isInstrumentSettingsComplete } from "../engine/calculationEngine.js";

const STORAGE_KEY = "tradesizer.instruments.v1";

/**
 * Seed instruments shown the first time the app runs. These are the example
 * values from the spec, purely to demonstrate the interface — the user is
 * expected to replace them with their broker's actual MT5 specification.
 */
const SEED_INSTRUMENTS = [
  {
    symbol: "USDJPY",
    unitType: "pip",
    pipSize: 0.01,
    pipValue: 6.67,
    minLot: 0.01,
    maxLot: 100,
    volumeStep: 0.01,
  },
  {
    symbol: "XAUUSD",
    unitType: "tick",
    pipSize: 0.01,
    pipValue: 1.0,
    minLot: 0.01,
    maxLot: 100,
    volumeStep: 0.01,
  },
  {
    symbol: "DXY",
    unitType: "tick",
    pipSize: 0.01,
    pipValue: 1.0,
    minLot: 0.01,
    maxLot: 100,
    volumeStep: 0.01,
  },
];

function hasLocalStorage() {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function readRaw() {
  if (!hasLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Corrupt data in storage should never crash the app.
    return null;
  }
}

function writeRaw(instruments) {
  if (!hasLocalStorage()) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(instruments));
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the full list of stored instruments, seeding defaults on first run.
 * @returns {Array<object>}
 */
export function loadInstruments() {
  let instruments = readRaw();
  if (!instruments || !Array.isArray(instruments) || instruments.length === 0) {
    instruments = SEED_INSTRUMENTS.map((i) => ({ ...i }));
    writeRaw(instruments);
  }
  return instruments;
}

/**
 * Looks up a single instrument by symbol.
 * @param {string} symbol
 */
export function getInstrument(symbol) {
  return loadInstruments().find((i) => i.symbol === symbol) || null;
}

/**
 * Validates a single instrument's fields.
 * @param {object} instrument
 * @returns {{valid:boolean, errors:string[]}}
 */
export function validateInstrument(instrument) {
  const errors = [];
  if (!instrument || !instrument.symbol) {
    errors.push("Instrument symbol is required.");
    return { valid: false, errors };
  }
  const { unitType, pipSize, pipValue, minLot, maxLot, volumeStep } = instrument;

  if (unitType !== "pip" && unitType !== "tick") {
    errors.push(`${instrument.symbol}: unit type must be "pip" or "tick".`);
  }
  if (!(pipSize > 0)) {
    errors.push(`${instrument.symbol}: pip/tick size must be greater than zero.`);
  }
  if (!(pipValue > 0)) {
    errors.push(`${instrument.symbol}: value per pip/tick must be greater than zero.`);
  }
  if (!(minLot > 0)) {
    errors.push(`${instrument.symbol}: minimum lot must be greater than zero.`);
  }
  if (!(maxLot > 0)) {
    errors.push(`${instrument.symbol}: maximum lot must be greater than zero.`);
  }
  if (maxLot > 0 && minLot > 0 && maxLot < minLot) {
    errors.push(`${instrument.symbol}: maximum lot cannot be less than minimum lot.`);
  }
  if (!(volumeStep > 0)) {
    errors.push(`${instrument.symbol}: volume step must be greater than zero.`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Saves the entire instrument list atomically. If ANY instrument is invalid,
 * nothing is written — this prevents partial saves as required by the spec.
 * @param {Array<object>} instruments
 * @returns {{valid:boolean, errors:string[]}}
 */
export function saveInstruments(instruments) {
  const allErrors = [];
  for (const instrument of instruments) {
    const { valid, errors } = validateInstrument(instrument);
    if (!valid) allErrors.push(...errors);
  }
  if (allErrors.length > 0) {
    return { valid: false, errors: allErrors };
  }
  writeRaw(instruments);
  return { valid: true, errors: [] };
}

/**
 * Convenience wrapper: whether a given instrument (looked up fresh from
 * storage) currently has complete, usable settings.
 * @param {string} symbol
 */
export function isSymbolComplete(symbol) {
  const instrument = getInstrument(symbol);
  return isInstrumentSettingsComplete(instrument);
}

export const DEFAULT_SEED_INSTRUMENTS = SEED_INSTRUMENTS;
