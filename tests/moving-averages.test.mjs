import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/movingAverages.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22',
});
const { movingAverageSeries, MOVING_AVERAGE_PERIODS } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);

const point = (date, close) => ({ date, close });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);
function tradingDays(count) {
  const rows = [];
  const date = new Date('2024-01-02T00:00:00Z');
  while (rows.length < count) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) rows.push(point(date.toISOString().slice(0, 10), rows.length + 1));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return rows;
}

test('trailing averages use exactly N daily closes, include the current close, and wait for a full window', () => {
  const history = [point('2024-01-02', 10), point('2024-01-03', 20), point('2024-01-05', 30), point('2024-01-08', 60)];
  assert.deepEqual(movingAverageSeries(history, 3), [
    { date: '2024-01-05', value: 20 }, { date: '2024-01-08', value: 110 / 3 },
  ]);
  assert.deepEqual(movingAverageSeries(history.slice(0, 2), 3), []);
  assert.deepEqual(movingAverageSeries(history, 1), history.map(row => ({ date: row.date, value: row.close })));
  assert.deepEqual(movingAverageSeries([], 20), []);
});

test('20, 50 and 200-day averages count saved trading observations rather than calendar days', () => {
  assert.deepEqual(MOVING_AVERAGE_PERIODS, [20, 50, 200]);
  const history = tradingDays(220);
  for (const period of MOVING_AVERAGE_PERIODS) {
    const averages = movingAverageSeries(history, period);
    assert.equal(averages.length, 221 - period);
    assert.equal(averages[0].date, history[period - 1].date);
    near(averages[0].value, (period + 1) / 2);
    near(averages.at(-1).value, 220 - (period - 1) / 2);
  }
});

test('later prices cannot change an earlier average, and viewport filtering is not part of the calculation', () => {
  const history = tradingDays(220);
  const prefix = history.slice(0, 205);
  const full = movingAverageSeries(history, 200);
  assert.deepEqual(movingAverageSeries(prefix, 200), full.filter(row => row.date <= prefix.at(-1).date));
  const changedFuture = history.map((row, index) => index >= 205 ? { ...row, close: row.close * 100 } : row);
  assert.deepEqual(movingAverageSeries(changedFuture, 200).filter(row => row.date <= prefix.at(-1).date), movingAverageSeries(prefix, 200));
  // A zoomed window still uses earlier saved prices for its first visible value.
  const visibleFrom = history[210].date;
  const visible = full.filter(row => row.date >= visibleFrom);
  assert.equal(visible[0].date, visibleFrom);
  near(visible[0].value, 111.5);
  assert.deepEqual(movingAverageSeries(history.slice(210), 200), []);
});

test('week and month views sample daily averages at each last observed group date', () => {
  const history = ['2024-01-29', '2024-01-30', '2024-01-31', '2024-02-01', '2024-02-02', '2024-02-05', '2024-02-06', '2024-02-07', '2024-02-08'].map((date, index) => point(date, index + 1));
  assert.deepEqual(movingAverageSeries(history, 3, 'weekly'), [
    { date: '2024-02-02', value: 4 }, { date: '2024-02-08', value: 8 },
  ]);
  assert.deepEqual(movingAverageSeries(history, 3, 'monthly'), [
    { date: '2024-01-31', value: 2 }, { date: '2024-02-08', value: 8 },
  ]);
  // At an earlier cutoff, the unfinished week ends on its actual final supplied day.
  assert.deepEqual(movingAverageSeries(history.slice(0, 4), 3, 'weekly'), [{ date: '2024-02-01', value: 3 }]);
});

test('grouped 200-day lines have values after 200 daily observations, not after 200 groups', () => {
  const history = tradingDays(220);
  const dailyValues = new Map(movingAverageSeries(history, 200).map(row => [row.date, row.value]));
  for (const interval of ['weekly', 'monthly']) {
    const grouped = movingAverageSeries(history, 200, interval);
    assert.ok(grouped.length > 0 && grouped.length < 22);
    assert.equal(grouped.at(-1).date, history.at(-1).date);
    for (const row of grouped) near(row.value, dailyValues.get(row.date));
  }
});

test('close-only rows and missing OHLC or volume still provide real closing-price averages', () => {
  const history = [
    point('2024-01-02', 10),
    { ...point('2024-01-03', 20), volume: null, open: null, high: null, low: null },
    { ...point('2024-01-04', 30), volume: NaN, open: 30, high: 1, low: 50 },
  ];
  assert.deepEqual(movingAverageSeries(history, 2), [{ date: '2024-01-03', value: 15 }, { date: '2024-01-04', value: 25 }]);
});

test('sorting, invalid dates/closes and duplicate rows use the shared chart sanitation without mutating inputs', () => {
  const history = [
    point('2024-01-05', 5), point('2024-01-02', 1), point('2024-01-03', 2), point('2024-01-04', NaN),
    point('2024-01-03', 3), point('2024-01-06', 0), point('2024-01-07', Infinity), point('2024-01-32', 99),
  ];
  const original = structuredClone(history);
  assert.deepEqual(movingAverageSeries(history, 2), [{ date: '2024-01-03', value: 2 }, { date: '2024-01-05', value: 4 }]);
  assert.deepEqual(history, original);
});

test('fractional periods, non-finite values and nonpositive periods are rejected explicitly', () => {
  for (const period of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '20', null, undefined]) {
    assert.throws(() => movingAverageSeries([], period), RangeError);
  }
  assert.deepEqual(movingAverageSeries(tradingDays(3), Number.MAX_SAFE_INTEGER), []);
});
