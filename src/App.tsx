import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowRight, ArrowUpRight, BarChart3, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, Compass, ExternalLink, FlaskConical, Leaf, Menu, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, TrendingUp, X, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Opportunity, ProbabilityReport, Scan, View } from './types';
import { isProbabilityReport, isScan } from './types';
import { date, isNumber, money, number, percent, timestamp } from './format';
import PriceChart from './PriceChart';
import TradePlan, { EntryScenarioCell, UpsideScenarioCell } from './TradePlan';
import OptionsLab from './OptionsLab';
import ProbabilityEvidence from './ProbabilityEvidence';

const navigation: { id: View; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: Compass },
  { id: 'opportunities', label: 'Opportunities', icon: BarChart3 },
  { id: 'options', label: 'Options lab', icon: FlaskConical },
  { id: 'methodology', label: 'Methodology', icon: BookOpen },
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
      <div className="dialog-header"><span className="section-label">SECURITY RESEARCH</span><button ref={closeButton} className="icon-button" aria-label="Close stock details" onClick={close}><X size={21} /></button></div>
      {demo && <div className="detail-demo">ILLUSTRATIVE DEMO · These prices and signals are not current market data.</div>}
      <div className="stock-detail-title"><div><div className="ticker-line"><h2 id="detail-title">{stock.symbol}</h2><Pill>{stock.exchange}</Pill><Pill tone={stock.dataQuality === 'Partial' ? 'amber' : 'green'}>{stock.dataQuality === 'Partial' ? 'Partial data' : 'Core data available'}</Pill></div><p>{stock.name} <span>·</span> {stock.sector}</p></div><div className="detail-price"><strong>{money(stock.price, stock.currency)}</strong><span className={isNumber(stock.changePercent) && stock.changePercent < 0 ? 'negative' : 'positive'}>{percent(stock.changePercent, true)} <span className="muted">daily</span></span></div></div>
      <div className="detail-price-meta">Daily close · {date(stock.priceAsOf, true)} · {stock.currency} · End-of-day observations</div>
      <PriceChart history={stock.history} currency={stock.currency} label={`${stock.symbol} daily close`} />
      <div className="detail-score-row"><div><span>Fundamental score</span><Score value={stock.fundamentalScore} /></div><div><span>Technical score</span><Score value={stock.technicalScore} kind="technical" /></div><div><span>Opportunity type</span><Pill>{stock.setup}</Pill></div><div><span>Research horizon</span><strong>{stock.horizon}</strong></div></div>
      <TradePlan plan={stock.tradePlan} currency={stock.currency} demo={demo} />
      <div className="detail-thesis"><span className="section-label">THE RESEARCH CASE</span><h3>{stock.summary}</h3><div className="analysis-label">{stock.analysisKind === 'AI' ? <Sparkles size={14} /> : <SlidersHorizontal size={14} />}{stock.analysisKind === 'AI' ? 'AI synthesis of supplied evidence' : 'Reproducible rules analysis'}<span>Scores are research signals, not profit probabilities.</span></div></div>
      <div className="evidence-grid"><section><h3><Check size={17} />Why it surfaced</h3>{stock.reasons.length ? <ul>{stock.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : <p className="muted">No supporting reasons were supplied.</p>}</section><section><h3><AlertTriangle size={17} />What could go wrong</h3>{stock.risks.length ? <ul>{stock.risks.map((risk, index) => <li key={index}>{risk}</li>)}</ul> : <p className="muted">No risk notes were supplied. This does not imply low risk.</p>}</section></div>
      <div className="detail-metric-columns"><section><div className="metric-heading"><h3>Fundamentals</h3><span>{date(stock.fundamentalsAsOf, true)}</span></div><p className="metric-context">Reported financial amounts: {financialCurrency || 'currency not supplied'}. Date shown is the oldest supplied reporting period; balance-sheet data may be newer.</p><div className="metric-list">{fundamentalMetrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></section><section><div className="metric-heading"><h3>Technical picture</h3><span>{date(stock.priceAsOf, true)}</span></div><p className="metric-context">Historical ranges describe past trading. Support is not a floor or a guaranteed entry.</p><div className="metric-list">{technicalMetrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></section></div>
      <div className="detail-bottom"><div><h3>Liquidity &amp; coverage</h3><p>Average daily value <strong>{money(stock.averageDailyValue, stock.currency, true)}</strong> · Market cap <strong>{money(stock.marketCap, stock.currency, true)}</strong></p><p>Options: {stock.optionsAvailable === true ? 'availability flagged by source; current contracts and quotes still need checking' : stock.optionsAvailable === false ? 'not available according to source' : 'availability has not been checked'}.</p></div><div><h3>Source trail</h3>{stock.sources.length ? stock.sources.map((source, index) => { let validUrl = false; try { validUrl = ['https:', 'http:'].includes(new URL(source.url).protocol); } catch { /* Show an unlinked source if its URL is invalid. */ } return <div className="source-item" key={index}>{validUrl ? <a href={source.url} target="_blank" rel="noreferrer">{source.label}<ExternalLink size={12} /></a> : <span>{source.label}</span>}<span>{date(source.asOf, true)}</span></div>; }) : <p>No source links supplied.</p>}</div></div>
    </div>
  </div>;
}

function Methodology({ scan, probabilityReport }: { scan: Scan | null; probabilityReport: ProbabilityReport | null }) {
  const sections = [
    { icon: Compass, title: 'A broad starting universe', text: 'Discover Canadian listings before applying eligibility rules. Exchange coverage, skipped symbols and failed requests stay visible. A scan is not “all Canada” unless the source and verification support that claim.' },
    { icon: Leaf, title: 'Fundamentals need context', text: 'Cash, debt, growth and cash generation help organize research. A resource developer needs a different interpretation from an operating business. Missing revenue is not, by itself, a solvency verdict.' },
    { icon: TrendingUp, title: 'Technical setups, not predictions', text: 'Entry zones, target scenarios and invalidation levels describe a conditional technical setup, not a long-term valuation. The default window is 20 trading sessions after entry; the entry zone is valid for five sessions. Returns exclude fees and slippage.' },
    { icon: ShieldCheck, title: 'Evidence before confidence', text: 'Unavailable values remain blank. Financial reporting currencies and dates are shown separately from Canadian listing prices. Partial data can influence comparisons, so scores should be read alongside their evidence.' },
    { icon: Sparkles, title: 'Rules, estimates and AI have separate jobs', text: 'Rules calculate metrics, ranks and conditional price scenarios. AI can summarize supplied evidence. Target-hit estimates appear only with sufficient held-out validation and show their specific event, sample support and model date. A score or past hit rate is not substituted for that estimate.' },
    { icon: Activity, title: 'Daily research, with a timestamp', text: 'This dashboard reads a published scan snapshot. Filters narrow those existing results; they do not rerun the market scan. End-of-day values are not live quotes. Refreshing reloads the file rather than executing a new scan.' },
  ];
  return <><div className="page-heading"><div><p className="eyebrow">KNOW WHAT IS BEHIND THE NUMBER</p><h1>Transparent by design.</h1><p className="page-description">A useful signal should come with its evidence and its limits.</p></div><Pill tone="green"><BookOpen size={13} />Methodology v2</Pill></div>
    <div className="method-intro"><div className="method-mark"><Leaf size={34} /></div><div><h2>A research shortlist. Your judgment.</h2><p>Maple Signal surfaces companies to investigate through distinct fundamental and technical lenses. Heuristic scores are not calibrated probabilities, price targets, or guarantees of a profitable trade.</p></div></div>
    <div className="method-grid">{sections.map(({ icon: Icon, title, text }, index) => <section className="card method-card" key={title}><div className="method-card-top"><span className="method-icon"><Icon size={21} /></span><span>0{index + 1}</span></div><h2>{title}</h2><p>{text}</p></section>)}</div>
    <ProbabilityEvidence report={probabilityReport} />
    <section className="card configuration"><div><div className="section-label">THIS PUBLISHED SCAN</div><h2>Configuration &amp; coverage</h2></div><dl><div><dt>Minimum share price</dt><dd>{scan ? money(scan.filters.minPrice) : 'No report loaded'}</dd></div><div><dt>Minimum daily trading value</dt><dd>{scan ? money(scan.filters.minAverageDailyValue, 'CAD', true) : '—'}</dd></div><div><dt>Universe source</dt><dd>{scan?.universe.source || 'Not supplied'}</dd></div><div><dt>Exchanges reported</dt><dd>{scan?.universe.exchanges.join(' · ') || 'Not supplied'}</dd></div><div><dt>Full coverage verified</dt><dd>{scan ? scan.universe.complete ? 'Reported complete' : 'No — incomplete coverage' : '—'}</dd></div><div><dt>AI summaries</dt><dd>{scan?.ai.enabled ? `${number(scan.ai.analyzed)} analyzed · ${scan.ai.model || 'model not supplied'}` : 'Disabled'}</dd></div></dl></section>
    <div className="notice soft"><CircleHelp size={19} /><div><strong>Free data still needs verification.</strong><p>Yahoo-based collection can have missing symbols, delayed updates and inconsistent financial fields. Confirm material facts against company filings and current quotes in your broker before acting.</p></div></div>
  </>;
}

export default function App() {
  const [view, setView] = useState<View>(initialView);
  const [mobileMenu, setMobileMenu] = useState(false);
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
  }, []);

  const navigate = (next: View) => { window.location.hash = next; setView(next); setMobileMenu(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
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
  const displayed = view === 'overview' ? filtered.slice(0, 8) : filtered;
  const hasFilters = query !== '' || horizon !== 'All horizons' || sector !== 'All sectors' || setup !== 'All setups';
  const resetFilters = () => { setQuery(''); setHorizon('All horizons'); setSector('All sectors'); setSetup('All setups'); };
  const technicalCount = scan?.opportunities.filter(stock => isNumber(stock.technicalScore)).length || 0;
  const fundamentalCount = scan?.opportunities.filter(stock => isNumber(stock.fundamentalScore)).length || 0;
  const coverage = scan && scan.universe.discovered > 0 ? Math.min(100, Math.round(scan.universe.scanned / scan.universe.discovered * 100)) : 0;

  return <><div className="app-shell" aria-hidden={selected ? true : undefined}>
    <aside className={`sidebar ${mobileMenu ? 'is-open' : ''}`}><a href="#overview" className="brand" onClick={() => { setMobileMenu(false); setView('overview'); }}><span className="brand-icon"><Leaf size={24} strokeWidth={1.6} /></span><div>Maple<span>Signal</span><small>CANADIAN MARKET RESEARCH</small></div></a><div className="sidebar-section-label">WORKSPACE</div><nav aria-label="Main navigation">{navigation.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => navigate(id)} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined}><Icon size={19} /><span>{label}</span>{view === id && <i />}</button>)}</nav><div className="sidebar-note"><span className="small-leaf"><Leaf size={19} /></span><h3>A little clarity.<br />A wider perspective.</h3><p>Research signals for the Canadian companies worth a closer look.</p><button onClick={() => navigate('methodology')}>How we find signals <ArrowUpRight size={14} /></button></div><div className="sidebar-bottom"><span className="status-dot" />Independent research workspace<small>Public dashboard · No brokerage linked</small></div></aside>
    {mobileMenu && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
    <div className="main-shell"><header className="topbar"><div className="topbar-location"><button className="icon-button mobile-toggle" aria-label="Toggle navigation" aria-expanded={mobileMenu} onClick={() => setMobileMenu(!mobileMenu)}><Menu size={21} /></button><span>Workspace</span><ChevronRight size={13} /><strong>{navigation.find(item => item.id === view)?.label}</strong></div><div className="topbar-right"><span className="canada-label"><span className="canada-dot" />Canadian equities</span><div className="topbar-divider" /><span className="user-avatar" aria-label="Personal workspace">MS</span></div></header>
      <main>
        {scan?.mode === 'demo' && <div className="demo-banner"><FlaskConical size={17} /><span><strong>DEMO WORKSPACE</strong><span className="demo-divider">/</span>Illustrative prices, companies and signals. This is not current market data.</span><Pill tone="amber">Demo data</Pill></div>}
        {error && <div className="notice error" role="alert"><AlertTriangle size={20} /><div><strong>{scan ? 'The refresh did not complete.' : 'The scan is not available yet.'}</strong><p>{error}{scan ? ' The last loaded report is still shown below.' : ' No prices or recommendations have been invented.'}</p></div><button className="button secondary" onClick={() => setReload(value => value + 1)} disabled={loading}><RefreshCw size={14} />Retry</button></div>}
        {scan && (scan.status !== 'complete' || !scan.universe.complete || scan.warnings.length > 0) && <div className="coverage-notice"><AlertTriangle size={16} /><div><strong>{scan.status === 'failed' ? 'This report indicates a failed scan.' : !scan.universe.complete ? 'Coverage is incomplete. Read signals with that in mind.' : 'Some data in this report needs review.'}</strong><p>{number(scan.universe.failed)} failed or skipped requests. {scan.universe.complete ? 'Review the data notes before interpreting signals.' : 'Full Canadian exchange coverage has not been verified.'}</p>{scan.warnings.length > 0 && <details className="scan-details"><summary>View scan details <span>({number(scan.warnings.length)})</span></summary><ul>{scan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}</div></div>}
        {view === 'options' ? <OptionsLab /> : view === 'methodology' ? <Methodology scan={scan} probabilityReport={probabilityReport} /> : <>
          <div className="page-heading"><div><p className="eyebrow">THE CANADIAN EQUITY BRIEF</p><h1>{view === 'overview' ? 'Good research starts here.' : 'Find your next research idea.'}</h1><p className="page-description">{view === 'overview' ? 'A clearer view of the companies and setups worth your attention.' : 'Explore the published shortlist through fundamental and technical lenses.'}</p></div><button className="button secondary refresh-button" onClick={() => setReload(value => value + 1)} disabled={loading}><RefreshCw size={15} className={loading ? 'spinning' : ''} />{loading ? 'Loading report' : 'Refresh report'}</button></div>
          <div className="report-meta"><span className="status-dot" /><strong>{scan?.marketAsOf ? `Market close · ${date(scan.marketAsOf, true)}` : 'End-of-day research'}</strong><span className="meta-dot">·</span><span>{scan ? `Report updated ${timestamp(scan.generatedAt)}` : 'Waiting for a published scan'}</span><span className="meta-end">Prices in their labelled trading currency</span></div>
          <div className="summary-grid"><section className="card summary-card"><div><span className="summary-label">Universe scanned</span><strong>{scan ? number(scan.universe.scanned) : '—'}<small>{scan ? `/ ${number(scan.universe.discovered)}` : ''}</small></strong><p>{scan ? scan.universe.exchanges.join(' · ') || 'Exchanges not supplied' : 'Canadian listings'}</p></div><div className="coverage-ring" style={{ background: `conic-gradient(#337c66 ${coverage}%, #edf1ec 0)` }}><span>{scan ? `${coverage}%` : '—'}</span></div></section><section className="card summary-card"><div><span className="summary-label">Eligible companies</span><strong>{scan ? number(scan.universe.eligible) : '—'}</strong><p>Passed published price &amp; liquidity rules</p></div><span className="summary-icon"><Check size={23} /></span></section><section className="card summary-card"><div><span className="summary-label">Research opportunities</span><strong>{scan ? number(scan.opportunities.length) : '—'}</strong><p><span>{scan ? number(fundamentalCount) : '—'} fundamental</span><span className="meta-dot">·</span><span>{scan ? number(technicalCount) : '—'} technical</span></p></div><span className="summary-icon amber"><Sparkles size={22} /></span></section></div>
          {view === 'overview' && <div className="lens-grid"><button className="lens-card fundamental-lens" onClick={() => { setSort('fundamental'); setHorizon('Long term'); navigate('opportunities'); }}><span className="lens-icon"><Leaf size={23} /></span><div><span className="section-label">THE LONGER VIEW</span><h2>Business before the ticker.</h2><p>Growth, financial strength and evidence behind the thesis.</p></div><ArrowUpRight size={22} /></button><button className="lens-card technical-lens" onClick={() => { setSort('technical'); setHorizon('Swing'); navigate('opportunities'); }}><span className="lens-icon"><TrendingUp size={23} /></span><div><span className="section-label">THE TECHNICAL PICTURE</span><h2>A setup worth watching.</h2><p>Trends, pullbacks and ranges, with the risks in view.</p></div><ArrowUpRight size={22} /></button></div>}
          <section className="card opportunities-card"><div className="opportunities-heading"><div><div className="title-with-count"><h2>{view === 'overview' ? 'On the research radar' : 'Opportunity explorer'}</h2><span className="count-badge">{number(filtered.length)}</span></div><p>{view === 'overview' ? 'Your daily shortlist. Open a company to see the whole picture.' : 'Dashboard filters narrow existing results. They do not trigger a new market scan.'}</p></div><div className="sort-control"><ArrowDown size={14} /><label className="sr-only" htmlFor="sort">Sort opportunities</label><select id="sort" value={sort} onChange={event => setSort(event.target.value)}><option value="technical">Technical score</option><option value="fundamental">Fundamental score</option><option value="liquidity">Daily trading value</option>{scan?.opportunities.some(stock => stock.tradePlan && stock.tradePlan.status !== 'Unavailable') && <option value="upside">Potential upside · scenario</option>}{scan?.mode === 'live' && scan.opportunities.some(stock => stock.tradePlan?.status !== 'Unavailable' && stock.tradePlan?.probability.status === 'Estimated' && isNumber(stock.tradePlan.probability.value)) && <option value="probability">Estimated target-hit probability</option>}<option value="symbol">Symbol A–Z</option></select><ChevronDown size={13} /></div></div>
            <div className="filter-bar"><label className="search-input"><Search size={17} /><input type="search" placeholder="Search a symbol or company…" aria-label="Search symbols and companies" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="search-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</label><div className="select-wrap"><select aria-label="Filter by horizon" value={horizon} onChange={event => setHorizon(event.target.value)}><option>All horizons</option><option>Long term</option><option>Swing</option></select><ChevronDown size={13} /></div><div className="select-wrap"><select aria-label="Filter by sector" value={sector} onChange={event => setSector(event.target.value)}><option>All sectors</option>{sectors.map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></div><div className="select-wrap"><select aria-label="Filter by setup" value={setup} onChange={event => setSetup(event.target.value)}><option>All setups</option>{['Trend continuation', 'Pullback', 'Range watch', 'Research watch'].map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></div></div>
            {loading && !scan ? <div className="loading-state" role="status"><RefreshCw size={25} className="spinning" /><h3>Reading the latest report</h3><p>Gathering the published scan, sources and research signals.</p></div> : !scan ? <div className="empty-state"><Activity size={32} /><h3>No report loaded</h3><p>Publish a scan to data/latest.json, then retry. The dashboard will show actual coverage and timestamps.</p><button className="button secondary" onClick={() => setReload(value => value + 1)} disabled={loading}>Retry loading</button></div> : !displayed.length ? <div className="empty-state"><Search size={30} /><h3>{hasFilters ? 'No matches in this report' : 'No opportunities in this scan'}</h3><p>{hasFilters ? 'Try a different sector, horizon or setup to broaden your view.' : 'No companies met the published research rules. A quiet shortlist is a valid result.'}</p>{hasFilters && <button className="button secondary" onClick={resetFilters}>Clear filters</button>}</div> : <div className="table-scroll"><table><thead><tr><th>Company</th><th>Daily close</th><th className="entry-scenario-heading">Entry / potential upside<span>scenario</span></th><th>Price history</th><th>Fundamental <span>/100</span></th><th>Technical <span>/100</span></th><th>Setup &amp; horizon</th><th><span className="sr-only">View details</span></th></tr></thead><tbody>{displayed.map(stock => <tr key={`${stock.exchange}:${stock.symbol}`}><td><button className="company-button" onClick={() => setSelected(stock)}><span className="company-monogram">{stock.symbol.slice(0, 2).replace('.', '')}</span><span><strong>{stock.symbol}<span className="exchange-label">{stock.exchange}</span></strong><small title={stock.name}>{stock.name}</small></span></button></td><td><span className="table-price">{money(stock.price, stock.currency)}</span><span className={`table-change ${isNumber(stock.changePercent) && stock.changePercent < 0 ? 'negative' : 'positive'}`}>{percent(stock.changePercent, true)}</span></td><td className="trade-plan-table-cell"><EntryScenarioCell plan={stock.tradePlan} currency={stock.currency} /><UpsideScenarioCell plan={stock.tradePlan} demo={scan.mode !== 'live'} /></td><td><PriceChart history={stock.history} currency={stock.currency} compact /></td><td><Score value={stock.fundamentalScore} /></td><td><Score value={stock.technicalScore} kind="technical" /></td><td><Pill tone={stock.setup === 'Trend continuation' ? 'green' : stock.setup === 'Pullback' ? 'amber' : 'neutral'}>{stock.setup}</Pill><div className="table-horizon">{stock.horizon}<span>·</span>{stock.dataQuality === 'Partial' ? 'Partial data' : stock.sector}</div></td><td><button className="row-open" aria-label={`Open ${stock.symbol} research details`} onClick={() => setSelected(stock)}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table></div>}
            <div className="table-footer"><span>{scan ? `${number(displayed.length)} of ${number(filtered.length)} matching opportunities` : 'No snapshot available'}{scan && <><span className="meta-dot">·</span>Minimum scan price {money(scan.filters.minPrice)}</>}</span>{view === 'overview' && filtered.length > 8 ? <button onClick={() => navigate('opportunities')}>Explore all opportunities <ArrowRight size={14} /></button> : <span>Daily close · Scores are heuristic</span>}</div>
          </section>
          <div className="research-note"><ShieldCheck size={17} /><p><strong>Context comes first.</strong> Missing data stays missing. Historical support is not a guaranteed floor, and a high score is not a promise of returns.</p><button onClick={() => navigate('methodology')}>Our methodology <ArrowUpRight size={14} /></button></div>
        </>}
        <footer className="page-footer"><span><Leaf size={13} />Maple Signal</span><p>For personal research. Confirm material facts and current quotes before making an investment decision.</p><span>Thoughtful research. Clearer signals.</span></footer>
      </main>
    </div>
  </div>{selected && <OpportunityDetail stock={selected} demo={scan?.mode === 'demo'} close={closeDetail} />}</>;
}
