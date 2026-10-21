"""Deterministic, exact-symbol analysis. No paid AI or broad-market filtering."""
from __future__ import annotations

import argparse
from datetime import date, datetime, time, timedelta, timezone
import json
from pathlib import Path
import re
import tempfile
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from .fundamentals import evaluate
from .run import ROOT, apply_probability_model, opportunity, settings_from
from .technicals import number
from .trade_plans import EVENT
from .yahoo import EXCHANGES, SUFFIXES, SourceError, YahooSource, expected_completed_session

SYMBOL_PATTERN = re.compile(r"[A-Z0-9][A-Z0-9._-]{0,23}\Z")


class AnalysisError(SourceError):
    """A controlled public error; provider exception text must never be exposed."""
    def __init__(self, code, message, status=422):
        super().__init__(message)
        self.code = code
        self.status = status


def normalize_symbol(symbol):
    """Accept one exact Yahoo identifier, never a URL, expression or symbol list."""
    if not isinstance(symbol, str) or not symbol.isascii() or any(ord(char) < 32 or ord(char) == 127 for char in symbol):
        raise ValueError("Enter one exact stock ticker, such as LSPD.TO or NEXG.V.")
    symbol = symbol.strip().upper()
    if not SYMBOL_PATTERN.fullmatch(symbol):
        raise ValueError("Enter one exact Yahoo ticker using letters, numbers, dots or hyphens.")
    return symbol


def _now(now=None):
    if now is None:
        return datetime.now(timezone.utc)
    if isinstance(now, datetime):
        return now.replace(tzinfo=timezone.utc) if now.tzinfo is None else now.astimezone(timezone.utc)
    if isinstance(now, date):
        return datetime.combine(now, time(23, 59), timezone.utc)
    raise ValueError("now must be a date or datetime")


def validate_history(frame, now=None):
    """Return a validated copy plus freshness warnings; never silently drop bad bars."""
    timestamp = _now(now)
    columns = ["Open", "High", "Low", "Close", "Volume"]
    if not isinstance(frame, pd.DataFrame) or any(column not in frame for column in columns) or len(frame) < 2:
        raise AnalysisError("invalid_history", "At least two completed daily prices with valid price ranges and volume are required.")
    try:
        if pd.api.types.is_numeric_dtype(frame.index.dtype):
            raise ValueError("Undated prices")
        values = frame.loc[:, columns].astype(float).copy()
        values.index = pd.DatetimeIndex(frame.index)
        if values.index.tz is not None:
            values.index = values.index.tz_localize(None)
        values.index = values.index.normalize()
    except (TypeError, ValueError):
        raise AnalysisError("invalid_history", "Daily price dates or values could not be verified.") from None
    if values.index.hasnans or values.index.has_duplicates or not values.index.is_monotonic_increasing or not np.isfinite(values.to_numpy()).all():
        raise AnalysisError("invalid_history", "Daily prices contain missing values, duplicate dates or dates in the wrong order.")
    if (values[["Open", "High", "Low", "Close"]] <= 0).any().any() or (values["Volume"] < 0).any():
        raise AnalysisError("invalid_history", "Daily price or volume values are invalid.")
    if (values["High"] < values[["Open", "Close", "Low"]].max(axis=1)).any() or (values["Low"] > values[["Open", "Close", "High"]].min(axis=1)).any():
        raise AnalysisError("invalid_history", "Daily opening, high, low and closing prices do not form valid ranges.")
    expected = date.fromisoformat(expected_completed_session(timestamp.astimezone(ZoneInfo("America/Toronto"))))
    latest = values.index[-1].date()
    if latest > expected:
        raise AnalysisError("invalid_history", "The latest price is dated in the future or its trading day is not yet complete.")
    lag = int(np.busday_count(latest + timedelta(days=1), expected + timedelta(days=1)))
    if lag >= 5:
        raise AnalysisError("stale_history", f"The latest price is {lag} weekdays old. Current analysis is withheld until newer prices are available.")
    warnings = []
    if lag:
        warnings.append(f"The latest price is {lag} weekday(s) behind the expected trading day. Exchange holidays may explain part of this gap.")
    return values, warnings


def _money(value, currency):
    if value is None:
        return "unavailable"
    return f"{currency or 'reporting currency unknown'} {value:,.0f}"


def build_long_term_outlook(payload, today=None):
    """Financial direction only: no technical snippets or numerical share-price forecast."""
    today = today or date.today()
    metrics, _, _, financial_risks, as_of, currency = evaluate(payload, today)
    info, income = payload.get("info", {}), payload.get("income", {})
    sector = info.get("sector")
    revenue = number(income.get("revenue"))
    prerevenue = sector == "Basic Materials" and revenue is not None and revenue <= 0
    specialist = sector in ("Financial Services", "Real Estate")
    evidence, risks, signals = [], list(financial_risks), []
    growth, margin, cash, debt, operating, free = (metrics[key] for key in ("revenueGrowth", "profitMargin", "cash", "debt", "operatingCashFlow", "freeCashFlow"))
    if cash is not None or debt is not None:
        evidence.append(f"Reported cash: {_money(cash, currency)}. Interest-bearing debt: {_money(debt, currency)}.")
    if growth is not None and not prerevenue:
        evidence.append(f"Reported revenue growth: {growth:+.1f}%.")
    if margin is not None and not prerevenue:
        evidence.append(f"Reported profit margin: {margin:.1f}%.")
    if operating is not None or free is not None:
        evidence.append(f"Annual operating cash flow: {_money(operating, currency)}. Annual free cash flow: {_money(free, currency)}.")
    runway = metrics["cashRunwayMonths"]
    if runway is not None:
        evidence.append(f"At the past rate of cash used to run the business, reported cash covers about {runway:g} months. This excludes major projects and loan repayments.")
    if prerevenue:
        evidence.append("The annual statement used here shows no revenue. That can be normal before a resource project starts producing.")
        risks.append("Current project economics, permits, construction funding and production milestones are needed for a longer-term view.")
    if not specialist and not prerevenue:
        if growth is not None:
            signals.append(1 if growth > 0 else -1 if growth < 0 else 0)
        if margin is not None:
            signals.append(1 if margin > 0 else -1 if margin < 0 else 0)
        cash_generation = [1 if value > 0 else -1 if value < 0 else 0 for value in (operating, free) if value is not None]
        if cash_generation:
            total = sum(cash_generation)
            signals.append(1 if total > 0 else -1 if total < 0 else 0)
        if currency and cash is not None and debt is not None:
            # A cash buffer helps the business, but debt exceeding cash is not
            # automatically distress and never implies a share-price direction.
            signals.append(1 if cash > debt else 0)
    current = as_of is not None and 0 <= (today - date.fromisoformat(as_of)).days <= 450
    if len(signals) < 3 or not current or not currency:
        label = "Insufficient data"
        summary = "The available financial information is not enough for a six-to-twelve-month business outlook. Review the latest company reports and the missing evidence below."
    elif sum(value < 0 for value in signals) >= 2:
        label = "Caution"
        summary = "Several reported financial signals are weak. Review profitability, cash use and funding before relying on a longer-term investment case."
    elif sum(value > 0 for value in signals) >= 3 and not any(value < 0 for value in signals):
        label = "Positive finances"
        summary = "The available financial signals are mostly positive and support a firmer business outlook. These figures alone do not establish whether the share price will rise."
    else:
        label = "Mixed"
        summary = "The reported financial signals point in different directions. More company-specific evidence is needed to judge the longer-term investment case."
    if not current:
        risks.append("Recent, dated financial reports are needed; missing or outdated figures cannot support a current outlook.")
    if not currency:
        risks.append("The financial reporting currency needs verification; amounts have not been converted or compared with the share price.")
    if not specialist and not prerevenue:
        if cash is None or debt is None:
            risks.append("Cash or debt figures are missing, so the funding position cannot be fully checked.")
        if growth is None:
            risks.append("Revenue growth is missing.")
        if margin is None:
            risks.append("Profit margin is missing.")
        if operating is None and free is None:
            risks.append("Dated annual cash-flow evidence is missing.")
    risks.append("Valuation, future demand and current company developments still need review. Financial balances alone do not predict the future share price.")
    return {"horizon": "6–12 months", "label": label, "summary": summary, "evidence": evidence, "risks": list(dict.fromkeys(risks)), "priceTarget": None, "probability": None}


def build_short_term_outlook(row, lag=0):
    plan = row["tradePlan"]
    dated = f"This plan uses the {row['priceAsOf']} closing price. The five-trading-day entry window starts after that date and does not restart when you open this analysis. " if lag else ""
    if plan["status"] == "Unavailable":
        return {"horizon": "20 trading days after entry", "label": "No clear entry", "summary": dated + plan["explanation"]}
    near = plan["status"] == "Ready"
    currency = row["currency"]
    timing = "The last closing price is inside the suggested buy range." if near else "The last closing price is outside the suggested buy range; wait for the stated entry conditions."
    window = "uses that original five-trading-day window" if lag else "is valid for five trading days"
    summary = f"{dated}{timing} A buy-limit order at {currency} {plan['referenceEntry']:.2f} {window}. If it fills, the target is {currency} {plan['target']:.2f}, before a {currency} {plan['invalidation']:.2f} stop level, within 20 trading days. These are conditional levels before trading costs; gaps can cause a worse exit price."
    return {"horizon": "20 trading days after entry", "label": "Dated entry plan" if lag else "Near buy range" if near else "Wait for entry", "summary": summary}


def _financial_payload(payload, today):
    """Keep bad financial dates from breaking an otherwise valid price lookup."""
    warnings = []
    if not isinstance(payload, dict):
        return {}, ["Company financial data was unavailable; price analysis is still shown."]
    info = payload.get("info")
    output = {"info": dict(info) if isinstance(info, dict) else {}}
    for key in ("balance", "cashflow", "income"):
        statement = payload.get(key)
        if not isinstance(statement, dict):
            continue
        value = statement.get("asOf")
        try:
            report_date = date.fromisoformat(value) if isinstance(value, str) else None
        except ValueError:
            report_date = None
        if report_date is None or report_date > today:
            if statement:
                warnings.append(f"The {key} report date could not be verified; those figures are omitted.")
            continue
        output[key] = dict(statement)
    return output, warnings


def analyze_symbol(symbol, settings, source=None, now=None):
    symbol = normalize_symbol(symbol)
    timestamp = _now(now)
    source = source or YahooSource(settings)
    try:
        supplied, quoted_currency = source.history(symbol)
    except Exception as exc:
        raise AnalysisError("data_unavailable", f"Daily prices could not be loaded for {symbol}.", 503) from exc
    frame, warnings = validate_history(supplied, timestamp)
    expected = date.fromisoformat(expected_completed_session(timestamp.astimezone(ZoneInfo("America/Toronto"))))
    price_lag = int(np.busday_count(frame.index[-1].date() + timedelta(days=1), expected + timedelta(days=1)))
    try:
        supplied_financials = source.fundamentals(symbol)
    except Exception:
        supplied_financials = {}
        warnings.append("Company financial data could not be loaded. The lookup still includes the available daily prices.")
    payload, date_warnings = _financial_payload(supplied_financials, timestamp.date())
    warnings.extend(date_warnings)
    info = payload.get("info", {})
    instrument_type = info.get("quoteType")
    if instrument_type and instrument_type != "EQUITY":
        raise AnalysisError("unsupported_instrument", "This lookup supports company shares. The provider identifies this ticker as a different type of investment.")
    if not instrument_type:
        warnings.append("The data provider did not identify the investment type. Verify that this ticker is a company share before relying on the financial outlook.")
    currency = quoted_currency or info.get("currency")
    if not isinstance(currency, str) or not re.fullmatch(r"[A-Za-z]{3}", currency):
        raise AnalysisError("unknown_currency", "The trading currency could not be verified. Analysis is withheld rather than assuming CAD.")
    suffix_market = SUFFIXES.get(symbol.rsplit(".", 1)[-1]) if "." in symbol else None
    provider_exchange = info.get("exchange")
    provider_market = info.get("fullExchangeName") or provider_exchange or info.get("market")
    market = str(provider_market or suffix_market or "Exchange not verified")
    snapshot = {"scannerExchange": market}
    row = opportunity(symbol, snapshot, frame, currency, payload, today=timestamp.date())
    price = row["price"]
    exchange_consistent = not provider_exchange or EXCHANGES.get(provider_exchange) == suffix_market
    equity = instrument_type == "EQUITY"
    supported = bool(suffix_market and currency == "CAD" and price >= 1 and exchange_consistent and equity)
    if supported and price_lag == 0:
        model_path = ROOT / settings.get("probability_model", "models/probability.json")
        try:
            model = json.loads(model_path.read_text())
        except (OSError, ValueError):
            model = None
        apply_probability_model([row], {symbol: frame}, model)
    else:
        if not equity:
            reason = "The provider has not verified that this ticker is a company share. The lookup is available, but the stock probability model is withheld."
        elif supported and price_lag:
            reason = "A current chance estimate needs the latest completed trading day's price. These older prices do not support a fresh probability."
        else:
            reason = "The probability model only covers supported Canadian CAD-traded shares priced at C$1 or more. This lookup is still available, but no probability is supplied."
        row["tradePlan"]["probability"] = {"value": None, "status": "Insufficient evidence", "event": EVENT, "reason": reason}
        warnings.append(reason)
    if price_lag:
        row["dataQuality"] = "Partial"
        dated_warning = f"The entry levels use the {row['priceAsOf']} close. The original five-trading-day entry window has not restarted; get updated prices before using the plan."
        row["risks"].append(dated_warning)
        warnings.append(dated_warning)
    if price < 1 and row["tradePlan"]["status"] == "Unavailable":
        row["tradePlan"]["explanation"] = "This lookup includes prices below 1. The current entry-plan rules do not provide a short-term target at this price."
    if not provider_market and not suffix_market:
        warnings.append("The exact exchange was not supplied by the data provider; no exchange or country has been guessed.")
    if suffix_market and not exchange_consistent:
        warnings.append("The exchange information does not match this Canadian ticker suffix. Verify the listing before using it.")
    if currency in ("GBp", "ZAc"):
        warnings.append(f"Prices use {currency}, the provider's minor currency unit; they have not been converted into pounds or rand.")
    warnings.append("This is one exact-symbol lookup using saved or newly fetched daily data. It does not run or replace the whole-market scan, and uses no paid AI.")
    return {
        "schemaVersion": 1, "symbol": symbol, "generatedAt": timestamp.isoformat(),
        "scope": {"market": market, "probabilitySupported": supported}, "opportunity": row,
        "outlook": {"shortTerm": build_short_term_outlook(row, price_lag), "longTerm": build_long_term_outlook(payload, timestamp.date())},
        "warnings": list(dict.fromkeys(warnings)),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--config", default="config/defaults.json")
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    data = analyze_symbol(args.symbol, settings_from(args.config))
    serialized = json.dumps(data, indent=2, allow_nan=False) + "\n"
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", dir=destination.parent, prefix=f".{destination.name}.", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(serialized)
        temporary.replace(destination)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
