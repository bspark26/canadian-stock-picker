import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const fail = (message) => { throw new Error(message); };
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const validDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

export function validateSnapshot(data, { expectLive = false } = {}) {
  if (!data || data.schemaVersion !== 1) fail('Unsupported snapshot schema.');
  if (!['demo', 'live'].includes(data.mode)) fail('Snapshot mode must be demo or live.');
  if (expectLive && data.mode !== 'live') fail('A live refresh cannot publish demo data.');
  if (!validDate(data.generatedAt)) fail('Invalid generation timestamp.');
  if (!['complete', 'partial'].includes(data.status)) fail('Only successful or partial scans may publish.');
  if (!Array.isArray(data.opportunities) || data.opportunities.length === 0) fail('No opportunities; keep the previous snapshot.');
  if (!strings(data.warnings)) fail('Scan warnings must be an array of text.');
  const universe = data.universe;
  if (!universe || !strings(universe.exchanges) || !universe.source || typeof universe.complete !== 'boolean') fail('Missing universe provenance.');
  for (const key of ['discovered', 'scanned', 'eligible', 'failed']) {
    if (!Number.isInteger(universe[key]) || universe[key] < 0) fail(`Invalid universe ${key}.`);
  }
  if (universe.scanned > universe.discovered || universe.eligible > universe.scanned) fail('Invalid scan coverage counts.');
  if (universe.failed > universe.discovered) fail('Failure count exceeds discovered universe.');
  if (universe.eligible < data.opportunities.length) fail('Opportunity count exceeds eligible universe.');
  if (!data.filters || !isNumber(data.filters.minPrice) || data.filters.minPrice < 1) fail('Minimum price must be at least C$1.');
  if (!isNumber(data.filters.minAverageDailyValue) || data.filters.minAverageDailyValue < 0) fail('Invalid liquidity filter.');
  if (!data.ai || typeof data.ai.enabled !== 'boolean' || !Number.isInteger(data.ai.analyzed)) fail('Missing AI status.');
  if (data.ai.analyzed < 0 || data.ai.analyzed > data.opportunities.length) fail('Invalid AI analysis count.');
  const seen = new Set();
  for (const item of data.opportunities) {
    if (!item || typeof item.symbol !== 'string' || !item.symbol || seen.has(item.symbol)) fail('Missing or duplicate symbol.');
    seen.add(item.symbol);
    for (const key of ['name', 'exchange', 'sector', 'currency', 'summary']) {
      if (typeof item[key] !== 'string' || !item[key]) fail(`${item.symbol}: missing ${key}.`);
    }
    if (!isNumber(item.price) || item.price < data.filters.minPrice) fail(`${item.symbol}: invalid or below-minimum price.`);
    if (item.financialCurrency != null && (typeof item.financialCurrency !== 'string' || !/^[A-Z]{3}$/.test(item.financialCurrency))) fail(`${item.symbol}: invalid reporting currency.`);
    for (const key of ['fundamentalScore', 'technicalScore']) {
      if (item[key] !== null && (!isNumber(item[key]) || item[key] < 0 || item[key] > 100)) fail(`${item.symbol}: invalid score.`);
    }
    for (const key of ['changePercent', 'marketCap', 'averageDailyValue']) {
      if (item[key] !== null && !isNumber(item[key])) fail(`${item.symbol}: invalid ${key}.`);
    }
    if (!strings(item.reasons) || !strings(item.risks)) fail(`${item.symbol}: missing evidence or risks.`);
    if (!['Complete', 'Partial'].includes(item.dataQuality) || !['Rules', 'AI'].includes(item.analysisKind)) fail(`${item.symbol}: invalid evidence labels.`);
    if (!['Long term', 'Swing', 'Both'].includes(item.horizon)) fail(`${item.symbol}: invalid horizon.`);
    if (!['Trend continuation', 'Pullback', 'Range watch', 'Research watch'].includes(item.setup)) fail(`${item.symbol}: invalid setup.`);
    if (!validDate(item.priceAsOf)) fail(`${item.symbol}: missing price timestamp.`);
    if (item.fundamentalsAsOf !== null && !validDate(item.fundamentalsAsOf)) fail(`${item.symbol}: invalid statement date.`);
    if (item.optionsAvailable !== null && typeof item.optionsAvailable !== 'boolean') fail(`${item.symbol}: invalid options availability.`);
    const numericGroups = {
      technicals: ['rsi14', 'sma20', 'sma50', 'sma200', 'support', 'resistance', 'atr14', 'relativeVolume', 'return20d'],
      fundamentals: ['cash', 'debt', 'revenueGrowth', 'freeCashFlow', 'operatingCashFlow', 'cashRunwayMonths', 'profitMargin', 'priceToSales'],
    };
    for (const [group, keys] of Object.entries(numericGroups)) {
      if (!item[group]) fail(`${item.symbol}: missing ${group}.`);
      for (const key of keys) {
        const value = item[group][key];
        if (value !== null && !isNumber(value)) fail(`${item.symbol}: ${group}.${key} must be numeric or null.`);
      }
    }
    if (!Array.isArray(item.history) || item.history.length < 2) fail(`${item.symbol}: insufficient chart history.`);
    let prior = '';
    for (const bar of item.history) {
      if (!validDate(bar.date) || bar.date <= prior || !isNumber(bar.close) || bar.close <= 0 || !isNumber(bar.volume) || bar.volume < 0) fail(`${item.symbol}: invalid chart history.`);
      prior = bar.date;
    }
    if (!Array.isArray(item.sources) || item.sources.length === 0) fail(`${item.symbol}: missing sources.`);
    for (const source of item.sources) {
      if (typeof source.label !== 'string' || !source.label || typeof source.url !== 'string') fail(`${item.symbol}: invalid source.`);
      let url;
      try { url = new URL(source.url); } catch { fail(`${item.symbol}: invalid source URL.`); }
      if (url.protocol !== 'https:') fail(`${item.symbol}: source must use HTTPS.`);
      if (source.asOf !== null && !validDate(source.asOf)) fail(`${item.symbol}: invalid source date.`);
    }
  }
  const serialized = JSON.stringify(data);
  if (/sk-(?:proj-)?[A-Za-z0-9_-]{24,}/.test(serialized) || /"(?:OPENAI_API_KEY|GITHUB_TOKEN|access_token|api_key)"\s*:/.test(serialized)) fail('Possible secret in public snapshot.');
  return { mode: data.mode, opportunities: data.opportunities.length, scanned: universe.scanned, status: data.status };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const filename = process.argv[2] || 'public/data/latest.json';
    const data = JSON.parse(await readFile(filename, 'utf8'));
    const result = validateSnapshot(data, { expectLive: process.argv.includes('--expect-live') });
    console.log(`Validated ${result.mode} snapshot: ${result.opportunities} opportunities, ${result.scanned} scanned (${result.status}).`);
  } catch (error) {
    console.error(`Snapshot validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
