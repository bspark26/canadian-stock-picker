# Dashboard data contract, version 1

The static dashboard fetches `data/latest.json` relative to the Vite base URL. Never include credentials, raw filings, or account information. Numbers that are unavailable are `null`, never fabricated zeros. Financial amounts and prices are CAD unless explicitly labelled. No forecast or score represents a probability of a profitable trade.

```ts
type Opportunity = {
  symbol: string; name: string; exchange: string; sector: string;
  price: number; changePercent: number | null; currency: string; financialCurrency?: string | null;
  marketCap: number | null; averageDailyValue: number | null;
  fundamentalScore: number | null; technicalScore: number | null;
  setup: 'Trend continuation' | 'Pullback' | 'Range watch' | 'Research watch';
  horizon: 'Long term' | 'Swing' | 'Both';
  summary: string; reasons: string[]; risks: string[];
  technicals: { rsi14: number | null; sma20: number | null; sma50: number | null; sma200: number | null; support: number | null; resistance: number | null; atr14: number | null; relativeVolume: number | null; return20d: number | null };
  fundamentals: { cash: number | null; debt: number | null; revenueGrowth: number | null; freeCashFlow: number | null; operatingCashFlow: number | null; cashRunwayMonths: number | null; profitMargin: number | null; priceToSales: number | null };
  history: { date: string; close: number; volume: number }[];
  sources: { label: string; url: string; asOf: string | null }[];
  priceAsOf: string; fundamentalsAsOf: string | null;
  dataQuality: 'Complete' | 'Partial';
  analysisKind: 'Rules' | 'AI';
  optionsAvailable: boolean | null;
};
type Scan = {
  schemaVersion: 1; mode: 'demo' | 'live'; generatedAt: string;
  marketAsOf: string | null;
  status: 'complete' | 'partial' | 'failed';
  universe: { discovered: number; scanned: number; eligible: number; failed: number; exchanges: string[]; source: string; complete: boolean };
  filters: { minPrice: number; minAverageDailyValue: number };
  ai: { enabled: boolean; model: string | null; analyzed: number };
  warnings: string[]; opportunities: Opportunity[];
};
```

`revenueGrowth`, `profitMargin`, and `return20d` use percent units (10 means 10%). History is daily end-of-day close, never represented as live prices. Support and resistance are descriptive historical ranges, not a promised floor, target, or forecast. Scores use 0–100 and only available metrics; insufficient evidence returns null. Distinguish pre-revenue resource developers from operating companies; lack of revenue alone is not a solvency verdict. AI only synthesizes supplied evidence and cannot invent management/project facts. Options availability is unknown unless checked; no contract recommendations without current quotes.

Demo fixtures are conspicuously labelled illustrative, not current market data. A failed scan must not overwrite the last successful data with fabricated output or a fresh timestamp. Show skipped/failed counts and incomplete exchange coverage honestly.

Financial statement amounts (`cash`, `debt`, operating/free cash flow) use `financialCurrency`, which can differ from the trading `currency`. If unknown, label reporting currency unknown. Never combine a CAD market cap with USD financial amounts in a manually derived ratio without conversion. Yahoo-supplied ratios retain their documented basis.
