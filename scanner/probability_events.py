"""Causal, price-only historical events for a separate probability calibration job.

This module creates labelled observations; it does not fit a model or publish a
forecast probability. Targets, invalidations and fill rules match the conditional
trade-plan diagnostic. All input must be split-consistent, completed daily OHLCV.
"""
from __future__ import annotations

import math
import numpy as np
import pandas as pd

from .historical import ENTRY_VALID_SESSIONS, HORIZON_SESSIONS, _outcome
from .technicals import classify_setup, number
from .trade_plans import build_trade_plan

MIN_PRIOR_BARS = 200


def _clean_frame(frame):
    """Normalize daily order/duplicates, and reject corrupt data rather than label it.

    Bad-bar/corporate-action investigation belongs to the collector. Silently
    deleting corrupt rows here would turn a missing trading day into a shorter
    outcome window, so invalid OHLCV causes this symbol to return no events.
    """
    columns = ["Open", "High", "Low", "Close", "Volume"]
    if not isinstance(frame, pd.DataFrame) or any(column not in frame for column in columns):
        return None
    try:
        values = frame.loc[:, columns].astype(float).copy()
        if pd.api.types.is_numeric_dtype(values.index.dtype):
            return None
        values.index = pd.DatetimeIndex(values.index)
        if values.index.tz is not None:
            values.index = values.index.tz_localize(None)
        values.index = values.index.normalize()
    except (TypeError, ValueError):
        return None
    if values.empty or values.index.hasnans:
        return None
    values = values[~values.index.duplicated(keep="last")].sort_index(kind="stable")
    if not np.isfinite(values.to_numpy()).all():
        return None
    if (values[["Open", "High", "Low", "Close"]] <= 0).any().any() or (values["Volume"] < 0).any():
        return None
    if (values["High"] < values[["Open", "Close", "Low"]].max(axis=1)).any() or (values["Low"] > values[["Open", "Close", "High"]].min(axis=1)).any():
        return None
    return values


def _causal_technicals(frame):
    """Vectorized equivalent of technicals.indicators at every historical prefix.

    Rolling windows are trailing (support/resistance exclude the signal bar).
    EWM is causal with exactly the same initialization as the existing scanner.
    Rounding happens when the signal row is read, matching indicators' Python
    rounding before classify_setup/build_trade_plan consume those features.
    """
    close, high, low, volume = (frame[key] for key in ("Close", "High", "Low", "Volume"))
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    rsi = 100 - 100 / (1 + gain / loss.replace(0, float("nan")))
    zero_loss = loss.eq(0)
    rsi = rsi.mask(zero_loss & gain.gt(0), 100).mask(zero_loss & gain.eq(0), 50)
    true_range = pd.concat([high - low, (high - close.shift()).abs(), (low - close.shift()).abs()], axis=1).max(axis=1)
    preceding_volume = volume.shift(1).rolling(20).mean()
    output = pd.DataFrame({
        "rsi14": rsi,
        "sma20": close.rolling(20).mean(),
        "sma50": close.rolling(50).mean(),
        "sma200": close.rolling(200).mean(),
        "support": low.shift(1).rolling(20).min(),
        "resistance": high.shift(1).rolling(20).max(),
        "atr14": true_range.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean(),
        "relativeVolume": volume / preceding_volume.where(preceding_volume > 0),
        "return20d": (close / close.shift(20) - 1) * 100,
    }, index=frame.index)
    daily_value = (close * volume).rolling(20).mean()
    return output, daily_value


def historical_events(symbol, frame, context=None):
    """Return complete sequential historical events using all supplied daily history.

    Each event has ``symbol``, ISO ``signalDate`` and ``outcomeEnd`` (the full
    20-post-fill-session endpoint for purging, even after an early exit), ``label``
    (targetFirst/stopFirst/expired), ``setup``, ``ambiguous`` and ``features``.
    Historical feature context is rebuilt as ``price``, ``averageDailyValue`` and
    ``setup`` at each signal, then passed to shared ``probability.build_features``.
    Optional ``context`` is reserved and ignored, so current issuer facts or
    today's prices cannot leak into past observations. Financial data is absent.
    """
    values = _clean_frame(frame)
    if values is None or len(values) < MIN_PRIOR_BARS + ENTRY_VALID_SESSIONS:
        return []
    from .probability import build_features
    technical_frame, daily_values = _causal_technicals(values)
    names = list(technical_frame.columns)
    technical_rows = technical_frame.to_numpy()
    bars = values[["Open", "High", "Low", "Close"]].to_numpy()
    daily_values = daily_values.to_numpy()
    dates = [timestamp.date().isoformat() for timestamp in values.index]
    events = []
    signal_index = MIN_PRIOR_BARS - 1
    while signal_index + ENTRY_VALID_SESSIONS < len(values):
        price = float(bars[signal_index, 3])
        technicals = {key: round(float(value), 4) if math.isfinite(value) else None for key, value in zip(names, technical_rows[signal_index])}
        setup = classify_setup(price, technicals)
        plan = build_trade_plan(price, technicals, setup, dates[signal_index])
        if not isinstance(plan, dict) or plan.get("status") not in ("Ready", "Wait"):
            signal_index += 1
            continue
        entry, target, stop = (number(plan.get(key)) for key in ("referenceEntry", "target", "invalidation"))
        if any(value is None for value in (entry, target, stop)) or not 0 < stop < entry < target or plan.get("horizonSessions") != HORIZON_SESSIONS or plan.get("entryValidForSessions") != ENTRY_VALID_SESSIONS:
            signal_index += 1
            continue
        outcome = _outcome(bars, signal_index, entry, target, stop)
        if outcome is None:
            # Preserve the single-active-plan policy at the right-censored end.
            break
        label, actual_outcome_index, full_window_end, ambiguous = outcome
        if label != "unfilled":
            features = build_features(plan, technicals, {"price": price, "averageDailyValue": number(daily_values[signal_index]), "setup": setup})
            events.append({
                "symbol": str(symbol), "signalDate": dates[signal_index],
                "outcomeEnd": dates[full_window_end], "label": label,
                "setup": setup, "ambiguous": bool(ambiguous), "features": features,
            })
        signal_index = max(signal_index + 1, actual_outcome_index)
    return events
