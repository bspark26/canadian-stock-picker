import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Bundle the real client and its canonical TypeScript guards, just as Vite does.
// Native Node cannot resolve their extensionless TypeScript imports on Node 22.
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/stockAnalysis.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22',
});
const { fetchStockAnalysis, normalizeStockSymbol, parseStockAnalysisResponse, stockAnalysisUrl } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);

const NOW = Date.parse('2026-10-21T18:00:00Z');
const API = 'https://example.com/analyze';
const EVENT = 'Target touched before invalidation within 20 trading sessions after a qualifying entry.';

function fixture(symbol = 'LSPD.TO', currency = 'CAD') {
  return {
    schemaVersion: 1, symbol, generatedAt: '2026-10-21T17:00:00Z',
    scope: { market: currency === 'CAD' ? 'Canadian' : 'Other / exchange not verified', probabilitySupported: currency === 'CAD' },
    opportunity: {
      symbol, currency, name: 'Test company', exchange: 'Test exchange', sector: 'Technology',
      price: 20, changePercent: null, marketCap: null, averageDailyValue: 100_000,
      financialCurrency: 'USD', fundamentalScore: null, technicalScore: 60,
      setup: 'Range watch', horizon: 'Both', summary: 'Test summary.', reasons: [], risks: [],
      technicals: { rsi14: null, sma20: null, sma50: 19, sma200: null, support: 19, resistance: 23, atr14: .5, relativeVolume: null, return20d: 5 },
      fundamentals: { cash: 1000, debt: null, revenueGrowth: null, freeCashFlow: null, operatingCashFlow: null, cashRunwayMonths: null, profitMargin: null, priceToSales: null },
      history: [{ date: '2026-10-19', close: 19, volume: 100 }, { date: '2026-10-20', close: 20, volume: 100 }],
      sources: [{ label: 'Test source', url: 'https://example.com/source', asOf: '2026-10-20' }],
      priceAsOf: '2026-10-20', fundamentalsAsOf: '2026-06-30',
      dataQuality: 'Partial', analysisKind: 'Rules', optionsAvailable: null,
    },
    outlook: {
      shortTerm: { horizon: '20 trading days', label: 'Watch the price', summary: 'A price-based plan.' },
      longTerm: { horizon: '1–3 years', label: 'More research needed', summary: 'Check company reports.', evidence: [], risks: [], priceTarget: null, probability: null },
    },
    warnings: ['Some financial data is missing.'],
  };
}

function estimatedFixture() {
  const report = fixture();
  const stock = report.opportunity;
  stock.history = Array.from({ length: 200 }, (_, index) => ({
    date: new Date(Date.parse('2026-10-20T00:00:00Z') - (199 - index) * 86_400_000).toISOString().slice(0, 10),
    close: 20, volume: 100,
  }));
  stock.technicals.sma200 = 19.8;
  stock.tradePlan = {
    status: 'Ready', asOf: stock.priceAsOf, horizonSessions: 20, entryValidForSessions: 5,
    entryLow: 19.9, entryHigh: 20.1, referenceEntry: 20, target: 23, invalidation: 18.5,
    upsidePercent: 15, downsidePercent: -7.5, rewardRisk: 1.813,
    basis: 'Test basis', explanation: 'Test explanation',
    probability: { status: 'Estimated', value: 60, event: EVENT, reason: 'Test result', modelVersion: 'test-model', asOf: '2026-10-01',
      validation: { testSamples: 500, testSymbols: 30, brier: .15, baselineBrier: .2, calibrationError: .04,
        testStart: '2026-08-01', testEnd: '2026-09-20', setupSamples: 100, binSamples: 60, observedHitRatePercent: 60 } },
  };
  return report;
}

const parse = report => parseStockAnalysisResponse(report, report.symbol, NOW);
const rejectsCode = (code, pattern) => error => error.code === code && (!pattern || pattern.test(error.message));

test('exact symbols keep their exchange ending or share class; no Canadian ending is guessed', () => {
  assert.equal(normalizeStockSymbol(' lspd.to '), 'LSPD.TO');
  assert.equal(normalizeStockSymbol('nexg.v'), 'NEXG.V');
  assert.equal(normalizeStockSymbol('brk-b'), 'BRK-B');
  assert.equal(normalizeStockSymbol('0700.hk'), '0700.HK');
  assert.equal(normalizeStockSymbol('aapl'), 'AAPL');
  for (const value of ['', 'Lightspeed Commerce', 'TSX:LSPD', 'LSPD.TO&symbol=AAPL', '../AAPL', 'A'.repeat(25), 'ß', 'MSFT\n']) {
    assert.throws(() => normalizeStockSymbol(value), rejectsCode('symbol'));
  }
});

test('URL construction sets exactly one symbol and accepts HTTP only on local development hosts', () => {
  const url = stockAnalysisUrl(`${API}?symbol=OLD&mode=one#old`, 'lspd.to');
  assert.deepEqual(url.searchParams.getAll('symbol'), ['LSPD.TO']);
  assert.equal(url.searchParams.get('mode'), 'one');
  assert.equal(url.hash, '');
  assert.equal(stockAnalysisUrl('http://localhost:8787/analyze', 'AAPL').hostname, 'localhost');
  for (const address of ['', '/analyze', 'http://example.com/analyze', 'https://user:secret@example.com/analyze', 'javascript:alert(1)']) {
    assert.throws(() => stockAnalysisUrl(address, 'AAPL'), rejectsCode('configuration'));
  }
});

test('valid Canadian and foreign stocks preserve the source trading and reporting currencies', () => {
  const canadian = parse(fixture());
  assert.equal(canadian.opportunity.currency, 'CAD');
  assert.equal(canadian.opportunity.financialCurrency, 'USD');
  const foreign = parse(fixture('BARC.L', 'GBp'));
  assert.equal(foreign.opportunity.currency, 'GBp');
  assert.equal(foreign.scope.probabilitySupported, false);
  const lowPrice = fixture('PENNY.V');
  lowPrice.opportunity.price = lowPrice.opportunity.history[1].close = .5;
  lowPrice.scope.probabilitySupported = false;
  assert.equal(parse(lowPrice).opportunity.price, .5);
});

test('the requested symbol must match both response and company, without fallback substitutions', () => {
  assert.throws(() => parseStockAnalysisResponse(fixture(), 'AAPL', NOW), rejectsCode('response'));
  const report = fixture();
  report.opportunity.symbol = 'AAPL';
  assert.throws(() => parse(report), rejectsCode('response'));
});

test('generated results expire after 24 hours, and future or malformed timestamps are rejected', () => {
  for (const generatedAt of ['2026-10-20T17:59:59Z', '2026-10-18T18:00:00Z']) {
    const report = fixture(); report.generatedAt = generatedAt;
    assert.throws(() => parse(report), rejectsCode('stale'));
  }
  for (const generatedAt of ['2026-10-21T18:06:00Z', '2026-02-31T18:00:00Z', '2026-10-21T17:00:00', 'not a date']) {
    const report = fixture(); report.generatedAt = generatedAt;
    assert.throws(() => parse(report), rejectsCode('response'));
  }
});

test('quote dates allow a long weekend but reject old, future and inconsistent history', () => {
  const weekend = fixture();
  weekend.opportunity.priceAsOf = weekend.opportunity.history[1].date = '2026-10-12';
  weekend.opportunity.history[0].date = '2026-10-09';
  assert.ok(parse(weekend));
  const old = structuredClone(weekend);
  old.opportunity.priceAsOf = old.opportunity.history[1].date = '2026-10-11';
  assert.throws(() => parse(old), rejectsCode('stale'));
  const future = fixture(); future.opportunity.priceAsOf = future.opportunity.history[1].date = '2026-10-22';
  assert.throws(() => parse(future), rejectsCode('response'));
  const mismatch = fixture(); mismatch.opportunity.history[1].close = 21;
  assert.throws(() => parse(mismatch), rejectsCode('response'));
});

test('missing measurements stay null; invalid metrics, long-term forecasts and unsafe links are rejected', () => {
  assert.equal(parse(fixture()).opportunity.fundamentalScore, null);
  const mutations = [
    value => { value.opportunity.fundamentalScore = 101; },
    value => { value.opportunity.fundamentals.cash = '1000'; },
    value => { value.outlook.longTerm.probability = 80; },
    value => { value.outlook.longTerm.priceTarget = 30; },
    value => { value.opportunity.sources[0].url = 'javascript:alert(1)'; },
    value => { value.opportunity.fundamentalsAsOf = '2026-10-22'; },
  ];
  for (const mutate of mutations) {
    const report = fixture(); mutate(report);
    assert.throws(() => parse(report), rejectsCode('response'));
  }
});

test('a model percentage requires the supported market, enough history and a consistent buy plan', () => {
  assert.equal(parse(estimatedFixture()).opportunity.tradePlan.probability.value, 60);
  const unsupported = estimatedFixture(); unsupported.scope.probabilitySupported = false;
  assert.throws(() => parse(unsupported), rejectsCode('response'));
  const short = estimatedFixture(); short.opportunity.history = short.opportunity.history.slice(-199);
  assert.throws(() => parse(short), rejectsCode('response'));
  const mismatch = estimatedFixture(); mismatch.opportunity.tradePlan.asOf = '2026-10-19';
  assert.throws(() => parse(mismatch), rejectsCode('response'));
  const ready = estimatedFixture(); ready.opportunity.tradePlan.status = 'Wait';
  assert.throws(() => parse(ready), rejectsCode('response'));
});

test('the client makes one uncached public request and validates before returning', async () => {
  let calls = 0;
  const result = await fetchStockAnalysis(API, 'lspd.to', { now: NOW, fetcher: async (url, init) => {
    calls += 1;
    assert.equal(url.searchParams.get('symbol'), 'LSPD.TO');
    assert.equal(init.cache, 'no-store');
    assert.deepEqual(init.headers, { Accept: 'application/json' });
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json(fixture());
  } });
  assert.equal(result.symbol, 'LSPD.TO');
  assert.equal(calls, 1);
});

test('approved service errors are useful without exposing arbitrary error bodies or retrying', async () => {
  for (const code of ['daily_limit', '__proto__', 'unknown']) {
    let calls = 0;
    await assert.rejects(fetchStockAnalysis(API, 'LSPD.TO', { fetcher: async () => {
      calls += 1;
      return Response.json({ error: { code, message: 'SECRET-server-message-and-key' } }, { status: 429 });
    } }), error => error.code === 'http' && /limit/.test(error.message) && !/SECRET|server-message|object Object/.test(error.message));
    assert.equal(calls, 1);
  }
  await assert.rejects(fetchStockAnalysis(API, 'LSPD.TO', { fetcher: async () => new Response('<html>private response</html>', { status: 503 }) }), rejectsCode('http', /temporarily unavailable/));
  await assert.rejects(fetchStockAnalysis(API, 'LSPD.TO', { fetcher: async () => Response.json({ error: { code: 'stale_history', message: 'SECRET-provider-detail' } }, { status: 422 }) }), error => error.code === 'http' && /too old/.test(error.message) && !error.message.includes('SECRET'));
});

test('malformed JSON, connection failures and mismatched responses return fixed errors', async () => {
  await assert.rejects(fetchStockAnalysis(API, 'LSPD.TO', { fetcher: async () => new Response('not json') }), rejectsCode('response', /unreadable/));
  await assert.rejects(fetchStockAnalysis(API, 'LSPD.TO', { fetcher: async () => { throw new Error('SECRET-network-detail'); } }), error => error.code === 'network' && !error.message.includes('SECRET'));
  await assert.rejects(fetchStockAnalysis(API, 'LSPD.TO', { now: NOW, fetcher: async () => Response.json(fixture('AAPL', 'USD')) }), rejectsCode('response'));
});

test('timeout and user cancellation stop a pending request without automatic retries', async () => {
  let calls = 0;
  const fetcher = async (_url, { signal }) => {
    calls += 1;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  };
  await assert.rejects(fetchStockAnalysis(API, 'LSPD.TO', { timeoutMs: 5, fetcher }), rejectsCode('timeout'));
  const controller = new AbortController();
  const pending = fetchStockAnalysis(API, 'LSPD.TO', { signal: controller.signal, fetcher });
  controller.abort();
  await assert.rejects(pending, rejectsCode('cancelled'));
  assert.equal(calls, 2);
  await assert.rejects(fetchStockAnalysis(API, 'LSPD.TO', { signal: controller.signal, fetcher }), rejectsCode('cancelled'));
  assert.equal(calls, 2);
});
