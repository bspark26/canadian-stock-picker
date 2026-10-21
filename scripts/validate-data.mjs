import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const fail = (message) => { throw new Error(message); };
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const validDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

function validateProbability(probability, plan, item, mode) {
  const reject = (reason) => fail(`${item.symbol}: invalid trade plan (${reason}).`);
  if (!probability || !['Not calibrated', 'Insufficient evidence', 'Estimated'].includes(probability.status)
    || probability.event !== 'Target touched before invalidation within 20 trading sessions after a qualifying entry.'
    || typeof probability.reason !== 'string' || !probability.reason) reject('unvalidated probability');
  if (probability.status !== 'Estimated') {
    if (probability.value !== null) reject('unvalidated probability');
    return;
  }
  if (mode !== 'live' || plan.status === 'Unavailable') reject('unvalidated probability');
  if (!isNumber(probability.value) || !Number.isInteger(probability.value) || probability.value < 1 || probability.value > 99
    || typeof probability.modelVersion !== 'string' || !probability.modelVersion || !validDate(probability.asOf)) reject('unvalidated probability');
  const evidence = probability.validation;
  if (!evidence || !Number.isInteger(evidence.testSamples) || evidence.testSamples < 300
    || !Number.isInteger(evidence.testSymbols) || evidence.testSymbols < 20 || evidence.testSymbols > evidence.testSamples
    || !isNumber(evidence.brier) || evidence.brier < 0 || !isNumber(evidence.baselineBrier) || evidence.baselineBrier > 1
    || evidence.brier >= evidence.baselineBrier || !isNumber(evidence.calibrationError) || evidence.calibrationError < 0 || evidence.calibrationError > 0.10
    || !validDate(evidence.testStart) || !validDate(evidence.testEnd) || evidence.testStart > evidence.testEnd
    || evidence.testEnd > item.priceAsOf || evidence.testEnd > probability.asOf) reject('probability validation evidence');
  for (const [key, minimum] of [['setupSamples', 75], ['binSamples', 50]]) {
    if (!Number.isInteger(evidence[key]) || evidence[key] < minimum || evidence[key] > evidence.testSamples) reject('probability sample support');
  }
  if (!isNumber(evidence.observedHitRatePercent) || evidence.observedHitRatePercent < 0 || evidence.observedHitRatePercent > 100) reject('probability sample support');
  const day = Date.parse(item.priceAsOf);
  if (Math.abs(day - Date.parse(probability.asOf)) > 120 * 86400000 || day - Date.parse(evidence.testEnd) > 120 * 86400000) reject('stale probability evidence');
}

function validateTradePlan(plan, item, mode) {
  const reject = (reason) => fail(`${item.symbol}: invalid trade plan (${reason}).`);
  const numericKeys = ['entryLow', 'entryHigh', 'referenceEntry', 'target', 'invalidation', 'upsidePercent', 'downsidePercent', 'rewardRisk'];
  if (!plan || !['Ready', 'Wait', 'Unavailable'].includes(plan.status) || !validDate(plan.asOf)) reject('status or date');
  if (plan.asOf !== item.priceAsOf || plan.horizonSessions !== 20 || plan.entryValidForSessions !== 5) reject('event timing');
  if (typeof plan.basis !== 'string' || !plan.basis || typeof plan.explanation !== 'string' || !plan.explanation) reject('missing rationale');
  validateProbability(plan.probability, plan, item, mode);
  if (plan.status === 'Unavailable') {
    if (!numericKeys.every((key) => plan[key] === null)) reject('unavailable levels must be null');
  } else {
    if (!numericKeys.every((key) => isNumber(plan[key]))) reject('missing level or return');
    const { invalidation: stop, entryLow: low, referenceEntry: entry, entryHigh: high, target } = plan;
    if (!(0 < stop && stop < low && low >= 1 && low <= entry && entry <= high && high < target)) reject('price ordering');
    if (plan.rewardRisk < 1.5 || Math.abs(plan.rewardRisk - (target - high) / (high - stop)) > 0.0011
      || Math.abs(plan.upsidePercent - (target / entry - 1) * 100) > 0.011
      || Math.abs(plan.downsidePercent - (stop / entry - 1) * 100) > 0.011) reject('return calculation');
    if ((plan.status === 'Ready') !== (low <= item.price && item.price <= high)) reject('entry readiness');
  }
  if (plan.historical === undefined) return;
  const history = plan.historical;
  if (!history || !['samples', 'targetFirst', 'stopFirst', 'expired', 'unfilled', 'ambiguous'].every((key) => Number.isInteger(history[key]) && history[key] >= 0)
    || history.samples !== history.targetFirst + history.stopFirst + history.expired
    || history.ambiguous > history.samples || typeof history.method !== 'string' || !history.method) reject('historical counts');
  if (history.asOf !== null && !validDate(history.asOf)) reject('historical date');
  if (history.samples + history.unfilled > 0 && history.asOf === null) reject('missing historical date');
  const rates = [history.hitRatePercent, history.intervalLowPercent, history.intervalHighPercent];
  if (history.samples < 20) {
    if (!rates.every((value) => value === null)) reject('insufficient historical sample');
  } else if (!rates.every((value) => isNumber(value) && value >= 0 && value <= 100)
    || history.intervalLowPercent > history.hitRatePercent || history.hitRatePercent > history.intervalHighPercent
    || Math.abs(history.hitRatePercent - history.targetFirst / history.samples * 100) > 0.011) reject('historical frequency');
  if (mode === 'demo' && rates.some((value) => value !== null)) reject('synthetic historical success claim');
}

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
    if (item.tradePlan !== undefined) validateTradePlan(item.tradePlan, item, data.mode);
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
