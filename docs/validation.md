# First-pass validation — 2026-10-21

## Passed locally

- Production TypeScript + Vite build.
- 141 Python regressions, including causal probability events, historical collection/split handling, time-separated calibration, purging, training-only preprocessing, individual inference support, verified OHLCV and history warmup, corrupted-artifact refusal, entry/return arithmetic and the existing scanner/AI checks.
- 39 Node checks covering probability UI guards, options payoffs and snapshot publication safeguards, including fabricated/demo probability rejection, temporal bounds, history warmup and historical outcome accounting.
- Static snapshot validation of the six-company synthetic demo, a three-symbol live smoke scan and the broad live shortlist.
- Firefox desktop checks: overview, navigation, symbol search, research detail panel, source/currency/date labels, strategy selection and edited contract counts.
- Firefox 412-pixel responsive viewport: compact navigation, live stock search/detail, entry and probability cards, full-width filters and Options calculator. Chart tick labels remain readable at 14 CSS pixels. This is browser simulation, not a physical-phone test.
- Entry/return cards checked in desktop Firefox and the 412-pixel viewport, including the entry range, target/upside, invalidation/downside, conservative reward/risk, dated entry window and unavailable probability. The final live SHOP detail was also checked with a supported conditional estimate.
- Larger typography checked in desktop Firefox: 16px body text, larger tables/controls/research notes, and compact navigation. The personal-tool layout removes promotional sections, puts the full table after filters, and keeps extended model/calculation notes collapsed. Live scan counts and aggregate model metrics were checked in the compact desktop layout. New live estimate/withheld/demo branches also passed automated render checks.

## Actual live data exercised

The broad Mac scan completed in 32 minutes 31 seconds, visiting 4,669 current Yahoo equity listings: TSX 1,034 of 1,043 provider-reported, TSXV 1,269 of 1,269, CSE 556 of 556, and Cboe Canada 1,810 of 1,860. It retrieved 3,735 daily histories, with 765 retrieval failures and 169 identified CDRs excluded before retrieval. Another 921 stale/insufficient/future histories and 23 non-CAD/unknown-currency listings were excluded. A further 38 otherwise eligible listings had invalid OHLCV histories and were excluded before ranking. Of 1,069 eligible CAD listings at least C$1, the top 100 were retained. All 100 displayed prices are dated 2026-10-20. These are provider counts, not exchange-master completeness evidence; gaps remain recorded in warnings. This run reused some local cache and does not establish fully cold or cloud-IP performance.

The live smoke scan retrieved `LSPD.TO`, `NEXG.V`, and `RY.TO`, with 2026-10-20 completed daily bars. It correctly retained USD reporting for LSPD, CAD reporting for the others, and withheld a generic fundamental score when the evidence or sector did not support it. An isolated cold-cache three-symbol scan took 2.81 seconds; this small sample does not establish full-market performance or cloud rate limits. The live smoke files are ignored local data at `.tmp/smoke-three.json` and `.tmp/smoke-cold.json`, and are separate from the published broad scan.

A further three-symbol scan exercised the new plans and passed snapshot validation: LSPD had a conditional entry setup with two completed historical samples; RY had a waiting entry scenario with 15 samples; NEXG had no qualifying technical plan. These diagnostic counts are too small for the historical frequency threshold and do not establish future probabilities. The private local result is `.tmp/scenarios-live.json`; the newer broad scan replaces the public demo.

The manual AI connection workflow succeeded with one synthetic record after API credits were added. This verifies the stored secret, Responses permission, billing and configured model connection; it does not validate the quality of live investment recommendations. [Workflow run](https://github.com/bspark26/canadian-stock-picker/actions/runs/39627595428).

## Still unverified

- A complete cold scan and its runtime in GitHub Actions, including cloud-IP throttling and long-run error rates.
- Live AI synthesis quality and actual broad-market AI cost.
- Prospective strategy performance after realistic trading costs. The probability pilot tests a conditional target-touch event, rather than profitability, and remains limited by its sampled present-day universe and Yahoo data quality.
- Official exchange-directory reconciliation and public redistribution rights for Yahoo quotes/history.
- Project-level filing analysis, management quality and development catalysts.
- Current Canadian option chains and account-specific brokerage permissions.

Scheduled live scans and scheduled AI remain off. The published data is now the checked broad Mac scan; refreshing the browser reads that saved result and does not start a scan or charge for AI.

## First probability-model fit

The preset model was fitted once on the collected pilot. Of 180 selected current listings, 95 produced usable CAD histories after split/range/length checks; 91 supplied 5,745 filled events above the historical C$50,000 liquidity floor. No raw histories or event rows are public artifacts.

- Training: 3,008 supported events, signals 2017-08-08 through 2023-04-26.
- Calibration: 1,189 supported events, signals 2023-05-31 through 2025-01-10.
- Untouched test: 1,383 supported events across 89 symbols, signals 2025-02-11 through 2026-09-18, with outcomes complete through 2026-10-20.
- Purged boundary-crossing events: 88 training and 52 calibration events. Production feature-support rules also apply before calibration/test accounting.
- Test Brier error: 0.167106 versus 0.177861 for the fixed calibration-frequency baseline; test log loss 0.510237 versus 0.542785; weighted calibration error 0.029049.

The 0–20% and 20–40% probability bands have 740 and 635 test outcomes respectively. The 40–60% band has only eight, so individual predictions in it are withheld; no higher bands have support. These figures describe held-out historical calibration, not prospective profit or independent effective sample sizes across correlated stocks. Model parameters and preset gates were not selected by searching these market test results.

A local three-symbol integration scan passed both publication and UI contracts: LSPD received an estimated target-hit probability, RY received an estimate, and NEXG withheld one because there was no qualifying technical plan. The probability specifically applies to the model's reference-entry limit fill, including its gap-skip rule, rather than any price in the displayed entry zone. The real aggregate report appears in Methodology independently of demo-company data.

The final published shortlist passes both server publication checks and frontend runtime guards. All 100 saved price histories pass OHLCV validation; 75 setups receive a supported model estimate and 25 withhold one. These counts reflect the dated snapshot and will change after a refresh. The probability integration safeguards have 13 additional regressions covering invalid/mismatched histories, published-price boundaries and pre-ranking exclusion.

## Chart and mobile update

The same dated live scan now publishes verified daily OHLCV history for all 100 stocks: 69–502 sessions per listing, with no new market-data request or AI call. The scanner retains up to 520 bars on later refreshes. Publication and frontend guards reject partial OHLC, impossible ranges, invalid dates, duplicate days and nonfinite prices/volume while accepting legacy close-only data.

Desktop Firefox checks passed for BMM: readable currency price/date axes, line/candlestick switching, All history, weekly aggregation, and a custom 2025-10-21 through 2026-10-20 range that changed the visible candles. In the 412-pixel responsive viewport, the wide results table is replaced by cards; BMM and SHOP cards, search, open details, SHOP line/candles and 1M controls were checked visually. Price and date scales remained readable within the phone width. Native date segments require keyboard entry in the automation tool; normal date inputs remain browser controls. Physical-phone touch gestures remain untested.

Nine chart-data test groups cover aggregation, calendar boundaries, missing OHLC/volume, source-date-relative ranges, short histories and non-trading-day tolerance. Four additional publication/UI history groups and one scanner export regression cover the new candle data contract. The chart library is loaded on opening stock detail and includes its attribution/license notices. The final preset filter also excludes ranges containing fewer than two bars at the selected interval.
