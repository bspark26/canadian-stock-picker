"""Entirely synthetic examples, intentionally unrelated to real issuers or quotes."""
from datetime import datetime, timedelta, timezone
import math

import pandas as pd

from .run import opportunity


def demo_scan(settings):
    today = datetime.now(timezone.utc).date()
    dates = pd.bdate_range(end=today - timedelta(days=1), periods=280)
    names = [
        ("DEMOA.TO", "Illustrative Northern Technology", "Technology", 13, 0.018),
        ("DEMOB.V", "Illustrative Granite Resources", "Basic Materials", 2.1, 0.005),
        ("DEMOC.TO", "Illustrative Prairie Industrial", "Industrials", 34, 0.025),
        ("DEMOD.CN", "Illustrative Harbour Health", "Healthcare", 5, -0.002),
        ("DEMOE.NE", "Illustrative Maple Consumer", "Consumer Defensive", 19, 0.009),
        ("DEMOF.TO", "Illustrative Western Energy", "Energy", 8, 0.008),
    ]
    opportunities = []
    for index, (symbol, name, sector, base, trend) in enumerate(names):
        close = [base + day * trend + math.sin(day / (9 + index)) * base * 0.045 for day in range(len(dates))]
        frame = pd.DataFrame({"Open": close, "Close": close, "High": [value * 1.018 for value in close], "Low": [value * 0.982 for value in close], "Volume": [int(40000 + index * 7000 + (1 + math.sin(day / 4)) * 15000) for day in range(len(dates))]}, index=dates)
        annual_date = f"{today.year - 1}-12-31"
        payload = {
            "info": {"longName": name, "sector": sector, "financialCurrency": "CAD", "revenueGrowth": 0.08 + index * 0.01, "profitMargins": 0.07 - index * 0.005, "priceToSalesTrailing12Months": 2.8, "marketCap": 250_000_000 + index * 100_000_000},
            "balance": {"asOf": annual_date, "cash": 80_000_000, "debt": 35_000_000},
            "cashflow": {"asOf": annual_date, "period": "12M", "operatingCashFlow": -12_000_000 if index == 1 else 25_000_000, "freeCashFlow": -17_000_000 if index == 1 else 18_000_000},
            "income": {"asOf": annual_date, "period": "12M", "revenue": 0 if index == 1 else 100_000_000},
        }
        row = opportunity(symbol, {}, frame, "CAD", payload)
        row["summary"] = "SYNTHETIC EXAMPLE — " + row["summary"]
        row["risks"].insert(0, "Entirely synthetic demonstration. This symbol, company and all numbers are illustrative, not a real recommendation.")
        row["sources"] = [{"label": "Synthetic demonstration, not sourced market data (yfinance documentation link only)", "url": "https://ranaroussi.github.io/yfinance/", "asOf": None}]
        if row["price"] >= settings["min_price"] and (row["averageDailyValue"] or 0) >= settings["min_average_daily_value"]:
            opportunities.append(row)
    return {
        "schemaVersion": 1, "mode": "demo", "generatedAt": datetime.now(timezone.utc).isoformat(), "marketAsOf": dates[-1].date().isoformat(), "status": "partial",
        "universe": {"discovered": len(names), "scanned": len(names), "eligible": len(opportunities), "failed": 0, "exchanges": ["TSX", "TSXV", "CSE", "Cboe Canada"], "source": "Synthetic demonstration only; no real universe discovered", "complete": False},
        "filters": {"minPrice": settings["min_price"], "minAverageDailyValue": settings["min_average_daily_value"]}, "ai": {"enabled": False, "model": None, "analyzed": 0},
        "warnings": ["SYNTHETIC DEMONSTRATION: all companies, symbols, prices and financial figures are invented examples. No live scan or AI call has run."], "opportunities": opportunities,
    }
