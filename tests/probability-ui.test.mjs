import assert from 'node:assert/strict';
import test from 'node:test';
import { isProbabilityReport, isTradePlan, isTradeProbability } from '../src/types.ts';

const event = 'Target touched before invalidation within 20 trading sessions after a qualifying entry.';
const probability = () => ({
  value: 64, status: 'Estimated', event, reason: 'Held-out historical estimate.',
  modelVersion: 'target-before-stop-logit-v1', asOf: '2026-10-15',
  validation: {
    testSamples: 350, testSymbols: 25, brier: .19, baselineBrier: .22,
    calibrationError: .07, testStart: '2026-03-01', testEnd: '2026-10-01',
    setupSamples: 95, binSamples: 80, observedHitRatePercent: 62.5,
  },
});
const plan = () => ({
  status: 'Ready', asOf: '2026-10-20', horizonSessions: 20, entryValidForSessions: 5,
  entryLow: 10, entryHigh: 10.1, referenceEntry: 10.05, target: 12, invalidation: 9,
  upsidePercent: 19.4, downsidePercent: -10.45, rewardRisk: 1.727,
  basis: 'Technical scenario', explanation: 'Conditional on a qualifying fill.', probability: probability(),
});
const validationPatch = patch => ({ ...probability(), validation: { ...probability().validation, ...patch } });

test('supported estimates require integer percentages inside the clipped tails', () => {
  assert(isTradeProbability(probability()));
  for (const value of [1, 99]) assert(isTradeProbability({ ...probability(), value }));
  for (const value of [0, 100, 64.5, -1, NaN, Infinity, null, '64']) {
    assert(!isTradeProbability({ ...probability(), value }), `reject ${String(value)}`);
  }
});

test('withheld and older snapshots remain compatible and cannot carry a percentage', () => {
  for (const status of ['Insufficient evidence', 'Not calibrated']) {
    assert(isTradeProbability({ value: null, status, event, reason: 'Not enough evidence.' }));
    assert(!isTradeProbability({ value: 64, status, event, reason: 'Not enough evidence.' }));
  }
  assert(isTradeProbability({ ...probability(), value: null, status: 'Insufficient evidence', validation: undefined }));
  assert(!isTradeProbability({ ...probability(), status: 'Validated estimate' }));
});

test('estimated output requires evidence for the full test, setup and probability band', () => {
  for (const patch of [{ testSamples: 299 }, { testSymbols: 19 }, { setupSamples: 74 }, { binSamples: 49 },
    { setupSamples: 351 }, { binSamples: 351 }, { setupSamples: undefined }, { binSamples: undefined },
    { observedHitRatePercent: undefined }, { observedHitRatePercent: -1 }, { observedHitRatePercent: 101 },
    { observedHitRatePercent: null }, { testSamples: 350.5 }, { binSamples: 80.5 }]) {
    assert(!isTradeProbability(validationPatch(patch)), JSON.stringify(patch));
  }
  assert(isTradeProbability(validationPatch({ setupSamples: 75, binSamples: 50, observedHitRatePercent: 0 })));
  assert(isTradeProbability(validationPatch({ observedHitRatePercent: 100 })));
});

test('model error must beat the historical-frequency baseline and pass calibration', () => {
  for (const patch of [{ brier: .22 }, { brier: .23 }, { brier: -.01 }, { baselineBrier: 1.01 },
    { calibrationError: .101 }, { calibrationError: -.01 }, { brier: NaN }]) {
    assert(!isTradeProbability(validationPatch(patch)), JSON.stringify(patch));
  }
  assert(isTradeProbability(validationPatch({ calibrationError: .10 })));
});

test('evidence dates must be real, ordered and no later than the model date', () => {
  assert(!isTradeProbability({ ...probability(), asOf: '2026-02-30' }));
  assert(!isTradeProbability({ ...probability(), modelVersion: '' }));
  for (const patch of [{ testStart: '2026-10-05' }, { testEnd: '2026-10-16' },
    { testStart: '2026-02-30' }, { testEnd: null }]) {
    assert(!isTradeProbability(validationPatch(patch)), JSON.stringify(patch));
  }
  assert(!isTradeProbability({ ...probability(), event: 'A profitable trade.' }));
});

test('plans exclude future validation outcomes and stale models or tests', () => {
  assert(isTradePlan(plan()));
  const future = plan(); future.asOf = '2026-09-30';
  assert(!isTradePlan(future), 'test ends after signal');
  const oldModel = plan(); oldModel.probability.asOf = '2026-06-21'; oldModel.probability.validation.testEnd = '2026-06-20';
  assert(!isTradePlan(oldModel), 'model more than 120 days before signal');
  const futureModel = plan(); futureModel.probability.asOf = '2027-02-18';
  assert(!isTradePlan(futureModel), 'model more than 120 days after signal');
  const staleTest = plan(); staleTest.probability.validation.testEnd = '2026-06-21';
  assert(!isTradePlan(staleTest), 'fresh training cannot make old test outcomes recent');
  const boundary = plan(); boundary.probability.asOf = '2026-06-22'; boundary.probability.validation.testEnd = '2026-06-22';
  assert(isTradePlan(boundary), '120-day boundary remains valid');
});

test('unavailable setups cannot publish an estimate', () => {
  const unavailable = { ...plan(), status: 'Unavailable' };
  for (const field of ['entryLow', 'entryHigh', 'referenceEntry', 'target', 'invalidation', 'upsidePercent', 'downsidePercent', 'rewardRisk']) unavailable[field] = null;
  assert(!isTradePlan(unavailable));
  unavailable.probability = { value: null, status: 'Insufficient evidence', event, reason: 'No qualifying setup.' };
  assert(isTradePlan(unavailable));
});

test('aggregate reports accept canonical collector metadata without exposing coefficients', () => {
  const report = {
    schemaVersion: 1, modelVersion: 'target-before-stop-logit-v1', status: 'Validated',
    reason: 'Preset validation gates met.', trainedAt: '2026-10-15',
    data: { inputEvents: 1500, acceptedEvents: 1400, symbols: 50 },
    validation: { ...probability().validation, setupSamples: { Pullback: 95 }, bins: [] },
    dataset: { period: '10y', eventSymbols: 50, events: 1400, limitations: 'Current-listing research cohort.' },
  };
  assert(isProbabilityReport(report));
  assert(isProbabilityReport({ ...report, status: 'Insufficient evidence', validation: undefined }));
  assert(!isProbabilityReport({ ...report, validation: { ...report.validation, brier: .25 } }));
  assert(!isProbabilityReport({ ...report, data: { ...report.data, acceptedEvents: 1600 } }));
  assert(!isProbabilityReport({ ...report, trainedAt: '2026-02-30' }));
});
