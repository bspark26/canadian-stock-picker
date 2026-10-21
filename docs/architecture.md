# Maple Signal first pass

Maple Signal is a personal Canadian equity research dashboard. It discovers a broad Canadian symbol universe, filters stocks trading below C$1, calculates reproducible screens, and explains a shortlist. It does not connect to a broker or track account balances.

## Data flow

1. `scanner.run` discovers the provider's Canadian equity universe, fetches daily history and available fundamentals, and records coverage and failures.
2. Python calculates technical indicators and fundamental evidence. The scanner distinguishes missing data from actual zero values and flags incomplete evidence.
3. Optional OpenAI curation selects the most relevant supplied evidence and risks for the shortlist. The first pass assembles the displayed summary from those exact evidence sentences; it does not author unsupported company claims. Rules summaries remain available when AI is disabled. API keys are only used by the scanner.
4. A validated JSON snapshot is committed to `public/data/latest.json`.
5. Vite builds a static React dashboard. GitHub Pages serves the built files publicly, without sign-in or a running application server.

Dashboard filters operate on the saved shortlist. They do not trigger a fresh market scan. On-demand live analysis would require a separate backend; it is outside this first pass.

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

Historical frequency and model calibration are separate. The app deliberately withholds a forecast probability until an independently validated chronological model exists. No LLM confidence percentage or historical hit rate is labelled as the chance of a future prediction being true.
