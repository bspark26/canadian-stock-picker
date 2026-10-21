/** Saved daily prices. OHLC is optional because older snapshots contain closes only. */
export type ChartHistoryPoint = {
  date: string;
  close: number;
  volume?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
};

/** OHLC is present only when every contributing daily bar has valid OHLC. */
export type ChartBar = {
  date: string;
  close: number;
  volume: number | null;
  open?: number;
  high?: number;
  low?: number;
};

export type ChartInterval = 'daily' | 'weekly' | 'monthly';
export type ChartRange = '1M' | '3M' | '6M' | 'YTD' | '1Y' | '2Y' | 'All';

export const CHART_RANGES: readonly ChartRange[] = ['1M', '3M', '6M', 'YTD', '1Y', '2Y', 'All'];
export const CHART_INTERVALS: readonly ChartInterval[] = ['daily', 'weekly', 'monthly'];

const DAY_MS = 86_400_000;
const finitePositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const utcDay = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isoDay = (value: Date) => value.toISOString().slice(0, 10);

/** Rejects normalized dates such as February 30, timestamps, and locale-dependent dates. */
export function isChartDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = utcDay(value);
  return Number.isFinite(parsed.valueOf()) && isoDay(parsed) === value;
}

function validOHLC(point: ChartHistoryPoint): boolean {
  return finitePositive(point.open) && finitePositive(point.high) && finitePositive(point.low)
    && point.high >= Math.max(point.open, point.close)
    && point.low <= Math.min(point.open, point.close);
}

/** Sorts a copy, drops unusable closes, and keeps the last valid-close row for each date. */
export function sanitizeHistory(history: readonly ChartHistoryPoint[]): ChartBar[] {
  const daily = new Map<string, ChartBar>();
  for (const point of history) {
    if (!point || typeof point !== 'object' || !isChartDate(point.date) || !finitePositive(point.close)) continue;
    const bar: ChartBar = {
      date: point.date,
      close: point.close,
      volume: typeof point.volume === 'number' && Number.isFinite(point.volume) && point.volume >= 0 ? point.volume : null,
    };
    if (validOHLC(point)) {
      bar.open = point.open!;
      bar.high = point.high!;
      bar.low = point.low!;
    }
    daily.set(point.date, bar);
  }
  return [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Empty or mixed close-only / OHLC series must not be rendered as candles. */
export function hasCompleteOHLC(history: readonly ChartHistoryPoint[]): boolean {
  return history.length > 0 && history.every(point => !!point && isChartDate(point.date) && finitePositive(point.close) && validOHLC(point));
}

function bucketKey(date: string, interval: ChartInterval): string {
  if (interval === 'monthly') return date.slice(0, 7);
  if (interval === 'daily') return date;
  const monday = utcDay(date);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return isoDay(monday);
}

/**
 * Uses Monday-based weeks and calendar months. Each date is the last saved observation,
 * so a partial period never receives a future end date. No unsupplied sessions are added.
 */
export function aggregateHistory(history: readonly ChartHistoryPoint[], interval: ChartInterval): ChartBar[] {
  const daily = sanitizeHistory(history);
  if (interval === 'daily') return daily;
  const buckets = new Map<string, ChartBar[]>();
  for (const bar of daily) {
    const key = bucketKey(bar.date, interval);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(bar);
    else buckets.set(key, [bar]);
  }
  return [...buckets.values()].map(bars => {
    const first = bars[0];
    const last = bars[bars.length - 1];
    const bar: ChartBar = {
      date: last.date,
      close: last.close,
      volume: bars.every(item => item.volume !== null) ? bars.reduce((sum, item) => sum + item.volume!, 0) : null,
    };
    if (hasCompleteOHLC(bars)) {
      bar.open = first.open;
      bar.high = Math.max(...bars.map(item => item.high!));
      bar.low = Math.min(...bars.map(item => item.low!));
    }
    return bar;
  });
}

/** Calendar subtraction clamps month ends instead of rolling into the following month. */
function monthsBefore(date: string, months: number): string {
  const end = utcDay(date);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() - months);
  const month = end.getUTCMonth();
  const last = new Date(end);
  last.setUTCMonth(month + 1, 0);
  end.setUTCDate(Math.min(day, last.getUTCDate()));
  return isoDay(end);
}

function rangeStart(lastDate: string, range: Exclude<ChartRange, 'All'>): string {
  if (range === 'YTD') return `${lastDate.slice(0, 4)}-01-01`;
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '2Y': 24 }[range];
  return monthsBefore(lastDate, months);
}

/** Selects relative to the last saved observation, independently of the current date. */
export function selectChartRange(history: readonly ChartHistoryPoint[], range: ChartRange): ChartBar[] {
  const daily = sanitizeHistory(history);
  if (range === 'All' || !daily.length) return daily;
  const start = rangeStart(daily[daily.length - 1].date, range);
  return daily.filter(bar => bar.date >= start);
}

/**
 * Offers ranges actually covered by the saved series. A seven-day start tolerance
 * allows weekends / exchange holidays; the selection still contains only saved rows.
 */
export function availableChartRanges(history: readonly ChartHistoryPoint[]): ChartRange[] {
  const daily = sanitizeHistory(history);
  if (!daily.length) return [];
  const firstDate = daily[0].date;
  const lastDate = daily[daily.length - 1].date;
  return CHART_RANGES.filter(range => {
    if (range === 'All') return true;
    if (daily.length < 2) return false;
    const start = rangeStart(lastDate, range);
    const toleranceEnd = new Date(utcDay(start).valueOf() + 7 * DAY_MS);
    if (firstDate > isoDay(toleranceEnd)) return false;
    if (range === 'YTD' && utcDay(lastDate).valueOf() - utcDay(start).valueOf() < 7 * DAY_MS) return false;
    return daily.filter(bar => bar.date >= start).length >= 2;
  });
}
