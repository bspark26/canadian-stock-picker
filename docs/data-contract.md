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
  tradePlan?: TradePlan;
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

## Conditional entry and return scenarios

`tradePlan` is optional for older snapshots. New snapshots attach the following object. All prices use the row's trading currency; percent values use display units. This technical timing plan is separate from the company's long-term investment thesis.

```ts
type HistoricalEvidence = {
  samples: number; targetFirst: number; stopFirst: number; expired: number;
  unfilled: number; ambiguous: number;
  hitRatePercent: number | null;
  intervalLowPercent: number | null; intervalHighPercent: number | null;
  asOf: string | null; method: string;
};
type TradePlan = {
  status: 'Ready' | 'Wait' | 'Unavailable'; asOf: string;
  horizonSessions: number; entryValidForSessions: number;
  entryLow: number | null; entryHigh: number | null; referenceEntry: number | null;
  target: number | null; invalidation: number | null;
  upsidePercent: number | null; downsidePercent: number | null;
  rewardRisk: number | null;
  basis: string; explanation: string;
  probability: {
    value: number | null; status: 'Estimated' | 'Insufficient evidence' | 'Not calibrated';
    event: string; reason: string; modelVersion?: string; asOf?: string;
    validation?: {
      testSamples: number; testSymbols: number; brier: number; baselineBrier: number;
      calibrationError: number; testStart: string; testEnd: string;
      setupSamples: number; binSamples: number; observedHitRatePercent: number;
    };
  };
  historical?: HistoricalEvidence;
};
```

Default plan window: 20 trading sessions after a qualifying entry, with the proposed entry valid for five sessions following `asOf`. Opening gaps at or below invalidation cancel a proposed entry. Target and invalidation are conditional scenarios, not guaranteed fills or exit prices. Returns use the stated reference entry before fees/slippage; `downsidePercent` is negative. `rewardRisk` is calculated at the upper edge of the entry range (the least favourable entry), rather than advertising a favourable midpoint ratio.

Prices are rounded before calculations. Ready or Wait plans satisfy `0 < invalidation < entryLow <= referenceEntry <= entryHigh < target`. A missing or broken setup yields Unavailable with null price/return fields. Probability is an integer percentage from 1 to 99 only when `status` is Estimated, independent model validation and individual setup/band support gates pass, and the snapshot is live. Otherwise `value` is null. The event is target touched before invalidation within 20 sessions after a qualifying entry; the estimate is conditional on the entry filling. A screening score or retrospective hit rate must never be substituted for that probability.

Estimated results require at least 300 supported untouched-test observations across 20 symbols, 75 observations for the setup, 50 in the probability band, Brier error below the fixed calibration-prevalence baseline, and global calibration error at most 0.10. Local setup/band mean errors must be at most 0.15. Model and latest test outcomes must be within 120 calendar days of the signal, and no test outcome may occur after that signal. These are preset research gates, not a certification of future performance.

`data/probability-validation.json` is an optional aggregate report. It contains version/date, status/reason, accepted dataset counts, purged training/calibration/test summaries, independent test metrics and scope limitations. It contains no raw price histories or training rows. Demo companies never receive real-model percentages, even when the Methodology page displays this real historical validation report.

Historical evidence, when available, is a same-symbol, price-only, chronological diagnostic using prior signals and completed future windows. Its target-first frequency is labelled historical, not a calibrated forecast. Unfilled entries are separate from filled outcomes; ambiguous daily bars use conservative ordering and are counted. Synthetic demo data never supplies real-world probabilities or historical hit-rate claims.
