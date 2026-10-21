import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import type { IChartApi, Time } from 'lightweight-charts';
import { date, isNumber, money, number } from './format';
import { aggregateHistory, availableChartRanges, hasCompleteOHLC, isChartDate, sanitizeHistory, selectChartRange } from './chartData';
import type { ChartBar, ChartInterval, ChartRange } from './chartData';
import type { Opportunity } from './types';

type Props = { history: Opportunity['history']; currency?: string; compact?: boolean; label?: string };
type CustomRange = { from: string; to: string };

function timeKey(time: Time): string {
  if (typeof time === 'string') return time;
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10);
  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}

function visibleBars(bars: ChartBar[], range: ChartRange, custom: CustomRange | null): ChartBar[] {
  return custom ? bars.filter(bar => bar.date >= custom.from && bar.date <= custom.to) : selectChartRange(bars, range);
}

function applyRange(chart: IChartApi, bars: ChartBar[], range: ChartRange, custom: CustomRange | null) {
  const selected = visibleBars(bars, range, custom);
  if (selected.length < 2 || range === 'All' && !custom) chart.timeScale().fitContent();
  else chart.timeScale().setVisibleRange({ from: selected[0].date, to: selected[selected.length - 1].date });
}

function CompactChart({ history, label }: Pick<Props, 'history' | 'label'>) {
  const points = useMemo(() => sanitizeHistory(history).slice(-90), [history]);
  if (points.length < 2) return <span className="muted">No history</span>;
  const minimum = Math.min(...points.map(point => point.close));
  const maximum = Math.max(...points.map(point => point.close));
  const range = maximum - minimum || Math.max(maximum * .02, .1);
  const low = minimum - range * .12;
  const high = maximum + range * .12;
  const x = (index: number) => 3 + index / (points.length - 1) * 122;
  const y = (price: number) => 3 + (high - price) / (high - low) * 34;
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(2)},${y(point.close).toFixed(2)}`).join(' ');
  const color = points[points.length - 1].close >= points[0].close ? '#287661' : '#bc6254';
  return <div className="sparkline"><svg viewBox="0 0 128 40" role="img" aria-label={`${label}, ${date(points[0].date)} to ${date(points[points.length - 1].date)}, ${points.length} daily observations`}><path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>;
}

function DetailChart({ history, currency = 'CAD', label = 'Daily closing price' }: Props) {
  const source = useMemo(() => sanitizeHistory(history), [history]);
  const coveredRanges = useMemo(() => availableChartRanges(source), [source]);
  const [range, setRange] = useState<ChartRange>('3M');
  const [interval, setInterval] = useState<ChartInterval>('daily');
  const availableIntervals = useMemo(() => (['daily', 'weekly', 'monthly'] as ChartInterval[]).filter(item => aggregateHistory(source, item).length >= 2), [source]);
  const activeInterval = availableIntervals.includes(interval) ? interval : 'daily';
  const [kind, setKind] = useState<'line' | 'candles'>('line');
  const bars = useMemo(() => aggregateHistory(source, activeInterval), [source, activeInterval]);
  const availableRanges = useMemo(() => coveredRanges.filter(preset => selectChartRange(bars, preset).length >= 2), [coveredRanges, bars]);
  const activeRange = availableRanges.includes(range) ? range : 'All';
  const candleAvailable = bars.length >= 2 && hasCompleteOHLC(bars);
  const chartKind = kind === 'candles' && candleAvailable ? 'candles' : 'line';
  const [custom, setCustom] = useState<CustomRange | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [feedback, setFeedback] = useState('');
  const [chartError, setChartError] = useState('');
  const [hovered, setHovered] = useState<ChartBar | null>(null);
  const [ready, setReady] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const selectionRef = useRef({ range: activeRange, custom });
  selectionRef.current = { range: activeRange, custom };

  useEffect(() => {
    const host = hostRef.current;
    if (!host || bars.length < 2) return;
    let cancelled = false;
    let chart: IChartApi | null = null;
    setReady(false); setChartError(''); setHovered(null);
    void import('lightweight-charts').then(({ createChart, CandlestickSeries, LineSeries, ColorType, CrosshairMode }) => {
      if (cancelled) return;
      chart = createChart(host, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#536650', fontSize: 14, fontFamily: "'DM Sans', sans-serif", attributionLogo: true },
        grid: { vertLines: { color: '#f0f3ec' }, horzLines: { color: '#e8eee2' } },
        rightPriceScale: { visible: true, borderVisible: true, borderColor: '#dce5d4', minimumWidth: 85, scaleMargins: { top: .12, bottom: .10 } },
        leftPriceScale: { visible: false },
        timeScale: { visible: true, borderVisible: true, borderColor: '#dce5d4', timeVisible: false, secondsVisible: false, minimumHeight: 36, rightOffset: 2, minBarSpacing: .1, fixLeftEdge: true, fixRightEdge: true, lockVisibleTimeRangeOnResize: true },
        crosshair: { mode: CrosshairMode.Magnet, vertLine: { color: '#8d9e80', labelBackgroundColor: '#294e38' }, horzLine: { color: '#8d9e80', labelBackgroundColor: '#294e38' } },
        localization: { locale: 'en-CA', priceFormatter: (value: number) => money(value, currency), timeFormatter: (value: Time) => date(timeKey(value), true) },
        handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
        kineticScroll: { mouse: true, touch: true },
      });
      if (chartKind === 'candles') {
        const series = chart.addSeries(CandlestickSeries, { upColor: '#287661', downColor: '#bb6554', borderVisible: false, wickUpColor: '#287661', wickDownColor: '#bb6554', priceLineVisible: true, lastValueVisible: true });
        series.setData(bars.map(bar => ({ time: bar.date, open: bar.open!, high: bar.high!, low: bar.low!, close: bar.close })));
      } else {
        const series = chart.addSeries(LineSeries, { color: '#287661', lineWidth: 2, priceLineVisible: true, lastValueVisible: true, crosshairMarkerVisible: true });
        series.setData(bars.map(bar => ({ time: bar.date, value: bar.close })));
      }
      const byDate = new Map(bars.map(bar => [bar.date, bar]));
      chart.subscribeCrosshairMove(param => setHovered(param.time && param.point ? byDate.get(timeKey(param.time)) || null : null));
      chartRef.current = chart;
      applyRange(chart, bars, selectionRef.current.range, selectionRef.current.custom);
      setReady(true);
    }).catch(() => { if (!cancelled) setChartError('The interactive chart could not load. Saved date and price values remain visible.'); });
    return () => { cancelled = true; chartRef.current = null; chart?.remove(); };
  }, [bars, chartKind, currency]);

  useEffect(() => {
    if (ready && chartRef.current) applyRange(chartRef.current, bars, activeRange, custom);
  }, [ready, bars, activeRange, custom]);

  if (source.length < 2) return <div className="chart-empty">Daily history is not available for this security.</div>;
  const first = source[0].date;
  const last = source[source.length - 1].date;
  const readout = hovered || bars[bars.length - 1];
  const selectRange = (next: ChartRange) => { setRange(next); setCustom(null); setFeedback(''); if (chartRef.current) applyRange(chartRef.current, bars, next, null); };
  const reset = () => selectRange(availableRanges.includes('3M') ? '3M' : 'All');
  const zoom = (factor: number) => {
    const scale = chartRef.current?.timeScale();
    const current = scale?.getVisibleLogicalRange();
    if (!scale || !current) return;
    const midpoint = (current.from + current.to) / 2;
    const span = Math.max(3, Math.min(bars.length + 4, (current.to - current.from) * factor));
    scale.setVisibleLogicalRange({ from: midpoint - span / 2, to: midpoint + span / 2 });
  };
  const pan = (direction: number) => {
    const scale = chartRef.current?.timeScale();
    const current = scale?.getVisibleLogicalRange();
    if (!scale || !current) return;
    const span = current.to - current.from;
    const start = Math.max(-2, Math.min(Math.max(-2, bars.length - span + 1), current.from + direction * Math.max(1, span * .25)));
    scale.setVisibleLogicalRange({ from: start, to: start + span });
  };
  const applyCustom = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = { from: from || first, to: to || last };
    if (!isChartDate(next.from) || !isChartDate(next.to) || next.from > next.to || next.from < first || next.to > last) { setFeedback('Choose dates within the saved history, with the start before the end.'); return; }
    if (visibleBars(bars, activeRange, next).length < 2) { setFeedback('Choose a range containing at least two bars at the selected interval.'); return; }
    setCustom(next); setFeedback('Custom date range applied.');
  };

  return <section className="detail-price-chart" aria-label={`${label}, interactive history`}>
    <div className="chart-toolbar">
      <div className="chart-view-toggle" aria-label="Chart style"><button type="button" aria-pressed={chartKind === 'line'} onClick={() => setKind('line')}>Line</button><button type="button" aria-pressed={chartKind === 'candles'} disabled={!candleAvailable} title={!candleAvailable ? 'Complete saved OHLC data is required for candles.' : undefined} onClick={() => setKind('candles')}>Candles</button></div>
      <label className="chart-interval-control">Interval<select value={activeInterval} onChange={event => { setInterval(event.target.value as ChartInterval); setCustom(null); setFeedback(''); }}>{availableIntervals.map(item => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></label>
      <div className="chart-tools"><button type="button" disabled={!ready} aria-label="Pan to earlier dates" title="Earlier dates" onClick={() => pan(-1)}><ChevronLeft size={18} /></button><button type="button" disabled={!ready} aria-label="Pan to later dates" title="Later dates" onClick={() => pan(1)}><ChevronRight size={18} /></button><button type="button" disabled={!ready} aria-label="Zoom in" title="Zoom in" onClick={() => zoom(.7)}><ZoomIn size={18} /></button><button type="button" disabled={!ready} aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1 / .7)}><ZoomOut size={18} /></button><button type="button" disabled={!ready} onClick={reset}><RotateCcw size={16} /><span>Reset</span></button></div>
    </div>
    <div className="chart-range-controls" aria-label="Saved history range">{availableRanges.map(preset => <button type="button" key={preset} aria-pressed={!custom && activeRange === preset} onClick={() => selectRange(preset)}>{preset}</button>)}</div>
    <details className="chart-date-controls"><summary>Custom dates</summary><form className="chart-date-fields" onSubmit={applyCustom}><label>From<input type="date" min={first} max={last} value={from || first} onChange={event => setFrom(event.target.value)} required /></label><label>To<input type="date" min={first} max={last} value={to || last} onChange={event => setTo(event.target.value)} required /></label><button type="submit">Apply dates</button></form></details>
    <div className="chart-readout"><strong>{date(readout.date, true)}</strong>{isNumber(readout.open) && <><span>O <b>{money(readout.open, currency)}</b></span><span>H <b>{money(readout.high, currency)}</b></span><span>L <b>{money(readout.low, currency)}</b></span></>}<span>C <b>{money(readout.close, currency)}</b></span><span>Volume <b>{number(readout.volume)}</b></span></div>
    <div ref={hostRef} className="interactive-chart-canvas" style={{ minHeight: 300 }} role="img" aria-label={`${chartKind === 'candles' ? 'Candlestick' : 'Closing price'} chart in ${currency}, ${activeInterval} bars. Drag horizontally to pan; use zoom buttons or pinch to zoom.`} />
    {chartError && <p className="chart-feedback" role="alert">{chartError}</p>}
    {feedback && <p className="chart-feedback" role="status">{feedback}</p>}
    {!candleAvailable && <p className="chart-history-note">Candlesticks unavailable: this saved history does not contain complete daily OHLC data.</p>}
    <p className="chart-history-note">Daily data · {date(first, true)} – {date(last, true)} · {number(source.length)} saved sessions. No intraday data. {activeInterval !== 'daily' && 'Bars aggregate saved daily observations; the latest period may be incomplete.'}</p>
    <p className="chart-attribution"><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a><span> · © 2025 TradingView, Inc. · </span><a href={`${import.meta.env.BASE_URL}licenses/lightweight-charts-NOTICE.txt`} target="_blank" rel="noreferrer">Notice</a><span> · </span><a href={`${import.meta.env.BASE_URL}licenses/lightweight-charts-LICENSE.txt`} target="_blank" rel="noreferrer">License</a></p>
  </section>;
}

export default function PriceChart(props: Props) {
  return props.compact ? <CompactChart history={props.history} label={props.label || 'Daily closing price'} /> : <DetailChart {...props} />;
}
