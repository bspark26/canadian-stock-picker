# Analyze a stock

The Analyze tab accepts one exact Yahoo equity symbol, including exchange suffixes (`NEXG.V`, `LSPD.TO`, `AAPL`). It does not add `.TO` or silently substitute another listing. Explicit lookups can include stocks outside the saved top 100 or below the broad scan's C$1 cutoff. Available data and the existing trade-plan rules still determine which results can be shown.

Each report includes company finances, price indicators, a chart, a conditional short-term trade plan, and a 6–12 month financial outlook. The longer outlook describes the available business evidence; it is not a calibrated stock-return forecast. Its price target and probability are deliberately null. Yahoo financial data cannot establish management quality, drilling results, construction execution, future gold prices or financing commitments. Short-term probabilities use the existing validated model only within its Canadian CAD listing domain and other evidence gates.

No OpenAI request, brokerage connection, portfolio data or API key is needed for this feature. The public frontend calls a narrow read-only backend; AWS credentials never reach the browser. Prices are completed daily bars, not live quotes.

## Local use

Run these in separate terminals:

```sh
ALLOWED_ORIGIN=http://127.0.0.1:5173 .venv/bin/python -m api.local
VITE_ANALYSIS_API_URL=http://127.0.0.1:8787/analyze npm run dev
```

The development API binds to loopback and uses the normal ignored disk cache. The local adapter has no public-production allowance and must not be exposed to the internet. Production requires the DynamoDB cache and allowance; missing configuration fails closed.

## Personal AWS deployment

The static dashboard stays on GitHub Pages. `infra/analysis-api.json` adds a Python 3.12 Lambda Function URL, a DynamoDB cache and seven-day logs. There is no VPC, NAT gateway, running VM, provisioned concurrency or always-running database. The URL uses normal Lambda request/duration billing; DynamoDB and artifact storage have their own usage charges.

The API allows 30 fresh analyses per UTC day globally, including failed provider attempts. Repeated results are cached for one hour, underlying history for one hour and fundamentals for three days. The completed-session boundary also invalidates older price/report caches. Concurrent requests for the same symbol share a short lock. Two concurrent Lambda executions and a 120-second timeout limit simultaneous expensive work where the account's regional quota supports a reservation; new accounts with lower quotas use their account concurrency limit and the same atomic daily allowance. These are operational limits, not a hard AWS billing cap: cached requests, rejected requests, logs and storage still consume service usage. CORS limits browser origins, not direct unauthenticated callers.

First verify which AWS profile belongs to the personal account. The deploy command requires the expected account ID and checks it before creating any resources. Never use the work account.

```sh
.venv/bin/python scripts/package-api.py
.venv/bin/python scripts/deploy-api.py --profile PERSONAL_PROFILE --personal-account-id 123456789012
```

The packager downloads Linux/x86_64 CPython 3.12 wheels, copies only application code, configuration and the public probability model, checks the uncompressed Lambda limit, and writes `.tmp/analysis-api.zip`. It excludes local credentials, `.env`, market caches, tests and training dependencies. Deployment uses a private S3 artifact bucket and CloudFormation. The function role only permits its own cache and logs. No access to OpenAI, GitHub, other AWS data or brokerage services is configured.

Before connecting Pages, verify `/health` and fresh real symbol analyses from the deployed function. A successful local Yahoo request does not establish that Yahoo allows requests from AWS IP addresses. Surface provider failures instead of falling back to sample data or an old report.

After live verification, save the returned full `/analyze` URL as the GitHub repository variable `ANALYSIS_API_URL` and rebuild the Pages workflow. That public URL is the only configuration compiled into the frontend. To disable access immediately, set the function's reserved concurrency to zero. To remove the API, delete the `maple-signal-analysis` CloudFormation stack; the artifact bucket is retained for explicit cleanup.

## HTTP contract

`GET /health` checks the HTTP adapter without importing pandas, yfinance or the scanner. `GET /analyze?symbol=LSPD.TO` returns one report:

```text
schemaVersion: 1
symbol, generatedAt
scope: { market, probabilitySupported }
opportunity: existing Opportunity contract
outlook:
  shortTerm: { horizon, label, summary }
  longTerm: { horizon, label, summary, evidence, risks, priceTarget: null, probability: null }
warnings: string[]
```

Errors use `{error: {code, message}}` with approved plain messages. No raw provider exception, request, key or stack trace is returned. The client verifies the ticker, dates, price/history match, numeric fields and probability scope before displaying a report. It cancels superseded requests and gives a timed-out request an explicit failure instead of presenting partial output.

References: [Lambda pricing](https://aws.amazon.com/lambda/pricing/), [Function URL billing](https://docs.aws.amazon.com/lambda/latest/dg/furls-http-invoke-decision.html), [Python native dependency packaging](https://docs.aws.amazon.com/lambda/latest/dg/python-package.html), [Function URL permissions](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html).
