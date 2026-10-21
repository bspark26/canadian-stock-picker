from copy import deepcopy
from datetime import date, datetime, timezone
import json
import math

import pandas as pd
import pytest

from scanner import analysis
from scanner.analysis import AnalysisError, analyze_symbol, build_long_term_outlook, normalize_symbol, validate_history
from scanner.fundamentals import evaluate
from scanner.run import settings_from

NOW = datetime(2026, 10, 21, 16, tzinfo=timezone.utc)


def history(price=10.5, end="2026-10-20", count=260):
    closes = [price * (1 + math.sin(index / 10) * 0.015) for index in range(count)]
    closes[-1] = price
    openings = [closes[0]] + closes[:-1]
    return pd.DataFrame({"Open": openings, "High": [max(a, b) * 1.01 for a, b in zip(openings, closes)], "Low": [min(a, b) * 0.99 for a, b in zip(openings, closes)], "Close": closes, "Volume": [100000] * count}, index=pd.bdate_range(end=end, periods=count))


def financials():
    return {
        "info": {"longName": "Synthetic Company", "currency": "CAD", "financialCurrency": "USD", "sector": "Technology", "exchange": "TOR", "fullExchangeName": "Toronto", "quoteType": "EQUITY", "marketCap": 1_000_000_000, "revenueGrowth": 0.1, "profitMargins": 0.15, "priceToSalesTrailing12Months": 3},
        "balance": {"cash": 120_000_000, "debt": 20_000_000, "asOf": "2026-06-30"},
        "cashflow": {"operatingCashFlow": 20_000_000, "freeCashFlow": 10_000_000, "period": "12M", "asOf": "2025-12-31"},
        "income": {"revenue": 100_000_000, "period": "12M", "asOf": "2025-12-31"},
    }


class FakeSource:
    def __init__(self, frame=None, currency="CAD", payload=None):
        self.frame = history() if frame is None else frame
        self.currency = currency
        self.payload = financials() if payload is None else payload
        self.history_calls, self.financial_calls = [], []
    def history(self, symbol):
        self.history_calls.append(symbol)
        return self.frame, self.currency
    def fundamentals(self, symbol):
        self.financial_calls.append(symbol)
        return deepcopy(self.payload)


@pytest.fixture
def model_calls(monkeypatch):
    calls = []
    def capture(rows, histories, model):
        calls.append((deepcopy(rows), histories, model))
        rows[0]["tradePlan"]["probability"] = {"value": None, "status": "Insufficient evidence", "event": "Synthetic model fixture", "reason": "No fitted model needed for this test"}
    monkeypatch.setattr(analysis, "apply_probability_model", capture)
    return calls


@pytest.mark.parametrize("symbol, expected", [(" nexg.v ", "NEXG.V"), ("SHOP.TO", "SHOP.TO"), ("TEST.CN", "TEST.CN"), ("TEST.NE", "TEST.NE"), ("MSFT", "MSFT"), ("BRK-B", "BRK-B"), ("0700.HK", "0700.HK"), ("A_B", "A_B")])
def test_exact_safe_symbol_normalization(symbol, expected):
    assert normalize_symbol(symbol) == expected


@pytest.mark.parametrize("symbol", ["", "https://finance.yahoo.com/quote/MSFT", "../RY.TO", "RY.TO;pwd", "SHOP.TO MSFT", "A/B", "AA,BB", "MSFT\n", "^GSPTSE", "EURCAD=X", "ß.TO", "A" * 25])
def test_urls_expressions_lists_controls_and_non_equity_identifiers_are_rejected(symbol):
    with pytest.raises(ValueError):
        normalize_symbol(symbol)


def test_canadian_lookup_contract_keeps_native_currencies_and_existing_score(model_calls):
    source = FakeSource()
    result = analyze_symbol("test.to", settings_from(None), source, NOW)
    row = result["opportunity"]
    assert result["schemaVersion"] == 1 and result["symbol"] == "TEST.TO"
    assert result["generatedAt"] == NOW.isoformat()
    assert result["scope"] == {"market": "Toronto", "probabilitySupported": True}
    assert source.history_calls == source.financial_calls == ["TEST.TO"]
    assert len(model_calls) == 1
    assert row["currency"] == "CAD" and row["financialCurrency"] == "USD"
    assert row["fundamentals"]["cash"] == 120_000_000
    assert row["fundamentalScore"] == evaluate(source.payload, NOW.date())[1]
    assert row["analysisKind"] == "Rules" and row["optionsAvailable"] is None
    assert result["outlook"]["longTerm"]["label"] == "Positive finances"
    assert result["outlook"]["longTerm"]["priceTarget"] is None
    assert result["outlook"]["longTerm"]["probability"] is None
    assert any("USD 120,000,000" in item for item in result["outlook"]["longTerm"]["evidence"])
    json.dumps(result, allow_nan=False)


def test_explicit_lookup_retains_below_one_dollar_shares_without_model_calls(model_calls):
    result = analyze_symbol("SMALL.V", settings_from(None), FakeSource(history(0.75)), NOW)
    assert result["opportunity"]["price"] == 0.75
    assert result["scope"]["probabilitySupported"] is False
    assert result["opportunity"]["tradePlan"]["probability"]["value"] is None
    assert result["outlook"]["longTerm"]["priceTarget"] is None
    assert model_calls == []


def test_foreign_market_and_currency_are_preserved_without_a_canadian_probability(model_calls):
    payload = financials()
    payload["info"].update(exchange="NMS", fullExchangeName="Nasdaq", currency="USD")
    result = analyze_symbol("MSFT", settings_from(None), FakeSource(currency="USD", payload=payload), NOW)
    assert result["scope"] == {"market": "Nasdaq", "probabilitySupported": False}
    assert result["opportunity"]["exchange"] == "Nasdaq"
    assert result["opportunity"]["currency"] == "USD"
    assert result["opportunity"]["tradePlan"]["probability"]["value"] is None
    assert model_calls == []


def test_pence_unit_is_not_silently_changed_into_pounds(model_calls):
    payload = financials()
    payload["info"].update(exchange="LSE", fullExchangeName="London", currency="GBp", financialCurrency="GBP")
    result = analyze_symbol("TEST.L", settings_from(None), FakeSource(currency="GBp", payload=payload), NOW)
    assert result["opportunity"]["currency"] == "GBp"
    assert result["opportunity"]["financialCurrency"] == "GBP"
    assert any("GBp" in warning and "minor currency unit" in warning for warning in result["warnings"])
    assert model_calls == []


def test_unknown_quote_currency_is_a_controlled_error(model_calls):
    payload = financials()
    payload["info"].pop("currency")
    with pytest.raises(AnalysisError) as failure:
        analyze_symbol("TEST.TO", settings_from(None), FakeSource(currency=None, payload=payload), NOW)
    assert failure.value.code == "unknown_currency" and failure.value.status == 422
    assert model_calls == []


def test_exchange_conflict_cannot_enter_the_model(model_calls):
    payload = financials()
    payload["info"]["exchange"] = "NMS"
    result = analyze_symbol("TEST.TO", settings_from(None), FakeSource(payload=payload), NOW)
    assert result["scope"]["probabilitySupported"] is False
    assert result["opportunity"]["tradePlan"]["probability"]["value"] is None
    assert model_calls == []


@pytest.mark.parametrize("instrument", ["ETF", "CRYPTOCURRENCY", "INDEX", "MUTUALFUND", "CURRENCY", "FUTURE"])
def test_known_non_share_instruments_do_not_receive_a_company_outlook(model_calls, instrument):
    payload = financials()
    payload["info"]["quoteType"] = instrument
    with pytest.raises(AnalysisError) as failure:
        analyze_symbol("TEST.TO", settings_from(None), FakeSource(payload=payload), NOW)
    assert failure.value.code == "unsupported_instrument" and failure.value.status == 422
    assert model_calls == []


def test_missing_instrument_type_allows_lookup_but_never_calls_the_stock_model(model_calls):
    payload = financials()
    payload["info"].pop("quoteType")
    result = analyze_symbol("TEST.TO", settings_from(None), FakeSource(payload=payload), NOW)
    assert result["opportunity"]["currency"] == "CAD"
    assert result["opportunity"]["price"] >= 1
    assert result["scope"]["probabilitySupported"] is False
    assert result["opportunity"]["tradePlan"]["probability"]["value"] is None
    assert "not verified that this ticker is a company share" in result["opportunity"]["tradePlan"]["probability"]["reason"]
    assert any("did not identify the investment type" in warning for warning in result["warnings"])
    assert model_calls == []


@pytest.mark.parametrize("end", ["2026-10-19", "2026-10-14"])
def test_one_to_four_missing_weekdays_keeps_a_dated_plan_without_a_current_probability(model_calls, end):
    closes = [10 + math.sin(index / 8) for index in range(500)]
    openings = [closes[0]] + closes[:-1]
    frame = pd.DataFrame({"Open": openings, "High": [max(a, b) + 0.12 for a, b in zip(openings, closes)], "Low": [min(a, b) - 0.12 for a, b in zip(openings, closes)], "Close": closes, "Volume": [100000] * len(closes)}, index=pd.bdate_range(end=end, periods=len(closes)))
    result = analyze_symbol("TEST.TO", settings_from(None), FakeSource(frame), NOW)
    row = result["opportunity"]
    assert result["scope"]["probabilitySupported"] is True
    assert row["priceAsOf"] == row["tradePlan"]["asOf"] == end
    assert row["dataQuality"] == "Partial"
    assert row["tradePlan"]["status"] != "Unavailable"
    assert row["tradePlan"]["entryValidForSessions"] == 5
    assert row["tradePlan"]["probability"]["value"] is None
    assert "latest completed trading day" in row["tradePlan"]["probability"]["reason"]
    assert result["outlook"]["shortTerm"]["label"] == "Dated entry plan"
    assert end in result["outlook"]["shortTerm"]["summary"]
    assert "does not restart" in result["outlook"]["shortTerm"]["summary"]
    assert model_calls == []


def test_exactly_five_missing_weekdays_rejects_the_expired_entry_window():
    source = FakeSource(history(end="2026-10-13"))
    with pytest.raises(AnalysisError) as failure:
        analyze_symbol("TEST.TO", settings_from(None), source, NOW)
    assert failure.value.code == "stale_history"
    assert "5 weekdays" in str(failure.value)
    assert source.financial_calls == []


@pytest.mark.parametrize("problem", ["range", "future", "forming", "stale", "duplicate"])
def test_invalid_or_stale_prices_are_rejected_before_financial_lookup(problem):
    frame = history()
    if problem == "range":
        frame.loc[frame.index[-10], "Low"] = frame.loc[frame.index[-10], "High"] + 1
    elif problem == "future":
        frame = history(end="2026-10-22")
    elif problem == "forming":
        frame = history(end="2026-10-21")
    elif problem == "stale":
        frame = history(end="2026-10-01")
    else:
        frame.index = pd.DatetimeIndex([frame.index[0]] * len(frame))
    source = FakeSource(frame)
    with pytest.raises(AnalysisError) as failure:
        analyze_symbol("TEST.TO", settings_from(None), source, NOW)
    assert failure.value.code == ("stale_history" if problem == "stale" else "invalid_history")
    assert source.financial_calls == []


def test_weekend_days_do_not_count_as_missed_trading_days():
    frame = history(end="2026-10-16")
    _, warnings = validate_history(frame, datetime(2026, 10, 19, 16, tzinfo=timezone.utc))
    assert warnings == []
    _, warnings = validate_history(frame, datetime(2026, 10, 19, 23, tzinfo=timezone.utc))
    assert any("1 weekday(s)" in warning for warning in warnings)


def test_provider_exception_text_never_becomes_a_public_error():
    class Unavailable(FakeSource):
        def history(self, symbol):
            raise RuntimeError("private provider debugging information")
    with pytest.raises(AnalysisError) as failure:
        analyze_symbol("TEST.TO", settings_from(None), Unavailable(), NOW)
    assert failure.value.code == "data_unavailable" and failure.value.status == 503
    assert "private provider" not in str(failure.value)


def test_financial_outage_keeps_prices_and_returns_an_honest_insufficient_outlook(model_calls):
    class MissingFinancials(FakeSource):
        def fundamentals(self, symbol):
            raise RuntimeError("provider unavailable")
    result = analyze_symbol("TEST.TO", settings_from(None), MissingFinancials(), NOW)
    assert result["opportunity"]["price"] == 10.5
    assert result["outlook"]["longTerm"]["label"] == "Insufficient data"
    assert result["outlook"]["longTerm"]["evidence"] == []
    assert result["outlook"]["longTerm"]["probability"] is None
    assert result["scope"]["probabilitySupported"] is False
    assert result["opportunity"]["tradePlan"]["probability"]["value"] is None
    assert "not verified that this ticker is a company share" in result["opportunity"]["tradePlan"]["probability"]["reason"]
    assert model_calls == []
    assert any("financial data could not be loaded" in warning for warning in result["warnings"])


def test_cash_alone_is_not_a_positive_share_price_forecast():
    payload = {"info": {"financialCurrency": "CAD"}, "balance": {"cash": 1_000_000_000, "debt": 0, "asOf": "2026-06-30"}}
    result = build_long_term_outlook(payload, NOW.date())
    assert result["label"] == "Insufficient data"
    assert result["priceTarget"] is result["probability"] is None
    assert any("cash-flow evidence is missing" in risk for risk in result["risks"])
    assert not any("RSI" in item or "50-session" in item for item in result["evidence"])


def test_conflicting_financial_signals_and_weak_financials_have_different_labels():
    payload = financials()
    payload["info"]["revenueGrowth"] = -0.1
    assert build_long_term_outlook(payload, NOW.date())["label"] == "Mixed"
    payload["info"]["profitMargins"] = -0.2
    assert build_long_term_outlook(payload, NOW.date())["label"] == "Caution"


def test_resource_developer_revenue_absence_does_not_create_a_failure_verdict():
    payload = financials()
    payload["info"].update(sector="Basic Materials", revenueGrowth=-1, profitMargins=-1)
    payload["income"]["revenue"] = 0
    payload["cashflow"].update(operatingCashFlow=-20_000_000, freeCashFlow=-50_000_000)
    result = build_long_term_outlook(payload, NOW.date())
    assert result["label"] == "Insufficient data"
    assert any("normal before a resource project" in item for item in result["evidence"])
    assert any("construction funding" in item for item in result["risks"])
    assert result["priceTarget"] is result["probability"] is None


def test_bad_or_future_financial_dates_do_not_break_a_valid_price_lookup(model_calls):
    payload = financials()
    payload["balance"]["asOf"] = "not-a-date"
    payload["cashflow"]["asOf"] = "2030-12-31"
    payload["income"]["asOf"] = "not-a-date"
    result = analyze_symbol("TEST.TO", settings_from(None), FakeSource(payload=payload), NOW)
    assert result["opportunity"]["fundamentals"]["cash"] is None
    assert result["opportunity"]["fundamentals"]["operatingCashFlow"] is None
    assert result["outlook"]["longTerm"]["label"] == "Insufficient data"
    assert any("report date could not be verified" in warning for warning in result["warnings"])
