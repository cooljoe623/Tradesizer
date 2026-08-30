import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateTrade,
  roundToVolumeStep,
  resolveDesiredProfit,
  isInstrumentSettingsComplete,
} from "./calculationEngine.js";

const usdjpy = {
  symbol: "USDJPY",
  unitType: "pip",
  pipSize: 0.01,
  pipValue: 6.67,
  minLot: 0.01,
  maxLot: 100,
  volumeStep: 0.01,
};

function baseInputs(overrides = {}) {
  return {
    instrumentSettings: usdjpy,
    capital: 100,
    desiredProfit: 100,
    entry: 150.0,
    sl: 149.5,
    tp: 151.0,
    direction: "buy",
    ...overrides,
  };
}

test("Test 1: $100 capital, $100 target, 1:2 RR -> required risk $50", () => {
  const { valid, result } = calculateTrade(baseInputs());
  assert.equal(valid, true);
  assert.equal(result.rr, 2);
  assert.equal(result.requiredRisk, 50);
});

test("Test 2: $100 capital, $100 target, 1:3 RR -> required risk $33.33...", () => {
  // TP distance 150 pips, SL distance 50 pips => RR 1:3
  const { valid, result } = calculateTrade(
    baseInputs({ tp: 151.5 /* 150 pip TP distance */ })
  );
  assert.equal(valid, true);
  assert.equal(result.rr, 3);
  assert.ok(Math.abs(result.requiredRisk - 100 / 3) < 1e-9);
});

test("Test 3: $500 capital, $500 target, 1:2 RR -> required risk $250", () => {
  const { valid, result } = calculateTrade(
    baseInputs({ capital: 500, desiredProfit: 500 })
  );
  assert.equal(valid, true);
  assert.equal(result.rr, 2);
  assert.equal(result.requiredRisk, 250);
});

test("Test 4: larger SL distance (same required risk) -> smaller lot size", () => {
  const tight = calculateTrade(baseInputs({ sl: 149.5 })); // 50 pip SL
  const wide = calculateTrade(baseInputs({ sl: 149.0, tp: 152.0 })); // 100 pip SL, RR still 2
  assert.equal(tight.valid, true);
  assert.equal(wide.valid, true);
  assert.equal(tight.result.rr, wide.result.rr);
  assert.ok(
    wide.result.theoreticalLotSize < tight.result.theoreticalLotSize,
    "wider SL distance should require a smaller lot size for the same risk"
  );
});

test("Test 5: different pip/tick values change the lot size correctly", () => {
  const cheap = calculateTrade(baseInputs()); // pipValue 6.67
  const expensiveInstrument = { ...usdjpy, pipValue: 13.34 }; // double the value
  const expensive = calculateTrade(
    baseInputs({ instrumentSettings: expensiveInstrument })
  );
  assert.equal(cheap.valid, true);
  assert.equal(expensive.valid, true);
  // Doubling pip value should roughly halve the theoretical lot size.
  assert.ok(
    Math.abs(expensive.result.theoreticalLotSize - cheap.result.theoreticalLotSize / 2) <
      0.001
  );
});

test("Test 6: invalid inputs are rejected", () => {
  assert.equal(calculateTrade(baseInputs({ entry: NaN })).valid, false);
  assert.equal(calculateTrade(baseInputs({ sl: 150.0 })).valid, false); // SL == entry
  assert.equal(calculateTrade(baseInputs({ tp: 150.0 })).valid, false); // TP == entry
  assert.equal(calculateTrade(baseInputs({ capital: 0 })).valid, false);
  assert.equal(calculateTrade(baseInputs({ desiredProfit: -10 })).valid, false);
  assert.equal(
    calculateTrade(baseInputs({ direction: "buy", sl: 150.5 })).valid,
    false // SL above entry on a Buy is inconsistent
  );
  assert.equal(
    calculateTrade(
      baseInputs({ instrumentSettings: { ...usdjpy, pipSize: 0 } })
    ).valid,
    false
  );
});

test("Test 7: volume-step rounding respects the configured step", () => {
  assert.equal(roundToVolumeStep(0.14993, 0.01), 0.15);
  assert.equal(roundToVolumeStep(0.146, 0.05), 0.15);
  assert.equal(roundToVolumeStep(1.2345, 0.001), 1.235); // rounds half up at boundary via Math.round

  const { valid, result } = calculateTrade(baseInputs());
  assert.equal(valid, true);
  // Final lot size must be an exact multiple of the volume step (within fp tolerance).
  const multiple = result.lotSize / usdjpy.volumeStep;
  assert.ok(Math.abs(multiple - Math.round(multiple)) < 1e-9);
});

test("Worked example from spec: USDJPY, $100 capital, Double X mode", () => {
  const desiredProfit = resolveDesiredProfit("double", 100, null);
  const { valid, result } = calculateTrade(baseInputs({ desiredProfit }));
  assert.equal(valid, true);
  assert.equal(result.slUnits, 50);
  assert.equal(result.tpUnits, 100);
  assert.equal(result.rr, 2);
  assert.equal(result.requiredRisk, 50);
  assert.ok(Math.abs(result.lotSize - 0.15) < 1e-9);
  assert.ok(Math.abs(result.expectedLoss - 50) < 1); // ~$50
  assert.ok(Math.abs(result.expectedProfit - 100) < 1.5); // ~$100
  assert.ok(Math.abs(result.capitalAfterTP - 200) < 1.5);
  assert.ok(Math.abs(result.capitalAfterSL - 50) < 1);
});

test("isInstrumentSettingsComplete flags missing/invalid fields", () => {
  assert.equal(isInstrumentSettingsComplete(usdjpy), true);
  assert.equal(isInstrumentSettingsComplete({ ...usdjpy, pipSize: 0 }), false);
  assert.equal(isInstrumentSettingsComplete({ ...usdjpy, maxLot: 0.005 }), false);
  assert.equal(isInstrumentSettingsComplete(null), false);
});
