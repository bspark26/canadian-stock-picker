import { isOpportunity } from './types';
import type { Opportunity } from './types';

type Outlook = { horizon: string; label: string; summary: string };

export type StockAnalysisResponse = {
  schemaVersion: 1;
  symbol: string;
  generatedAt: string;
  scope: { market: string; probabilitySupported: boolean };
  opportunity: Opportunity;
  outlook: {
    shortTerm: Outlook;
    longTerm: Outlook & { evidence: string[]; risks: string[]; priceTarget: null; probability: null };
  };
  warnings: string[];
};

export type StockAnalysisErrorCode = 'symbol' | 'configuration' | 'response' | 'stale' | 'http' | 'network' | 'timeout' | 'cancelled';

export class StockAnalysisError extends Error {
  readonly code: StockAnalysisErrorCode;
  constructor(code: StockAnalysisErrorCode, message: string) {
    super(message);
    this.name = 'StockAnalysisError';
    this.code = code;
  }
}

const DAY = 86_400_000;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const dayValue = (value: unknown): number => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const day = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === value ? day : NaN;
};
const outlook = (value: unknown): value is Outlook & Record<string, unknown> => record(value) && text(value.horizon) && text(value.label) && text(value.summary);

export function normalizeStockSymbol(value: string): string {
  const trimmed = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(value) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,23}$/.test(trimmed)) {
    throw new StockAnalysisError('symbol', 'Enter a stock symbol, such as LSPD.TO, NEXG.V or AAPL. Use up to 24 letters, numbers, dots, dashes or underscores.');
  }
  return trimmed.toUpperCase();
}

export function stockAnalysisUrl(apiUrl: string, symbol: string): URL {
  if (!apiUrl.trim()) throw new StockAnalysisError('configuration', 'Stock lookup is not connected yet.');
  let url: URL;
  try { url = new URL(apiUrl); }
  catch { throw new StockAnalysisError('configuration', 'The stock lookup address needs to be checked.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new StockAnalysisError('configuration', 'The stock lookup address needs to be checked.');
  }
  url.hash = '';
  url.searchParams.set('symbol', normalizeStockSymbol(symbol));
  return url;
}

function invalid(): never {
  throw new StockAnalysisError('response', 'The lookup returned incomplete or inconsistent data. Try again later.');
}

/** A fresh API result must agree with its requested symbol and saved price history. */
export function parseStockAnalysisResponse(value: unknown, requestedSymbol: string, now = Date.now()): StockAnalysisResponse {
  const symbol = normalizeStockSymbol(requestedSymbol);
  if (!record(value) || value.schemaVersion !== 1 || value.symbol !== symbol
    || !text(value.generatedAt) || !record(value.scope) || !text(value.scope.market)
    || typeof value.scope.probabilitySupported !== 'boolean' || !isOpportunity(value.opportunity)
    || !record(value.outlook) || !outlook(value.outlook.shortTerm) || !outlook(value.outlook.longTerm)
    || !strings(value.outlook.longTerm.evidence) || !strings(value.outlook.longTerm.risks)
    || value.outlook.longTerm.priceTarget !== null || value.outlook.longTerm.probability !== null
    || !strings(value.warnings)) invalid();

  const generated = Date.parse(value.generatedAt);
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.generatedAt)
    || !Number.isFinite(dayValue(value.generatedAt.slice(0, 10))) || !Number.isFinite(generated)
    || !Number.isFinite(now) || generated > now + 5 * 60_000) invalid();
  if (now - generated > DAY) throw new StockAnalysisError('stale', 'This lookup result is more than a day old. Please look up the stock again.');

  const stock = value.opportunity;
  const today = dayValue(new Date(now).toISOString().slice(0, 10));
  const priceDay = dayValue(stock.priceAsOf);
  if (stock.symbol !== symbol || !text(stock.name) || !text(stock.currency) || stock.currency.length > 20
    || stock.price <= 0 || !Number.isFinite(priceDay) || priceDay > today
    || ['fundamentalScore', 'technicalScore'].some(key => {
      const score = stock[key as 'fundamentalScore' | 'technicalScore'];
      return score !== null && (score < 0 || score > 100);
    })
    || [stock.marketCap, stock.averageDailyValue].some(number => number !== null && number < 0)) invalid();
  // Covers a long weekend without disagreeing with the API's five-weekday limit.
  if (today - priceDay > 9 * DAY) throw new StockAnalysisError('stale', 'The available closing price is too old for a new analysis. Try again later.');
  if (stock.fundamentalsAsOf !== null && (!Number.isFinite(dayValue(stock.fundamentalsAsOf)) || dayValue(stock.fundamentalsAsOf) > today)) invalid();
  if (stock.history.some(bar => dayValue(bar.date) > priceDay)) invalid();
  const last = stock.history.at(-1)!;
  if (last.date !== stock.priceAsOf || Math.abs(last.close - stock.price) > Math.max(0.000001, stock.price * 0.00000001)) invalid();
  for (const source of stock.sources) {
    try { if (new URL(source.url).protocol !== 'https:') invalid(); }
    catch { invalid(); }
    if (source.asOf !== null && (!Number.isFinite(dayValue(source.asOf)) || dayValue(source.asOf) > today)) invalid();
  }

  const plan = stock.tradePlan;
  if (plan) {
    if (plan.asOf !== stock.priceAsOf) invalid();
    if (plan.probability.asOf && dayValue(plan.probability.asOf) > today
      || plan.historical?.asOf && dayValue(plan.historical.asOf) > priceDay) invalid();
    if (plan.status !== 'Unavailable') {
      const inRange = stock.price >= plan.entryLow! && stock.price <= plan.entryHigh!;
      if ((plan.status === 'Ready') !== inRange || stock.price <= plan.invalidation!) invalid();
    }
    if (plan.probability.status === 'Estimated'
      && (!value.scope.probabilitySupported || stock.history.length < 200)) invalid();
  }
  if (value.scope.probabilitySupported && (stock.currency !== 'CAD' || stock.price < 1 || !/\.(TO|V|CN|NE)$/.test(symbol))) invalid();
  return value as StockAnalysisResponse;
}

const serviceMessages: Record<string, string> = {
  not_configured: 'Stock lookup is not connected yet.',
  in_progress: 'This stock is already being checked. Try again in a minute.',
  daily_limit: 'Today’s new-stock lookup limit has been reached. Try again tomorrow.',
  invalid_symbol: 'Check the stock symbol, including its exchange ending such as .TO or .V.',
  symbol_not_found: 'No usable stock data was found for that symbol. Check its spelling and exchange ending.',
  not_found: 'No usable stock data was found for that symbol. Check its spelling and exchange ending.',
  stale_data: 'The available closing price is too old for a new analysis. Try again later.',
  stale_history: 'The available closing price is too old for a new analysis. Try again later.',
  invalid_history: 'The available daily prices could not be verified. Analysis is withheld.',
  unknown_currency: 'The trading currency could not be verified. Analysis is withheld.',
  data_unavailable: 'Yahoo could not supply daily prices. Check the exact symbol and try again later.',
  unsupported_instrument: 'This lookup supports company shares. The supplied symbol is a different kind of investment.',
};

async function responseError(response: Response): Promise<StockAnalysisError> {
  let code = '';
  try {
    const body: unknown = await response.json();
    if (record(body) && record(body.error) && typeof body.error.code === 'string') code = body.error.code;
  } catch { /* Only a known error code is used; never display a server response. */ }
  const generic: Record<number, string> = {
    400: 'Check the stock symbol, including its exchange ending such as .TO or .V.',
    403: 'Stock lookup is not available from this website yet.',
    404: 'No usable stock data was found for that symbol. Check its spelling and exchange ending.',
    409: 'This stock is already being checked. Try again in a minute.',
    429: 'Stock lookups are temporarily limited. Try again later.',
    502: 'The data source could not return a usable result. Try again later.',
    503: 'Stock lookup is temporarily unavailable. Try again later.',
    504: 'The lookup took too long. Try again later.',
  };
  const approved = Object.hasOwn(serviceMessages, code) ? serviceMessages[code] : undefined;
  return new StockAnalysisError('http', approved || generic[response.status] || 'The stock lookup could not be completed. Try again later.');
}

export async function fetchStockAnalysis(apiUrl: string, symbol: string, options: {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  now?: number;
} = {}): Promise<StockAnalysisResponse> {
  const normalized = normalizeStockSymbol(symbol);
  const url = stockAnalysisUrl(apiUrl, normalized);
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (options.signal?.aborted) throw new StockAnalysisError('cancelled', 'Lookup cancelled.');
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 150_000);
  try {
    const response = await (options.fetcher || fetch)(url, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw await responseError(response);
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new StockAnalysisError('response', 'The lookup returned unreadable data. Try again later.'); }
    if (controller.signal.aborted) throw new StockAnalysisError('cancelled', 'Lookup cancelled.');
    return parseStockAnalysisResponse(body, normalized, options.now);
  } catch (error) {
    if (controller.signal.aborted) throw new StockAnalysisError(timedOut ? 'timeout' : 'cancelled', timedOut ? 'The lookup took too long. Try again later.' : 'Lookup cancelled.');
    if (error instanceof StockAnalysisError) throw error;
    throw new StockAnalysisError('network', 'Could not reach stock lookup. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}
