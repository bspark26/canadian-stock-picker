import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Info, RotateCcw } from 'lucide-react';
import { money, number } from './format';
import { optionSummary, payoff, validOptions } from './options';
import type { Strategy } from './options';

const strategies: { id: Strategy; name: string; description: string; position: string }[] = [
  { id: 'covered-call', name: 'Covered call', description: 'You receive the option price, but gains stop above the strike price. The shares can still lose value.', position: 'Own 100 shares + sell 1 matching call per contract' },
  { id: 'protective-put', name: 'Protective put', description: 'The put sets a minimum value for your shares on the expiry date.', position: 'Own 100 shares + buy 1 matching put per contract' },
  { id: 'long-call', name: 'Long call', description: 'Benefits from a rising share price. The option price and fees are the most you can lose.', position: 'Buy 1 call per contract; no shares included' },
  { id: 'long-put', name: 'Long put', description: 'Benefits from a falling share price. The option price and fees are the most you can lose.', position: 'Buy 1 put per contract; no shares included' },
];

export default function OptionsLab() {
  const [strategy, setStrategy] = useState<Strategy>('covered-call');
  const [values, setValues] = useState({ sharePrice: '20', strike: '22', premium: '0.80', contracts: '1', fees: '10' });
  const [expiry, setExpiry] = useState('');
  const chartRef = useRef<SVGSVGElement>(null);
  const [chartWidth, setChartWidth] = useState(750);
  const input = { sharePrice: Number(values.sharePrice), strike: Number(values.strike), premium: Number(values.premium), contracts: Number(values.contracts), fees: Number(values.fees) };
  const valid = Object.values(values).every(value => value.trim() !== '') && validOptions(input);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const measure = () => {
      const width = chart.getBoundingClientRect().width;
      if (width > 0) setChartWidth(previous => Math.abs(previous - width) < .5 ? previous : width);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(chart);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [valid]);
  // SVG user units scale with the viewBox; compensate so labels remain 14px on screen.
  const axisFontSize = 14 * 750 / chartWidth;
  const axisTicks = chartWidth < 520 ? [0, .5, 1] : [0, .25, .5, .75, 1];
  const summary = valid ? optionSummary(strategy, input) : null;
  const current = strategies.find(item => item.id === strategy)!;
  const change = (id: Strategy) => { setStrategy(id); setValues(previous => ({ ...previous, strike: id === 'protective-put' || id === 'long-put' ? '18' : '22' })); };
  const reset = () => { setStrategy('covered-call'); setValues({ sharePrice: '20', strike: '22', premium: '0.80', contracts: '1', fees: '10' }); setExpiry(''); };
  const maximumPrice = valid ? Math.max(input.sharePrice, input.strike, summary?.breakEven || 0) * 1.65 : 40;
  const points = valid ? Array.from({ length: 121 }, (_, index) => ({ price: maximumPrice * index / 120, profit: payoff(strategy, maximumPrice * index / 120, input) })) : [];
  const minY = Math.min(0, ...points.map(point => point.profit));
  const maxY = Math.max(1, ...points.map(point => point.profit));
  const padding = (maxY - minY) * 0.12 || 1;
  const y = (profit: number) => 230 - (profit - minY + padding) / (maxY - minY + 2 * padding) * 210;
  const x = (price: number) => 50 + price / maximumPrice * 650;
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.price)},${y(point.profit)}`).join(' ');
  const breakEvenDescription = summary ? strategy === 'protective-put' && summary.worst >= 0 ? 'No loss at any final share price'
    : summary.best <= 0 ? 'No share price produces a profit'
    : summary.breakEven !== null ? money(summary.breakEven) : 'No positive share price breaks even' : '—';
  const expiryLabel = expiry ? `${expiry} · ` : '';
  return <>
    <div className="page-heading"><div><h1>Options calculator</h1><p className="page-description">Manual prices · CAD · Profit or loss at the expiry date</p></div><button className="button secondary" onClick={reset}><RotateCcw size={15} />Reset example</button></div>
    <p className="metric-context">The starting prices are examples. This tool does not fetch current option prices or check which contracts are available.</p>
    <div className="strategy-tabs" aria-label="Option strategies">{strategies.map(item => <button className={strategy === item.id ? 'active' : ''} key={item.id} onClick={() => change(item.id)} aria-pressed={strategy === item.id}>{item.name}</button>)}</div>
    <div className="options-layout">
      <section className="card calculator-inputs"><div className="section-label">INPUTS</div><h2>{current.name}</h2><p className="muted leading">{current.description}</p><div className="position-note">{current.position}</div>
        <div className="input-grid">
          {([['sharePrice', 'Share price', '0.01'], ['strike', 'Strike price', '0.01'], ['premium', 'Option price per share', '0.01'], ['contracts', 'Number of contracts', '1'], ['fees', 'Total estimated fees', '0.01']] as const).map(([key, label, step]) => <label key={key}>{label}<div className="input-with-unit"><span>{key === 'contracts' ? '#' : 'C$'}</span><input type="number" min={key === 'contracts' ? 1 : key === 'sharePrice' || key === 'strike' ? 0.01 : 0} max={key === 'contracts' ? 10000 : undefined} step={step} value={values[key]} onChange={event => setValues(previous => ({ ...previous, [key]: event.target.value }))} /></div></label>)}
          <label>Expiry date <span className="optional">optional</span><input type="date" value={expiry} onChange={event => setExpiry(event.target.value)} /></label>
        </div>
        <p className="field-help">Include all expected fees for buying, selling or using the option. Enter this total once.</p>
        {!valid && <p className="validation-message" role="alert">Share and strike prices must be above zero. Option prices and fees cannot be negative. Enter 1–10,000 whole contracts.</p>}
        <div className="small-info"><Info size={15} /><span>Uses standard contracts for 100 shares each.</span></div>
      </section>
      <section className="card payoff-card"><div className="section-heading"><div><div className="section-label">RESULTS</div><h2>On the expiry date</h2></div><span className="pill neutral">{expiryLabel}{summary ? `${number(summary.shares)} shares` : 'Enter your prices'}</span></div>
        <div className="payoff-metrics"><div><span>Best possible result</span><strong>{summary ? summary.best === Infinity ? 'No upper limit' : money(summary.best) : '—'}</strong></div><div><span>Most you could lose</span><strong>{summary ? money(summary.maxLoss) : '—'}</strong></div><div><span>Share price to break even</span><strong className={breakEvenDescription.length > 20 ? 'small-value' : ''}>{breakEvenDescription}</strong></div></div>
        {valid ? <><svg ref={chartRef} className="payoff-chart" viewBox="0 0 750 270" role="img" aria-label={`${current.name} profit or loss on the expiry date at different share prices`}>
          <rect x="50" y="20" width="650" height={Math.max(0, y(0) - 20)} fill="#f2f8f4" />
          {axisTicks.map(fraction => <g key={fraction}><line x1={x(maximumPrice * fraction)} x2={x(maximumPrice * fraction)} y1="20" y2="230" stroke="#edf0ec" /><text x={x(maximumPrice * fraction)} y="253" textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'} style={{ fontSize: axisFontSize }}>{money(maximumPrice * fraction)}</text></g>)}
          <line x1="50" x2="700" y1={y(0)} y2={y(0)} stroke="#a8b5ac" strokeDasharray="4 4" /><text x="43" y={y(0) + 4} textAnchor="end" style={{ fontSize: axisFontSize }}>0</text>
          <path d={path} stroke="#287661" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" fill="none" />
          {summary?.breakEven !== null && summary && summary.breakEven <= maximumPrice && <circle cx={x(summary.breakEven)} cy={y(0)} r="5" fill="#ce8a52" stroke="#fff" strokeWidth="2" />}
        </svg><div className="chart-axis"><span>Profit / loss after your estimated fees</span><span>Share price on the expiry date (CAD)</span></div>
        <div className="scenario-table"><div className="scenario-table-heading"><span>Share price on expiry date</span><span>Profit / loss after fees</span></div>{[0, input.sharePrice * 0.75, input.sharePrice, input.sharePrice * 1.25, Math.max(input.strike, input.sharePrice) * 1.5].map((price, index) => { const result = payoff(strategy, price, input); return <div className="scenario-row" key={index}><span>{money(price)}</span><strong className={result >= 0 ? 'positive' : 'negative'}>{result > 0 ? '+' : ''}{money(result)}</strong></div>; })}</div></> : <div className="chart-empty">The profit / loss chart will appear when the entered values are valid.</div>}
      </section>
    </div>
    <details className="scan-details"><summary>How this is calculated &amp; contract rules</summary><ul><li>The strike price is the share price set in the contract. A call gives its buyer the right to buy shares at that price; a put gives the right to sell. The option price per share is also called the premium.</li><li>Results are for the expiry date and include the fees you entered. Dividend payments, interest and currency changes are excluded. Before that date, option value also depends on time left, share-price movements and how easily the option can be traded.</li><li>A covered call assumes you own all the matching shares. The buyer of your sold call can require you to sell those shares before the expiry date. This is called early assignment. A purchased option can also lead to a share purchase or sale.</li><li>Broker and account permissions differ, including in a TFSA. Check the share count, costs and rules for using the option with your broker. This calculator supports standard 100-share contracts only.</li><li>The break-even price is where the entered position makes no profit or loss. It is not a price prediction. The optional expiry date is a label; changing it does not change these end-of-contract calculations.</li><li><a href="https://www.m-x.ca/en/markets/equity-derivatives/equity-options" target="_blank" rel="noreferrer">Montréal Exchange contract rules <ArrowUpRight size={14} /></a></li></ul></details>
  </>;
}
