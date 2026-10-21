import pandas as pd
import pytest

from scanner.train_probability import clean_history, select_cohort


def quote(symbol, **extra):
    return {"symbol": symbol, "quoteType": "EQUITY", "regularMarketPrice": 5,
            "averageDailyVolume3Month": 100000, "currency": "CAD", "scannerExchange": "TSX", **extra}


def test_training_cohort_does_not_count_the_same_stock_on_two_venues():
    rows = [quote("ABC.NE", scannerExchange="Cboe Canada"), quote("ABC.TO"), quote("XYZ.V", scannerExchange="TSXV")]
    assert {row["symbol"] for row in select_cohort(rows, 10)} == {"ABC.TO", "XYZ.V"}


def test_cohort_excludes_pennies_cdrs_debt_warrants_and_non_cad():
    rows = [quote("GOOD.TO"), quote("PENNY.V", regularMarketPrice=0.5),
            quote("CDR.NE", longName="Example CDR CAD HEDGED"), quote("BAD-DBH.TO"),
            quote("BAD-WT.V"), quote("USD.TO", currency="USD")]
    assert [row["symbol"] for row in select_cohort(rows, 20)] == ["GOOD.TO"]


def frame():
    return pd.DataFrame({"Open": 10., "High": 11., "Low": 9., "Close": 10., "Volume": 100000., "Stock Splits": 0.},
                        index=pd.bdate_range("2019-01-01", periods=1500))


def test_a_split_restarts_history_so_future_adjustments_do_not_change_past_price_eligibility():
    values = frame()
    values.loc[values.index[300], "Stock Splits"] = 2
    cleaned, actions = clean_history(values)
    assert cleaned.index[0] == values.index[301]
    assert actions["reportedSplits"] == 1
    assert actions["lastSplit"] == values.index[300].date().isoformat()


def test_recent_split_with_too_little_warmup_is_unusable():
    values = frame()
    values.loc[values.index[-100], "Stock Splits"] = 5
    with pytest.raises(ValueError, match="500 usable"):
        clean_history(values)


def test_missing_bar_data_and_unverified_extreme_jumps_do_not_become_labels():
    values = frame()
    values.loc[values.index[400], "Close"] = float("nan")
    with pytest.raises(ValueError, match="invalid or missing"):
        clean_history(values)
    values = frame()
    values.loc[values.index[400], ["Open", "High", "Low", "Close"]] *= 10
    with pytest.raises(ValueError, match="extreme"):
        clean_history(values)
