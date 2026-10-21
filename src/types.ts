export type Opportunity = {
  symbol: string; name: string; exchange: string; sector: string;
  price: number; changePercent: number | null; currency: string;
  marketCap: number | null; averageDailyValue: number | null;
  financialCurrency?: string | null;
  fundamentalScore: number | null; technicalScore: number | null;
  setup: 'Trend continuation' | 'Pullback' | 'Range watch' | 'Research watch';
  horizon: 'Long term' | 'Swing' | 'Both';
  summary: string; reasons: string[]; risks: string[];
  technicals: { rsi14: number | null; sma20: number | null; sma50: number | null; sma200: number | null; support: number | null; resistance: number | null; atr14: number | null; relativeVolume: number | null; return20d: number | null };
  fundamentals: { cash: number | null; debt: number | null; revenueGrowth: number | null; freeCashFlow: number | null; operatingCashFlow: number | null; cashRunwayMonths: number | null; profitMargin: number | null; priceToSales: number | null };
  history: { date: string; close: number; volume: number }[];
  sources: { label: string; url: string; asOf: string | null }[];
  priceAsOf: string; fundamentalsAsOf: string | null;
  dataQuality: 'Complete' | 'Partial'; analysisKind: 'Rules' | 'AI';
  optionsAvailable: boolean | null;
  tradePlan?: TradePlan;
};

export type HistoricalEvidence = {
  samples: number; targetFirst: number; stopFirst: number; expired: number;
  unfilled: number; ambiguous: number;
  hitRatePercent: number | null;
  intervalLowPercent: number | null; intervalHighPercent: number | null;
  asOf: string | null; method: string;
};

export type ProbabilityValidation = {
  testSamples: number; testSymbols: number;
  brier: number; baselineBrier: number; calibrationError: number;
  testStart: string; testEnd: string;
  setupSamples?: number; binSamples?: number; observedHitRatePercent?: number;
};

export type TradeProbability = {
  value: number | null;
  status: 'Estimated' | 'Insufficient evidence' | 'Not calibrated';
  event: string; reason: string;
  modelVersion?: string | null; asOf?: string | null;
  validation?: ProbabilityValidation | null;
};

type ValidationSplit = { samples: number; symbols: number; start: string | null; end: string | null; outcomeEnd: string | null; targetFirst: number };
export type ProbabilityReport = {
  schemaVersion: 1; modelVersion: string;
  status: 'Validated' | 'Insufficient evidence'; reason: string; trainedAt: string;
  data: { inputEvents: number; acceptedEvents: number; symbols: number };
  splits?: { training: ValidationSplit; calibration: ValidationSplit; test: ValidationSplit };
  validation?: Pick<ProbabilityValidation, 'testSamples' | 'testSymbols' | 'brier' | 'baselineBrier' | 'calibrationError' | 'testStart' | 'testEnd'>;
  dataset?: { period: string; eventSymbols: number; events: number; limitations: string | string[]; selection?: string };
};

export type TradePlan = {
  status: 'Ready' | 'Wait' | 'Unavailable'; asOf: string;
  horizonSessions: number; entryValidForSessions: number;
  entryLow: number | null; entryHigh: number | null; referenceEntry: number | null;
  target: number | null; invalidation: number | null;
  upsidePercent: number | null; downsidePercent: number | null;
  rewardRisk: number | null;
  basis: string; explanation: string;
  probability: TradeProbability;
  historical?: HistoricalEvidence;
};

export type Scan = {
  schemaVersion: 1; mode: 'demo' | 'live'; generatedAt: string;
  marketAsOf: string | null; status: 'complete' | 'partial' | 'failed';
  universe: { discovered: number; scanned: number; eligible: number; failed: number; exchanges: string[]; source: string; complete: boolean };
  filters: { minPrice: number; minAverageDailyValue: number };
  ai: { enabled: boolean; model: string | null; analyzed: number };
  warnings: string[]; opportunities: Opportunity[];
};

export type View = 'overview' | 'opportunities' | 'options' | 'methodology';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nullableNumber = (value: unknown) => value === null || finite(value);
const nullableString = (value: unknown) => value === null || typeof value === 'string';
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const count = (value: unknown): value is number => finite(value) && Number.isInteger(value) && value >= 0;
const nullablePercent = (value: unknown) => value === null || finite(value) && value >= 0 && value <= 100;
const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};
const TRADE_EVENT = 'Target touched before invalidation within 20 trading sessions after a qualifying entry.';

function isProbabilityValidation(value: unknown): value is ProbabilityValidation {
  return record(value) && count(value.testSamples) && count(value.testSymbols)
    && finite(value.brier) && value.brier >= 0 && value.brier <= 1
    && finite(value.baselineBrier) && value.baselineBrier >= 0 && value.baselineBrier <= 1
    && finite(value.calibrationError) && value.calibrationError >= 0 && value.calibrationError <= 1
    && validDate(value.testStart) && validDate(value.testEnd) && value.testStart <= value.testEnd
    && (value.setupSamples === undefined || count(value.setupSamples))
    && (value.binSamples === undefined || count(value.binSamples))
    && (value.observedHitRatePercent === undefined || finite(value.observedHitRatePercent) && value.observedHitRatePercent >= 0 && value.observedHitRatePercent <= 100);
}

export function isTradeProbability(value: unknown): value is TradeProbability {
  if (!record(value) || !['Estimated', 'Insufficient evidence', 'Not calibrated'].includes(String(value.status))
    || value.event !== TRADE_EVENT || typeof value.reason !== 'string'
    || value.modelVersion !== undefined && value.modelVersion !== null && (typeof value.modelVersion !== 'string' || !value.modelVersion.trim())
    || value.asOf !== undefined && value.asOf !== null && !validDate(value.asOf)
    || value.validation !== undefined && value.validation !== null && !isProbabilityValidation(value.validation)) return false;
  if (value.status !== 'Estimated') return value.value === null;
  return count(value.value) && value.value >= 1 && value.value <= 99
    && typeof value.modelVersion === 'string' && !!value.modelVersion.trim()
    && validDate(value.asOf) && isProbabilityValidation(value.validation)
    && value.validation.testEnd <= value.asOf
    && value.validation.testSamples >= 300 && value.validation.testSymbols >= 20
    && value.validation.calibrationError <= .10 && value.validation.brier < value.validation.baselineBrier
    && count(value.validation.setupSamples) && value.validation.setupSamples >= 75 && value.validation.setupSamples <= value.validation.testSamples
    && count(value.validation.binSamples) && value.validation.binSamples >= 50 && value.validation.binSamples <= value.validation.testSamples
    && finite(value.validation.observedHitRatePercent) && value.validation.observedHitRatePercent >= 0 && value.validation.observedHitRatePercent <= 100;
}

export function isProbabilityReport(value: unknown): value is ProbabilityReport {
  if (!record(value) || value.schemaVersion !== 1 || typeof value.modelVersion !== 'string' || !value.modelVersion.trim()
    || !['Validated', 'Insufficient evidence'].includes(String(value.status)) || typeof value.reason !== 'string'
    || !validDate(value.trainedAt) || !record(value.data)
    || !['inputEvents', 'acceptedEvents', 'symbols'].every(key => count((value.data as Record<string, unknown>)[key]))
    || Number(value.data.acceptedEvents) > Number(value.data.inputEvents)) return false;
  if (value.splits !== undefined) {
    if (!record(value.splits)) return false;
    for (const name of ['training', 'calibration', 'test']) {
      const split = value.splits[name];
      if (!record(split) || !['samples', 'symbols', 'targetFirst'].every(key => count(split[key]))
        || Number(split.targetFirst) > Number(split.samples)
        || !['start', 'end', 'outcomeEnd'].every(key => split[key] === null || validDate(split[key]))) return false;
    }
  }
  if (value.validation !== undefined) {
    if (!record(value.validation)) return false;
    const { setupSamples: _setupSamples, binSamples: _binSamples, observedHitRatePercent: _observedRate, ...base } = value.validation;
    if (!isProbabilityValidation(base) || base.testEnd > value.trainedAt) return false;
  }
  if (value.dataset !== undefined && (!record(value.dataset) || typeof value.dataset.period !== 'string'
    || !count(value.dataset.eventSymbols) || !count(value.dataset.events) || !(typeof value.dataset.limitations === 'string' || strings(value.dataset.limitations))
    || value.dataset.selection !== undefined && typeof value.dataset.selection !== 'string')) return false;
  if (value.status === 'Validated') {
    if (!record(value.validation)) return false;
    const validation = value.validation;
    return Number(validation.testSamples) >= 300 && Number(validation.testSymbols) >= 20
      && Number(validation.calibrationError) <= .10 && Number(validation.brier) < Number(validation.baselineBrier);
  }
  return true;
}

function isHistoricalEvidence(value: unknown): value is HistoricalEvidence {
  if (!record(value)) return false;
  if (!['samples', 'targetFirst', 'stopFirst', 'expired', 'unfilled', 'ambiguous'].every(key => count(value[key]))
    || Number(value.samples) !== Number(value.targetFirst) + Number(value.stopFirst) + Number(value.expired)
    || Number(value.ambiguous) > Number(value.samples)
    || !nullablePercent(value.hitRatePercent) || !nullablePercent(value.intervalLowPercent) || !nullablePercent(value.intervalHighPercent)
    || value.asOf !== null && !validDate(value.asOf) || typeof value.method !== 'string') return false;
  const rates = [value.hitRatePercent, value.intervalLowPercent, value.intervalHighPercent];
  if (Number(value.samples) < 20) return rates.every(rate => rate === null);
  if (!rates.every(finite)) return false;
  const hitRate = Number(value.hitRatePercent);
  const expectedHitRate = Math.round(Number(value.targetFirst) / Number(value.samples) * 10000) / 100;
  return Number(value.intervalLowPercent) <= hitRate && hitRate <= Number(value.intervalHighPercent)
    && Math.abs(hitRate - expectedHitRate) <= 0.011;
}

export function isTradePlan(value: unknown): value is TradePlan {
  if (!record(value) || !record(value.probability)) return false;
  const numberFields = ['entryLow', 'entryHigh', 'referenceEntry', 'target', 'invalidation', 'upsidePercent', 'downsidePercent', 'rewardRisk'];
  if (!['Ready', 'Wait', 'Unavailable'].includes(String(value.status)) || !validDate(value.asOf)
    || value.horizonSessions !== 20 || value.entryValidForSessions !== 5
    || !numberFields.every(key => nullableNumber(value[key])) || typeof value.basis !== 'string' || typeof value.explanation !== 'string'
    || !isTradeProbability(value.probability)
    || value.historical !== undefined && !isHistoricalEvidence(value.historical)) return false;
  if (value.status === 'Unavailable') return value.probability.status !== 'Estimated' && numberFields.every(key => value[key] === null);
  if (value.probability.status === 'Estimated') {
    const signalDay = new Date(`${value.asOf}T00:00:00.000Z`).valueOf();
    const modelDay = new Date(`${value.probability.asOf}T00:00:00.000Z`).valueOf();
    const testEnd = value.probability.validation!.testEnd;
    const testDay = new Date(`${testEnd}T00:00:00.000Z`).valueOf();
    if (testEnd > value.asOf || Math.abs(signalDay - modelDay) / 86400000 > 120 || (signalDay - testDay) / 86400000 > 120) return false;
  }
  if (!numberFields.every(key => finite(value[key]))) return false;
  const priceFields = ['entryLow', 'entryHigh', 'referenceEntry', 'target', 'invalidation'];
  if (!priceFields.every(key => Math.abs(Number(value[key]) * 100 - Math.round(Number(value[key]) * 100)) <= 0.000001)) return false;
  if (!(Number(value.entryLow) >= 1 && 0 < Number(value.invalidation) && Number(value.invalidation) < Number(value.entryLow)
    && Number(value.entryLow) <= Number(value.referenceEntry) && Number(value.referenceEntry) <= Number(value.entryHigh)
    && Number(value.entryHigh) < Number(value.target) && Number(value.upsidePercent) > 0
    && Number(value.downsidePercent) < 0 && Number(value.rewardRisk) >= 1.5)) return false;
  const rounded = (key: string) => Math.round(Number(value[key]) * 100) / 100;
  const entry = rounded('referenceEntry');
  const target = rounded('target');
  const invalidation = rounded('invalidation');
  const upperEntry = rounded('entryHigh');
  const upside = (target / entry - 1) * 100;
  const downside = (invalidation / entry - 1) * 100;
  const rewardRisk = (target - upperEntry) / (upperEntry - invalidation);
  return rewardRisk >= 1.5 - 1e-9 && Math.abs(Number(value.upsidePercent) - upside) <= 0.011
    && Math.abs(Number(value.downsidePercent) - downside) <= 0.011
    && Math.abs(Number(value.rewardRisk) - rewardRisk) <= 0.0011;
}

function isOpportunity(value: unknown): value is Opportunity {
  if (!record(value) || !record(value.technicals) || !record(value.fundamentals)) return false;
  const textFields = ['symbol', 'name', 'exchange', 'sector', 'currency', 'summary', 'priceAsOf'];
  const numberFields = ['changePercent', 'marketCap', 'averageDailyValue', 'fundamentalScore', 'technicalScore'];
  const technicalFields = ['rsi14', 'sma20', 'sma50', 'sma200', 'support', 'resistance', 'atr14', 'relativeVolume', 'return20d'];
  const fundamentalFields = ['cash', 'debt', 'revenueGrowth', 'freeCashFlow', 'operatingCashFlow', 'cashRunwayMonths', 'profitMargin', 'priceToSales'];
  return textFields.every(key => typeof value[key] === 'string') && finite(value.price)
    && numberFields.every(key => nullableNumber(value[key]))
    && technicalFields.every(key => nullableNumber((value.technicals as Record<string, unknown>)[key]))
    && fundamentalFields.every(key => nullableNumber((value.fundamentals as Record<string, unknown>)[key]))
    && ['Trend continuation', 'Pullback', 'Range watch', 'Research watch'].includes(String(value.setup))
    && ['Long term', 'Swing', 'Both'].includes(String(value.horizon))
    && ['Complete', 'Partial'].includes(String(value.dataQuality)) && ['Rules', 'AI'].includes(String(value.analysisKind))
    && strings(value.reasons) && strings(value.risks) && nullableString(value.fundamentalsAsOf)
    && (value.financialCurrency === undefined || nullableString(value.financialCurrency))
    && (value.optionsAvailable === null || typeof value.optionsAvailable === 'boolean')
    && (value.tradePlan === undefined || isTradePlan(value.tradePlan))
    && (!record(value.tradePlan) || !record(value.tradePlan.probability) || value.tradePlan.probability.status !== 'Estimated'
      || finite(value.technicals.sma200) && value.technicals.sma200 > 0)
    && Array.isArray(value.history) && value.history.every(point => record(point) && typeof point.date === 'string' && finite(point.close) && finite(point.volume))
    && Array.isArray(value.sources) && value.sources.every(source => record(source) && typeof source.label === 'string' && typeof source.url === 'string' && nullableString(source.asOf));
}

export function isScan(value: unknown): value is Scan {
  if (!record(value) || !record(value.universe) || !record(value.filters) || !record(value.ai)) return false;
  return value.schemaVersion === 1 && (value.mode === 'demo' || value.mode === 'live')
    && ['complete', 'partial', 'failed'].includes(String(value.status))
    && typeof value.generatedAt === 'string' && nullableString(value.marketAsOf)
    && ['discovered', 'scanned', 'eligible', 'failed'].every(key => finite((value.universe as Record<string, unknown>)[key]))
    && strings(value.universe.exchanges) && typeof value.universe.source === 'string' && typeof value.universe.complete === 'boolean'
    && finite(value.filters.minPrice) && finite(value.filters.minAverageDailyValue)
    && typeof value.ai.enabled === 'boolean' && nullableString(value.ai.model) && finite(value.ai.analyzed)
    && strings(value.warnings) && Array.isArray(value.opportunities) && value.opportunities.every(isOpportunity);
}
