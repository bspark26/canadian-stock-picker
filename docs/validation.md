# First-pass validation — 2026-10-21

## Passed locally

- Production TypeScript + Vite build.
- 65 Python regressions, including entry/return arithmetic, price rounding, unavailable setups, historical no-look-ahead, gaps, conservative intraday ordering, non-overlap, right-censoring and sample thresholds, alongside the scanner and AI error checks.
- 13 Node checks covering options payoffs and snapshot publication safeguards, including fabricated probability rejection and historical outcome accounting.
- Static snapshot validation of the six-company synthetic demo and a three-symbol live smoke scan.
- Firefox desktop checks: overview, navigation, symbol search, research detail panel, source/currency/date labels, strategy selection and edited contract counts.
- Firefox 412-pixel responsive viewport: page layout, navigation drawer and Options Lab navigation. This is browser simulation, not a physical-phone test.
- Entry/return cards checked in desktop Firefox and the 412-pixel viewport, including the entry range, target/upside, invalidation/downside, conservative reward/risk, dated entry window and explicit uncalibrated probability.

## Actual live data exercised

The Yahoo screener paginated four exchange codes and discovered 4,672 unique eligible-type equity listings: TSX 1,034 of 1,044 provider-reported, TSXV 1,269 of 1,269, CSE 556 of 556, and Cboe Canada 1,813 of 1,863. These are provider counts, not exchange-master completeness evidence; gaps are retained in warnings.

The live smoke scan retrieved `LSPD.TO`, `NEXG.V`, and `RY.TO`, with 2026-10-20 completed daily bars. It correctly retained USD reporting for LSPD, CAD reporting for the others, and withheld a generic fundamental score when the evidence or sector did not support it. An isolated cold-cache three-symbol scan took 2.81 seconds; this small sample does not establish full-market performance or cloud rate limits. The live smoke files are ignored local data at `.tmp/smoke-three.json` and `.tmp/smoke-cold.json`, and are not the published demo.

A further three-symbol scan exercised the new plans and passed snapshot validation: LSPD had a conditional entry setup with two completed historical samples; RY had a waiting entry scenario with 15 samples; NEXG had no qualifying technical plan. These diagnostic counts are too small for the historical frequency threshold and do not establish future probabilities. The private local result is `.tmp/scenarios-live.json`; public data remains synthetic.

The manual AI connection workflow succeeded with one synthetic record after API credits were added. This verifies the stored secret, Responses permission, billing and configured model connection; it does not validate the quality of live investment recommendations. [Workflow run](https://github.com/bspark26/canadian-stock-picker/actions/runs/39627595428).

## Still unverified

- A complete cold scan and its runtime in GitHub Actions, including cloud-IP throttling and long-run error rates.
- Live AI synthesis quality and actual broad-market AI cost.
- Calibrated forecast probabilities and prospective strategy performance after realistic trading costs. Historical diagnostics are not a validated prediction model.
- Official exchange-directory reconciliation and public redistribution rights for Yahoo quotes/history.
- Project-level filing analysis, management quality and development catalysts.
- Current Canadian option chains and account-specific brokerage permissions.

Scheduled live scans and scheduled AI are off by default. The published first pass intentionally contains synthetic data until these live-data checks are resolved.
