"""Descriptive daily indicators. Scores are heuristics, never return probabilities."""
from __future__ import annotations

import math
import pandas as pd


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def indicators(frame: pd.DataFrame) -> dict:
    close = frame["Close"].astype(float)
    high, low = frame["High"].astype(float), frame["Low"].astype(float)
    volume = frame["Volume"].astype(float)
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    rsi = 100 - 100 / (1 + gain / loss.replace(0, float("nan")))
    if len(close) >= 15 and loss.iloc[-1] == 0:
        rsi.iloc[-1] = 100 if gain.iloc[-1] > 0 else 50
    true_range = pd.concat([high - low, (high - close.shift()).abs(), (low - close.shift()).abs()], axis=1).max(axis=1)
    preceding = frame.iloc[-21:-1]
    previous_volume = volume.iloc[-21:-1].mean() if len(volume) >= 21 else None
    value = {
        "rsi14": number(rsi.iloc[-1]),
        **{f"sma{n}": number(close.rolling(n).mean().iloc[-1]) for n in (20, 50, 200)},
        "support": number(preceding["Low"].min()) if len(preceding) >= 20 else None,
        "resistance": number(preceding["High"].max()) if len(preceding) >= 20 else None,
        "atr14": number(true_range.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean().iloc[-1]),
        "relativeVolume": number(volume.iloc[-1] / previous_volume) if previous_volume and previous_volume > 0 else None,
        "return20d": number((close.iloc[-1] / close.iloc[-21] - 1) * 100) if len(close) >= 21 else None,
    }
    return {key: round(val, 4) if val is not None else None for key, val in value.items()}


def technical_score(price: float, metrics: dict, bars: int):
    # A handful of recent bars must not produce an apparently precise trend score.
    if bars < 60 or metrics.get("sma50") is None:
        return None
    components = []
    for key, weight in (("sma20", 1), ("sma50", 2), ("sma200", 2)):
        average = metrics.get(key)
        if average and average > 0:
            components.append((75 if price > average else 25, weight))
    rsi = metrics.get("rsi14")
    if rsi is not None:
        components.append((80 if 45 <= rsi <= 65 else 50 if 35 <= rsi <= 75 else 25, 1))
    movement = metrics.get("return20d")
    if movement is not None:
        components.append((min(85, max(15, 50 + movement * 2)), 1))
    return round(sum(score * weight for score, weight in components) / sum(weight for _, weight in components)) if len(components) >= 4 else None


def classify_setup(price: float, metrics: dict) -> str:
    sma20, sma50, sma200 = (metrics.get(key) for key in ("sma20", "sma50", "sma200"))
    if sma50 and sma200 and price > sma50 > sma200:
        if sma20 and abs(price / sma20 - 1) <= 0.035:
            return "Pullback"
        return "Trend continuation"
    if metrics.get("support") and metrics.get("resistance") and sma50:
        if abs(price / sma50 - 1) <= 0.08:
            return "Range watch"
    return "Research watch"
