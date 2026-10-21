import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateSnapshot } from '../scripts/validate-data.mjs';
import { isChartBar, isScan } from '../src/types.ts';

const fixture = JSON.parse(await readFile(new URL('../public/data/latest.json', import.meta.url), 'utf8'));
const bar = (patch = {}) => ({ date: '2026-10-19', open: 10, high: 12, low: 9, close: 11, volume: 100, ...patch });
const snapshot = (bars) => {
  const data = structuredClone(fixture);
  data.opportunities[0].history = bars;
  return data;
};

test('valid OHLC and legacy close-only histories remain readable and publishable', () => {
  for (const first of [bar(), { date: '2026-10-19', close: 11, volume: 100 }]) {
    const data = snapshot([first, bar({ date: '2026-10-20' })]);
    assert(isChartBar(first));
    assert(isScan(data));
    validateSnapshot(data);
  }
});

test('the public live history has actual candles with the same last close and date', () => {
  for (const row of fixture.opportunities) {
    assert(row.history.every(point => isChartBar(point) && typeof point.open === 'number'));
    const last = row.history.at(-1);
    assert.equal(last.date, row.priceAsOf);
    assert.equal(last.close, row.price);
  }
});

test('incomplete, nonfinite and impossible candles fail both public data guards', () => {
  for (const patch of [{ open: undefined }, { high: undefined, low: undefined }, { low: null },
    { open: 0 }, { open: NaN }, { high: Infinity }, { high: 10 }, { low: 11 },
    { low: 13 }, { close: 0 }, { volume: -1 }, { volume: NaN }]) {
    const first = bar(patch);
    const data = snapshot([first, bar({ date: '2026-10-20' })]);
    assert(!isChartBar(first), JSON.stringify(patch));
    assert(!isScan(data), JSON.stringify(patch));
    assert.throws(() => validateSnapshot(data), /invalid chart/, JSON.stringify(patch));
  }
});

test('chart history rejects invalid dates, duplicate days and reverse ordering', () => {
  for (const bars of [[bar({ date: '2026-02-30' }), bar({ date: '2026-10-20' })],
    [bar(), bar()], [bar({ date: '2026-10-20' }), bar()]]) {
    const data = snapshot(bars);
    assert(!isScan(data));
    assert.throws(() => validateSnapshot(data), /invalid chart history/);
  }
});
