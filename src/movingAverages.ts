import { aggregateHistory, sanitizeHistory } from './chartData';
import type { ChartHistoryPoint, ChartInterval } from './chartData';

export const MOVING_AVERAGE_PERIODS = [20, 50, 200] as const;
export type MovingAveragePeriod = typeof MOVING_AVERAGE_PERIODS[number];
export type AveragePoint = { date: string; value: number };

/**
 * A trailing average of actual daily closing prices, including the current day.
 * Grouped charts sample this daily average on each group's last saved date.
 * Call with the full saved history, before applying a visible date range.
 */
export function movingAverageSeries(history: readonly ChartHistoryPoint[], period: number, interval: ChartInterval = 'daily'): AveragePoint[] {
  if (!Number.isSafeInteger(period) || period <= 0) throw new RangeError('The average period must be a positive whole number.');
  const daily = sanitizeHistory(history);
  if (daily.length < period) return [];
  const averages: AveragePoint[] = [];
  let total = 0;
  for (let index = 0; index < daily.length; index += 1) {
    total += daily[index].close;
    if (index >= period) total -= daily[index - period].close;
    if (index >= period - 1) averages.push({ date: daily[index].date, value: total / period });
  }
  if (interval === 'daily') return averages;
  const dates = new Set(aggregateHistory(daily, interval).map(bar => bar.date));
  return averages.filter(point => dates.has(point.date));
}
