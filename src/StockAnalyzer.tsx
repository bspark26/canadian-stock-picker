import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpRight, Search, X } from 'lucide-react';
import type { Opportunity } from './types';
import { date, isNumber, money, number, percent, timestamp } from './format';
import { pricePatternLabel } from './labels';
import { plainEnglish } from './plainEnglish';
import { EntryScenarioCell, UpsideScenarioCell } from './TradePlan';
import { fetchStockAnalysis, normalizeStockSymbol, StockAnalysisError } from './stockAnalysis';
import type { StockAnalysisResponse } from './stockAnalysis';
import './stockAnalyzer.css';

export default function StockAnalyzer({ apiUrl, onOpen }: { apiUrl: string; onOpen: (stock: Opportunity) => void }) {
  const [symbol, setSymbol] = useState('');
  const [result, setResult] = useState<StockAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingSymbol, setPendingSymbol] = useState('');
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const request = useRef(0);
  const available = !!apiUrl.trim();

  useEffect(() => () => { request.current += 1; active.current?.abort(); }, []);
  useEffect(() => {
    request.current += 1;
    active.current?.abort();
    setLoading(false);
    setResult(null);
    setError('');
  }, [apiUrl]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available) return;
    const id = ++request.current;
    active.current?.abort();
    active.current = null;
    setLoading(false);
    setResult(null);
    setError('');
    let normalized: string;
    try { normalized = normalizeStockSymbol(symbol); }
    catch (cause) { setError(cause instanceof StockAnalysisError ? cause.message : 'Check the stock symbol.'); return; }
    const controller = new AbortController();
    active.current = controller;
    setSymbol(normalized);
    setPendingSymbol(normalized);
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const response = await fetchStockAnalysis(apiUrl, normalized, { signal: controller.signal });
      if (request.current === id) setResult(response);
    } catch (cause) {
      if (request.current === id && !(cause instanceof StockAnalysisError && cause.code === 'cancelled')) {
        setError(cause instanceof StockAnalysisError ? cause.message : 'The stock lookup could not be completed. Try again later.');
      }
    } finally {
      if (request.current === id) { setLoading(false); active.current = null; }
    }
  }

  function cancel() {
    request.current += 1;
    active.current?.abort();
    active.current = null;
    setLoading(false);
  }

  const stock = result?.opportunity;
  const plan = stock?.tradePlan;
  const hasPlan = plan && plan.status !== 'Unavailable';
  const financialMoney = (value: number | null) => stock?.financialCurrency ? money(value, stock.financialCurrency, true)
    : isNumber(value) ? `${number(value)} · currency unknown` : '—';

  return <section className="stock-analyzer" aria-labelledby="stock-lookup-title">
    <div className="page-heading compact-heading"><h1 id="stock-lookup-title">Look up a stock</h1></div>
    <form className="card stock-analyzer-form" onSubmit={submit}>
      <label htmlFor="stock-lookup-symbol">Stock symbol</label>
      <div className="stock-analyzer-input-row"><input id="stock-lookup-symbol" value={symbol} onChange={event => setSymbol(event.target.value)} placeholder="LSPD.TO" maxLength={24} autoCapitalize="characters" autoComplete="off" spellCheck={false} disabled={!available} aria-describedby="stock-lookup-help" />
        <button className="button" type="submit" disabled={!available || !symbol.trim()}><Search size={18} />{loading ? 'Look up again' : 'Look up'}</button>
        {loading && <button className="button secondary" type="button" onClick={cancel}><X size={17} />Cancel</button>}
      </div>
      <p id="stock-lookup-help">Use the exact Yahoo symbol: LSPD.TO for Toronto, NEXG.V for Venture, or AAPL for a US stock.</p>
      {!available && <p className="stock-analyzer-status" role="status">Stock lookup is not connected yet. Saved stock results are still available under Stocks.</p>}
    </form>
    {loading && <p className="stock-analyzer-status" role="status">Checking {pendingSymbol}… This can take a couple of minutes.</p>}
    {error && <p className="stock-analyzer-error" role="alert">{error}</p>}
    {result && stock && <article className="card stock-analyzer-result" aria-label={`${stock.symbol} analysis`}>
      <div className="stock-analyzer-result-heading"><div><h2>{stock.symbol}</h2><p>{stock.name}</p><p className="stock-analyzer-meta">{stock.exchange} · {stock.currency} · {result.scope.market}</p></div><div className="stock-analyzer-price"><strong>{money(stock.price, stock.currency)}</strong><span className={isNumber(stock.changePercent) && stock.changePercent < 0 ? 'negative' : isNumber(stock.changePercent) ? 'positive' : ''}>{percent(stock.changePercent, true)} daily</span></div></div>
      <div className="stock-analyzer-dates"><span>Closing price: {date(stock.priceAsOf, true)}</span><span>Checked: {timestamp(result.generatedAt)}</span><span>{stock.dataQuality === 'Partial' ? 'Some data missing' : 'Key data available'}</span></div>
      <p className="stock-analyzer-summary">{plainEnglish(stock.summary)}</p>
      <div className="stock-analyzer-columns">
        <section><h3>Company finances</h3><dl className="stock-analyzer-metrics"><div><dt>Financial score</dt><dd>{number(stock.fundamentalScore)}<small> /100</small></dd></div><div><dt>Cash</dt><dd>{financialMoney(stock.fundamentals.cash)}</dd></div><div><dt>Debt</dt><dd>{financialMoney(stock.fundamentals.debt)}</dd></div><div><dt>Cash after capital spending (annual)</dt><dd>{financialMoney(stock.fundamentals.freeCashFlow)}</dd></div><div><dt>Sales growth</dt><dd>{percent(stock.fundamentals.revenueGrowth, true)}</dd></div></dl><p className="stock-analyzer-meta">Company reports: {date(stock.fundamentalsAsOf, true)} · {stock.financialCurrency || 'currency unknown'}</p></section>
        <section><h3>Price movement</h3><dl className="stock-analyzer-metrics"><div><dt>Price score</dt><dd>{number(stock.technicalScore)}<small> /100</small></dd></div><div><dt>Price pattern</dt><dd>{pricePatternLabel(stock.setup)}</dd></div><div><dt>Price change over 20 trading days</dt><dd>{percent(stock.technicals.return20d, true)}</dd></div><div><dt>50-day average price</dt><dd>{money(stock.technicals.sma50, stock.currency)}</dd></div><div><dt>Average traded per day</dt><dd>{money(stock.averageDailyValue, stock.currency, true)}</dd></div></dl></section>
      </div>
      <div className="stock-analyzer-columns stock-analyzer-outlooks">
        <section><h3>Short term</h3><p className="stock-analyzer-outlook-label">{plainEnglish(result.outlook.shortTerm.label)}<span>{plainEnglish(result.outlook.shortTerm.horizon)}</span></p><p>{plainEnglish(result.outlook.shortTerm.summary)}</p>
          <div className="stock-analyzer-entry"><span>Suggested buy range</span><EntryScenarioCell plan={plan} currency={stock.currency} /></div>
          {hasPlan && <><dl className="stock-analyzer-metrics"><div><dt>Buy price used</dt><dd>{money(plan.referenceEntry, stock.currency)}</dd></div><div><dt>Target sell price</dt><dd>{money(plan.target, stock.currency)}</dd></div><div><dt>Sell if it falls to</dt><dd>{money(plan.invalidation, stock.currency)}</dd></div></dl><div className="stock-analyzer-gain"><span>Possible gain</span><UpsideScenarioCell plan={plan} demo={false} /></div><p className="stock-analyzer-meta">Gain uses the buy price shown, before fees. Any chance shown means reaching the target before the lower exit price within {number(plan.horizonSessions)} trading days after buying at that price.</p></>}
          {!result.scope.probabilitySupported && <p className="stock-analyzer-meta">The chance model covers supported Canadian stocks only.</p>}
        </section>
        <section><h3>Long term</h3><p className="stock-analyzer-outlook-label">{plainEnglish(result.outlook.longTerm.label)}<span>{plainEnglish(result.outlook.longTerm.horizon)}</span></p><p>{plainEnglish(result.outlook.longTerm.summary)}</p>
          {result.outlook.longTerm.evidence.length > 0 && <><h4>Reasons</h4><ul>{result.outlook.longTerm.evidence.map((item, index) => <li key={index}>{plainEnglish(item)}</li>)}</ul></>}
          {result.outlook.longTerm.risks.length > 0 && <><h4>Risks</h4><ul>{result.outlook.longTerm.risks.map((item, index) => <li key={index}>{plainEnglish(item)}</li>)}</ul></>}
          <p className="stock-analyzer-meta">No long-term price or chance estimate is available.</p>
        </section>
      </div>
      {result.warnings.length > 0 && <details className="stock-analyzer-notes"><summary>Data notes ({number(result.warnings.length)})</summary><ul>{result.warnings.map((warning, index) => <li key={index}>{plainEnglish(warning)}</li>)}</ul></details>}
      <button className="button secondary stock-analyzer-open" onClick={() => onOpen(stock)}>Open chart and full details<ArrowUpRight size={18} /></button>
    </article>}
  </section>;
}
