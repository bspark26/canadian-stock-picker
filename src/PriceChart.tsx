import { useId } from 'react';
import { date, money } from './format';
import type { Opportunity } from './types';

type Props = { history: Opportunity['history']; currency?: string; compact?: boolean; label?: string };

export default function PriceChart({ history, currency = 'CAD', compact = false, label = 'Daily closing price' }: Props) {
  const id = useId().replace(/:/g, '');
  const points = history.filter(point => Number.isFinite(point.close) && point.close >= 0).slice(-90);
  if (points.length < 2) return compact ? <span className="muted">No history</span> : <div className="chart-empty">Daily history is not available for this security.</div>;
  const width = compact ? 128 : 760;
  const height = compact ? 40 : 250;
  const padding = compact ? 3 : 30;
  const minimum = Math.min(...points.map(point => point.close));
  const maximum = Math.max(...points.map(point => point.close));
  const range = maximum - minimum || Math.max(maximum * 0.02, 0.1);
  const low = minimum - range * 0.12;
  const high = maximum + range * 0.12;
  const x = (index: number) => padding + index / (points.length - 1) * (width - padding * 2);
  const y = (price: number) => padding + (high - price) / (high - low) * (height - padding * 2);
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(2)},${y(point.close).toFixed(2)}`).join(' ');
  const positive = points[points.length - 1].close >= points[0].close;
  const color = positive ? '#287661' : '#bc6254';
  return <div className={compact ? 'sparkline' : 'price-chart'}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}, ${date(points[0].date)} to ${date(points[points.length - 1].date)}, ${points.length} daily observations`}>
      {!compact && <>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.16" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        {[0, 1, 2, 3].map(index => <line key={index} x1={padding} x2={width - padding} y1={padding + index * (height - padding * 2) / 3} y2={padding + index * (height - padding * 2) / 3} stroke="#e5eae6" strokeDasharray="3 5" />)}
        <path d={`${path} L${x(points.length - 1)},${height - padding} L${padding},${height - padding} Z`} fill={`url(#${id})`} />
      </>}
      <path d={path} fill="none" stroke={color} strokeWidth={compact ? 2 : 2.8} strokeLinecap="round" strokeLinejoin="round" />
      {!compact && <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].close)} r="4.5" fill={color} stroke="white" strokeWidth="2" />}
    </svg>
    {!compact && <div className="chart-axis"><span>{date(points[0].date)}</span><span>Range {money(minimum, currency)} – {money(maximum, currency)}</span><span>{date(points[points.length - 1].date)}</span></div>}
  </div>;
}
