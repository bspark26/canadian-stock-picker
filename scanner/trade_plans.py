"""Conditional technical entry scenarios, never model-calibrated forecasts."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
import math


EVENT = "Target touched before invalidation within 20 trading sessions after a qualifying entry."
MIN_REWARD_RISK = 1.5


def _positive(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) and result > 0 else None
    except (TypeError, ValueError):
        return None


def _cents(value):
    return float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def build_trade_plan(price, technicals, setup, as_of):
    """Freeze the entry/exit rules at the supplied signal date, using past data only.

    Normal range: wait near the preceding 20-session low, targeting that range's
    high. An existing breakout instead uses a retest of the old range high with
    an explicitly ATR-derived objective. Decline plans whose rounded worst entry
    offers less than 1.5 units of target reward per unit of invalidation risk.
    """
    result = {
        "status": "Unavailable", "asOf": as_of,
        "horizonSessions": 20, "entryValidForSessions": 5,
        **{key: None for key in ("entryLow", "entryHigh", "referenceEntry", "target", "invalidation", "upsidePercent", "downsidePercent", "rewardRisk")},
        "basis": "Conditional technical scenario",
        "explanation": "A supported technical entry setup is not available.",
        "probability": {
            "value": None, "status": "Not calibrated", "event": EVENT,
            "reason": "No out-of-sample calibrated model has validated this event. Screening scores and historical hit rates are not forecast probabilities.",
        },
    }
    close = _positive(price)
    if close is None or close < 1:
        result["explanation"] = "The last close must be at least C$1 for an entry scenario."
        return result
    if setup not in ("Pullback", "Range watch", "Trend continuation"):
        result["explanation"] = "This is a research watch. Company valuation and project evidence are needed before proposing an entry."
        return result
    support, resistance, atr, average = (_positive(technicals.get(key)) for key in ("support", "resistance", "atr14", "sma50"))
    if None in (support, resistance, atr, average):
        result["explanation"] = "Historical range, positive ATR and a 50-session average are required to form a timing scenario."
        return result
    if support >= resistance or close < support:
        result["explanation"] = "The historical range is invalid or its support has already broken at the last close."
        return result
    breakout = close > resistance
    if breakout:
        anchor = resistance
        low, high = max(1, anchor), max(1, anchor + 0.5 * atr)
        stop, target = anchor - atr, anchor + 3 * atr
        basis = "Prior range-high retest; ATR-derived target scenario"
        explanation = "After the observed breakout, wait for a retest of the prior range high. The target is a three-ATR scenario, not a valuation or a predicted future price."
    else:
        anchor = support
        low, high = max(1, anchor + 0.1 * atr), max(1, anchor + 0.5 * atr)
        stop, target = anchor - 0.5 * atr, resistance
        basis = "Prior 20-session range; ATR-buffered entry and invalidation"
        explanation = "Consider a pullback near the preceding 20-session range low, with the prior range high as a conditional target."
    low, high, stop, target = (_cents(value) for value in (low, high, stop, target))
    entry = _cents((low + high) / 2)
    if not (0 < stop < low <= entry <= high < target):
        result["explanation"] = "Rounded entry, target and invalidation prices do not leave a valid positive-risk trade structure."
        return result
    ratio = (target - high) / (high - stop)
    if ratio < MIN_REWARD_RISK:
        result["explanation"] = "The historical target leaves less than 1.5× reward/risk at the upper entry price; no entry recommendation is made."
        return result
    result.update({
        # Match the six-decimal published close; vendor float noise must not
        # label a displayed boundary price as outside its entry zone.
        "status": "Ready" if low <= round(close, 6) <= high else "Wait",
        "entryLow": low, "entryHigh": high, "referenceEntry": entry,
        "target": target, "invalidation": stop,
        "upsidePercent": round((target / entry - 1) * 100, 2),
        "downsidePercent": round((stop / entry - 1) * 100, 2),
        "rewardRisk": round(ratio, 3), "basis": basis,
        "explanation": explanation + " Entry is conditional for the next five sessions; skip an opening gap at or below invalidation and reassess if the setup changes.",
    })
    return result
