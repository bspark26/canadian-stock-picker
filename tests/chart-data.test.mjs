import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateHistory, availableChartRanges, hasCompleteOHLC, isChartDate,
  sanitizeHistory, selectChartRange,
} from '../src/chartData.ts';

const daily = (date, open = 10, high = 13, low = 9, close = 12, volume = 100) => ({ date, open, high, low, close, volume });
const closeOnly = date => ({ date, close: 10, volume: 100 });

test('sanitizes exact dates, sorts chronologically, and resolves duplicate dates without mutating inputs', () => {
  const history = [
    daily('2024-03-01'), daily('2024-02-29'), daily('2024-02-29', 11, 15, 9, 14),
    daily('2023-02-29'), daily('2024-02-30'), daily('03/02/2024'), daily('2024-03-01T00:00:00Z'),
    { ...daily('2024-03-04'), close: NaN }, { ...daily('2024-03-05'), close: 0 },
    { ...daily('2024-03-06'), close: Infinity },
  ];
  const before = structuredClone(history);
  assert.deepEqual(sanitizeHistory(history), [daily('2024-02-29', 11, 15, 9, 14), daily('2024-03-01')]);
  assert.deepEqual(history, before);
  assert.equal(isChartDate('2024-02-29'), true);
  for (const invalid of ['2023-02-29', '2024-04-31', '2024-1-01', '2024-01-01Z', '', null]) assert.equal(isChartDate(invalid), false);
});

test('weekly aggregation uses chronological first open, extrema, last close, summed volume, and last actual date', () => {
  const history = [
    daily('2019-01-04', 12, 20, 8, 14, 200),
    daily('2018-12-31', 10, 13, 9, 12, 100),
    daily('2019-01-02', 12, 16, 10, 15, 150),
    daily('2019-01-07', 14, 18, 13, 17, 250),
  ];
  assert.deepEqual(aggregateHistory(history, 'weekly'), [
    daily('2019-01-04', 10, 20, 8, 14, 450),
    daily('2019-01-07', 14, 18, 13, 17, 250),
  ]);
  // The same ongoing week can be computed at an earlier cutoff without later prices.
  assert.deepEqual(aggregateHistory(history.filter(bar => bar.date <= '2019-01-02'), 'weekly'), [
    daily('2019-01-02', 10, 16, 9, 15, 250),
  ]);
});

test('monthly aggregation respects month and year boundaries, including leap days and partial months', () => {
  const history = [daily('2023-12-29'), daily('2024-01-02', 11, 15, 10, 14), daily('2024-01-31', 14, 19, 13, 18), daily('2024-02-29', 18, 21, 16, 20)];
  assert.deepEqual(aggregateHistory(history, 'monthly'), [
    daily('2023-12-29'), daily('2024-01-31', 11, 19, 10, 18, 200), daily('2024-02-29', 18, 21, 16, 20),
  ]);
});

test('never invents OHLC for close-only or mixed bars, but preserves valid closes', () => {
  const mixed = [daily('2024-03-04'), closeOnly('2024-03-05'), daily('2024-03-06')];
  assert.deepEqual(aggregateHistory(mixed, 'weekly'), [{ date: '2024-03-06', close: 12, volume: 300 }]);
  assert.equal(hasCompleteOHLC(mixed), false);
  assert.equal(hasCompleteOHLC([]), false);
  assert.equal(hasCompleteOHLC([daily('2024-03-04')]), true);
  for (const fields of [{ open: null }, { high: 11 }, { low: 11 }, { low: -1 }, { open: Infinity }, { high: undefined }]) {
    const invalid = { ...daily('2024-03-05'), ...fields };
    assert.deepEqual(sanitizeHistory([invalid]), [{ date: '2024-03-05', close: 12, volume: 100 }]);
    assert.deepEqual(aggregateHistory([daily('2024-03-04'), invalid], 'weekly'), [{ date: '2024-03-05', close: 12, volume: 200 }]);
  }
});

test('unavailable volume remains unavailable instead of creating a misleading sum', () => {
  for (const volume of [undefined, null, -1, NaN, Infinity]) {
    const row = { ...daily('2024-03-05'), volume };
    assert.equal(sanitizeHistory([row])[0].volume, null);
    assert.equal(aggregateHistory([daily('2024-03-04'), row], 'weekly')[0].volume, null);
  }
  assert.equal(aggregateHistory([daily('2024-03-04', 10, 13, 9, 12, 0)], 'weekly')[0].volume, 0);
});

test('ranges are anchored to saved dates, respect exact calendar cutoffs, and clamp month ends', () => {
  const history = ['2023-08-30', '2023-08-31', '2023-11-30', '2024-01-31', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-31'].map(closeOnly);
  assert.deepEqual(selectChartRange(history, '1M').map(bar => bar.date), ['2024-02-29', '2024-03-01', '2024-03-31']);
  assert.deepEqual(selectChartRange(history, '6M').map(bar => bar.date), history.slice(2).map(bar => bar.date));
  assert.deepEqual(selectChartRange(history, 'YTD').map(bar => bar.date), history.slice(3).map(bar => bar.date));
  assert.deepEqual(selectChartRange([closeOnly('2023-02-27'), closeOnly('2023-02-28'), closeOnly('2023-03-31')], '1M').map(bar => bar.date), ['2023-02-28', '2023-03-31']);
  assert.deepEqual(selectChartRange([closeOnly('2023-02-28'), closeOnly('2024-02-29')], '1Y').map(bar => bar.date), ['2023-02-28', '2024-02-29']);
});

test('only offers adequately covered ranges, with a bounded allowance for non-trading start dates', () => {
  const history = ['2022-03-31', '2023-03-31', '2023-10-02', '2024-01-02', '2024-01-15', '2024-03-01', '2024-03-28'].map(closeOnly);
  assert.deepEqual(availableChartRanges(history), ['1M', '3M', '6M', 'YTD', '1Y', '2Y', 'All']);
  assert.deepEqual(availableChartRanges(['2024-03-11', '2024-03-28'].map(closeOnly)), ['All']);
  assert.deepEqual(availableChartRanges(['2024-03-04', '2024-03-28'].map(closeOnly)), ['1M', 'All']);
  assert.deepEqual(availableChartRanges([closeOnly('2024-03-28')]), ['All']);
  assert.deepEqual(availableChartRanges([]), []);
  // A distant first point does not justify controls when the selected window has only one row.
  assert.deepEqual(availableChartRanges(['2022-01-01', '2024-03-28'].map(closeOnly)), ['All']);
});

test('YTD needs coverage of the first trading week and at least two observations after a meaningful cutoff', () => {
  assert.equal(availableChartRanges(['2023-12-29', '2024-01-02', '2024-01-05'].map(closeOnly)).includes('YTD'), false);
  assert.equal(availableChartRanges(['2024-01-03', '2024-01-09'].map(closeOnly)).includes('YTD'), true);
  assert.equal(availableChartRanges(['2024-01-09', '2024-03-28'].map(closeOnly)).includes('YTD'), false);
  assert.equal(availableChartRanges(['2023-12-29', '2024-03-28'].map(closeOnly)).includes('YTD'), false);
});

test('empty and daily selections are safe, chronological, and independent copies', () => {
  assert.deepEqual(aggregateHistory([], 'daily'), []);
  assert.deepEqual(aggregateHistory([], 'weekly'), []);
  assert.deepEqual(selectChartRange([], '1Y'), []);
  const row = daily('2024-03-04');
  const result = aggregateHistory([row], 'daily');
  assert.deepEqual(result, [row]);
  result[0].close = 99;
  assert.equal(row.close, 12);
});
