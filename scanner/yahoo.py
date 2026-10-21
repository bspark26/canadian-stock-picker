"""Yahoo access via yfinance; no claims of exchange-master completeness or SLA."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf

from .technicals import number

EXCHANGES = {"TOR": "TSX", "VAN": "TSXV", "CNQ": "CSE", "NEO": "Cboe Canada"}
SUFFIXES = {"TO": "TSX", "V": "TSXV", "CN": "CSE", "NE": "Cboe Canada"}


def expected_completed_session(now=None):
    """Weekday cache boundary, not an exchange holiday calendar or inferred price date."""
    now = now or datetime.now(ZoneInfo("America/Toronto"))
    day = now.date()
    if (now.hour, now.minute) < (16, 20):
        day -= timedelta(days=1)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day.isoformat()


class SourceError(RuntimeError):
    pass


class Cache:
    def __init__(self, root=".cache/scanner"):
        self.root = Path(root)

    def path(self, category, key):
        digest = hashlib.sha256(key.encode()).hexdigest()[:24]
        return self.root / category / f"{digest}.json"

    def get(self, category, key, hours):
        path = self.path(category, key)
        try:
            if time.time() - path.stat().st_mtime > hours * 3600:
                return None
            return json.loads(path.read_text())
        except (OSError, ValueError):
            return None

    def put(self, category, key, value):
        path = self.path(category, key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(f".{os.getpid()}.tmp")
        temporary.write_text(json.dumps(value, allow_nan=False))
        temporary.replace(path)


class YahooSource:
    def __init__(self, settings: dict, cache: Cache | None = None):
        self.settings = settings
        self.cache = cache or Cache()
        self.last_request = 0.0

    def pause(self):
        remaining = self.settings["request_pause_seconds"] - (time.monotonic() - self.last_request)
        if remaining > 0:
            time.sleep(remaining)
        self.last_request = time.monotonic()

    def universe(self):
        quotes, warnings, totals = {}, [], {}
        for code, exchange in EXCHANGES.items():
            key = f"equity-universe-v2-{code}"
            cached = self.cache.get("universe", key, self.settings["universe_cache_hours"])
            if cached:
                result = cached
            else:
                found, expected, complete = {}, None, False
                try:
                    for page in range(self.settings["max_pages_per_exchange"]):
                        self.pause()
                        response = yf.screen(yf.EquityQuery("eq", ["exchange", code]), size=self.settings["page_size"], offset=page * self.settings["page_size"], sortField="ticker", sortAsc=True)
                        if not isinstance(response, dict) or not isinstance(response.get("quotes"), list):
                            raise SourceError("Invalid screener response")
                        if expected is None:
                            expected = int(response.get("total", -1))
                        batch = response["quotes"]
                        previous = len(found)
                        for quote in batch:
                            if quote.get("symbol") and quote.get("quoteType") == "EQUITY" and quote.get("exchange") == code:
                                found[quote["symbol"]] = quote
                        if expected >= 0 and len(found) >= expected:
                            complete = True
                            break
                        if not batch or len(found) == previous:
                            break
                    result = {"quotes": list(found.values()), "total": expected, "complete": complete}
                    if complete and expected and found:
                        self.cache.put("universe", key, result)
                except Exception as exc:
                    result = {"quotes": list(found.values()), "total": expected, "complete": False}
                    warnings.append(f"{exchange} discovery failed: {type(exc).__name__}.")
            totals[exchange] = {"reported": result["total"], "discovered": len(result["quotes"]), "paginated": result["complete"]}
            if not result["complete"]:
                warnings.append(f"{exchange}: discovered {len(result['quotes'])} of Yahoo-reported {result['total']}; pagination incomplete.")
            for quote in result["quotes"]:
                quote["scannerExchange"] = exchange
                quotes[quote["symbol"]] = quote
        if not quotes:
            raise SourceError("Yahoo returned no valid Canadian equity universe; prior output preserved.")
        warnings.append("Yahoo exchange totals (not reconciled to exchange issuer directories): " + "; ".join(f"{name} {values['discovered']}/{values['reported']}" for name, values in totals.items()) + ".")
        warnings.append("Coverage is unverified against official exchange directories; Yahoo may omit listings or retain stale/ineligible securities.")
        return list(quotes.values()), warnings

    def history(self, symbol: str):
        key = f"v2-{symbol}-{self.settings['history_period']}"
        expected_session = expected_completed_session()
        cached = self.cache.get("history", key, self.settings["history_cache_hours"])
        if cached and cached.get("expectedSession") == expected_session:
            frame = pd.DataFrame(cached["bars"])
            frame.index = pd.to_datetime(frame.pop("date"))
            return frame, cached.get("currency")
        self.pause()
        ticker = yf.Ticker(symbol)
        frame = ticker.history(period=self.settings["history_period"], interval="1d", auto_adjust=False, actions=False, repair=False, raise_errors=True, timeout=20)
        if frame.empty:
            raise SourceError(f"No daily history for {symbol}")
        if frame.index.tz is not None:
            frame.index = frame.index.tz_localize(None)
        local_now = datetime.now(ZoneInfo("America/Toronto"))
        # A currently forming daily candle must not become an EOD recommendation.
        last_allowed = local_now.date()
        if local_now.hour < 16 or (local_now.hour == 16 and local_now.minute < 20):
            frame = frame[frame.index.date < last_allowed]
        else:
            frame = frame[frame.index.date <= last_allowed]
        frame = frame[["Open", "High", "Low", "Close", "Volume"]].apply(pd.to_numeric, errors="coerce").dropna()
        frame = frame[(frame["Close"] > 0) & (frame["High"] >= frame["Low"]) & (frame["Volume"] >= 0)]
        frame = frame[~frame.index.duplicated(keep="last")].sort_index()
        if frame.empty:
            raise SourceError(f"No completed valid bars for {symbol}")
        metadata = ticker.history_metadata or {}
        currency = metadata.get("currency")
        bars = [{"date": index.date().isoformat(), **{key: number(row[key]) for key in ("Open", "High", "Low", "Close", "Volume")}} for index, row in frame.iterrows()]
        self.cache.put("history", key, {"bars": bars, "currency": currency, "expectedSession": expected_session})
        return frame, currency

    def fundamentals(self, symbol: str):
        cached = self.cache.get("fundamentals", f"v2-{symbol}", self.settings["fundamentals_cache_days"] * 24)
        if cached:
            return cached
        self.pause()
        ticker = yf.Ticker(symbol)
        info = ticker.get_info() or {}
        balance = ticker.get_balance_sheet(freq="quarterly")
        if balance.empty:
            balance = ticker.get_balance_sheet(freq="yearly")
        flow = ticker.get_cashflow(freq="yearly")
        income = ticker.get_income_stmt(freq="yearly")
        def statement(frame, rows, period=None):
            if frame.empty:
                return {}
            frame = frame.reindex(sorted(frame.columns, reverse=True), axis=1)
            column = frame.columns[0]
            output = {"asOf": pd.Timestamp(column).date().isoformat()}
            if period:
                output["period"] = period
            for name, candidates in rows.items():
                output[name] = next((number(frame.loc[candidate, column]) for candidate in candidates if candidate in frame.index and number(frame.loc[candidate, column]) is not None), None)
            return output
        result = {
            "info": {key: info.get(key) for key in ("longName", "shortName", "sector", "industry", "financialCurrency", "currency", "marketCap", "revenueGrowth", "profitMargins", "priceToSalesTrailing12Months")},
            "balance": statement(balance, {"cash": ["CashCashEquivalentsAndShortTermInvestments", "CashAndCashEquivalents"], "debt": ["TotalDebt"]}),
            "cashflow": statement(flow, {"operatingCashFlow": ["OperatingCashFlow"], "freeCashFlow": ["FreeCashFlow"]}, "12M"),
            "income": statement(income, {"revenue": ["TotalRevenue"]}, "12M"),
        }
        if not info and not result["balance"] and not result["cashflow"]:
            raise SourceError(f"No fundamental evidence for {symbol}")
        self.cache.put("fundamentals", f"v2-{symbol}", result)
        return result
