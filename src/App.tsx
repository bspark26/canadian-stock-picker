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

const navigation: { id: View; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Stocks', icon: BarChart3 },
  { id: 'options', label: 'Options', icon: FlaskConical },
  { id: 'methodology', label: 'Data & model', icon: BookOpen },
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
    <div className="mobile-stock-meta"><Pill tone={stock.setup === 'Trend continuation' ? 'green' : stock.setup === 'Pullback' ? 'amber' : 'neutral'}>{stock.setup}</Pill><span>{stock.horizon}</span><span>{stock.dataQuality === 'Partial' ? 'Partial data' : 'Core data available'}</span></div>
    <div className="mobile-stock-scores"><div><span>Fundamental <small>/100</small></span><Score value={stock.fundamentalScore} /></div><div><span>Technical <small>/100</small></span><Score value={stock.technicalScore} kind="technical" /></div></div>
    <div className="mobile-stock-entry"><span className="mobile-stock-label">Entry zone</span><EntryScenarioCell plan={plan} currency={stock.currency} />{available && <span className="mobile-stock-reference">Reference {money(plan.referenceEntry, stock.currency)}</span>}</div>
    {available && <><div className="mobile-stock-levels"><div><span>Target</span><strong>{money(plan.target, stock.currency)}</strong></div><div><span>Stop / invalidation</span><strong>{money(plan.invalidation, stock.currency)}</strong></div></div><div className="mobile-stock-return"><span>Potential upside<br /><small>{number(plan.horizonSessions)} sessions · scenario</small></span><UpsideScenarioCell plan={plan} demo={demo} /></div></>}
    <div className="mobile-stock-date">Daily close · {date(stock.priceAsOf, true)} · {stock.currency}</div>
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
    ['RSI · 14 sessions', number(stock.technicals.rsi14, 1)],
    ['20-day average', money(stock.technicals.sma20, stock.currency)],
    ['50-day average', money(stock.technicals.sma50, stock.currency)],
    ['200-day average', money(stock.technicals.sma200, stock.currency)],
    ['Historical support', money(stock.technicals.support, stock.currency)],
    ['Historical resistance', money(stock.technicals.resistance, stock.currency)],
    ['Relative volume', isNumber(stock.technicals.relativeVolume) ? `${number(stock.technicals.relativeVolume, 2)}×` : '—'],
    ['20-session return', percent(stock.technicals.return20d, true)],
  ];
  const fundamentalMetrics = [
    ['Cash', reportedMoney(stock.fundamentals.cash)], ['Debt', reportedMoney(stock.fundamentals.debt)],
    ['Operating cash flow (annual)', reportedMoney(stock.fundamentals.operatingCashFlow)], ['Free cash flow (annual)', reportedMoney(stock.fundamentals.freeCashFlow)],
    ['Revenue growth', percent(stock.fundamentals.revenueGrowth, true)], ['Profit margin', percent(stock.fundamentals.profitMargin)],
    ['Price / sales', isNumber(stock.fundamentals.priceToSales) ? `${number(stock.fundamentals.priceToSales, 2)}×` : '—'],
    ['Cash runway estimate', isNumber(stock.fundamentals.cashRunwayMonths) ? `${number(stock.fundamentals.cashRunwayMonths, 1)} months` : '—'],
  ];
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialog} className="stock-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <div className="dialog-header"><span className="section-label">STOCK DETAILS</span><button ref={closeButton} className="icon-button" aria-label="Close stock details" onClick={close}><X size={21} /></button></div>
      {demo && <div className="detail-demo">Demo data · Illustrative prices and signals.</div>}
      <div className="stock-detail-title"><div><div className="ticker-line"><h2 id="detail-title">{stock.symbol}</h2><Pill>{stock.exchange}</Pill><Pill tone={stock.dataQuality === 'Partial' ? 'amber' : 'green'}>{stock.dataQuality === 'Partial' ? 'Partial data' : 'Core data available'}</Pill></div><p>{stock.name} <span>·</span> {stock.sector}</p></div><div className="detail-price"><strong>{money(stock.price, stock.currency)}</strong><span className={isNumber(stock.changePercent) && stock.changePercent < 0 ? 'negative' : 'positive'}>{percent(stock.changePercent, true)} <span className="muted">daily</span></span></div></div>
      <div className="detail-price-meta">Daily close · {date(stock.priceAsOf, true)} · {stock.currency}</div>
      <PriceChart history={stock.history} currency={stock.currency} label={`${stock.symbol} daily close`} />
      <div className="detail-score-row"><div><span>Fundamental score</span><Score value={stock.fundamentalScore} /></div><div><span>Technical score</span><Score value={stock.technicalScore} kind="technical" /></div><div><span>Setup</span><Pill>{stock.setup}</Pill></div><div><span>Horizon</span><strong>{stock.horizon}</strong></div></div>
      <TradePlan plan={stock.tradePlan} currency={stock.currency} demo={demo} />
      <div className="detail-thesis"><p className="stock-summary">{stock.summary}</p><div className="analysis-label">{stock.analysisKind === 'AI' ? <Sparkles size={14} /> : <SlidersHorizontal size={14} />}{stock.analysisKind === 'AI' ? 'AI summary' : 'Rules summary'}</div></div>
      <div className="evidence-grid"><section><h3>Reasons</h3>{stock.reasons.length ? <ul>{stock.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : <p className="muted">No reasons supplied.</p>}</section><section><h3>Risks</h3>{stock.risks.length ? <ul>{stock.risks.map((risk, index) => <li key={index}>{risk}</li>)}</ul> : <p className="muted">No risk notes supplied.</p>}</section></div>
      <div className="detail-metric-columns"><section><div className="metric-heading"><h3>Fundamentals</h3><span>{date(stock.fundamentalsAsOf, true)}</span></div><p className="metric-context">Reported financial amounts: {financialCurrency || 'currency not supplied'}. Date shown is the oldest supplied reporting period; balance-sheet data may be newer.</p><div className="metric-list">{fundamentalMetrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></section><section><div className="metric-heading"><h3>Technicals</h3><span>{date(stock.priceAsOf, true)}</span></div><p className="metric-context">Historical ranges describe past trading. Support is not a floor or a guaranteed entry.</p><div className="metric-list">{technicalMetrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></section></div>
      <div className="detail-bottom"><div><h3>Liquidity</h3><p>Average daily value <strong>{money(stock.averageDailyValue, stock.currency, true)}</strong> · Market cap <strong>{money(stock.marketCap, stock.currency, true)}</strong></p><p>Options: {stock.optionsAvailable === true ? 'availability flagged by source; current contracts and quotes still need checking' : stock.optionsAvailable === false ? 'not available according to source' : 'availability has not been checked'}.</p></div><div><h3>Sources</h3>{stock.sources.length ? stock.sources.map((source, index) => { let validUrl = false; try { validUrl = ['https:', 'http:'].includes(new URL(source.url).protocol); } catch { /* Show an unlinked source if its URL is invalid. */ } return <div className="source-item" key={index}>{validUrl ? <a href={source.url} target="_blank" rel="noreferrer">{source.label}<ExternalLink size={12} /></a> : <span>{source.label}</span>}<span>{date(source.asOf, true)}</span></div>; }) : <p>No source links supplied.</p>}</div></div>
    </div>
  </div>;
}

function Methodology({ scan, probabilityReport }: { scan: Scan | null; probabilityReport: ProbabilityReport | null }) {
  return <>
    <div className="page-heading compact-heading"><h1>Data &amp; model</h1></div>
    <section className="card configuration"><h2>Scan settings</h2><dl>
      <div><dt>Minimum price</dt><dd>{scan ? money(scan.filters.minPrice) : '—'}</dd></div>
      <div><dt>Minimum daily trading value</dt><dd>{scan ? money(scan.filters.minAverageDailyValue, 'CAD', true) : '—'}</dd></div>
      <div><dt>Source</dt><dd>{scan?.universe.source || 'Not supplied'}</dd></div>
      <div><dt>Exchanges</dt><dd>{scan?.universe.exchanges.join(' · ') || '—'}</dd></div>
      <div><dt>Coverage verified</dt><dd>{scan?.universe.complete ? 'Yes' : 'No'}</dd></div>
      <div><dt>AI summaries</dt><dd>{scan?.ai.enabled ? `${number(scan.ai.analyzed)} · ${scan.ai.model || 'model unknown'}` : 'Off'}</dd></div>
    </dl></section>
    <ProbabilityEvidence report={probabilityReport} />
    <details className="card calculation-notes"><summary>Calculation notes</summary><ul>
      <li>Prices are daily closes. Reloading reads the saved scan; it does not run a new scan.</li>
      <li>Fundamental and technical scores use rules, not probabilities. Missing values remain blank.</li>
      <li>Financial amounts use the issuer's reporting currency. Annual cash flow and the latest balance sheet can cover different periods.</li>
      <li>Trade plans use historical ranges and ATR. Scenario returns use the reference entry before costs; reward/risk uses the upper entry price.</li>
      <li>Target-hit probabilities use a separate historical model, conditional on its reference-entry fill rules. They do not measure profit after costs.</li>
      <li>Yahoo data and exchange coverage can be incomplete. Source dates and links are shown in each stock.</li>
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
      .then(response => { if (!response.ok) throw new Error(`The published scan could not be loaded (HTTP ${response.status}).`); return response.json(); })
      .then((data: unknown) => { if (!isScan(data)) throw new Error('The published file does not match the supported scan format.'); setScan(data); })
      .catch((reason: unknown) => { if (controller.signal.aborted) return; setError(reason instanceof SyntaxError ? 'The published scan is not valid JSON. Check that data/latest.json was deployed.' : reason instanceof Error ? reason.message : 'The published scan could not be loaded.'); })
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
      {scan?.mode === 'demo' && <div className="demo-banner compact-notice"><FlaskConical size={17} /><span><strong>Demo data</strong> · Illustrative companies and prices.</span></div>}
      {error && <div className="notice error" role="alert"><AlertTriangle size={20} /><div><strong>Could not reload data.</strong><p>{error}{scan ? ' The previous report remains visible.' : ''}</p></div><button className="button secondary" onClick={() => setReload(value => value + 1)} disabled={loading}>Retry</button></div>}
      {view === 'options' ? <OptionsLab /> : view === 'methodology' ? <Methodology scan={scan} probabilityReport={probabilityReport} /> : <>
        <div className="scan-heading"><div><h1>Stock scan</h1><p>{scan?.marketAsOf ? `Daily close: ${date(scan.marketAsOf, true)}` : 'No scan loaded'}{scan && <> · Updated {timestamp(scan.generatedAt)}</>}{marketAge > 4 && <> · Data is {number(marketAge)} days old</>}</p></div><button className="button secondary" onClick={() => setReload(value => value + 1)} disabled={loading}><RefreshCw size={15} className={loading ? 'spinning' : ''} />{loading ? 'Loading' : 'Reload data'}</button></div>
        {scan && <div className="scan-facts"><span><strong>{number(scan.universe.scanned)}</strong> / {number(scan.universe.discovered)} scanned</span><span><strong>{number(scan.universe.eligible)}</strong> eligible</span><span>Minimum <strong>{money(scan.filters.minPrice)}</strong></span><span>{scan.universe.complete ? 'Coverage verified' : 'Partial coverage'}</span><span><strong>{number(scan.universe.failed)}</strong> failed requests</span></div>}
        {scan && (scan.status !== 'complete' || !scan.universe.complete || scan.warnings.length > 0) && <details className="scan-details compact-scan-details"><summary>{scan.status === 'failed' ? 'Scan failed' : 'Data notes'}{scan.warnings.length > 0 && <> ({number(scan.warnings.length)})</>}</summary>{!scan.universe.complete && <p>Full exchange coverage has not been verified.</p>}<ul>{scan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        <section className="card opportunities-card"><div className="opportunities-heading"><div className="title-with-count"><h2>Stocks</h2><span className="count-badge">{number(filtered.length)}</span></div><div className="sort-control"><ArrowDown size={14} /><label className="sr-only" htmlFor="sort">Sort stocks</label><select id="sort" value={sort} onChange={event => setSort(event.target.value)}><option value="technical">Technical score</option><option value="fundamental">Fundamental score</option><option value="liquidity">Daily trading value</option>{scan?.opportunities.some(stock => stock.tradePlan && stock.tradePlan.status !== 'Unavailable') && <option value="upside">Potential upside</option>}{scan?.mode === 'live' && scan.opportunities.some(stock => stock.tradePlan?.status !== 'Unavailable' && stock.tradePlan?.probability.status === 'Estimated' && isNumber(stock.tradePlan.probability.value)) && <option value="probability">Target-hit probability</option>}<option value="symbol">Symbol A–Z</option></select><ChevronDown size={13} /></div></div>
            <div className="filter-bar"><label className="search-input"><Search size={17} /><input type="search" placeholder="Search symbol or company" aria-label="Search symbols and companies" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="search-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</label><div className="select-wrap"><select aria-label="Filter by horizon" value={horizon} onChange={event => setHorizon(event.target.value)}><option>All horizons</option><option>Long term</option><option>Swing</option></select><ChevronDown size={13} /></div><div className="select-wrap"><select aria-label="Filter by sector" value={sector} onChange={event => setSector(event.target.value)}><option>All sectors</option>{sectors.map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></div><div className="select-wrap"><select aria-label="Filter by setup" value={setup} onChange={event => setSetup(event.target.value)}><option>All setups</option>{['Trend continuation', 'Pullback', 'Range watch', 'Research watch'].map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></div></div>
            {loading && !scan ? <div className="loading-state" role="status"><RefreshCw size={25} className="spinning" /><h3>Loading scan</h3><p></p></div> : !scan ? <div className="empty-state"><Activity size={32} /><h3>No scan loaded</h3><p>Reload after a scan has been published.</p><button className="button secondary" onClick={() => setReload(value => value + 1)} disabled={loading}>Retry loading</button></div> : !displayed.length ? <div className="empty-state"><Search size={30} /><h3>{hasFilters ? 'No matching stocks' : 'No eligible stocks'}</h3><p>{hasFilters ? 'Change or clear the filters.' : 'No stocks met the scan filters.'}</p>{hasFilters && <button className="button secondary" onClick={resetFilters}>Clear filters</button>}</div> : mobileResults ? <div className="mobile-stock-results">{displayed.map(stock => <MobileStockCard key={`${stock.exchange}:${stock.symbol}`} stock={stock} demo={scan.mode !== 'live'} open={() => setSelected(stock)} />)}</div> : <div className="table-scroll desktop-stock-results"><table><thead><tr><th>Company</th><th>Daily close</th><th className="entry-scenario-heading">Entry / upside<span>scenario · 20 sessions</span></th><th>Price history</th><th>Fundamental <span>/100</span></th><th>Technical <span>/100</span></th><th>Setup &amp; horizon</th><th><span className="sr-only">View details</span></th></tr></thead><tbody>{displayed.map(stock => <tr key={`${stock.exchange}:${stock.symbol}`}><td><button className="company-button" onClick={() => setSelected(stock)}><span className="company-monogram">{stock.symbol.slice(0, 2).replace('.', '')}</span><span><strong>{stock.symbol}<span className="exchange-label">{stock.exchange}</span></strong><small title={stock.name}>{stock.name}</small></span></button></td><td><span className="table-price">{money(stock.price, stock.currency)}</span><span className={`table-change ${isNumber(stock.changePercent) && stock.changePercent < 0 ? 'negative' : 'positive'}`}>{percent(stock.changePercent, true)}</span></td><td className="trade-plan-table-cell"><EntryScenarioCell plan={stock.tradePlan} currency={stock.currency} /><UpsideScenarioCell plan={stock.tradePlan} demo={scan.mode !== 'live'} /></td><td><PriceChart history={stock.history} currency={stock.currency} compact /></td><td><Score value={stock.fundamentalScore} /></td><td><Score value={stock.technicalScore} kind="technical" /></td><td><Pill tone={stock.setup === 'Trend continuation' ? 'green' : stock.setup === 'Pullback' ? 'amber' : 'neutral'}>{stock.setup}</Pill><div className="table-horizon">{stock.horizon}<span>·</span>{stock.dataQuality === 'Partial' ? 'Partial data' : stock.sector}</div></td><td><button className="row-open" aria-label={`Open ${stock.symbol} research details`} onClick={() => setSelected(stock)}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table></div>}
            <div className="table-footer"><span>{scan ? `${number(displayed.length)} matching stocks` : 'No data loaded'}</span><span>Daily closes · Open a stock for details</span></div>
        </section>
      </>}
    </main>
  </div>{selected && <OpportunityDetail stock={selected} demo={scan?.mode === 'demo'} close={closeDetail} />}</>;
}
