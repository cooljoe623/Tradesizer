/**
 * calculationEngine.js
 *
 * Pure, dependency-free position-sizing math for TradeSizer.
 *
 * Contract:
 *   Entry / SL / TP are inputs decided from the chart. This module NEVER
 *   adjusts them. It only ever solves for the lot size required to hit a
 *   desired monetary profit at TP, given the RR implied by the chart levels.
 *
 * Nothing in this file touches the DOM, localStorage, or any UI framework,
 * so it can be imported both by the browser app and by a plain Node test
 * runner.
 */

/** @typedef {'buy'|'sell'} Direction */

/**
 * @typedef {Object} InstrumentSettings
 * @property {string} symbol
 * @property {'pip'|'tick'} unitType
 * @property {number} pipSize        price distance of one pip/tick
 * @property {number} pipValue       monetary value of one pip/tick per 1.00 standard lot
 * @property {number} minLot
 * @property {number} maxLot
 * @property {number} volumeStep
 */

/**
 * @typedef {Object} TradeInputs
 * @property {InstrumentSettings} instrumentSettings
 * @property {number} capital
 * @property {number} desiredProfit
 * @property {number} entry
 * @property {number} sl
 * @property {number} tp
 * @property {Direction} direction
 * @property {number} [rrWarningThreshold]  default 2 — RR below this is flagged, not blocked
 */

const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Resolves the desired profit for a given target mode.
 * @param {'double'|'custom'} mode
 * @param {number} capital
 * @param {number} customProfit
 */
export function resolveDesiredProfit(mode, capital, customProfit) {
  if (mode === "double") return capital;
  if (mode === "custom") return customProfit;
  throw new Error(`Unknown target mode: ${mode}`);
}

/**
 * Checks whether a stored instrument configuration has everything the
 * calculation engine needs, with sane (>0) values.
 * @param {InstrumentSettings} settings
 */
export function isInstrumentSettingsComplete(settings) {
  if (!settings) return false;
  const { unitType, pipSize, pipValue, minLot, maxLot, volumeStep } = settings;
  if (unitType !== "pip" && unitType !== "tick") return false;
  if (!isFiniteNumber(pipSize) || pipSize <= 0) return false;
  if (!isFiniteNumber(pipValue) || pipValue <= 0) return false;
  if (!isFiniteNumber(minLot) || minLot <= 0) return false;
  if (!isFiniteNumber(maxLot) || maxLot <= 0) return false;
  if (!isFiniteNumber(volumeStep) || volumeStep <= 0) return false;
  if (maxLot < minLot) return false;
  return true;
}

/**
 * Validates raw trade inputs before any math runs.
 * Returns { valid, errors }. Never throws.
 * @param {TradeInputs} inputs
 */
export function validateTradeInputs(inputs) {
  const errors = [];
  const { instrumentSettings, capital, desiredProfit, entry, sl, tp, direction } =
    inputs || {};

  if (!instrumentSettings || !isInstrumentSettingsComplete(instrumentSettings)) {
    errors.push(
      "Instrument settings are missing or incomplete. Configure this instrument in Settings first."
    );
  }

  if (!isFiniteNumber(entry)) errors.push("Please enter an entry price.");
  if (!isFiniteNumber(sl)) errors.push("Please enter a stop loss price.");
  if (!isFiniteNumber(tp)) errors.push("Please enter a take profit price.");

  if (!isFiniteNumber(capital) || capital <= 0)
    errors.push("Capital must be a number greater than zero.");
  if (!isFiniteNumber(desiredProfit) || desiredProfit <= 0)
    errors.push("Desired profit must be a number greater than zero.");

  if (direction !== "buy" && direction !== "sell")
    errors.push("Select a direction: Buy or Sell.");

  // Only run the level-consistency checks once the basic numbers are sane,
  // so we don't produce confusing compound error messages.
  if (isFiniteNumber(entry) && isFiniteNumber(sl) && isFiniteNumber(tp)) {
    if (sl === entry) errors.push("Stop loss cannot equal entry price.");
    if (tp === entry) errors.push("Take profit cannot equal entry price.");

    if (direction === "buy") {
      if (entry <= sl) errors.push("For a Buy, entry should be above stop loss.");
      if (tp <= entry) errors.push("For a Buy, take profit should be above entry.");
    } else if (direction === "sell") {
      if (entry >= sl) errors.push("For a Sell, entry should be below stop loss.");
      if (tp >= entry) errors.push("For a Sell, take profit should be below entry.");
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Rounds a lot size to the broker's supported volume increment, using the
 * step's own decimal precision to avoid floating point artifacts
 * (e.g. 0.14999999999999997).
 * @param {number} value
 * @param {number} step
 */
export function roundToVolumeStep(value, step) {
  if (!isFiniteNumber(step) || step <= 0) return value;
  const stepStr = String(step);
  const decimals = stepStr.includes(".") ? stepStr.split(".")[1].length : 0;
  const steps = Math.round(value / step);
  const rounded = steps * step;
  return Number(rounded.toFixed(decimals));
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Runs the full position-sizing calculation.
 *
 * Order of operations (must not be reversed):
 *   1. SL / TP distance from the chart levels (never altered)
 *   2. RR from those distances
 *   3. Required risk from desired profit and RR
 *   4. Lot size from required risk and SL distance
 *
 * @param {TradeInputs} inputs
 * @returns {{valid:boolean, errors:string[], result?:object}}
 */
export function calculateTrade(inputs) {
  const validation = validateTradeInputs(inputs);
  if (!validation.valid) {
    return { valid: false, errors: validation.errors };
  }

  const {
    instrumentSettings,
    capital,
    desiredProfit,
    entry,
    sl,
    tp,
    rrWarningThreshold = 2,
  } = inputs;
  const { pipSize, pipValue, minLot, maxLot, volumeStep } = instrumentSettings;

  // 1. Distances, straight from the chart levels.
  const slDistancePrice = Math.abs(entry - sl);
  const tpDistancePrice = Math.abs(tp - entry);
  const slUnits = slDistancePrice / pipSize;
  const tpUnits = tpDistancePrice / pipSize;

  if (slUnits === 0 || tpUnits === 0) {
    return {
      valid: false,
      errors: [
        "SL and TP distance must both be greater than zero. Check your price levels.",
      ],
    };
  }

  // 2. RR purely from the chart-derived distances.
  const rr = tpUnits / slUnits;

  // 3. Required risk from desired profit and RR. This is the ONLY point
  //    where money and RR meet — the chart levels are never touched.
  const requiredRisk = desiredProfit / rr;

  // 4. Lot size from required risk and SL distance.
  const theoreticalLotSize = requiredRisk / (slUnits * pipValue);
  const brokerAdjustedLotSize = clamp(
    roundToVolumeStep(theoreticalLotSize, volumeStep),
    minLot,
    maxLot
  );

  // Recompute actual outcomes using the broker-adjusted (rounded) lot size,
  // since rounding can shift the real risk/profit slightly.
  const expectedLoss = slUnits * pipValue * brokerAdjustedLotSize;
  const expectedProfit = tpUnits * pipValue * brokerAdjustedLotSize;
  const capitalAfterTP = capital + expectedProfit;
  const capitalAfterSL = capital - expectedLoss;

  return {
    valid: true,
    errors: [],
    result: {
      slDistancePrice,
      tpDistancePrice,
      slUnits,
      tpUnits,
      rr,
      rrBelowThreshold: rr < rrWarningThreshold,
      requiredRisk,
      theoreticalLotSize,
      lotSize: brokerAdjustedLotSize,
      expectedLoss,
      expectedProfit,
      capitalAfterTP,
      capitalAfterSL,
    },
  };
}
