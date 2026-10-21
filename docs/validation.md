# First-pass validation — 2026-10-21

## Passed locally

- Production TypeScript + Vite build.
- 13 Python scanner regression tests, including financial units, missing evidence, freshness rejection and AI timeout budget reservation.
- Seven independent options payoff tests, including standard contract sizing, fees, payoff caps, downside protection, breakeven boundaries and invalid inputs.
- Static snapshot validation of the six-company synthetic demo and a three-symbol live smoke scan.
- Firefox desktop checks: overview, navigation, symbol search, research detail panel, source/currency/date labels, strategy selection and edited contract counts.
- Firefox 412-pixel responsive viewport: page layout, navigation drawer and Options Lab navigation. This is browser simulation, not a physical-phone test.

## Actual live data exercised

The Yahoo screener paginated four exchange codes and discovered 4,672 unique eligible-type equity listings: TSX 1,034 of 1,044 provider-reported, TSXV 1,269 of 1,269, CSE 556 of 556, and Cboe Canada 1,813 of 1,863. These are provider counts, not exchange-master completeness evidence; gaps are retained in warnings.

The live smoke scan retrieved `LSPD.TO`, `NEXG.V`, and `RY.TO`, with 2026-10-20 completed daily bars. It correctly retained USD reporting for LSPD, CAD reporting for the others, and withheld a generic fundamental score when the evidence or sector did not support it. An isolated cold-cache three-symbol scan took 2.81 seconds; this small sample does not establish full-market performance or cloud rate limits. The live smoke files are ignored local data at `.tmp/smoke-three.json` and `.tmp/smoke-cold.json`, and are not the published demo.

## Still unverified

- A complete cold scan and its runtime in GitHub Actions, including cloud-IP throttling and long-run error rates.
- Actual paid OpenAI output and billing: no API key was supplied and no paid generation was run.
- Official exchange-directory reconciliation and public redistribution rights for Yahoo quotes/history.
- Project-level filing analysis, management quality and development catalysts.
- Current Canadian option chains and account-specific brokerage permissions.

Scheduled live scans and scheduled AI are off by default. The published first pass intentionally contains synthetic data until these live-data checks are resolved.
