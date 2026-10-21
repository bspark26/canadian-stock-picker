# Maple Signal first pass

Maple Signal is a personal Canadian equity research dashboard. It discovers a broad Canadian symbol universe, filters stocks trading below C$1, calculates reproducible screens, and explains a shortlist. It does not connect to a broker or track account balances.

## Data flow

1. `scanner.run` discovers the provider's Canadian equity universe, fetches daily history and available fundamentals, and records coverage and failures.
2. Python calculates technical indicators and fundamental evidence. The scanner distinguishes missing data from actual zero values and flags incomplete evidence.
3. Optional OpenAI curation selects the most relevant supplied evidence and risks for the shortlist. The first pass assembles the displayed summary from those exact evidence sentences; it does not author unsupported company claims. Rules summaries remain available when AI is disabled. API keys are only used by the scanner.
4. A validated JSON snapshot is committed to `public/data/latest.json`.
5. Vite builds a static React dashboard. GitHub Pages serves the built files publicly, without sign-in or a running application server.

Dashboard filters operate on the saved shortlist. They do not trigger a fresh market scan. The separate Analyze tab calls a small on-demand backend for an exact stock symbol. It reuses the financial and technical calculations, adds short- and longer-term views, and does not change the shortlist. The personal-AWS backend is deployed and live tested; Pages receives its public URL through a repository variable. See [stock analysis](stock-analysis.md) for local use, deployment and the evidence limits.

## Reliability and cost

- A scan writes to a temporary file first. Failed or empty results cannot replace the deployed snapshot.
- Scan times, price dates, financial statement periods, missing values, and exchange coverage are shown separately.
- A scan and deployment run in the same serialized GitHub workflow, because a bot commit does not trigger another workflow.
- Scheduled scans and scheduled AI are separate repository opt-ins. Pushes and pull requests do not call the paid API.
- Scan and AI caches are disposable ignored local data. The public site never needs a key to display completed reports.
- No full market-data archive is committed. The snapshot contains the selected research candidates and their chart histories.

## First-pass boundaries

Yahoo/yfinance is an unofficial research data source. Canadian directory completeness, data coverage, cloud IP throttling, adjustment errors and fundamental freshness need live validation. Coverage metadata must never claim that every listed company was successfully analyzed when it was not.

Pre-revenue developers require project and financing research that Yahoo ratios alone cannot establish. This version flags candidates and financial evidence, rather than inventing drill results, management quality or construction progress.

Options Lab calculates expiry payoffs from manually entered assumptions and quotes. It does not fetch Canadian option chains, validate account permissions, or predict pre-expiry option prices. Cash, debt and cash flows retain their reporting currency, which can differ from the stock's trading currency.

The included sample snapshot is synthetic and clearly marked. It is for reviewing functionality, never current investment evidence. Public display of third-party quotes and histories needs appropriate data rights; selecting a free host does not grant redistribution permission.

## Entry and return scenarios

`scanner.trade_plans` computes rounded entry ranges, conditional targets, invalidation levels and price-change scenarios from the signal's preceding range and ATR. Reward/risk uses the least favourable entry in the range. `scanner.historical` evaluates prior same-symbol signals with no future data in the signal calculation, non-overlapping observation windows, explicit entry validity, and conservative daily-bar ordering. It runs only on the displayed shortlist and reuses already downloaded OHLCV history.

Historical frequency and model calibration are separate. `scanner.probability` loads a plain JSON coefficient artifact for a logistic model with a separately fitted sigmoid calibrator. Training-only imputation, scaling and feature ranges are preserved. Date-grouped 60/20/20 splits purge full outcome windows crossing the next boundary. Calibration and untouched test events must pass the same feature-support and historical liquidity rules as production. Preset global and local calibration/sample gates decide whether an estimate can be shown. This adds no network calls or AI charges to the daily scan.

`scanner.train_probability` is a local, explicitly invoked collection/training command. It discovers a deterministic present-day exchange/sector cohort, downloads up to ten years of daily Yahoo OHLCV with reported actions, and restarts each history after its latest stock split. Invalid ranges, insufficient post-split history and unexplained extreme jumps are rejected. Present-day constituent selection has survivorship limitations; no historical fundamentals are reconstructed from current statements. `scanner.probability_events` rebuilds causal technical signals efficiently and labels complete sequential fill/exit windows. Raw histories/events remain in ignored caches. The versioned artifact is `models/probability.json`; the public aggregate report is `public/data/probability-validation.json`.

The daily scanner attaches an integer target-before-invalidation probability only for a supported live plan. Invalid, missing, stale or out-of-domain evidence yields Insufficient evidence with a reason. The public Methodology page can show independent model results even while a demo snapshot is loaded. No LLM confidence percentage or same-stock historical hit rate is substituted for a future probability.

## Interactive chart presentation

`PriceChart` retains lightweight SVG sparklines for the desktop table and uses a client-side Lightweight Charts instance for stock detail. Full detail uses the published OHLCV history with explicit price and time scales. Range/interval changes are browser calculations, not Yahoo or AI calls. Weekly/monthly aggregation uses completed daily records and does not invent intraday prices. Library instances/observers are removed on unmount. Mobile stock cards replace table markup at the responsive breakpoint, using the same filtered result array.
