from copy import deepcopy
import math

import pandas as pd
import pytest

from scanner.historical import historical_evidence
from scanner.technicals import classify_setup, indicators


def frame(count=90, opening=10.5, high=10.7, low=10.2, close=10.5):
    return pd.DataFrame({"Open": [opening] * count, "High": [high] * count, "Low": [low] * count, "Close": [close] * count, "Volume": [10000] * count}, index=pd.bdate_range("2020-01-01", periods=count))


def set_bar(values, index, opening, high, low, close):
    values.loc[values.index[index], ["Open", "High", "Low", "Close"]] = [opening, high, low, close]


def plan():
    return {"status": "Ready", "referenceEntry": 10, "target": 12, "invalidation": 8, "horizonSessions": 20, "entryValidForSessions": 5}


def single_signal(values):
    signal_date = values.index[59].date().isoformat()
    return lambda price, technicals, setup, as_of: plan() if as_of == signal_date else {"status": "Unavailable"}


def test_opening_fill_then_target_is_a_completed_target_first_event():
    values = frame()
    set_bar(values, 60, 9.5, 10, 9, 9.8)
    set_bar(values, 61, 10.5, 12.1, 10, 11.9)
    evidence = historical_evidence(values, plan_builder=single_signal(values))
    assert evidence["samples"] == evidence["targetFirst"] == 1
    assert evidence["stopFirst"] == evidence["expired"] == evidence["ambiguous"] == 0
    assert evidence["hitRatePercent"] is None
    assert evidence["asOf"] == values.index[80].date().isoformat()


def test_intraday_fill_cannot_claim_entry_day_high_as_a_target_first_hit():
    values = frame()
    set_bar(values, 60, 10.5, 12.5, 9.8, 10.1)
    evidence = historical_evidence(values, plan_builder=single_signal(values))
    assert evidence["targetFirst"] == 0
    assert evidence["expired"] == evidence["ambiguous"] == evidence["samples"] == 1


def test_an_intraday_fill_day_ambiguous_high_can_be_followed_by_a_real_target_hit():
    values = frame()
    set_bar(values, 60, 10.5, 12.5, 9.8, 10.1)
    set_bar(values, 62, 10.5, 12.1, 10.2, 12)
    evidence = historical_evidence(values, plan_builder=single_signal(values))
    assert evidence["targetFirst"] == evidence["ambiguous"] == 1


@pytest.mark.parametrize("opening", [9.8, 10.5])
def test_both_levels_touched_after_open_or_intraday_fill_use_stop_first(opening):
    values = frame()
    set_bar(values, 60, opening, 12.5, 7.5, 10)
    evidence = historical_evidence(values, plan_builder=single_signal(values))
    assert evidence["stopFirst"] == evidence["ambiguous"] == evidence["samples"] == 1
    assert evidence["targetFirst"] == 0


def test_gap_below_invalidation_before_entry_is_unfilled_not_a_loss():
    values = frame()
    set_bar(values, 60, 7.5, 9, 7, 8)
    evidence = historical_evidence(values, plan_builder=single_signal(values))
    assert evidence["unfilled"] == 1
    assert evidence["samples"] == evidence["stopFirst"] == 0
    assert evidence["asOf"] == values.index[64].date().isoformat()


@pytest.mark.parametrize("opening, expected", [(7, "stopFirst"), (13, "targetFirst")])
def test_post_entry_opening_gap_establishes_order_before_the_rest_of_the_bar(opening, expected):
    values = frame()
    set_bar(values, 60, 9.5, 10, 9, 9.8)
    set_bar(values, 61, opening, 14, 6, 10)
    evidence = historical_evidence(values, plan_builder=single_signal(values))
    assert evidence[expected] == 1
    assert evidence["ambiguous"] == 0


def test_unfilled_limit_expires_after_exactly_five_future_sessions():
    values = frame()
    set_bar(values, 65, 9.5, 12.1, 9, 11)
    evidence = historical_evidence(values, plan_builder=single_signal(values))
    assert evidence["unfilled"] == 1
    assert evidence["samples"] == 0


@pytest.mark.parametrize("count, samples", [(80, 0), (81, 1)])
def test_early_target_still_needs_all_twenty_post_fill_bars(count, samples):
    values = frame(count)
    set_bar(values, 60, 9.5, 10, 9, 9.8)
    set_bar(values, 61, 10.5, 12.1, 10, 12)
    evidence = historical_evidence(values, plan_builder=single_signal(values))
    assert evidence["samples"] == evidence["targetFirst"] == samples
    assert evidence["expired"] == 0
    if samples == 0:
        assert evidence["asOf"] is None


@pytest.mark.parametrize("count, samples", [(84, 0), (85, 1)])
def test_window_is_measured_from_actual_late_fill_instead_of_signal_date(count, samples):
    values = frame(count)
    set_bar(values, 64, 9.5, 10, 9, 9.8)
    evidence = historical_evidence(values, plan_builder=single_signal(values))
    assert evidence["expired"] == evidence["samples"] == samples


def test_right_censored_active_plan_is_not_skipped_for_a_later_overlapping_alternative():
    values = frame(82)
    # First signal's lower limit waits until session64, so its full window would
    # end at84, beyond the supplied bars. A hypothetical later, higher limit
    # could fill at61 and complete at81, but the first order is already active.
    set_bar(values, 61, 10.4, 10.7, 10.2, 10.5)
    set_bar(values, 64, 9.5, 10, 9, 9.8)
    first_date = values.index[59].date().isoformat()
    later_date = values.index[60].date().isoformat()
    called = []
    def sequential_builder(price, metrics, setup, as_of):
        called.append(as_of)
        if as_of == first_date:
            return plan()
        if as_of == later_date:
            return {**plan(), "referenceEntry": 10.5}
        return {"status": "Unavailable"}
    evidence = historical_evidence(values, plan_builder=sequential_builder)
    assert called == [first_date]
    assert evidence["samples"] == evidence["unfilled"] == 0
    assert evidence["asOf"] is None
    # Verify the later alternative really has a completed window when tested
    # alone, rather than passing merely because neither candidate was usable.
    alternate = historical_evidence(values, plan_builder=lambda price, metrics, setup, as_of: {**plan(), "referenceEntry": 10.5} if as_of == later_date else {"status": "Unavailable"})
    assert alternate["samples"] == alternate["expired"] == 1
    assert alternate["asOf"] == values.index[81].date().isoformat()


def test_open_positions_never_overlap_and_expiries_are_filled_outcomes():
    values = frame(102, opening=9.5, high=10.5, low=9, close=10)
    evidence = historical_evidence(values, plan_builder=lambda *args: plan())
    assert evidence["samples"] == evidence["expired"] == 2
    assert evidence["unfilled"] == 0
    assert evidence["asOf"] == values.index[101].date().isoformat()


@pytest.mark.parametrize("count, expected_samples", [(479, 19), (480, 20)])
def test_frequency_and_wilson_interval_require_twenty_complete_filled_samples(count, expected_samples):
    values = frame(count, opening=9.5, high=10.5, low=9, close=10)
    evidence = historical_evidence(values, plan_builder=lambda *args: plan())
    assert evidence["samples"] == evidence["expired"] == expected_samples
    if expected_samples < 20:
        assert evidence["hitRatePercent"] is None
        assert evidence["intervalLowPercent"] is None
        assert evidence["intervalHighPercent"] is None
    else:
        assert evidence["hitRatePercent"] == evidence["intervalLowPercent"] == 0
        assert evidence["intervalHighPercent"] == pytest.approx(16.11)


def test_wilson_interval_for_twenty_target_first_events_does_not_claim_certainty():
    values = frame(100, opening=9.5, high=12.1, low=9, close=10)
    evidence = historical_evidence(values, plan_builder=lambda *args: plan())
    assert evidence["samples"] == evidence["targetFirst"] == 20
    assert evidence["hitRatePercent"] == evidence["intervalHighPercent"] == 100
    assert evidence["intervalLowPercent"] == pytest.approx(83.89)


def test_future_price_changes_cannot_change_historical_signal_features():
    values = frame()
    changed = values.copy()
    changed.iloc[60:, :4] *= 5
    captured = []
    for supplied in (values, changed):
        calls = []
        def capture(price, metrics, setup, as_of):
            calls.append((price, deepcopy(metrics), setup, as_of))
            return {"status": "Unavailable"}
        historical_evidence(supplied, plan_builder=capture)
        captured.append(calls[0])
    assert captured[0] == captured[1]
    assert captured[0][3] == values.index[59].date().isoformat()
    assert captured[0][1]["sma200"] is None


def test_only_current_setup_class_is_compared(monkeypatch):
    monkeypatch.setattr("scanner.historical.classify_setup", lambda *args: "Pullback")
    calls = []
    evidence = historical_evidence(frame(), "Range watch", lambda *args: calls.append(args) or plan())
    assert evidence["samples"] == 0
    assert calls == []
    assert "same setup class (Range watch)" in evidence["method"]


@pytest.mark.parametrize("change", ["nan", "bad_range", "unordered", "duplicate"])
def test_corrupt_or_unordered_bars_produce_no_diagnostic_instead_of_false_outcomes(change):
    values = frame()
    if change == "nan":
        values.loc[values.index[65], "Low"] = float("nan")
    elif change == "bad_range":
        values.loc[values.index[65], "High"] = 1
    elif change == "unordered":
        values = values.iloc[::-1]
    else:
        values.index = pd.DatetimeIndex([values.index[0]] * len(values))
    evidence = historical_evidence(values, plan_builder=lambda *args: plan())
    assert evidence["samples"] == 0
    assert evidence["asOf"] is None
    assert "invalid" in evidence["method"]


def test_default_builder_integrates_with_real_plan_schema_without_a_probability_claim():
    closes = [10 + math.sin(index / 8) for index in range(500)]
    openings = [closes[0]] + closes[:-1]
    values = pd.DataFrame({"Open": openings, "High": [max(a, b) + 0.12 for a, b in zip(openings, closes)], "Low": [min(a, b) - 0.12 for a, b in zip(openings, closes)], "Close": closes, "Volume": [10000] * 500}, index=pd.bdate_range("2020-01-01", periods=500))
    setup = classify_setup(closes[-1], indicators(values))
    evidence = historical_evidence(values, setup)
    assert evidence["samples"] > 0
    assert evidence["samples"] == sum(evidence[key] for key in ("targetFirst", "stopFirst", "expired"))
    assert "probability" not in evidence
    assert "not calibrated prediction" in evidence["method"]
    assert evidence["asOf"] <= values.index[-1].date().isoformat()


def test_long_supplied_history_is_bounded_to_520_bars():
    values = frame(1000)
    dates = []
    def capture(price, metrics, setup, as_of):
        dates.append(as_of)
        return {"status": "Unavailable"}
    historical_evidence(values, plan_builder=capture)
    assert dates[0] == values.index[-520 + 59].date().isoformat()
