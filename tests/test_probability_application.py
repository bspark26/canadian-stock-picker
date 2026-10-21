"""Integration guards before a stored probability model sees scanner inputs."""
from argparse import Namespace
from datetime import date, timedelta
import math

import pandas as pd
import pytest

from scanner.run import apply_probability_model, live_scan, settings_from
from scanner.technicals import indicators
from scanner.trade_plans import build_trade_plan


def completed_history(last_close=10.5):
    closes = [10.5 + 0.2 * math.sin(index / 10) for index in range(260)]
    closes[-1] = last_close
    openings = [closes[0]] + closes[:-1]
    return pd.DataFrame({
        "Open": openings,
        "High": [max(opening, close) + 0.15 for opening, close in zip(openings, closes)],
        "Low": [min(opening, close) - 0.15 for opening, close in zip(openings, closes)],
        "Close": closes, "Volume": [100000] * len(closes),
    }, index=pd.bdate_range(end=date.today() - timedelta(days=1), periods=len(closes)))


def published_row(frame):
    price = round(float(frame["Close"].iloc[-1]), 6)
    as_of = frame.index[-1].date().isoformat()
    metrics = indicators(frame)
    # A deterministic supported range gives a real rounded entry zone of
    # C$10.10–10.50, suitable for checking published-price boundary behavior.
    metrics.update(support=10, resistance=14, atr14=1, sma50=10.5)
    return {
        "symbol": "SYNTHETIC.TO", "price": price, "priceAsOf": as_of,
        "averageDailyValue": float((frame["Close"] * frame["Volume"]).tail(20).mean()),
        "setup": "Range watch", "technicals": metrics,
        "dataQuality": "Complete", "risks": [],
        "tradePlan": build_trade_plan(price, metrics, "Range watch", as_of),
    }


@pytest.mark.parametrize("problem", ["invalid_high", "invalid_low", "nonfinite", "missing", "date_mismatch", "close_mismatch"])
def test_invalid_or_mismatched_history_replaces_an_old_probability_with_a_closed_result(problem):
    frame = completed_history()
    row = published_row(frame)
    row["tradePlan"]["probability"] = {"value": 75, "status": "Estimated", "reason": "Old saved estimate"}
    histories = {row["symbol"]: frame}
    if problem == "invalid_high":
        # Keep the final price/date intact: validating only the latest close
        # would overlook this impossible older OHLC range.
        frame.loc[frame.index[-30], "High"] = frame.loc[frame.index[-30], "Low"] - 1
    elif problem == "invalid_low":
        frame.loc[frame.index[-1], "Low"] = frame.loc[frame.index[-1], "Close"] + 1
    elif problem == "nonfinite":
        frame.loc[frame.index[-30], "Volume"] = float("nan")
    elif problem == "missing":
        histories = {}
    elif problem == "date_mismatch":
        row["priceAsOf"] = frame.index[-2].date().isoformat()
    elif problem == "close_mismatch":
        row["price"] += 0.01

    # The model need not be fitted: the real inference function must reject
    # history before model support/metadata could be considered.
    apply_probability_model([row], histories, {"status": "Validated"})
    probability = row["tradePlan"]["probability"]
    assert probability["value"] is None
    assert probability["status"] == "Insufficient evidence"
    assert "history failed validation" in probability["reason"]
    assert row["dataQuality"] == "Partial"
    assert len([risk for risk in row["risks"] if risk.startswith("Probability withheld:")]) == 1

    # Reapplying a newer artifact must not accumulate duplicate risk messages.
    apply_probability_model([row], histories, {"status": "Validated"})
    assert len([risk for risk in row["risks"] if risk.startswith("Probability withheld:")]) == 1


def test_verified_history_and_published_context_are_dispatched_to_inference(monkeypatch):
    frame = completed_history()
    row = published_row(frame)
    model = {"fixture": "dispatch only; no model fitting"}
    calls = []
    def inspect(plan, metrics, context, artifact):
        calls.append((plan, metrics, context, artifact))
        assert context["historyValid"] is True
        return {"value": 64, "status": "Estimated", "reason": "Synthetic dispatch fixture"}
    monkeypatch.setattr("scanner.probability.predict_probability", inspect)

    apply_probability_model([row], {row["symbol"]: frame}, model)
    assert len(calls) == 1
    dispatched_plan, metrics, context, artifact = calls[0]
    assert dispatched_plan is row["tradePlan"]
    assert metrics is row["technicals"]
    assert artifact is model
    assert context == {"price": row["price"], "averageDailyValue": row["averageDailyValue"], "setup": row["setup"], "historyValid": True}
    assert row["tradePlan"]["probability"]["value"] == 64
    assert row["dataQuality"] == "Complete"
    assert row["risks"] == []


@pytest.mark.parametrize("vendor_close, published_price, expected_status", [
    (10.0999996, 10.1, "Ready"),
    (10.5000004, 10.5, "Ready"),
    (10.0999994, 10.099999, "Wait"),
    (10.5000006, 10.500001, "Wait"),
])
def test_entry_status_uses_the_six_decimal_published_price_at_both_boundaries(monkeypatch, vendor_close, published_price, expected_status):
    frame = completed_history(vendor_close)
    row = published_row(frame)
    assert row["price"] == published_price
    assert row["tradePlan"]["entryLow"] == 10.1
    assert row["tradePlan"]["entryHigh"] == 10.5
    # Simulate reapplying an artifact to an older snapshot with a stale label.
    row["tradePlan"]["status"] = "Wait" if expected_status == "Ready" else "Ready"
    calls = []
    def inspect(plan, metrics, context, artifact):
        calls.append((plan["status"], context["price"], context["historyValid"]))
        return {"value": None, "status": "Insufficient evidence", "reason": "Dispatch fixture"}
    monkeypatch.setattr("scanner.probability.predict_probability", inspect)

    apply_probability_model([row], {row["symbol"]: frame}, None)
    assert calls == [(expected_status, published_price, True)]
    assert row["tradePlan"]["status"] == expected_status
    assert row["dataQuality"] == "Complete"


def test_unavailable_plan_is_not_promoted_even_when_the_history_is_valid(monkeypatch):
    frame = completed_history()
    row = published_row(frame)
    row["tradePlan"] = build_trade_plan(row["price"], row["technicals"], "Research watch", row["priceAsOf"])
    calls = []
    def inspect(plan, metrics, context, artifact):
        calls.append((plan["status"], context["historyValid"]))
        return {"value": None, "status": "Insufficient evidence", "reason": "No supported scenario"}
    monkeypatch.setattr("scanner.probability.predict_probability", inspect)
    apply_probability_model([row], {row["symbol"]: frame}, None)
    assert calls == [("Unavailable", True)]
    assert row["tradePlan"]["status"] == "Unavailable"
    assert row["tradePlan"]["probability"]["value"] is None


def test_live_scan_excludes_impossible_ohlcv_before_eligibility_ranking_and_fundamentals(tmp_path):
    valid = completed_history()
    invalid = valid.copy()
    # Price, date and liquidity qualify normally, but an older impossible range
    # must prevent this row from receiving a score or entering the shortlist.
    invalid.loc[invalid.index[-30], "High"] = invalid.loc[invalid.index[-30], "Low"] - 1
    class FakeSource:
        def __init__(self):
            self.fundamental_calls = []
        def universe(self):
            return [{"symbol": "INVALID.TO"}, {"symbol": "VALID.TO"}], []
        def history(self, symbol):
            return (valid if symbol == "VALID.TO" else invalid), "CAD"
        def fundamentals(self, symbol):
            self.fundamental_calls.append(symbol)
            return {}
    source = FakeSource()
    args = Namespace(symbols=None, limit=None, fundamental_limit=None, ai=False, max_ai=0)
    settings = settings_from(None)
    # No stored model or live data source is needed for this scanner boundary.
    settings["probability_model"] = str(tmp_path / "absent-model.json")

    result = live_scan(args, settings, source)

    assert [row["symbol"] for row in result["opportunities"]] == ["VALID.TO"]
    assert result["universe"]["discovered"] == result["universe"]["scanned"] == 2
    assert result["universe"]["eligible"] == 1
    assert source.fundamental_calls == ["VALID.TO"]
    assert "Excluded 1 listings with invalid completed daily OHLCV histories; no technical scores or entry scenarios were published for them." in result["warnings"]
