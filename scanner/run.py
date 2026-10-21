"""Run: python -m scanner.run --output public/data/latest.json [--demo]."""
from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
import json
import math
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import quote

from .fundamentals import evaluate
from .technicals import indicators, technical_score, classify_setup, number
from .trade_plans import build_trade_plan
from .yahoo import Cache, EXCHANGES, SUFFIXES, YahooSource, SourceError

ROOT = Path(__file__).resolve().parents[1]


def settings_from(path):
    settings = json.loads((ROOT / "config/defaults.json").read_text())
    if path and Path(path).resolve() != (ROOT / "config/defaults.json").resolve():
        settings.update(json.loads(Path(path).read_text()))
    return settings


def opportunity(symbol, snapshot, frame, currency, payload):
    price = float(frame["Close"].iloc[-1])
    technicals = indicators(frame)
    score = technical_score(price, technicals, len(frame))
    metrics, fundamental_score, reasons, risks, financial_date, financial_currency = evaluate(payload)
    info = payload.get("info", {})
    price_as_of = frame.index[-1].date().isoformat()
    daily_value = number((frame["Close"] * frame["Volume"]).tail(20).mean()) if len(frame) >= 20 else None
    if technicals["sma50"]:
        reasons.append(f"Daily close is {'above' if price > technicals['sma50'] else 'below'} its 50-session average.")
    if technicals["return20d"] is not None:
        reasons.append(f"20-session price change: {technicals['return20d']:+.1f}%.")
    if technicals["rsi14"] is not None:
        reasons.append(f"14-session RSI: {technicals['rsi14']:.1f}; descriptive momentum, not a reversal prediction.")
    if not reasons:
        reasons.append("Limited available evidence: inspect the linked price history and issuer disclosures.")
    if daily_value is None or daily_value < 50000:
        risks.append("Thin or unverified liquidity: quoted prices may not be executable without material spreads or slippage.")
    age = (date.today() - frame.index[-1].date()).days
    if age > 7:
        risks.append(f"The latest available daily bar is {age} days old.")
    if len(frame) < 200:
        risks.append("Fewer than 200 daily bars; long-term trend evidence is incomplete.")
    risks.append("Historical price ranges are descriptive; verify current quotes, corporate actions and issuer filings before acting.")
    setup = classify_setup(price, technicals)
    has_statement_evidence = any(payload.get(key) for key in ("balance", "cashflow", "income"))
    swing_context = score is not None and score >= 55 and setup != "Research watch"
    horizon = "Both" if has_statement_evidence and swing_context else "Long term" if has_statement_evidence else "Swing"
    resource_annual_revenue = number(payload.get("income", {}).get("revenue"))
    annual_resource_research = info.get("sector") == "Basic Materials" and resource_annual_revenue is not None and resource_annual_revenue <= 0
    if annual_resource_research:
        horizon = "Both" if setup in ("Trend continuation", "Pullback") and score is not None and score >= 60 else "Long term"
        if horizon == "Long term":
            setup = "Research watch"
    name = info.get("longName") or snapshot.get("longName") or snapshot.get("shortName") or symbol
    exchange = snapshot.get("scannerExchange") or EXCHANGES.get(snapshot.get("exchange")) or SUFFIXES.get(symbol.rsplit(".", 1)[-1], "Unknown")
    if fundamental_score is None and score is None:
        horizon = "Long term"
        setup = "Research watch"
    financial_known = all(metrics[key] is not None for key in ("cash", "debt", "operatingCashFlow")) and financial_date is not None and financial_currency is not None
    quality = "Complete" if financial_known and fundamental_score is not None and score is not None and len(frame) >= 200 and age <= 7 else "Partial"
    return {
        "symbol": symbol, "name": name, "exchange": exchange, "sector": info.get("sector") or snapshot.get("sector") or "Unknown",
        "price": round(price, 6), "changePercent": round((price / float(frame["Close"].iloc[-2]) - 1) * 100, 3) if len(frame) > 1 else None,
        "currency": currency, "financialCurrency": financial_currency,
        "marketCap": number(info.get("marketCap") or snapshot.get("marketCap")), "averageDailyValue": round(daily_value, 2) if daily_value is not None else None,
        "fundamentalScore": fundamental_score, "technicalScore": score, "setup": setup, "horizon": horizon,
        "summary": " ".join(reasons[:2]), "reasons": reasons, "risks": list(dict.fromkeys(risks)), "technicals": technicals, "fundamentals": metrics,
        "history": [{"date": index.date().isoformat(), **{key.lower(): round(float(row[key]), 6) for key in ("Open", "High", "Low", "Close")}, "volume": int(row["Volume"])} for index, row in frame.tail(520).iterrows()],
        "sources": [
            {"label": "Yahoo Finance daily history", "url": f"https://finance.yahoo.com/quote/{quote(symbol)}/history/", "asOf": price_as_of},
            {"label": "Yahoo Finance annual income statement", "url": f"https://finance.yahoo.com/quote/{quote(symbol)}/financials/", "asOf": payload.get("income", {}).get("asOf")},
            {"label": "Yahoo Finance annual cash-flow statement", "url": f"https://finance.yahoo.com/quote/{quote(symbol)}/cash-flow/", "asOf": payload.get("cashflow", {}).get("asOf")},
            {"label": "Yahoo Finance latest reported balance sheet", "url": f"https://finance.yahoo.com/quote/{quote(symbol)}/balance-sheet/", "asOf": payload.get("balance", {}).get("asOf")},
            {"label": "Yahoo company profile / issuer links", "url": f"https://finance.yahoo.com/quote/{quote(symbol)}/profile/", "asOf": None},
        ],
        "priceAsOf": price_as_of, "fundamentalsAsOf": financial_date, "dataQuality": quality, "analysisKind": "Rules", "optionsAvailable": None,
        "tradePlan": build_trade_plan(price, technicals, setup, price_as_of),
    }


def apply_probability_model(opportunities, histories, model):
    """Apply the trained model only to verified completed OHLCV inputs."""
    from .historical import _validated_frame
    from .probability import predict_probability
    for row in opportunities:
        frame = histories.get(row["symbol"])
        history_valid = _validated_frame(frame) is not None
        if history_valid:
            history_valid = frame.index[-1].date().isoformat() == row["priceAsOf"] and abs(float(frame.Close.iloc[-1]) - row["price"]) <= 0.000001
        if not history_valid:
            row["dataQuality"] = "Partial"
            warning = "Probability withheld: completed daily OHLCV history failed validation or does not match this price timestamp."
            if warning not in row["risks"]:
                row["risks"].append(warning)
        plan = row["tradePlan"]
        # Compare against the published close, avoiding vendor float noise at
        # an entry-zone boundary when reapplying a newer model to a snapshot.
        if plan["status"] != "Unavailable":
            plan["status"] = "Ready" if plan["entryLow"] <= row["price"] <= plan["entryHigh"] else "Wait"
        plan["probability"] = predict_probability(
            plan, row["technicals"],
            {"price": row["price"], "averageDailyValue": row["averageDailyValue"], "setup": row["setup"], "historyValid": history_valid}, model,
        )


def live_scan(args, settings, source=None):
    from .historical import _validated_frame, historical_evidence
    source = source or YahooSource(settings)
    warnings = ["Unofficial Yahoo/yfinance data is for personal research; data, adjustments and financial fields can be incomplete or erroneous. Scores are transparent heuristics, not forecasts or trade instructions.", "Fundamental evidence mixes the labelled annual cash-flow period with the latest balance sheet and vendor ratios; fundamentalsAsOf is the oldest statement period used. It is not the filing publication date."]
    warnings.append("Yahoo's equity classification can include preferred shares, funds and CDRs; instrument types have not been reconciled to exchange directories.")
    if args.symbols:
        snapshots = [{"symbol": symbol.upper(), "quoteType": "EQUITY"} for symbol in dict.fromkeys(args.symbols)]
        warnings.append("Explicit --symbols smoke-test scope; this is not a whole-market scan.")
    else:
        snapshots, discovery_warnings = source.universe()
        warnings.extend(discovery_warnings)
    discovered = len(snapshots)
    if args.limit:
        snapshots = snapshots[:args.limit]
        warnings.append(f"Development --limit {args.limit} enabled; universe coverage is partial.")
    scanned, failed, eligible, skipped_cdr, non_cad, fundamental_failures, stale, invalid_histories = 0, 0, 0, 0, 0, 0, 0, 0
    opportunities = []
    candidate_histories = {}
    for index, snapshot in enumerate(snapshots):
        symbol = snapshot["symbol"]
        print(f"[{index + 1}/{len(snapshots)}] {symbol}", file=sys.stderr, flush=True)
        name = (snapshot.get("shortName", "") + " " + snapshot.get("longName", "")).upper()
        if settings.get("exclude_cdrs", True) and (" CDR " in f" {name} " or "CAD HEDGED" in name):
            skipped_cdr += 1
            continue
        try:
            frame, source_currency = source.history(symbol)
            currency = source_currency or snapshot.get("currency")
            scanned += 1
            age = (date.today() - frame.index[-1].date()).days
            if age < 0 or age > 7 or len(frame) < 2:
                stale += 1
                continue
            # The C$1 filter is only comparable for CAD-traded listings. No guessed FX.
            if currency != "CAD":
                non_cad += 1
                continue
            price = float(frame["Close"].iloc[-1])
            if price < settings["min_price"]:
                continue
            daily_value = number((frame["Close"] * frame["Volume"]).tail(20).mean()) if len(frame) >= 20 else None
            if settings["min_average_daily_value"] > 0 and (daily_value is None or daily_value < settings["min_average_daily_value"]):
                continue
            if _validated_frame(frame) is None:
                invalid_histories += 1
                print(f"Excluded {symbol}: invalid completed daily OHLCV history", file=sys.stderr)
                continue
            eligible += 1
            payload = {}
            if args.fundamental_limit is None or len(opportunities) < args.fundamental_limit:
                try:
                    payload = source.fundamentals(symbol)
                except Exception as exc:
                    fundamental_failures += 1
                    print(f"Fundamentals unavailable for {symbol}: {type(exc).__name__}", file=sys.stderr)
            result = opportunity(symbol, snapshot, frame, currency, payload)
            if not payload:
                result["risks"].append("Fundamental retrieval was unavailable or intentionally limited; this row has technical evidence only.")
            opportunities.append(result)
            candidate_histories[symbol] = frame
        except Exception as exc:
            failed += 1
            print(f"Skipped {symbol}: {type(exc).__name__}: {exc}", file=sys.stderr)
    if scanned == 0:
        raise SourceError("No valid daily histories were retrieved; prior output preserved.")
    if skipped_cdr:
        warnings.append(f"Excluded {skipped_cdr} identified CDR/CAD-hedged listings by name; classification is not exhaustive. Config exclude_cdrs can disable this filter.")
    if non_cad:
        warnings.append(f"Excluded {non_cad} non-CAD or unknown-currency listings; no FX conversion is inferred.")
    if failed:
        warnings.append(f"Daily history failed for {failed} listings; coverage is partial.")
    if stale:
        warnings.append(f"Excluded {stale} listings with future, insufficient or stale daily history (latest bar over 7 calendar days old); suspended/delisted prices are not active candidates.")
    if invalid_histories:
        warnings.append(f"Excluded {invalid_histories} listings with invalid completed daily OHLCV histories; no technical scores or entry scenarios were published for them.")
    if fundamental_failures:
        warnings.append(f"Fundamentals unavailable for {fundamental_failures} eligible listings; their missing financial values remain null.")
    if args.fundamental_limit is not None:
        warnings.append(f"Development fundamentals limit {args.fundamental_limit} enabled.")
    def rank(row):
        scores = [row[key] for key in ("fundamentalScore", "technicalScore") if row[key] is not None]
        return (sum(scores) / len(scores) if scores else -1, len(scores), row["averageDailyValue"] or 0)
    opportunities.sort(key=rank, reverse=True)
    if len(opportunities) > settings["output_limit"]:
        warnings.append(f"Showing the top {settings['output_limit']} research candidates from {eligible} eligible listings; this is a display shortlist, not the entire universe.")
        opportunities = opportunities[:settings["output_limit"]]
    # Evaluate only the displayed shortlist; reuse fetched history without API calls.
    historical_failures = 0
    for row in opportunities:
        if row["tradePlan"]["status"] == "Unavailable":
            continue
        try:
            row["tradePlan"]["historical"] = historical_evidence(candidate_histories[row["symbol"]], row["setup"])
        except Exception as exc:
            historical_failures += 1
            print(f"Historical diagnostic unavailable for {row['symbol']}: {type(exc).__name__}", file=sys.stderr)
    if historical_failures:
        warnings.append(f"Historical entry diagnostics unavailable for {historical_failures} shortlist rows; their same-symbol diagnostics were withheld.")
    # The locally trained JSON model runs here without another service or AI call.
    # Missing, stale or unsupported evidence fails closed on each individual plan.
    model_path = ROOT / settings.get("probability_model", "models/probability.json")
    try:
        probability_model = json.loads(model_path.read_text())
    except (OSError, ValueError):
        probability_model = None
    apply_probability_model(opportunities, candidate_histories, probability_model)
    analyzed, model = 0, None
    if args.ai:
        from .ai import curate
        analyzed, model, ai_warnings = curate(opportunities, settings, source.cache, args.max_ai)
        warnings.extend(ai_warnings)
    dates = [row["priceAsOf"] for row in opportunities]
    return {
        "schemaVersion": 1, "mode": "live", "generatedAt": datetime.now(timezone.utc).isoformat(), "marketAsOf": max(dates) if dates else None,
        "status": "partial", # Yahoo-only discovery cannot prove coverage against exchange masters.
        "universe": {"discovered": discovered, "scanned": scanned, "eligible": eligible, "failed": failed, "exchanges": list(EXCHANGES.values()), "source": "Yahoo Finance paginated equity screener via yfinance" if not args.symbols else "Explicit symbols for development smoke test", "complete": False},
        "filters": {"minPrice": settings["min_price"], "minAverageDailyValue": settings["min_average_daily_value"]},
        "ai": {"enabled": bool(args.ai), "model": model, "analyzed": analyzed}, "warnings": warnings, "opportunities": opportunities,
    }


def atomic_write(path, data):
    text = json.dumps(data, indent=2, allow_nan=False) + "\n"
    if not data.get("opportunities"):
        raise ValueError("No eligible opportunities to publish; prior output preserved")
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(text)
        temporary.replace(path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="public/data/latest.json")
    parser.add_argument("--config", default="config/defaults.json")
    parser.add_argument("--demo", action="store_true")
    parser.add_argument("--symbols", nargs="+")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--fundamental-limit", type=int)
    parser.add_argument("--ai", action="store_true")
    parser.add_argument("--max-ai", type=int, default=int(os.environ.get("AI_MAX_COMPANIES", 10)))
    parser.add_argument("--min-price", type=float)
    parser.add_argument("--min-average-daily-value", type=float)
    args = parser.parse_args(argv)
    try:
        settings = settings_from(args.config)
        if args.min_price is not None:
            settings["min_price"] = args.min_price
        if args.min_average_daily_value is not None:
            settings["min_average_daily_value"] = args.min_average_daily_value
        if settings["min_price"] < 1 or settings["min_average_daily_value"] < 0:
            raise ValueError("minPrice must be at least C$1; minAverageDailyValue must be non-negative")
        if args.limit is not None and args.limit <= 0 or args.max_ai < 0 or args.fundamental_limit is not None and args.fundamental_limit < 0:
            raise ValueError("Limits must be positive (--max-ai and --fundamental-limit may be zero)")
        if args.demo:
            from .demo import demo_scan
            data = demo_scan(settings)
        else:
            data = live_scan(args, settings)
        atomic_write(args.output, data)
        print(f"Wrote {args.output}: {len(data['opportunities'])} candidates, mode={data['mode']}, coverage={data['status']}")
        return 0
    except Exception as exc:
        print(f"Scan failed; existing output preserved. {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
