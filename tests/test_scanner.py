from argparse import Namespace
from datetime import date, datetime, timedelta
import json

import pandas as pd
import pytest

from scanner.fundamentals import evaluate
from scanner.run import atomic_write, live_scan, settings_from
from scanner.ai import curate
from scanner.technicals import indicators, technical_score
from scanner.yahoo import SourceError, expected_completed_session
import requests


def bars(price=5, periods=240):
    return pd.DataFrame({"Open": [price] * periods, "High": [price * 1.02] * periods, "Low": [price * 0.98] * periods, "Close": [price] * periods, "Volume": [100] * periods}, index=pd.bdate_range(end=date.today() - timedelta(days=1), periods=periods))


def payload(**kwargs):
    result = {"info": {"sector": "Technology", "financialCurrency": "USD", "revenueGrowth": 0.1, "profitMargins": 0.15}, "balance": {"cash": 120, "debt": 20, "asOf": "2026-06-30"}, "cashflow": {"operatingCashFlow": -60, "freeCashFlow": -70, "asOf": "2025-12-31", "period": "12M"}, "income": {"revenue": 80, "asOf": "2025-12-31"}}
    result.update(kwargs)
    return result


def test_flat_prices_have_neutral_momentum_and_no_fabricated_volume_ratio():
    frame = bars()
    frame["Volume"] = 0
    metrics = indicators(frame)
    assert metrics["rsi14"] == 50
    assert metrics["return20d"] == 0
    assert metrics["relativeVolume"] is None
    assert metrics["support"] <= 5 <= metrics["resistance"]
    assert 0 <= technical_score(5, metrics, len(frame)) <= 100


def test_short_history_does_not_receive_trend_score():
    frame = bars(periods=25)
    metrics = indicators(frame)
    assert metrics["sma50"] is None
    assert metrics["sma200"] is None
    assert technical_score(5, metrics, len(frame)) is None


def test_missing_financials_are_not_zero_or_a_perfect_score():
    metrics, score, _, _, as_of, currency = evaluate({"info": {"revenueGrowth": 0.5}}, date(2026, 10, 21))
    assert metrics["cash"] is None
    assert metrics["debt"] is None
    assert metrics["revenueGrowth"] == 50
    assert score is None and as_of is None and currency is None


def test_runway_uses_annual_operating_burn_and_preserves_reporting_currency():
    metrics, _, reasons, risks, as_of, currency = evaluate(payload(), date(2026, 10, 21))
    assert metrics["cashRunwayMonths"] == 24
    assert metrics["revenueGrowth"] == 10
    assert metrics["profitMargin"] == 15
    assert currency == "USD" and as_of == "2025-12-31"
    assert any("construction" in risk for risk in risks)
    quarterly = payload(cashflow={"operatingCashFlow": -60, "asOf": "2026-06-30", "period": "3M"})
    assert evaluate(quarterly, date(2026, 10, 21))[0]["cashRunwayMonths"] is None
    assert evaluate(quarterly, date(2026, 10, 21))[0]["operatingCashFlow"] is None


def test_prerevenue_resource_does_not_get_revenue_failure_penalty():
    first = payload(info={"sector": "Basic Materials", "financialCurrency": "CAD", "revenueGrowth": -1, "profitMargins": -1}, income={"revenue": 0, "asOf": "2025-12-31"})
    second = payload(info={"sector": "Basic Materials", "financialCurrency": "CAD", "revenueGrowth": 1, "profitMargins": 1}, income={"revenue": 0, "asOf": "2025-12-31"})
    left, right = evaluate(first, date(2026, 10, 21)), evaluate(second, date(2026, 10, 21))
    assert left[1] == right[1] is None
    assert any("current development/production status" in reason for reason in left[2])


def test_total_liabilities_are_never_substituted_for_debt():
    item = payload(balance={"cash": 120, "totalLiabilities": 900, "accumulatedDeficit": -700, "asOf": "2026-06-30"})
    assert evaluate(item, date(2026, 10, 21))[0]["debt"] is None


class FakeSource:
    def universe(self):
        return [{"symbol": "LOW.TO"}, {"symbol": "THIN.TO"}, {"symbol": "FAIL.TO"}], ["Test partial universe"]
    def history(self, symbol):
        if symbol == "FAIL.TO":
            raise SourceError("unavailable")
        return bars(0.99 if symbol == "LOW.TO" else 1.01), "CAD"
    def fundamentals(self, symbol):
        return {}


def args(**kwargs):
    values = {"symbols": None, "limit": None, "fundamental_limit": None, "ai": False, "max_ai": 0}
    values.update(kwargs)
    return Namespace(**values)


def test_price_filter_keeps_above_one_even_when_thin_and_tracks_failures():
    settings = settings_from(None)
    result = live_scan(args(), settings, FakeSource())
    assert [row["symbol"] for row in result["opportunities"]] == ["THIN.TO"]
    assert result["filters"]["minAverageDailyValue"] == 0
    assert result["universe"] == {"discovered": 3, "scanned": 2, "eligible": 1, "failed": 1, "exchanges": ["TSX", "TSXV", "CSE", "Cboe Canada"], "source": "Yahoo Finance paginated equity screener via yfinance", "complete": False}
    assert result["opportunities"][0]["optionsAvailable"] is None
    assert any("liquidity" in risk for risk in result["opportunities"][0]["risks"])


def test_all_unavailable_fails_and_atomic_write_rejects_nonfinite(tmp_path):
    class Broken(FakeSource):
        def history(self, symbol):
            raise SourceError("outage")
    with pytest.raises(SourceError):
        live_scan(args(), settings_from(None), Broken())
    path = tmp_path / "latest.json"
    path.write_text('{"last":"good"}')
    with pytest.raises(ValueError):
        atomic_write(path, {"bad": float("nan")})
    assert json.loads(path.read_text()) == {"last": "good"}


def test_development_limit_cannot_claim_full_coverage():
    result = live_scan(args(limit=1), settings_from(None), FakeSource())
    assert result["universe"]["discovered"] == 3
    assert result["universe"]["scanned"] == 1
    assert result["universe"]["complete"] is False
    assert result["status"] == "partial"
    assert any("--limit" in item for item in result["warnings"])


@pytest.mark.parametrize("end", [date.today() - timedelta(days=14), date.today() + timedelta(days=1)])
def test_stale_or_future_quotes_cannot_be_ranked_as_active_candidates(end):
    class BadDate(FakeSource):
        def history(self, symbol):
            frame = bars(5)
            frame.index = pd.date_range(end=end, periods=len(frame))
            return frame, "CAD"
    result = live_scan(args(), settings_from(None), BadDate())
    assert result["opportunities"] == []
    assert result["universe"]["eligible"] == 0
    assert any("stale" in warning for warning in result["warnings"])


def test_ai_timeout_still_reserves_attempted_request_budget(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-placeholder")
    monkeypatch.delenv("AI_MAX_SPEND_USD", raising=False)
    settings = settings_from(None)
    settings.update(ai_input_usd_per_million=0, ai_output_usd_per_million=10, ai_max_output_tokens=1000, ai_max_spend_usd=0.015)
    row = live_scan(args(), settings, FakeSource())["opportunities"][0]
    calls = []
    def timeout(*args, **kwargs):
        calls.append(kwargs)
        raise requests.Timeout("server may already have accepted")
    class EmptyCache:
        def get(self, *args):
            return None
    monkeypatch.setattr(requests, "post", timeout)
    analyzed, _, warnings = curate([row, row.copy()], settings, EmptyCache(), 2)
    assert analyzed == 0
    assert len(calls) == 1
    assert any("spend limit" in warning for warning in warnings)


def test_history_cache_rolls_when_a_new_completed_weekday_session_becomes_due():
    assert expected_completed_session(datetime(2026, 10, 21, 10)) == "2026-10-20"
    assert expected_completed_session(datetime(2026, 10, 21, 16, 19)) == "2026-10-20"
    assert expected_completed_session(datetime(2026, 10, 21, 16, 20)) == "2026-10-21"
    assert expected_completed_session(datetime(2026, 10, 24, 18)) == "2026-10-23"
