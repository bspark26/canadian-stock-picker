"""Synthetic statistical checks: never evidence for a real market probability."""
from copy import deepcopy
from datetime import date, timedelta
import json

import pytest

from scanner.probability import FEATURE_NAMES, GATES, build_features, predict_probability, train_model


def scenario():
    plan = {
        "status": "Wait", "asOf": "2021-01-01", "horizonSessions": 20,
        "entryValidForSessions": 5, "invalidation": 9.5,
        "entryLow": 10.1, "referenceEntry": 10.3, "entryHigh": 10.5,
        "target": 14, "rewardRisk": 3.5,
    }
    metrics = {"atr14": 1, "rsi14": 55, "sma50": 10.5,
               "return20d": 8, "relativeVolume": 1.2}
    context = {"price": 10.8, "averageDailyValue": 100000, "setup": "Range watch"}
    return plan, metrics, context


def events():
    result = []
    for index in range(1800):
        signal = date(2017, 1, 1) + timedelta(days=(index // 12) * 7)
        plan, metrics, context = scenario()
        # Every date block has all setup classes and both outcomes, preventing
        # chronological train/calibration/test class-imbalance accidents.
        positive = (index // 3) % 2 == 0
        setup = ("Pullback", "Range watch", "Trend continuation")[index % 3]
        metrics["return20d"] = 8 if positive else -8
        metrics["rsi14"] = 55 if positive else 45
        context["setup"] = setup
        result.append({
            "symbol": f"STOCK{index % 60}.TO", "signalDate": signal.isoformat(),
            "outcomeEnd": (signal + timedelta(days=28)).isoformat(),
            "label": "targetFirst" if positive else "stopFirst", "setup": setup,
            "features": build_features(plan, metrics, context),
        })
    return result


@pytest.fixture(scope="module")
def fitted():
    return train_model(events(), trained_at="2020-01-01")


def test_feature_units_and_missing_values():
    plan, metrics, context = scenario()
    value = build_features(plan, metrics, context)
    assert tuple(value) == FEATURE_NAMES
    assert value["targetAtr"] == pytest.approx(3.7)
    assert value["stopAtr"] == pytest.approx(0.8)
    assert value["entryDistanceAtr"] == pytest.approx(0.5)
    assert value["distanceSma50Atr"] == pytest.approx(0.3)
    assert value["logDollarVolume"] == 5
    assert value["setupRangeWatch"] == 1
    assert value["setupPullback"] == 0
    metrics["atr14"] = 0
    context["averageDailyValue"] = False
    value = build_features(plan, metrics, context)
    assert value["targetAtr"] is None
    assert value["logDollarVolume"] is None


def test_prespecified_chronological_splits_are_purged_by_label_end(fitted):
    assert fitted["status"] == "Validated", fitted["reason"]
    partitions = fitted["splits"]
    assert partitions["training"]["outcomeEnd"] < partitions["calibration"]["start"]
    assert partitions["calibration"]["outcomeEnd"] < partitions["test"]["start"]
    assert partitions["purgedTraining"] > 0
    assert partitions["purgedCalibration"] > 0
    assert fitted["validation"]["testSamples"] >= GATES["testSamples"]
    assert fitted["validation"]["testSymbols"] >= GATES["testSymbols"]
    assert fitted["validation"]["brier"] < fitted["validation"]["baselineBrier"]
    assert fitted["validation"]["calibrationError"] <= 0.10
    assert fitted["validation"]["logLoss"] < fitted["validation"]["baselineLogLoss"]


def test_artifact_is_finite_json_coefficients_not_training_rows(fitted):
    text = json.dumps(fitted, allow_nan=False)
    assert "features" not in text
    assert "STOCK" not in text
    assert len(fitted["model"]["coefficients"]) == len(FEATURE_NAMES)
    assert len(fitted["validation"]["bins"]) == 5
    for bucket in fitted["validation"]["bins"]:
        if bucket["samples"]:
            assert 0 <= bucket["intervalLowPercent"] <= bucket["observedHitRatePercent"] <= bucket["intervalHighPercent"] <= 100


def test_untouched_test_features_do_not_change_base_or_calibrator(fitted):
    changed = events()
    start = fitted["splits"]["test"]["start"]
    for event in changed:
        if event["signalDate"] >= start:
            event["features"]["return20d"] *= -1
            event["features"]["rsi14"] = 100 - event["features"]["rsi14"]
    artifact = train_model(changed, trained_at="2020-01-01")
    # Inverting only untouched-test outcomes/features must fail validation;
    # the implementation never refits or retunes to rescue the result.
    assert artifact["status"] == "Insufficient evidence"
    assert "Brier" in artifact["reason"]
    assert "model" not in artifact


def test_preprocessing_never_learns_untouched_test_ranges_or_values(fitted):
    changed = events()
    start = fitted["splits"]["test"]["start"]
    for event in changed:
        if event["signalDate"] >= start:
            # This feature was constant during training; its coefficient must
            # remain zero, without fitting its extreme test-only distribution.
            event["features"]["logDollarVolume"] = 40
    artifact = train_model(changed, trained_at="2020-01-01")
    assert artifact["status"] == "Insufficient evidence"
    assert artifact["support"]["trainingRanges"] == fitted["model"]["trainingRanges"]
    assert artifact["support"]["excludedTest"] == fitted["validation"]["testSamples"]
    assert artifact["splits"]["test"]["samples"] == 0
    assert "test needs at least" in artifact["reason"]


def test_calibration_out_of_support_rows_cannot_calibrate_or_lend_sample_support(fitted):
    changed = events()
    start, end = fitted["splits"]["calibration"]["start"], fitted["splits"]["test"]["start"]
    for event in changed:
        if start <= event["signalDate"] < end:
            event["features"]["return20d"] = 800
    artifact = train_model(changed, trained_at="2020-01-01")
    assert artifact["status"] == "Insufficient evidence"
    assert artifact["support"]["excludedCalibration"] > 0
    assert artifact["splits"]["calibration"]["samples"] == 0
    assert "calibration needs at least" in artifact["reason"]


def test_small_sample_and_missing_artifact_withhold():
    artifact = train_model(events()[:60], trained_at="2020-01-01")
    assert artifact["status"] == "Insufficient evidence"
    assert "at least" in artifact["reason"]
    plan, metrics, context = scenario()
    assert predict_probability(plan, metrics, context, None)["value"] is None
    result = predict_probability(plan, metrics, context, artifact)
    assert result["status"] == "Insufficient evidence"
    assert result["value"] is None


def test_future_outcomes_are_not_accepted():
    artifact = train_model(events(), trained_at="2017-06-01")
    assert artifact["status"] == "Insufficient evidence"
    assert "beyond" in artifact["reason"]


def test_invalid_duplicates_unfilled_and_unknown_setups_are_not_training_events():
    original = events()[:5]
    malformed = deepcopy(original[0])
    malformed["label"] = "unfilled"
    unknown = deepcopy(original[1])
    unknown["setup"] = "Research watch"
    missing = deepcopy(original[2])
    missing["features"] = {}
    artifact = train_model(original + original + [malformed, unknown, missing], trained_at="2020-01-01")
    assert artifact["data"]["acceptedEvents"] == 5
    assert artifact["data"]["rejectedEvents"] == 8


def test_training_api_rejects_unknown_and_below_floor_historical_liquidity():
    data = events()[:5]
    data[0]["features"]["logDollarVolume"] = 4.0
    data[1]["features"]["logDollarVolume"] = None
    data[2]["features"]["logDollarVolume"] = 4.6989  # strictly below log10(50,000)
    artifact = train_model(data, trained_at="2020-01-01")
    assert artifact["data"]["acceptedEvents"] == 2
    assert artifact["data"]["rejectedEvents"] == 3


def _current(fitted):
    plan, metrics, context = scenario()
    plan["asOf"] = fitted["trainedAt"]
    return plan, metrics, context


def test_validated_supported_inference_is_integer_conditional_estimate(fitted):
    result = predict_probability(*_current(fitted), fitted)
    assert result["status"] == "Estimated", result["reason"]
    assert isinstance(result["value"], int)
    assert 50 < result["value"] <= 100
    assert "conditional" in result["reason"]
    assert result["validation"]["binSamples"] >= 50
    assert result["validation"]["setupSamples"] >= 75


def test_bad_individual_band_is_withheld_even_when_global_error_passes(fitted):
    artifact = deepcopy(fitted)
    artifact["validation"]["bins"][4]["predictedPercent"] = 81.0
    artifact["validation"]["calibrationError"] = 0.10
    artifact["validation"]["brier"] = 0.0181
    result = predict_probability(*_current(fitted), artifact)
    assert result["value"] is None
    assert "probability band has excessive" in result["reason"]


def test_bad_individual_setup_is_withheld_when_pooled_errors_cancel(fitted):
    artifact = deepcopy(fitted)
    artifact["validation"]["setupEvidence"]["Range watch"]["predictedPercent"] = 30.0
    artifact["validation"]["setupEvidence"]["Pullback"]["predictedPercent"] = 70.0
    result = predict_probability(*_current(fitted), artifact)
    assert result["value"] is None
    assert "setup class has excessive" in result["reason"]


def test_subprecision_brier_improvement_cannot_pass_serialized_gate(monkeypatch):
    import sklearn.metrics
    scores = iter((0.24999961, 0.24999965))
    monkeypatch.setattr(sklearn.metrics, "brier_score_loss", lambda *args: next(scores))
    artifact = train_model(events(), trained_at="2020-01-01")
    assert artifact["validation"]["brier"] == artifact["validation"]["baselineBrier"]
    assert artifact["status"] == "Insufficient evidence"
    assert "Brier" in artifact["reason"]


@pytest.mark.parametrize("change", ["schema", "sample_float", "class_count", "baseline", "overlap", "bin_partition", "setup_partition", "support_count", "array_shape", "range_shape"])
def test_validated_status_cannot_bypass_malformed_artifact_gates(fitted, change):
    artifact = deepcopy(fitted)
    if change == "schema":
        artifact["schemaVersion"] = True
    elif change == "sample_float":
        artifact["validation"]["testSamples"] = float(artifact["validation"]["testSamples"])
    elif change == "class_count":
        artifact["splits"]["test"]["targetFirst"] = 49
    elif change == "baseline":
        artifact["validation"]["baselineBrier"] = 0.5
    elif change == "overlap":
        artifact["splits"]["training"]["outcomeEnd"] = artifact["splits"]["calibration"]["start"]
    elif change == "bin_partition":
        artifact["validation"]["bins"][4]["samples"] += 1
    elif change == "setup_partition":
        artifact["validation"]["setupSamples"]["Range watch"] += 1
    elif change == "support_count":
        artifact["support"]["excludedTest"] = 1
    elif change == "array_shape":
        artifact["model"]["means"] = [0]
    elif change == "range_shape":
        artifact["model"]["trainingRanges"]["rsi14"] = [0, 1, 2]
    result = predict_probability(*_current(fitted), artifact)
    assert result["status"] == "Insufficient evidence"
    assert result["value"] is None


@pytest.mark.parametrize("change, reason", [
    ("illiquid", "50,000"), ("price", "C$1"), ("stale", "stale"),
    ("future", "future"), ("unsupported_setup", "setup class"),
    ("unsupported_bin", "probability band"), ("extrapolation", "feature support"),
    ("missing", "Too many"), ("invalid_plan", "valid 20-session"),
    ("bad_coefficients", "invalid coefficients"),
    ("bad_metadata", "validation metadata"),
    ("old_evidence", "validation period is stale"),
])
def test_support_safety_gates_withhold(fitted, change, reason):
    plan, metrics, context = _current(fitted)
    artifact = deepcopy(fitted)
    if change == "illiquid":
        context["averageDailyValue"] = 49999
    elif change == "price":
        context["price"] = 0.99
    elif change == "stale":
        plan["asOf"] = "2022-01-01"
    elif change == "future":
        plan["asOf"] = (date.fromisoformat(artifact["validation"]["testEnd"]) - timedelta(days=1)).isoformat()
    elif change == "unsupported_setup":
        artifact["validation"]["setupSamples"]["Range watch"] = 74
        artifact["validation"]["setupSamples"]["Pullback"] += 46
        for setup in ("Range watch", "Pullback"):
            item = artifact["validation"]["setupEvidence"][setup]
            item["samples"] = artifact["validation"]["setupSamples"][setup]
            item["observedHitRatePercent"] = round(item["targetFirst"] / item["samples"] * 100, 2)
    elif change == "unsupported_bin":
        artifact["model"]["coefficients"] = [0.0] * len(FEATURE_NAMES)
        artifact["model"]["intercept"] = 0.0
        artifact["model"]["calibrationIntercept"] = 0.0
    elif change == "extrapolation":
        metrics["return20d"] = 200
    elif change == "missing":
        metrics = {"atr14": 1}
    elif change == "invalid_plan":
        plan["invalidation"] = plan["target"]
    elif change == "bad_coefficients":
        artifact["model"]["coefficients"][0] = float("nan")
    elif change == "bad_metadata":
        artifact["validation"]["brier"] = "bad"
    elif change == "old_evidence":
        artifact["trainedAt"] = "2021-01-01"
        plan["asOf"] = artifact["trainedAt"]
    result = predict_probability(plan, metrics, context, artifact)
    assert result["status"] == "Insufficient evidence"
    assert result["value"] is None
    assert reason in result["reason"]
