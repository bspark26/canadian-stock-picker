"""Same-symbol walk-forward diagnostics, never a calibrated forecast probability.

Only the supplied completed daily bars are used. Features and proposed levels are
rebuilt from each historical prefix. Non-overlapping events avoid counting the
same open position repeatedly. Daily OHLC cannot establish every intraday order;
ambiguous cases receive conservative treatment and are explicitly counted.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .technicals import classify_setup, indicators, number

MIN_PRIOR_BARS = 60
MIN_RATE_SAMPLES = 20
MAX_HISTORY_BARS = 520
HORIZON_SESSIONS = 20
ENTRY_VALID_SESSIONS = 5


def _wilson(successes, samples):
    """Wilson score interval, nominal 95%, conditional on this historical sample."""
    z = 1.959963984540054
    proportion = successes / samples
    denominator = 1 + z * z / samples
    center = (proportion + z * z / (2 * samples)) / denominator
    half = z * math.sqrt(proportion * (1 - proportion) / samples + z * z / (4 * samples * samples)) / denominator
    return round(max(0, center - half) * 100, 2), round(min(1, center + half) * 100, 2)


def _method(setup):
    scope = f"same setup class ({setup})" if setup else "all eligible setup classes"
    return (
        f"Same-symbol chronological walk-forward diagnostic; {scope}; at most {MAX_HISTORY_BARS} completed daily bars, "
        f"at least {MIN_PRIOR_BARS} prior bars. Each plan uses only its historical prefix. "
        f"Conditional entry skips opening gaps at or below invalidation; otherwise models a buy limit at reference entry, valid next {ENTRY_VALID_SESSIONS} sessions; fill day plus next {HORIZON_SESSIONS} sessions evaluated. "
        "Only filled events with all 20 post-fill bars available enter samples, even when an exit occurs earlier. "
        "One active plan at a time: next signal follows the previous actual outcome or expiry; a right-censored active plan ends the diagnostic rather than selecting later overlapping alternatives. "
        "Gaps below invalidation before entry are unfilled; gaps after entry can stop out. "
        "Ambiguous target/stop bars count stop first; intraday-entry-day target touches receive no target-first credit. "
        "Unfilled entries are separate. Historical frequency and nominal Wilson 95% interval appear only with at least 20 filled samples. "
        "This is retrospective price-only evidence, not calibrated prediction; fees, spreads, slippage, dividends, execution availability and corporate-action verification are excluded."
    )


def _empty(setup):
    return {
        "samples": 0, "targetFirst": 0, "stopFirst": 0, "expired": 0,
        "unfilled": 0, "ambiguous": 0, "hitRatePercent": None,
        "intervalLowPercent": None, "intervalHighPercent": None,
        "asOf": None, "method": _method(setup),
    }


def _validated_frame(frame):
    columns = ["Open", "High", "Low", "Close", "Volume"]
    if not isinstance(frame, pd.DataFrame) or any(column not in frame for column in columns):
        return None
    values = frame.loc[:, columns].tail(MAX_HISTORY_BARS).copy()
    try:
        values = values.astype(float)
        values.index = pd.DatetimeIndex(values.index)
    except (TypeError, ValueError):
        return None
    if values.empty or values.index.hasnans or values.index.has_duplicates or not values.index.is_monotonic_increasing:
        return None
    if not np.isfinite(values.to_numpy()).all():
        return None
    if (values[["Open", "High", "Low", "Close"]] <= 0).any().any() or (values["Volume"] < 0).any():
        return None
    if (values["High"] < values[["Open", "Close", "Low"]].max(axis=1)).any() or (values["Low"] > values[["Open", "Close", "High"]].min(axis=1)).any():
        return None
    return values


def _outcome(bars, signal_index, entry, target, stop):
    """Return (outcome, outcome index, completed-window index, ambiguous), or None.

    None is right-censoring, never an expiry/failure. An intraday buy-limit fill
    cannot earn credit for an earlier or order-unknown high on its entry bar.
    """
    count = len(bars)
    entry_end = signal_index + ENTRY_VALID_SESSIONS
    if entry_end >= count:
        return None
    for fill_index in range(signal_index + 1, entry_end + 1):
        opening, high, low = bars[fill_index, :3]
        if opening <= stop:
            return "unfilled", fill_index, entry_end, False
        at_open = opening <= entry
        intraday = low <= entry <= high
        if not at_open and not intraday:
            continue
        window_end = fill_index + HORIZON_SESSIONS
        if window_end >= count:
            return None
        ambiguous = False
        for index in range(fill_index, window_end + 1):
            opening, high, low = bars[index, :3]
            stop_touch, target_touch = low <= stop, high >= target
            if index != fill_index:
                # Opening gaps establish ordering before the rest of the daily range.
                if opening <= stop:
                    return "stopFirst", index, window_end, ambiguous
                if opening >= target:
                    return "targetFirst", index, window_end, ambiguous
            if index == fill_index and not at_open and target_touch:
                ambiguous = True
                if stop_touch:
                    return "stopFirst", index, window_end, ambiguous
                # The high could have occurred before the buy limit filled.
                continue
            if stop_touch and target_touch:
                return "stopFirst", index, window_end, True
            if stop_touch:
                return "stopFirst", index, window_end, ambiguous
            if target_touch:
                return "targetFirst", index, window_end, ambiguous
        return "expired", window_end, window_end, ambiguous
    return "unfilled", entry_end, entry_end, False


def historical_evidence(frame, setup=None, plan_builder=None):
    """Describe completed, non-overlapping prior events using today's plan rules.

    ``setup`` restricts prior signals to the current descriptive setup class.
    ``plan_builder(price, technicals, setup, as_of)`` is injectable for tests;
    by default it imports ``scanner.trade_plans.build_trade_plan`` lazily.
    """
    result = _empty(setup)
    values = _validated_frame(frame)
    if values is None:
        result["method"] += " Diagnostic unavailable because daily OHLCV data is missing, unordered or invalid."
        return result
    if len(values) < MIN_PRIOR_BARS + ENTRY_VALID_SESSIONS:
        return result
    if plan_builder is None:
        from .trade_plans import build_trade_plan
        plan_builder = build_trade_plan
    # Numeric arrays make forward event evaluation independent of pandas row overhead.
    bars = values[["Open", "High", "Low", "Close"]].to_numpy()
    signal_index = MIN_PRIOR_BARS - 1
    last_window = None
    while signal_index + ENTRY_VALID_SESSIONS < len(values):
        prefix = values.iloc[:signal_index + 1]
        price = float(bars[signal_index, 3])
        technicals = indicators(prefix)
        historical_setup = classify_setup(price, technicals)
        if setup is not None and historical_setup != setup:
            signal_index += 1
            continue
        as_of = values.index[signal_index].date().isoformat()
        plan = plan_builder(price, technicals, historical_setup, as_of)
        if not isinstance(plan, dict) or plan.get("status") not in ("Ready", "Wait"):
            signal_index += 1
            continue
        entry, target, stop = (number(plan.get(key)) for key in ("referenceEntry", "target", "invalidation"))
        if any(value is None for value in (entry, target, stop)) or not 0 < stop < entry < target:
            signal_index += 1
            continue
        # Do not pool a different event definition under this diagnostic's label.
        if plan.get("horizonSessions") != HORIZON_SESSIONS or plan.get("entryValidForSessions") != ENTRY_VALID_SESSIONS:
            signal_index += 1
            continue
        outcome = _outcome(bars, signal_index, entry, target, stop)
        if outcome is None:
            # The current active plan is right-censored. Do not skip it based on
            # future availability to select a later, overlapping alternative.
            break
        label, outcome_index, window_end, ambiguous = outcome
        result[label] += 1
        if ambiguous:
            result["ambiguous"] += 1
        last_window = max(last_window or window_end, window_end)
        signal_index = max(signal_index + 1, outcome_index)
    result["samples"] = result["targetFirst"] + result["stopFirst"] + result["expired"]
    result["asOf"] = values.index[last_window].date().isoformat() if last_window is not None else None
    if result["samples"] >= MIN_RATE_SAMPLES:
        result["hitRatePercent"] = round(result["targetFirst"] / result["samples"] * 100, 2)
        result["intervalLowPercent"], result["intervalHighPercent"] = _wilson(result["targetFirst"], result["samples"])
    return result
