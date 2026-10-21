import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateSnapshot } from '../scripts/validate-data.mjs';

const fixture = JSON.parse(await readFile(new URL('../public/data/latest.json', import.meta.url), 'utf8'));
const scenario = () => {
  const data = structuredClone(fixture);
  // The published shortlist can change daily; these contract cases must not
  // depend on whether today's market happens to contain a qualifying setup.
  for (const row of data.opportunities) delete row.tradePlan;
  data.mode = 'live';
  const item = data.opportunities[0];
  item.price = 20;
  item.tradePlan = {
    status: 'Wait', asOf: item.priceAsOf, horizonSessions: 20, entryValidForSessions: 5,
    entryLow: 10.1, entryHigh: 10.5, referenceEntry: 10.3, target: 14, invalidation: 9.5,
    upsidePercent: 35.92, downsidePercent: -7.77, rewardRisk: 3.5,
    basis: 'Prior range', explanation: 'Conditional entry test.',
    probability: { value: null, status: 'Not calibrated',
      event: 'Target touched before invalidation within 20 trading sessions after a qualifying entry.',
      reason: 'No calibrated model exists.' },
  };
  return { data, item, plan: item.tradePlan };
};

test('published scenarios validate and older snapshots remain readable', () => {
  validateSnapshot(fixture);
  const legacy = structuredClone(fixture);
  for (const item of legacy.opportunities) delete item.tradePlan;
  validateSnapshot(legacy);
});

test('a fabricated success probability cannot be published', () => {
  const { data, plan } = scenario();
  plan.probability.value = 85;
  assert.throws(() => validateSnapshot(data), /unvalidated probability/);
});

test('returns and readiness must agree with the actual price levels', () => {
  const { data, plan } = scenario();
  plan.upsidePercent += 10;
  assert.throws(() => validateSnapshot(data), /return calculation/);
  const next = scenario();
  next.plan.status = 'Ready';
  assert.throws(() => validateSnapshot(next.data), /entry readiness/);
});

test('unavailable scenarios cannot retain an actionable entry price', () => {
  const { data, plan } = scenario();
  plan.status = 'Unavailable';
  for (const key of ['entryLow', 'entryHigh', 'referenceEntry', 'target', 'invalidation', 'upsidePercent', 'downsidePercent', 'rewardRisk']) plan[key] = null;
  validateSnapshot(data);
  plan.referenceEntry = 5;
  assert.throws(() => validateSnapshot(data), /unavailable levels/);
});

const history = {
  samples: 20, targetFirst: 12, stopFirst: 5, expired: 3, unfilled: 2, ambiguous: 1,
  hitRatePercent: 60, intervalLowPercent: 38.66, intervalHighPercent: 78.12,
  asOf: '2026-10-20', method: 'Same-symbol walk-forward diagnostic; not a forecast probability.',
};

test('historical frequency is gated by completed samples and outcome accounting', () => {
  const { data, plan } = scenario();
  data.mode = 'live';
  plan.historical = structuredClone(history);
  validateSnapshot(data);
  plan.historical.samples = 19;
  plan.historical.expired = 2;
  assert.throws(() => validateSnapshot(data), /insufficient historical sample/);
  plan.historical = { ...history, expired: 2 };
  assert.throws(() => validateSnapshot(data), /historical counts/);
});

test('synthetic historical success rates cannot be published as evidence', () => {
  const { data, plan } = scenario();
  data.mode = 'demo';
  plan.historical = structuredClone(history);
  assert.throws(() => validateSnapshot(data), /synthetic historical success claim/);
});
