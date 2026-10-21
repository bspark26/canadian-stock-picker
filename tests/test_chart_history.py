from datetime import date

import pandas as pd

from scanner.run import opportunity


def test_chart_history_retains_verified_ohlcv_and_available_two_year_window():
    dates = pd.bdate_range(end=date(2026, 10, 20), periods=540)
    frame = pd.DataFrame({
        "Open": [10.1234567] * 540, "High": [12.5] * 540,
        "Low": [9.75] * 540, "Close": [11.125] * 540, "Volume": [12500] * 540,
    }, index=dates)
    row = opportunity("TEST.TO", {}, frame, "CAD", {})
    assert len(row["history"]) == 520
    assert row["history"][0]["date"] == dates[-520].date().isoformat()
    assert row["history"][-1] == {
        "date": "2026-10-20", "open": 10.123457, "high": 12.5,
        "low": 9.75, "close": 11.125, "volume": 12500,
    }
    assert row["history"][-1]["close"] == row["price"]
