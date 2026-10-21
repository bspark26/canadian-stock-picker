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
