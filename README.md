# Maple Signal

A personal Canadian stock research dashboard with fundamental and technical screens, saved recommendations, and an educational options calculator. React + TypeScript on GitHub Pages; Python scans in GitHub Actions. No brokerage connection, sign-in, or portfolio tracking.

The published snapshot is a live Yahoo scan with completed daily prices through **2026-10-20**. It shows the top 100 candidates from 1,069 eligible CAD listings priced at least C$1. Coverage is partial; missing and failed histories remain recorded in the report.

## Run locally

Use Node.js 22.18+ and Python 3.12+.

```sh
npm ci
npm run dev
```

Open the Local URL printed by Vite. The saved dashboard works without Python, an API key or a paid service; Python is only needed to refresh data or retrain the model.

To use the scanner:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m scanner.run --output public/data/latest.json
```

The default live scan discovers the provider's Canadian equity listings. It is not a preset watchlist. Prices below C$1 are excluded. Missing data, failures and incomplete coverage are recorded in the snapshot. Dashboard filters operate on the published shortlist, rather than running the Python scanner in your browser.

A small live smoke test can use:

```sh
python -m scanner.run --symbols NEXG.V LSPD.TO --output .tmp/smoke.json
node scripts/validate-data.mjs .tmp/smoke.json --expect-live
```

Explicit symbols or scan limits are development tools and are marked as partial coverage. They do not become the production universe.

To regenerate the illustrative demo intentionally:

```sh
python -m scanner.run --demo --output public/data/latest.json
```

## Charts and mobile

Open a stock for an interactive line or candlestick chart with price/date scales, crosshair values, pan/zoom, preset ranges and custom dates. Daily, weekly and monthly views use the published daily bars; intraday quotes are not included. Available history varies by listing and is shown in the chart. Weekly/monthly candles aggregate actual daily open, high, low, close and volume; partial calendar periods reflect only saved completed sessions.

On screens up to 760 pixels, results use stock cards with prices, scores, entry/target/stop and supported probabilities. The desktop keeps the sortable table. Both layouts use the same filters and data.

Charts use [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/) with its attribution and license notices included. No chart subscription or new backend is required.

## Optional AI

The scanner produces rules-based summaries without a key. For optional AI curation, set `OPENAI_API_KEY` in the scanner's environment and explicitly pass `--ai`. In this first pass, the model selects and orders the supplied evidence and risks; the displayed sentences come from that evidence, rather than free-form company claims. `OPENAI_MODEL` defaults to `gpt-6.1-sol`; `--max-ai 10` limits company analyses. Do not put a secret in a command argument, a `VITE_` environment variable, committed JSON, or browser code.

```sh
python -m scanner.run --ai --max-ai 10 --output .tmp/latest.json
node scripts/validate-data.mjs .tmp/latest.json --expect-live
```

Python does not automatically load `.env`. Set variables in your shell or use your normal secret manager. `.env.example` documents the names without real credentials. In GitHub, add the key under **Settings → Secrets and variables → Actions → Secrets**. A dashboard refresh only reads saved results and does not call the API.

After saving the secret, run **Actions → Check AI connection → Run workflow**. This manual-only check attempts one uncached generation using synthetic evidence and reports whether the exact model and structured response worked. It does not scan Yahoo, publish data, or enable scheduled jobs. The check reserves an estimated maximum of US$0.05 using the configured token rates and never retries a potentially billed generation automatically.

## Publish on GitHub Pages

1. Create a **public** GitHub repository and push this project to its `main` branch. Free Pages uses a public publishing repository. If your CLI login has expired, run `gh auth login -h github.com` first.
2. In the repository, open **Settings → Pages → Build and deployment → Source**, and choose **GitHub Actions**.
3. Open **Actions → Scan, check and publish dashboard → Run workflow**. Leave `refresh` and `use_ai` off to publish the saved snapshot without a new scan or AI charge.
4. The workflow runs tests, validates the snapshot, builds the correct repository subdirectory, and deploys to Pages. The deployment provides the public URL.

To refresh live data manually, run the same workflow with `refresh` enabled. AI is a separate checkbox. The first broad Mac scan completed in about 33 minutes; GitHub Actions runtime and cloud-IP throttling still need validation. Public display of provider prices and chart histories also requires appropriate data rights; yfinance is not a redistribution licence.

To enable unattended refreshes after validation, set these repository **Variables**:

| Variable | Value | Effect |
| --- | --- | --- |
| `ENABLE_SCHEDULED_SCAN` | `true` | Runs weekday scans at 23:17 UTC, after Canadian markets close. |
| `ENABLE_SCHEDULED_AI` | `true` | Enables paid AI during scheduled scans; requires the key. |
| `OPENAI_MODEL` | optional model ID | Overrides the scanner's default model. |

Pushes and pull requests do not run paid AI. GitHub schedules may be delayed, run on the default branch, and can be disabled after prolonged repository inactivity. Check the displayed data date instead of assuming a refresh occurred.

The workflow validates temporary live output before replacing the saved snapshot. An empty, failed or invalid refresh leaves the deployed dashboard unchanged. It builds and deploys the scanner's bot commit in the same run, because that commit does not trigger a second workflow.

Scan settings live in `config/defaults.json`. Liquidity filtering defaults to zero so thinly traded stocks are flagged rather than silently removed. Identified CDRs are excluded by default; this is configurable. Only confirmed CAD-traded listings pass the C$1 filter. Results are capped at the top 100 research candidates, with full scan counts retained. The first broad Mac scan visited 4,669 discovered listings in about 33 minutes, including previously cached data. A fully cold cloud run has not been timed.

## Checks

```sh
python -m pytest tests
node --experimental-strip-types --test tests/*.test.mjs
node scripts/validate-data.mjs public/data/latest.json
npm run build
```

The production build includes TypeScript checking. For a project Pages URL, also verify the base path:

```sh
VITE_BASE_PATH=/canadian-stock-picker/ npm run build
npm run preview
```

## What the first pass can establish

- Daily-price trend, momentum, historical range and liquidity evidence.
- Available cash, debt, growth, profitability and cash-flow evidence, with missing values and reporting currencies shown.
- Separate fundamental and technical rankings, research explanations and risks.
- Conditional entry ranges, target-price upside, invalidation downside, and reward/risk, using a stated 20-session window after entry.
- Same-symbol historical entry diagnostics and separately validated model probabilities for supported setups; unsupported estimates remain blank.
- Expiry payoff examples for long calls, long puts, covered calls and protective puts using manually entered assumptions.

Scores are screening heuristics, not return probabilities. Yahoo fundamentals alone cannot verify management quality, drill results, mine construction plans or future financing. Company filings and releases still need review. Options Lab does not retrieve chains or confirm TD account permissions and cannot value an option before expiry. See [architecture](docs/architecture.md) and [data contract](docs/data-contract.md) for implementation boundaries.

## Entry scenarios and probability

The entry plan is a conditional technical scenario, separate from a company's long-term investment thesis. Normal range setups propose a zone near the preceding 20-session low, targeting the prior range high. Existing breakouts instead propose a retest of the prior range high with an explicitly ATR-derived objective. Invalidation uses an ATR buffer. Rounded prices must leave at least 1.5× target reward/risk at the upper edge of the entry range; unsupported or broken setups get no forced entry recommendation.

Potential returns are price changes from the stated reference entry before fees and slippage. They are not expected returns, valuations or guaranteed fills. The proposed entry is valid for five sessions following the signal's as-of date and must be reassessed if conditions change. Skip an opening gap at or below invalidation. A stop/invalidation level is not a guaranteed exit price.

The historical diagnostic rebuilds earlier signals using only information available on each signal day, models conditional reference-entry limit fills for five sessions while skipping opening gaps at or below invalidation, separates unfilled entries, and counts target-first, stop-first and expired filled outcomes. It requires a complete post-entry 20-session window and uses conservative daily-bar ordering for ambiguous cases. Observations do not overlap. This is retrospective price-only evidence from the provider's available history, with missing/delisted-universe limitations; it is not a calibrated forecast. A same-symbol historical hit rate can be calculated after at least 20 filled observations, with a Wilson interval, but the dashboard currently shows supporting counts rather than presenting that frequency as a future probability.

The separate probability model learns from price-only events across a sampled Canadian universe. It fits on older dates, calibrates on later dates and measures performance on an untouched newest period, purging outcome windows across the boundaries. Only supported live setups receive an integer probability; unsupported conditions show Insufficient evidence. Demo companies never receive model percentages. The Methodology page displays aggregate real validation evidence separately.

The probability is conditional on the model's reference-entry buy-limit fill, skipping an opening gap at or below invalidation, and measures target-before-invalidation within the stated 20-session window. It does not apply to every possible fill across the entry zone; a different entry needs a new estimate. It is not an estimate of net profitability. Fees, spreads, execution, correlated stocks, changing market conditions, missing/delisted listings and present-day universe selection limit what historical validation can establish. The model may withhold estimates after 120 days without fresh evidence. A screening score and an AI-generated confidence number cannot substitute for validation.

## Train the probability model locally

```sh
python -m scanner.train_probability --max-symbols 180 --period 10y
```

This collects an explicitly sampled training cohort, preserves raw history/events only in ignored `.cache/probability/`, and writes `models/probability.json` plus the aggregate `public/data/probability-validation.json`. It does not call OpenAI, enable a schedule or change the scan universe. Failed validation saves the failure evidence and withholds probabilities; no parameter search on the test period is performed. The normal live scanner automatically uses the checked-in model.

To reuse an already collected cohort without downloading again:

```sh
python -m scanner.train_probability --train-only
```

Training uses at least C$50,000 historical average daily traded value and 200 completed prior bars, restarts history after a reported split, and excludes unverified extreme price jumps. Production estimates require the same history warmup and liquidity. This is a present-day Yahoo constituent pilot, with survivorship and provider-data limitations, rather than a historical whole-market benchmark. Refresh the local dataset periodically and review the independent report before publishing a replacement artifact. Running the initial training on your Mac adds no server or AI expense.

Method references: [probability calibration](https://scikit-learn.org/stable/modules/calibration.html), [CIRO guidance on stop-loss orders](https://www.ciro.ca/newsroom/publications/guidance-respecting-management-stop-loss-orders-0).

Primary service references: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), [yfinance](https://github.com/ranaroussi/yfinance), [OpenAI model](https://developers.openai.com/api/docs/models/gpt-6.1-sol).
