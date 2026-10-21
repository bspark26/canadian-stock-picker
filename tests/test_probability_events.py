from copy import deepcopy
import importlib
import math

import numpy as np
import pandas as pd
import pytest

from scanner import probability_events as events_module
from scanner.probability_events import historical_events, _causal_technicals
from scanner.technicals import indicators


def frame(count=250):
    return pd.DataFrame({"Open": [10.5] * count, "High": [10.7] * count, "Low": [10.2] * count, "Close": [10.5] * count, "Volume": [10000] * count}, index=pd.bdate_range("2015-01-01", periods=count))


def set_bar(values, index, opening, high, low, close):
    values.loc[values.index[index], ["Open", "High", "Low", "Close"]] = [opening, high, low, close]


def plan(entry=10):
    return {"status": "Ready", "referenceEntry": entry, "target": 12, "invalidation": 8, "rewardRisk": 2, "horizonSessions": 20, "entryValidForSessions": 5}


def only_signal(monkeypatch, values, signal=199):
    date = values.index[signal].date().isoformat()
    monkeypatch.setattr(events_module, "build_trade_plan", lambda price, metrics, setup, as_of: plan() if as_of == date else {"status": "Unavailable"})


@pytest.fixture
def feature_calls(monkeypatch):
    shared = importlib.import_module("scanner.probability")
    calls = []
    def capture(plan, metrics, context):
        calls.append(deepcopy((plan, metrics, context)))
        return {"capturedSignalPrice": context["price"], "capturedRsi": metrics["rsi14"]}
    monkeypatch.setattr(shared, "build_features", capture)
    return calls


def test_vectorized_features_match_existing_prefix_indicators_over_ten_years():
    rng = np.random.default_rng(42)
    closes = 10 * np.exp(np.cumsum(rng.normal(0, 0.01, 2520)))
    openings = np.r_[closes[0], closes[:-1]]
    values = pd.DataFrame({"Open": openings, "High": np.maximum(openings, closes) * 1.01, "Low": np.minimum(openings, closes) * 0.99, "Close": closes, "Volume": rng.integers(0, 100000, len(closes))}, index=pd.bdate_range("2010-01-01", periods=len(closes)))
    causal, daily_values = _causal_technicals(values)
    for index in (199, 200, 499, 1000, 2000, 2519):
        expected = indicators(values.iloc[:index + 1])
        actual = {key: round(float(value), 4) if np.isfinite(value) else None for key, value in causal.iloc[index].items()}
        assert actual == expected
        assert daily_values.iloc[index] == pytest.approx((values["Close"] * values["Volume"]).iloc[index - 19:index + 1].mean())


def test_complete_event_exports_full_purging_window_not_early_exit(monkeypatch, feature_calls):
    values = frame()
    set_bar(values, 200, 9.5, 10, 9, 9.8)
    set_bar(values, 201, 10.5, 12.1, 10, 12)
    only_signal(monkeypatch, values)
    result = historical_events("EXAMPLE.TO", values)
    assert len(result) == 1
    event = result[0]
    assert event["symbol"] == "EXAMPLE.TO"
    assert event["signalDate"] == values.index[199].date().isoformat()
    assert event["outcomeEnd"] == values.index[220].date().isoformat()
    assert event["label"] == "targetFirst"
    assert event["ambiguous"] is False
    assert feature_calls[0][2] == {"price": 10.5, "averageDailyValue": 105000, "setup": event["setup"]}


def test_current_context_and_future_prices_never_enter_historical_features(monkeypatch, feature_calls):
    values = frame()
    set_bar(values, 200, 9.5, 10, 9, 9.8)
    only_signal(monkeypatch, values)
    historical_events("EXAMPLE.TO", values, {"price": 999999, "averageDailyValue": 1e20, "setup": "Research watch", "debt": 123})
    before = deepcopy(feature_calls)
    feature_calls.clear()
    changed = values.copy()
    changed.iloc[201:, :4] *= 2
    changed["revenueGrowth"] = 0.99
    historical_events("EXAMPLE.TO", changed)
    assert before == feature_calls
    assert "debt" not in before[0][2]
    assert "revenueGrowth" not in before[0][1]


def test_unfilled_plan_is_omitted_and_next_signal_follows_its_expiry(monkeypatch, feature_calls):
    values = frame()
    set_bar(values, 206, 10.5, 12.1, 10.2, 12)
    first, second = (values.index[index].date().isoformat() for index in (199, 204))
    def builder(price, metrics, setup, as_of):
        return plan() if as_of == first else plan(10.5) if as_of == second else {"status": "Unavailable"}
    monkeypatch.setattr(events_module, "build_trade_plan", builder)
    result = historical_events("EXAMPLE.TO", values)
    assert len(result) == 1
    assert result[0]["signalDate"] == second
    assert result[0]["label"] == "targetFirst"
    assert result[0]["outcomeEnd"] == values.index[225].date().isoformat()


def test_early_exit_allows_next_signal_but_purging_windows_remain_complete(monkeypatch, feature_calls):
    values = frame()
    for index in (200, 202):
        set_bar(values, index, 9.5, 10, 9, 9.8)
    for index in (201, 203):
        set_bar(values, index, 10.5, 12.1, 10, 12)
    signals = {values.index[index].date().isoformat() for index in (199, 201)}
    calls = []
    def builder(price, metrics, setup, as_of):
        calls.append(as_of)
        return plan() if as_of in signals else {"status": "Unavailable"}
    monkeypatch.setattr(events_module, "build_trade_plan", builder)
    result = historical_events("EXAMPLE.TO", values)
    assert [event["signalDate"] for event in result] == sorted(signals)
    assert [event["outcomeEnd"] for event in result] == [values.index[index].date().isoformat() for index in (220, 222)]
    assert values.index[200].date().isoformat() not in calls
    assert values.index[202].date().isoformat() not in calls


def test_ambiguous_intraday_entry_high_gets_no_optimistic_label(monkeypatch, feature_calls):
    values = frame()
    set_bar(values, 200, 10.5, 12.5, 9.8, 10.1)
    only_signal(monkeypatch, values)
    result = historical_events("EXAMPLE.TO", values)
    assert result[0]["label"] == "expired"
    assert result[0]["ambiguous"] is True


def test_right_censored_active_plan_blocks_later_overlapping_alternative(monkeypatch, feature_calls):
    values = frame(222)
    set_bar(values, 201, 10.4, 10.7, 10.2, 10.5)
    set_bar(values, 204, 9.5, 10, 9, 9.8)
    first, second = (values.index[index].date().isoformat() for index in (199, 200))
    calls = []
    def builder(price, metrics, setup, as_of):
        calls.append(as_of)
        return plan() if as_of == first else plan(10.5) if as_of == second else {"status": "Unavailable"}
    monkeypatch.setattr(events_module, "build_trade_plan", builder)
    assert historical_events("EXAMPLE.TO", values) == []
    assert calls == [first]
    assert feature_calls == []


def test_uses_long_history_and_starts_only_after_200_observed_bars(monkeypatch, feature_calls):
    values = frame(2520)
    set_bar(values, 200, 9.5, 10, 9, 9.8)
    set_bar(values, 201, 10.5, 12.1, 10, 12)
    calls = []
    first = values.index[199].date().isoformat()
    def builder(price, metrics, setup, as_of):
        calls.append(as_of)
        return plan() if as_of == first else {"status": "Unavailable"}
    monkeypatch.setattr(events_module, "build_trade_plan", builder)
    result = historical_events("EXAMPLE.TO", values)
    assert result[0]["signalDate"] == calls[0] == first
    assert calls[-1] == values.index[-6].date().isoformat()
    assert feature_calls[0][1]["sma200"] is not None


def test_sorting_and_duplicate_daily_input_are_consistent(monkeypatch, feature_calls):
    values = frame()
    set_bar(values, 200, 9.5, 10, 9, 9.8)
    only_signal(monkeypatch, values)
    expected = historical_events("EXAMPLE.TO", values)
    scrambled = pd.concat([values.iloc[::-1], values.iloc[[200]]])
    assert historical_events("EXAMPLE.TO", scrambled) == expected


@pytest.mark.parametrize("kind", ["nan", "bad_range", "negative_volume"])
def test_bad_bars_are_not_silently_removed_from_outcome_windows(kind):
    values = frame(2520)
    if kind == "nan":
        values.loc[values.index[1200], "High"] = np.nan
    elif kind == "bad_range":
        values.loc[values.index[1200], "Low"] = 15
    else:
        values.loc[values.index[1200], "Volume"] = -1
    assert historical_events("EXAMPLE.TO", values) == []


def test_real_shared_feature_contract_matches_the_signal_prefix_exactly():
    from scanner.probability import FEATURE_NAMES, build_features
    from scanner.technicals import classify_setup
    from scanner.trade_plans import build_trade_plan
    closes = [10 + math.sin(index / 8) for index in range(600)]
    openings = [closes[0]] + closes[:-1]
    values = pd.DataFrame({"Open": openings, "High": [max(a, b) + 0.12 for a, b in zip(openings, closes)], "Low": [min(a, b) - 0.12 for a, b in zip(openings, closes)], "Close": closes, "Volume": [10000] * len(closes)}, index=pd.bdate_range("2015-01-01", periods=len(closes)))
    result = historical_events("SYNTHETIC.TO", values)
    assert result
    first = result[0]
    signal_index = values.index.get_loc(pd.Timestamp(first["signalDate"]))
    prefix = values.iloc[:signal_index + 1]
    price = float(prefix["Close"].iloc[-1])
    metrics = indicators(prefix)
    setup = classify_setup(price, metrics)
    proposed = build_trade_plan(price, metrics, setup, first["signalDate"])
    expected = build_features(proposed, metrics, {"price": price, "averageDailyValue": (prefix["Close"] * prefix["Volume"]).tail(20).mean(), "setup": setup})
    assert set(first["features"]) == set(FEATURE_NAMES)
    assert first["features"] == expected
