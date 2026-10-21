"""Cached single-symbol analysis. Production fails closed if cost controls fail."""
from __future__ import annotations

import os

from .storage import DynamoCache, LimitReached


class RequestError(RuntimeError):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message
        super().__init__(message)


def analyze(symbol, store=None):
    from scanner.analysis import AnalysisError, analyze_symbol, normalize_symbol
    from scanner.run import settings_from
    from scanner.yahoo import YahooSource
    import yfinance as yf

    try:
        symbol = normalize_symbol(symbol)
    except ValueError:
        raise RequestError(400, "invalid_symbol", "Enter one exact stock symbol, such as LSPD.TO or NEXG.V.") from None
    table = os.environ.get("CACHE_TABLE")
    if store is None and not table:
        raise RequestError(503, "not_configured", "Stock analysis is not connected yet.")
    store = store or DynamoCache(table, release=os.environ.get("CACHE_RELEASE", "v1"))
    if table:
        yf.set_tz_cache_location("/tmp/yfinance")
    # The history cache checks the completed-session boundary as well. Include
    # it here so a report from before today's close cannot hide the new close.
    from scanner.yahoo import expected_completed_session
    report_key = f"{symbol}:{expected_completed_session()}"
    cached = store.get("analysis", report_key, 1)
    if cached is not None:
        return cached
    if not store.claim(symbol):
        raise RequestError(409, "in_progress", "This stock is already being checked. Try again in a minute.")
    try:
        # Recheck after obtaining the lock in case a previous caller just finished.
        cached = store.get("analysis", report_key, 1)
        if cached is not None:
            return cached
        limit = max(1, min(100, int(os.environ.get("DAILY_ANALYSIS_LIMIT", "30"))))
        try:
            store.reserve_download(limit)
        except LimitReached:
            raise RequestError(429, "daily_limit", "Today's new-stock limit has been reached. Saved results still work; try again tomorrow.") from None
        settings = settings_from(None)
        settings.update(history_cache_hours=1, fundamentals_cache_days=3)
        source = YahooSource(settings, cache=store)
        try:
            report = analyze_symbol(symbol, settings, source=source)
        except AnalysisError as error:
            messages = {
                "invalid_history": "The available daily prices could not be verified. Analysis is withheld.",
                "stale_history": "The available prices are too old for a current analysis. Try again when newer data is available.",
                "unknown_currency": "The trading currency could not be verified. Analysis is withheld.",
                "data_unavailable": "Yahoo could not supply daily prices. Check the exact symbol and try again later.",
                "unsupported_instrument": "This lookup supports company shares. The supplied symbol is a different kind of investment.",
            }
            if error.code not in messages:
                raise
            raise RequestError(error.status, error.code, messages[error.code]) from None
        store.put("analysis", report_key, report)
        return report
    finally:
        store.release_claim(symbol)
