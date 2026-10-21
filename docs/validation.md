# First-pass validation — 2026-10-21

## Passed locally

- Production TypeScript + Vite build.
- 121 Python regressions, including causal probability events, historical collection/split handling, time-separated calibration, purging, training-only preprocessing, individual inference support, corrupted-artifact refusal, entry/return arithmetic and the existing scanner/AI checks.
- 25 Node checks covering probability UI guards, options payoffs and snapshot publication safeguards, including fabricated/demo probability rejection, temporal bounds and historical outcome accounting.
- Static snapshot validation of the six-company synthetic demo and a three-symbol live smoke scan.
- Firefox desktop checks: overview, navigation, symbol search, research detail panel, source/currency/date labels, strategy selection and edited contract counts.
- Firefox 412-pixel responsive viewport: page layout, navigation drawer and Options Lab navigation. This is browser simulation, not a physical-phone test.
- Entry/return cards checked in desktop Firefox and the 412-pixel viewport, including the entry range, target/upside, invalidation/downside, conservative reward/risk, dated entry window and explicit uncalibrated probability.
- Larger typography checked in desktop Firefox: 16px body text, larger tables/controls/research notes, and a sidebar card that grows instead of clipping. New live estimate/withheld/demo branches also passed automated render checks.

## Actual live data exercised

The Yahoo screener paginated four exchange codes and discovered 4,672 unique eligible-type equity listings: TSX 1,034 of 1,044 provider-reported, TSXV 1,269 of 1,269, CSE 556 of 556, and Cboe Canada 1,813 of 1,863. These are provider counts, not exchange-master completeness evidence; gaps are retained in warnings.

The live smoke scan retrieved `LSPD.TO`, `NEXG.V`, and `RY.TO`, with 2026-10-20 completed daily bars. It correctly retained USD reporting for LSPD, CAD reporting for the others, and withheld a generic fundamental score when the evidence or sector did not support it. An isolated cold-cache three-symbol scan took 2.81 seconds; this small sample does not establish full-market performance or cloud rate limits. The live smoke files are ignored local data at `.tmp/smoke-three.json` and `.tmp/smoke-cold.json`, and are not the published demo.

A further three-symbol scan exercised the new plans and passed snapshot validation: LSPD had a conditional entry setup with two completed historical samples; RY had a waiting entry scenario with 15 samples; NEXG had no qualifying technical plan. These diagnostic counts are too small for the historical frequency threshold and do not establish future probabilities. The private local result is `.tmp/scenarios-live.json`; public data remains synthetic.

The manual AI connection workflow succeeded with one synthetic record after API credits were added. This verifies the stored secret, Responses permission, billing and configured model connection; it does not validate the quality of live investment recommendations. [Workflow run](https://github.com/bspark26/canadian-stock-picker/actions/runs/39627595428).

## Still unverified

- A complete cold scan and its runtime in GitHub Actions, including cloud-IP throttling and long-run error rates.
- Live AI synthesis quality and actual broad-market AI cost.
- Prospective strategy performance after realistic trading costs. The probability pilot tests a conditional target-touch event, rather than profitability, and remains limited by its sampled present-day universe and Yahoo data quality.
- Official exchange-directory reconciliation and public redistribution rights for Yahoo quotes/history.
- Project-level filing analysis, management quality and development catalysts.
- Current Canadian option chains and account-specific brokerage permissions.

Scheduled live scans and scheduled AI are off by default. The published first pass intentionally contains synthetic data until these live-data checks are resolved.

## First probability-model fit

The preset model was fitted once on the collected pilot. Of 180 selected current listings, 95 produced usable CAD histories after split/range/length checks; 91 supplied 5,745 filled events above the historical C$50,000 liquidity floor. No raw histories or event rows are public artifacts.

- Training: 3,008 supported events, signals 2017-08-08 through 2023-04-26.
- Calibration: 1,189 supported events, signals 2023-05-31 through 2025-01-10.
- Untouched test: 1,383 supported events across 89 symbols, signals 2025-02-11 through 2026-09-18, with outcomes complete through 2026-10-20.
- Purged boundary-crossing events: 88 training and 52 calibration events. Production feature-support rules also apply before calibration/test accounting.
- Test Brier error: 0.167106 versus 0.177861 for the fixed calibration-frequency baseline; test log loss 0.510237 versus 0.542785; weighted calibration error 0.029049.

The 0–20% and 20–40% probability bands have 740 and 635 test outcomes respectively. The 40–60% band has only eight, so individual predictions in it are withheld; no higher bands have support. These figures describe held-out historical calibration, not prospective profit or independent effective sample sizes across correlated stocks. Model parameters and preset gates were not selected by searching these market test results.

A local three-symbol integration scan passed both publication and UI contracts: LSPD received an estimated target-hit probability, RY received an estimate, and NEXG withheld one because there was no qualifying technical plan. The probability specifically applies to the model's reference-entry limit fill, including its gap-skip rule, rather than any price in the displayed entry zone. The real aggregate report appears in Methodology independently of demo-company data.
