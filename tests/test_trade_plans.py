import math

import pytest

from scanner.trade_plans import build_trade_plan


def metrics(**updates):
    return {"support": 10, "resistance": 14, "atr14": 1, "sma50": 11, **updates}


def test_entry_return_and_worst_entry_reward_risk_use_the_same_rounded_prices():
    plan = build_trade_plan(12, metrics(), "Range watch", "2026-10-20")
    assert plan["status"] == "Wait"
    assert (plan["entryLow"], plan["entryHigh"], plan["referenceEntry"]) == (10.1, 10.5, 10.3)
    assert plan["target"] == 14 and plan["invalidation"] == 9.5
    assert plan["upsidePercent"] == round((14 / 10.3 - 1) * 100, 2)
    assert plan["downsidePercent"] == round((9.5 / 10.3 - 1) * 100, 2)
    assert plan["rewardRisk"] == (14 - 10.5) / (10.5 - 9.5)
    assert plan["probability"]["value"] is None
    assert plan["horizonSessions"] == 20 and plan["entryValidForSessions"] == 5


def test_close_inside_entry_band_is_ready_without_claiming_a_live_fill():
    plan = build_trade_plan(10.3, metrics(), "Pullback", "2026-10-20")
    assert plan["status"] == "Ready"
    assert plan["asOf"] == "2026-10-20"


@pytest.mark.parametrize("close", [10.1 - 1e-8, 10.5 + 1e-8])
def test_vendor_float_noise_at_a_published_entry_boundary_does_not_change_readiness(close):
    plan = build_trade_plan(close, metrics(), "Pullback", "2026-10-20")
    assert plan["status"] == "Ready"


def test_breakout_uses_a_disclosed_atr_projection_and_waits_for_a_retest():
    plan = build_trade_plan(16, metrics(), "Trend continuation", "2026-10-20")
    assert plan["status"] == "Wait"
    assert plan["entryLow"] == 14 and plan["entryHigh"] == 14.5
    assert plan["target"] == 17 and plan["invalidation"] == 13
    assert "ATR-derived" in plan["basis"]
    assert plan["rewardRisk"] >= 1.5


@pytest.mark.parametrize("changes", [{"atr14": None}, {"atr14": 0}, {"atr14": math.nan}, {"support": -1}, {"sma50": None}, {"resistance": 9}])
def test_bad_or_missing_evidence_does_not_create_precise_price_targets(changes):
    plan = build_trade_plan(12, metrics(**changes), "Range watch", "2026-10-20")
    assert plan["status"] == "Unavailable"
    assert plan["target"] is None and plan["upsidePercent"] is None


def test_broken_support_and_unqualified_research_watch_do_not_get_forced_entries():
    assert build_trade_plan(9.99, metrics(), "Range watch", "2026-10-20")["status"] == "Unavailable"
    assert build_trade_plan(12, metrics(), "Research watch", "2026-10-20")["entryLow"] is None


def test_does_not_raise_historical_target_to_manufacture_attractive_reward_risk():
    plan = build_trade_plan(10.8, metrics(resistance=11), "Pullback", "2026-10-20")
    assert plan["status"] == "Unavailable"
    assert plan["target"] is None
    assert "1.5" in plan["explanation"]


def test_rounding_and_price_floor_do_not_create_zero_risk_or_sub_dollar_entries():
    tiny = build_trade_plan(1.001, metrics(support=1, resistance=1.002, atr14=0.001, sma50=1), "Range watch", "2026-10-20")
    assert tiny["status"] == "Unavailable"
    valid = build_trade_plan(1.2, metrics(support=0.99, resistance=1.5, atr14=0.1, sma50=1.1), "Range watch", "2026-10-20")
    assert valid["entryLow"] >= 1
    assert valid["invalidation"] < valid["entryLow"]
