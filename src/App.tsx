import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUpRight, BarChart3, BookOpen, ChevronDown, ExternalLink, FlaskConical, RefreshCw, Search, SlidersHorizontal, Sparkles, X, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Opportunity, ProbabilityReport, Scan, View } from './types';
import { isProbabilityReport, isScan } from './types';
import { date, isNumber, money, number, percent, timestamp } from './format';
import PriceChart from './PriceChart';
import TradePlan, { EntryScenarioCell, UpsideScenarioCell } from './TradePlan';
import OptionsLab from './OptionsLab';
import ProbabilityEvidence from './ProbabilityEvidence';
import { pricePatternLabel, timeframeLabel } from './labels';
import { plainEnglish } from './plainEnglish';

const navigation: { id: View; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Stocks', icon: BarChart3 },
  { id: 'options', label: 'Options', icon: FlaskConical },
  { id: 'methodology', label: 'How it works', icon: BookOpen },
];

function initialView(): View {
  const candidate = window.location.hash.replace('#', '');
  return navigation.some(item => item.id === candidate) ? candidate as View : 'overview';
}

function Score({ value, kind = 'fundamental' }: { value: number | null; kind?: string }) {
  return <div className={`score ${kind}`}><span>{isNumber(value) ? number(value) : '—'}</span><div className="score-track"><i style={{ width: `${isNumber(value) ? Math.max(0, Math.min(100, value)) : 0}%` }} /></div></div>;
}

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function MobileStockCard({ stock, demo, open }: { stock: Opportunity; demo: boolean; open: () => void }) {
  const plan = stock.tradePlan;
  const available = plan && plan.status !== 'Unavailable';
  return <article className="mobile-stock-card" aria-label={`${stock.symbol} stock summary`}>
    <div className="mobile-stock-heading"><div className="mobile-stock-company"><h3>{stock.symbol}<span>{stock.exchange}</span></h3><p>{stock.name}</p></div><div className="mobile-stock-price"><strong>{money(stock.price, stock.currency)}</strong><span className={isNumber(stock.changePercent) && stock.changePercent < 0 ? 'negative' : 'positive'}>{percent(stock.changePercent, true)}</span></div></div>
    <div className="mobile-stock-meta"><Pill tone={stock.setup === 'Trend continuation' ? 'green' : stock.setup === 'Pullback' ? 'amber' : 'neutral'}>{pricePatternLabel(stock.setup)}</Pill><span>{timeframeLabel(stock.horizon)}</span><span>{stock.dataQuality === 'Partial' ? 'Some data missing' : 'Key data available'}</span></div>
    <div className="mobile-stock-scores"><div><span>Financial score <small>/100</small></span><Score value={stock.fundamentalScore} /></div><div><span>Price score <small>/100</small></span><Score value={stock.technicalScore} kind="technical" /></div></div>
    <div className="mobile-stock-entry"><span className="mobile-stock-label">Suggested buy range</span><EntryScenarioCell plan={plan} currency={stock.currency} />{available && <span className="mobile-stock-reference">Buy price used: {money(plan.referenceEntry, stock.currency)}</span>}</div>
    {available && <><div className="mobile-stock-levels"><div><span>Target sell price</span><strong>{money(plan.target, stock.currency)}</strong></div><div><span>Sell if it falls to</span><strong>{money(plan.invalidation, stock.currency)}</strong></div></div><div className="mobile-stock-return"><span>Possible gain<br /><small>Within {number(plan.horizonSessions)} trading days</small></span><UpsideScenarioCell plan={plan} demo={demo} /></div></>}
    <div className="mobile-stock-date">Closing price · {date(stock.priceAsOf, true)} · {stock.currency}</div>
    <button className="button secondary mobile-stock-open" onClick={open} aria-label={`Open ${stock.symbol} details`}>Open details<ArrowUpRight size={17} /></button>
  </article>;
}

function OpportunityDetail({ stock, demo, close }: { stock: Opportunity; demo: boolean; close: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key !== 'Tab' || !dialog.current) return;
      const elements = [...dialog.current.querySelectorAll<HTMLElement>('button, a[href], input, select, [tabindex="0"]')];
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [close]);
  const financialCurrency = stock.financialCurrency || null;
  const reportedMoney = (value: number | null) => financialCurrency ? money(value, financialCurrency, true) : isNumber(value) ? `${number(value)} · currency unknown` : '—';
  const technicalMetrics = [
    ['Recent price strength (RSI)', number(stock.technicals.rsi14, 1)],
    ['20-day average price', money(stock.technicals.sma20, stock.currency)],
    ['50-day average price', money(stock.technicals.sma50, stock.currency)],
    ['200-day average price', money(stock.technicals.sma200, stock.currency)],
    ['Recent 20-day low', money(stock.technicals.support, stock.currency)],
    ['Recent 20-day high', money(stock.technicals.resistance, stock.currency)],
    ['Trading volume vs. usual', isNumber(stock.technicals.relativeVolume) ? `${number(stock.technicals.relativeVolume, 2)}×` : '—'],
    ['Price change over 20 trading days', percent(stock.technicals.return20d, true)],
  ];
  const fundamentalMetrics = [
    ['Cash', reportedMoney(stock.fundamentals.cash)], ['Debt', reportedMoney(stock.fundamentals.debt)],
    ['Cash from business (annual)', reportedMoney(stock.fundamentals.operatingCashFlow)], ['Cash after capital spending (annual)', reportedMoney(stock.fundamentals.freeCashFlow)],
    ['Sales growth', percent(stock.fundamentals.revenueGrowth, true)], ['Profit margin', percent(stock.fundamentals.profitMargin)],
    ['Price compared with sales', isNumber(stock.fundamentals.priceToSales) ? `${number(stock.fundamentals.priceToSales, 2)}×` : '—'],
    ['Estimated months of cash', isNumber(stock.fundamentals.cashRunwayMonths) ? `${number(stock.fundamentals.cashRunwayMonths, 1)} months` : '—'],
  ];
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialog} className="stock-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <div className="dialog-header"><span className="section-label">STOCK DETAILS</span><button ref={closeButton} className="icon-button" aria-label="Close stock details" onClick={close}><X size={21} /></button></div>
      {demo && <div className="detail-demo">Demo data · Example prices and suggestions.</div>}
      <div className="stock-detail-title"><div><div className="ticker-line"><h2 id="detail-title">{stock.symbol}</h2><Pill>{stock.exchange}</Pill><Pill tone={stock.dataQuality === 'Partial' ? 'amber' : 'green'}>{stock.dataQuality === 'Partial' ? 'Some data missing' : 'Key data available'}</Pill></div><p>{stock.name} <span>·</span> {stock.sector}</p></div><div className="detail-price"><strong>{money(stock.price, stock.currency)}</strong><span className={isNumber(stock.changePercent) && stock.changePercent < 0 ? 'negative' : 'positive'}>{percent(stock.changePercent, true)} <span className="muted">daily</span></span></div></div>
      <div className="detail-price-meta">Closing price · {date(stock.priceAsOf, true)} · {stock.currency}</div>
      <PriceChart history={stock.history} currency={stock.currency} label={`${stock.symbol} closing price`} />
      <div className="detail-score-row"><div><span>Financial score</span><Score value={stock.fundamentalScore} /></div><div><span>Price score</span><Score value={stock.technicalScore} kind="technical" /></div><div><span>Price pattern</span><Pill>{pricePatternLabel(stock.setup)}</Pill></div><div><span>Timeframe</span><strong>{timeframeLabel(stock.horizon)}</strong></div></div>
      <TradePlan plan={stock.tradePlan} currency={stock.currency} demo={demo} />
      <div className="detail-thesis"><p className="stock-summary">{plainEnglish(stock.summary)}</p><div className="analysis-label">{stock.analysisKind === 'AI' ? <Sparkles size={14} /> : <SlidersHorizontal size={14} />}{stock.analysisKind === 'AI' ? 'AI summary' : 'Calculated summary'}</div></div>
      <div className="evidence-grid"><section><h3>Reasons</h3>{stock.reasons.length ? <ul>{stock.reasons.map((reason, index) => <li key={index}>{plainEnglish(reason)}</li>)}</ul> : <p className="muted">No reasons supplied.</p>}</section><section><h3>Risks</h3>{stock.risks.length ? <ul>{stock.risks.map((risk, index) => <li key={index}>{plainEnglish(risk)}</li>)}</ul> : <p className="muted">No risk notes supplied.</p>}</section></div>
      <div className="detail-metric-columns"><section><div className="metric-heading"><h3>Company finances</h3><span>{date(stock.fundamentalsAsOf, true)}</span></div><p className="metric-context">Financial currency: {financialCurrency || 'currency unknown'}. Date shown is the oldest company report used. Cash and debt figures may be newer.</p><div className="metric-list">{fundamentalMetrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></section><section><div className="metric-heading"><h3>Price measurements</h3><span>{date(stock.priceAsOf, true)}</span></div><p className="metric-context">Recent highs and lows show past prices, not limits on future prices.</p><div className="metric-list">{technicalMetrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></section></div>
      <div className="detail-bottom"><div><h3>Trading activity</h3><p>Average traded per day <strong>{money(stock.averageDailyValue, stock.currency, true)}</strong> · Value of all shares <strong>{money(stock.marketCap, stock.currency, true)}</strong></p><p>Options: {stock.optionsAvailable === true ? 'listed by the data source; check current contracts and prices' : stock.optionsAvailable === false ? 'not listed by the data source' : 'not checked'}.</p></div><div><h3>Sources</h3>{stock.sources.length ? stock.sources.map((source, index) => { let validUrl = false; try { validUrl = ['https:', 'http:'].includes(new URL(source.url).protocol); } catch { /* Show an unlinked source if its URL is invalid. */ } return <div className="source-item" key={index}>{validUrl ? <a href={source.url} target="_blank" rel="noreferrer">{plainEnglish(source.label)}<ExternalLink size={12} /></a> : <span>{plainEnglish(source.label)}</span>}<span>{date(source.asOf, true)}</span></div>; }) : <p>No source links supplied.</p>}</div></div>
    </div>
  </div>;
}

function Methodology({ scan, probabilityReport }: { scan: Scan | null; probabilityReport: ProbabilityReport | null }) {
  return <>
    <div className="page-heading compact-heading"><h1>How it works</h1></div>
    <section className="card configuration"><h2>Search settings</h2><dl>
      <div><dt>Minimum price</dt><dd>{scan ? money(scan.filters.minPrice) : '—'}</dd></div>
      <div><dt>Minimum amount traded per day</dt><dd>{scan ? money(scan.filters.minAverageDailyValue, 'CAD', true) : '—'}</dd></div>
      <div><dt>Source</dt><dd>{scan ? plainEnglish(scan.universe.source) : 'Not supplied'}</dd></div>
      <div><dt>Exchanges</dt><dd>{scan?.universe.exchanges.join(' · ') || '—'}</dd></div>
      <div><dt>All listings confirmed</dt><dd>{scan?.universe.complete ? 'Yes' : 'No'}</dd></div>
      <div><dt>AI summaries</dt><dd>{scan?.ai.enabled ? `${number(scan.ai.analyzed)} · ${scan.ai.model || 'model unknown'}` : 'Off'}</dd></div>
    </dl></section>
    <ProbabilityEvidence report={probabilityReport} />
    <details className="card calculation-notes"><summary>How to read the numbers</summary><ul>
      <li>Prices are the closing prices from the date shown. Reloading opens the latest saved results; it does not start another stock search.</li>
      <li>Financial and price scores run from 0 to 100. Higher means stronger results under the app’s rules, not a higher chance of profit. A dash means data is missing.</li>
      <li>Company finances use the currency in its reports. Yearly cash flow and the latest cash/debt figures can cover different periods. Capital spending means money spent on long-term business assets.</li>
      <li>Suggested buy and sell prices use recent highs, lows and typical daily price moves. Possible gains use the displayed buy price, before fees. Gain compared with possible loss uses the highest price in the buy range.</li>
      <li>The percentage estimates the chance of reaching the suggested sell price before the lower exit price, after buying at the price used in the calculation. It is not the chance of making a profit after fees.</li>
      <li>Recent price strength (RSI) compares price rises and falls over 14 trading days. Averages and recent highs/lows also use trading days, excluding weekends and market holidays.</li>
      <li>Yahoo data can be incomplete. Open a stock to see its dates and sources.</li>
    </ul></details>
  </>;
}

export default function App() {
  const [view, setView] = useState<View>(initialView);
  const [mobileResults, setMobileResults] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [scan, setScan] = useState<Scan | null>(null);
  const [probabilityReport, setProbabilityReport] = useState<ProbabilityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  const [horizon, setHorizon] = useState('All horizons');
  const [sector, setSector] = useState('All sectors');
  const [setup, setSetup] = useState('All setups');
  const [sort, setSort] = useState('technical');
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const closeDetail = useRef(() => setSelected(null)).current;

  useEffect(() => { const handler = () => setView(initialView()); window.addEventListener('hashchange', handler); return () => window.removeEventListener('hashchange', handler); }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setMobileResults(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`${import.meta.env.BASE_URL}data/latest.json`, { signal: controller.signal, cache: 'no-cache' })
      .then(response => { if (!response.ok) throw new Error(`The saved stock results could not be loaded (HTTP ${response.status}).`); return response.json(); })
      .then((data: unknown) => { if (!isScan(data)) throw new Error('The saved stock results could not be read.'); setScan(data); })
      .catch((reason: unknown) => { if (controller.signal.aborted) return; setError(reason instanceof SyntaxError ? 'The saved stock results are damaged or incomplete.' : reason instanceof Error ? reason.message : 'The saved stock results could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/probability-validation.json`, { signal: controller.signal, cache: 'no-cache' })
      .then(response => response.ok ? response.json() : null)
      .then((data: unknown) => { if (!controller.signal.aborted) setProbabilityReport(isProbabilityReport(data) ? data : null); })
      .catch(() => { if (!controller.signal.aborted) setProbabilityReport(null); });
    return () => controller.abort();
  }, [reload]);

  const navigate = (next: View) => { window.location.hash = next; setView(next); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const sectors = useMemo(() => [...new Set(scan?.opportunities.map(stock => stock.sector) || [])].sort(), [scan]);
  const filtered = useMemo(() => (scan?.opportunities || []).filter(stock => {
    const term = query.toLocaleLowerCase().trim();
    return (!term || `${stock.symbol} ${stock.name}`.toLocaleLowerCase().includes(term))
      && (horizon === 'All horizons' || stock.horizon === horizon || stock.horizon === 'Both')
      && (sector === 'All sectors' || stock.sector === sector) && (setup === 'All setups' || stock.setup === setup);
  }).sort((a, b) => {
    if (sort === 'symbol') return a.symbol.localeCompare(b.symbol);
    if (sort === 'probability' && scan?.mode === 'live') {
      const value = (stock: Opportunity) => stock.tradePlan?.status !== 'Unavailable' && stock.tradePlan?.probability.status === 'Estimated' && isNumber(stock.tradePlan.probability.value) ? stock.tradePlan.probability.value : -Infinity;
      return value(b) - value(a) || a.symbol.localeCompare(b.symbol);
    }
    if (sort === 'upside') return (b.tradePlan?.upsidePercent ?? -Infinity) - (a.tradePlan?.upsidePercent ?? -Infinity) || a.symbol.localeCompare(b.symbol);
    const key = sort === 'fundamental' ? 'fundamentalScore' : sort === 'liquidity' ? 'averageDailyValue' : 'technicalScore';
    return (isNumber(b[key]) ? b[key]! : -Infinity) - (isNumber(a[key]) ? a[key]! : -Infinity) || a.symbol.localeCompare(b.symbol);
  }), [scan, query, horizon, sector, setup, sort]);
  const displayed = filtered;
  const hasFilters = query !== '' || horizon !== 'All horizons' || sector !== 'All sectors' || setup !== 'All setups';
  const resetFilters = () => { setQuery(''); setHorizon('All horizons'); setSector('All sectors'); setSetup('All setups'); };
  const marketAge = scan?.marketAsOf ? Math.floor((Date.now() - Date.parse(`${scan.marketAsOf}T00:00:00Z`)) / 86400000) : 0;

  return <><div className="app-shell" aria-hidden={selected ? true : undefined}>
    <header className="app-header"><a className="app-name" href="#overview" onClick={() => setView('overview')}>Canadian stock picker</a><nav className="app-nav" aria-label="Main navigation">{navigation.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => navigate(id)} className={view === id || id === 'overview' && view === 'opportunities' ? 'active' : ''} aria-current={view === id || id === 'overview' && view === 'opportunities' ? 'page' : undefined}><Icon size={17} /><span>{label}</span></button>)}</nav></header>
    <main className="functional-main">
      {scan?.mode === 'demo' && <div className="demo-banner compact-notice"><FlaskConical size={17} /><span><strong>Demo data</strong> · Example companies and prices.</span></div>}
      {error && <div className="notice error" role="alert"><AlertTriangle size={20} /><div><strong>Could not reload data.</strong><p>{error}{scan ? ' The previous report remains visible.' : ''}</p></div><button className="button secondary" onClick={() => setReload(value => value + 1)} disabled={loading}>Retry</button></div>}
      {view === 'options' ? <OptionsLab /> : view === 'methodology' ? <Methodology scan={scan} probabilityReport={probabilityReport} /> : <>
        <div className="scan-heading"><div><h1>Stocks</h1><p>{scan?.marketAsOf ? `Prices as of ${date(scan.marketAsOf, true)}` : 'No stock data loaded'}{scan && <> · Updated {timestamp(scan.generatedAt)}</>}{marketAge > 4 && <> · Data is {number(marketAge)} days old</>}</p></div><button className="button secondary" onClick={() => setReload(value => value + 1)} disabled={loading}><RefreshCw size={15} className={loading ? 'spinning' : ''} />{loading ? 'Loading' : 'Reload data'}</button></div>
        {scan && <div className="scan-facts"><span><strong>{number(scan.universe.scanned)}</strong> / {number(scan.universe.discovered)} checked</span><span><strong>{number(scan.universe.eligible)}</strong> passed the filters</span><span>Minimum <strong>{money(scan.filters.minPrice)}</strong></span><span>{scan.universe.complete ? 'All listings confirmed' : 'Some listings may be missing'}</span><span><strong>{number(scan.universe.failed)}</strong> could not be checked</span></div>}
        {scan && (scan.status !== 'complete' || !scan.universe.complete || scan.warnings.length > 0) && <details className="scan-details compact-scan-details"><summary>{scan.status === 'failed' ? 'Stock search failed' : 'Data notes'}{scan.warnings.length > 0 && <> ({number(scan.warnings.length)})</>}</summary>{!scan.universe.complete && <p>The app has not confirmed that every Canadian listing is included.</p>}<ul>{scan.warnings.map((warning, index) => <li key={index}>{plainEnglish(warning)}</li>)}</ul></details>}
        <section className="card opportunities-card"><div className="opportunities-heading"><div className="title-with-count"><h2>Stocks</h2><span className="count-badge">{number(filtered.length)}</span></div><div className="sort-control"><ArrowDown size={14} /><label className="sr-only" htmlFor="sort">Sort stocks</label><select id="sort" value={sort} onChange={event => setSort(event.target.value)}><option value="technical">Price score</option><option value="fundamental">Financial score</option><option value="liquidity">Amount traded per day</option>{scan?.opportunities.some(stock => stock.tradePlan && stock.tradePlan.status !== 'Unavailable') && <option value="upside">Possible gain</option>}{scan?.mode === 'live' && scan.opportunities.some(stock => stock.tradePlan?.status !== 'Unavailable' && stock.tradePlan?.probability.status === 'Estimated' && isNumber(stock.tradePlan.probability.value)) && <option value="probability">Chance of reaching target</option>}<option value="symbol">Symbol A–Z</option></select><ChevronDown size={13} /></div></div>
            <div className="filter-bar"><label className="search-input"><Search size={17} /><input type="search" placeholder="Search symbol or company" aria-label="Search symbols and companies" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="search-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</label><div className="select-wrap"><select aria-label="Filter by timeframe" value={horizon} onChange={event => setHorizon(event.target.value)}><option value="All horizons">All timeframes</option><option value="Long term">Long term</option><option value="Swing">Short term</option></select><ChevronDown size={13} /></div><div className="select-wrap"><select aria-label="Filter by sector" value={sector} onChange={event => setSector(event.target.value)}><option>All sectors</option>{sectors.map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></div><div className="select-wrap"><select aria-label="Filter by price pattern" value={setup} onChange={event => setSetup(event.target.value)}><option value="All setups">All price patterns</option>{['Trend continuation', 'Pullback', 'Range watch', 'Research watch'].map(item => <option key={item} value={item}>{pricePatternLabel(item)}</option>)}</select><ChevronDown size={13} /></div></div>
            {loading && !scan ? <div className="loading-state" role="status"><RefreshCw size={25} className="spinning" /><h3>Loading stocks</h3><p></p></div> : !scan ? <div className="empty-state"><Activity size={32} /><h3>No stock data loaded</h3><p>Reload when the stock search has finished.</p><button className="button secondary" onClick={() => setReload(value => value + 1)} disabled={loading}>Retry loading</button></div> : !displayed.length ? <div className="empty-state"><Search size={30} /><h3>{hasFilters ? 'No matching stocks' : 'No stocks passed the filters'}</h3><p>{hasFilters ? 'Change or clear the filters.' : 'No stocks met the search filters.'}</p>{hasFilters && <button className="button secondary" onClick={resetFilters}>Clear filters</button>}</div> : mobileResults ? <div className="mobile-stock-results">{displayed.map(stock => <MobileStockCard key={`${stock.exchange}:${stock.symbol}`} stock={stock} demo={scan.mode !== 'live'} open={() => setSelected(stock)} />)}</div> : <div className="table-scroll desktop-stock-results"><table><thead><tr><th>Company</th><th>Closing price</th><th className="entry-scenario-heading">Buy range / possible gain<span>within 20 trading days</span></th><th>Price history</th><th>Financial score <span>/100</span></th><th>Price score <span>/100</span></th><th>Price pattern &amp; timeframe</th><th><span className="sr-only">View details</span></th></tr></thead><tbody>{displayed.map(stock => <tr key={`${stock.exchange}:${stock.symbol}`}><td><button className="company-button" onClick={() => setSelected(stock)}><span className="company-monogram">{stock.symbol.slice(0, 2).replace('.', '')}</span><span><strong>{stock.symbol}<span className="exchange-label">{stock.exchange}</span></strong><small title={stock.name}>{stock.name}</small></span></button></td><td><span className="table-price">{money(stock.price, stock.currency)}</span><span className={`table-change ${isNumber(stock.changePercent) && stock.changePercent < 0 ? 'negative' : 'positive'}`}>{percent(stock.changePercent, true)}</span></td><td className="trade-plan-table-cell"><EntryScenarioCell plan={stock.tradePlan} currency={stock.currency} /><UpsideScenarioCell plan={stock.tradePlan} demo={scan.mode !== 'live'} /></td><td><PriceChart history={stock.history} currency={stock.currency} compact /></td><td><Score value={stock.fundamentalScore} /></td><td><Score value={stock.technicalScore} kind="technical" /></td><td><Pill tone={stock.setup === 'Trend continuation' ? 'green' : stock.setup === 'Pullback' ? 'amber' : 'neutral'}>{pricePatternLabel(stock.setup)}</Pill><div className="table-horizon">{timeframeLabel(stock.horizon)}<span>·</span>{stock.dataQuality === 'Partial' ? 'Some data missing' : stock.sector}</div></td><td><button className="row-open" aria-label={`Open ${stock.symbol} research details`} onClick={() => setSelected(stock)}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table></div>}
            <div className="table-footer"><span>{scan ? `${number(displayed.length)} matching stocks` : 'No data loaded'}</span><span>Closing prices · Open a stock for details</span></div>
        </section>
      </>}
    </main>
  </div>{selected && <OpportunityDetail stock={selected} demo={scan?.mode === 'demo'} close={closeDetail} />}</>;
}
