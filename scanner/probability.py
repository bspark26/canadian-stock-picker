"""Time-ordered, held-out probability estimates for the frozen technical event.

The artifact contains plain coefficients and validation metadata, never a pickle
or training rows. Failure to meet a preset gate withholds forecasts. A model's
validation is conditional on the supplied research universe; current Yahoo
listings alone cannot establish survivorship-unbiased market-wide performance.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
import math

import numpy as np

from .trade_plans import EVENT

MODEL_VERSION = "target-before-stop-logit-v1"
SETUPS = ("Pullback", "Range watch", "Trend continuation")
NUMERIC_FEATURES = (
    "rewardRisk", "targetAtr", "stopAtr", "entryDistanceAtr", "rsi14",
    "distanceSma50Atr", "return20d", "relativeVolume", "logDollarVolume",
)
SETUP_FEATURES = ("setupPullback", "setupRangeWatch", "setupTrendContinuation")
FEATURE_NAMES = NUMERIC_FEATURES + SETUP_FEATURES
GATES = {
    "trainingSamples": 500, "calibrationSamples": 200, "testSamples": 300,
    "symbols": 40, "testSymbols": 20,
    "calibrationEachClass": 30, "testEachClass": 50,
    "maxCalibrationError": 0.10,
    "maxBandCalibrationError": 0.15, "maxSetupCalibrationError": 0.15,
    "minDailyValue": 50000, "setupTestSamples": 75, "binTestSamples": 50,
    "maxAgeDays": 120,
}


def _number(value):
    if isinstance(value, bool):
        return None
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError, OverflowError):
        return None


def _day(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def build_features(plan, technicals, context):
    """Features for both historical signals and the current frozen scenario.

    ``context`` supplies the contemporaneous price, averageDailyValue and setup.
    Missing numeric features stay None; training-only medians impute them later.
    No fundamental or future-outcome information is used.
    """
    plan, technicals, context = plan or {}, technicals or {}, context or {}
    price, volume = (_number(context.get(key)) for key in ("price", "averageDailyValue"))
    atr = _number(technicals.get("atr14"))
    entry, target, stop = (_number(plan.get(key)) for key in ("referenceEntry", "target", "invalidation"))
    average = _number(technicals.get("sma50"))

    def in_atr(first, second):
        return (first - second) / atr if first is not None and second is not None and atr is not None and atr > 0 else None

    result = {
        "rewardRisk": _number(plan.get("rewardRisk")),
        "targetAtr": in_atr(target, entry), "stopAtr": in_atr(entry, stop),
        "entryDistanceAtr": in_atr(price, entry),
        "rsi14": _number(technicals.get("rsi14")),
        "distanceSma50Atr": in_atr(price, average),
        "return20d": _number(technicals.get("return20d")),
        "relativeVolume": _number(technicals.get("relativeVolume")),
        "logDollarVolume": math.log10(volume) if volume is not None and volume > 0 else None,
    }
    setup = context.get("setup")
    result.update({key: float(setup == name) for key, name in zip(SETUP_FEATURES, SETUPS)})
    return result


def _summary(rows):
    dates = [row["signalDate"] for row in rows]
    return {
        "samples": len(rows), "symbols": len({row["symbol"] for row in rows}),
        "start": min(dates).isoformat() if dates else None,
        "end": max(dates).isoformat() if dates else None,
        "outcomeEnd": max((row["outcomeEnd"] for row in rows), default=None).isoformat() if rows else None,
        "targetFirst": sum(row["label"] == "targetFirst" for row in rows),
    }


def _normalise(events):
    rows, seen = [], set()
    for event in events:
        if not isinstance(event, dict):
            continue
        signal, end = _day(event.get("signalDate")), _day(event.get("outcomeEnd"))
        symbol, setup = event.get("symbol"), event.get("setup")
        features = event.get("features")
        if not isinstance(symbol, str) or not symbol.strip() or setup not in SETUPS:
            continue
        if signal is None or end is None or end <= signal or event.get("label") not in ("targetFirst", "stopFirst", "expired"):
            continue
        if not isinstance(features, dict):
            continue
        values = {name: _number(features.get(name)) for name in FEATURE_NAMES}
        # Match the forecast domain using contemporaneous liquidity, never
        # today's liquidity for a historical signal or an imputed unknown.
        if values["logDollarVolume"] is None or values["logDollarVolume"] < math.log10(GATES["minDailyValue"]):
            continue
        # The categorical feature must agree with the event label, not be imputed.
        if any(values[key] != float(setup == name) for key, name in zip(SETUP_FEATURES, SETUPS)):
            continue
        if sum(values[name] is not None for name in NUMERIC_FEATURES) < 6:
            continue
        identity = (symbol, signal)
        if identity in seen:
            continue
        seen.add(identity)
        rows.append({"symbol": symbol, "signalDate": signal, "outcomeEnd": end,
                     "label": event["label"], "setup": setup, "features": values})
    return sorted(rows, key=lambda row: (row["signalDate"], row["symbol"]))


def _matrix(rows):
    return np.asarray([[row["features"][name] if row["features"][name] is not None else np.nan for name in FEATURE_NAMES] for row in rows], dtype=float)


def _unsupported_feature(features, ranges):
    """Identical numeric support rule for calibration, testing and inference."""
    for name in NUMERIC_FEATURES:
        lower, upper = ranges[name]
        margin = max((upper - lower) * 0.10, abs(lower) * 0.01, 0.01)
        value = features[name]
        if value is not None and not lower - margin <= value <= upper + margin:
            return name
    return None


def _sigmoid(values):
    return 1 / (1 + np.exp(-np.clip(values, -40, 40)))


def _wilson(successes, samples):
    z = 1.959963984540054
    p = successes / samples
    denominator = 1 + z * z / samples
    center = (p + z * z / (2 * samples)) / denominator
    half = z * math.sqrt(p * (1 - p) / samples + z * z / (4 * samples * samples)) / denominator
    return round(max(0, center - half) * 100, 2), round(min(1, center + half) * 100, 2)


def _reliability(predictions, labels):
    bins = []
    assignments = np.minimum((predictions * 5).astype(int), 4)
    for index in range(5):
        selected = assignments == index
        count = int(selected.sum())
        successes = int(labels[selected].sum())
        interval = _wilson(successes, count) if count else (None, None)
        bins.append({
            "index": index, "lowPercent": index * 20, "highPercent": (index + 1) * 20,
            "samples": count, "targetFirst": successes,
            "predictedPercent": round(float(predictions[selected].mean()) * 100, 2) if count else None,
            "observedHitRatePercent": round(successes / count * 100, 2) if count else None,
            "intervalLowPercent": interval[0], "intervalHighPercent": interval[1],
        })
    error = sum(item["samples"] / len(labels) * abs((item["predictedPercent"] - item["observedHitRatePercent"]) / 100) for item in bins if item["samples"])
    return bins, float(error)


def train_model(events, *, trained_at=None):
    """Train, calibrate and evaluate once using preset chronological 60/20/20 cuts.

    Signals are grouped by date across every symbol. Labels crossing the next
    partition boundary are purged; calibration/test data never set imputation,
    scaling or base-model parameters. The test is not used to tune parameters.
    """
    events = list(events)
    rows = _normalise(events)
    today = _day(trained_at) if trained_at is not None else datetime.now(timezone.utc).date()
    if today is None:
        raise ValueError("trained_at must be an ISO date")
    artifact = {
        "schemaVersion": 1, "modelVersion": MODEL_VERSION,
        "status": "Insufficient evidence", "reason": "Not enough dated historical events to train and validate.",
        "event": EVENT, "trainedAt": today.isoformat(), "gates": dict(GATES),
        "data": {"inputEvents": len(events), "acceptedEvents": len(rows), "rejectedEvents": len(events) - len(rows), "symbols": len({row["symbol"] for row in rows})},
        "scope": "Price-only, conditional-on-fill model of supplied historical listings; current-listing data has survivorship and Yahoo corporate-action limitations. No fees, spreads or execution guarantee.",
    }
    dates = sorted({row["signalDate"] for row in rows})
    if len(dates) < 5:
        return artifact
    calibration_start, test_start = dates[int(len(dates) * 0.6)], dates[int(len(dates) * 0.8)]
    training_candidates = [row for row in rows if row["signalDate"] < calibration_start]
    calibration_candidates = [row for row in rows if calibration_start <= row["signalDate"] < test_start]
    training = [row for row in training_candidates if row["outcomeEnd"] < calibration_start]
    calibration = [row for row in calibration_candidates if row["outcomeEnd"] < test_start]
    test = [row for row in rows if row["signalDate"] >= test_start]
    purged_training, purged_calibration = len(training_candidates) - len(training), len(calibration_candidates) - len(calibration)
    # Apply the production feature domain before calibrator fitting or test
    # sample accounting. Out-of-domain examples cannot lend support to forecasts
    # that production would withhold. The range derives from training only.
    prepared = None
    if training:
        x_train = _matrix(training)
        if not np.isnan(x_train).all(axis=0).any():
            imputation = np.nanmedian(x_train, axis=0)
            x_train = np.where(np.isnan(x_train), imputation, x_train)
            means, scales = x_train.mean(axis=0), x_train.std(axis=0)
            scales[scales == 0] = 1
            ranges = {name: [float(x_train[:, index].min()), float(x_train[:, index].max())] for index, name in enumerate(FEATURE_NAMES)}
            supported_calibration = [row for row in calibration if _unsupported_feature(row["features"], ranges) is None]
            supported_test = [row for row in test if _unsupported_feature(row["features"], ranges) is None]
            artifact["support"] = {"trainingRanges": ranges,
                                   "excludedCalibration": len(calibration) - len(supported_calibration),
                                   "excludedTest": len(test) - len(supported_test)}
            calibration, test = supported_calibration, supported_test
            prepared = x_train, imputation, means, scales, ranges
    artifact["splits"] = {"training": _summary(training), "calibration": _summary(calibration), "test": _summary(test),
                          "purgedTraining": purged_training, "purgedCalibration": purged_calibration}
    failures = []
    for name, partition, minimum in (("training", training, GATES["trainingSamples"]), ("calibration", calibration, GATES["calibrationSamples"]), ("test", test, GATES["testSamples"])):
        if len(partition) < minimum:
            failures.append(f"{name} needs at least {minimum} filled events (has {len(partition)})")
    if artifact["data"]["symbols"] < GATES["symbols"]:
        failures.append(f"at least {GATES['symbols']} historical symbols are required")
    if len({row["symbol"] for row in test}) < GATES["testSymbols"]:
        failures.append(f"at least {GATES['testSymbols']} untouched-test symbols are required")
    for name, partition, minimum in (("calibration", calibration, GATES["calibrationEachClass"]), ("test", test, GATES["testEachClass"])):
        positives = sum(row["label"] == "targetFirst" for row in partition)
        if min(positives, len(partition) - positives) < minimum:
            failures.append(f"{name} needs at least {minimum} target-first and {minimum} other outcomes")
    if rows and max(row["outcomeEnd"] for row in rows) > today:
        failures.append("outcomes extend beyond the model training date")
    if prepared is None:
        failures.append("a feature has no observed values in the training period")
    if failures:
        artifact["reason"] = "; ".join(failures) + "."
        return artifact
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import brier_score_loss, log_loss

    x_train, imputation, means, scales, ranges = prepared
    x_calibration, x_test = (_matrix(partition) for partition in (calibration, test))
    transform = lambda values: (np.where(np.isnan(values), imputation, values) - means) / scales
    y_train, y_calibration, y_test = (np.asarray([int(row["label"] == "targetFirst") for row in partition]) for partition in (training, calibration, test))
    if len(np.unique(y_train)) < 2:
        artifact["reason"] = "The training period contains only one outcome class."
        return artifact
    base = LogisticRegression(C=1.0, solver="lbfgs", max_iter=1000).fit(transform(x_train), y_train)
    calibrator = LogisticRegression(C=1.0, solver="lbfgs", max_iter=1000).fit(base.decision_function(transform(x_calibration)).reshape(-1, 1), y_calibration)
    # The same clipping is used in validation and inference: never display
    # impossible certainty as a rounded 0% or 100% estimate.
    predictions = np.clip(calibrator.predict_proba(base.decision_function(transform(x_test)).reshape(-1, 1))[:, 1], 0.01, 0.99)
    baseline_rate = float(y_calibration.mean())
    baseline = np.full(len(y_test), baseline_rate)
    brier, baseline_brier = (float(brier_score_loss(y_test, values)) for values in (predictions, baseline))
    bins, error = _reliability(predictions, y_test)
    artifact["validation"] = {
        "testSamples": len(test), "testSymbols": len({row["symbol"] for row in test}),
        "testStart": artifact["splits"]["test"]["start"], "testEnd": artifact["splits"]["test"]["outcomeEnd"],
        "brier": round(brier, 6), "baselineBrier": round(baseline_brier, 6),
        "logLoss": round(float(log_loss(y_test, predictions)), 6),
        "baselineLogLoss": round(float(log_loss(y_test, baseline)), 6),
        "baselineRatePercent": round(baseline_rate * 100, 2), "calibrationError": round(error, 6),
        "bins": bins, "setupSamples": {setup: sum(row["setup"] == setup for row in test) for setup in SETUPS},
    }
    setup_evidence = {}
    for setup in SETUPS:
        mask = np.asarray([row["setup"] == setup for row in test])
        samples, positives = int(mask.sum()), int(y_test[mask].sum())
        setup_evidence[setup] = {
            "samples": samples, "targetFirst": positives,
            "predictedPercent": round(float(predictions[mask].mean()) * 100, 2) if samples else None,
            "observedHitRatePercent": round(positives / samples * 100, 2) if samples else None,
        }
    artifact["validation"]["setupEvidence"] = setup_evidence
    if artifact["validation"]["brier"] >= artifact["validation"]["baselineBrier"]:
        failures.append("untouched-test Brier score does not beat the calibration-prevalence baseline")
    if error > GATES["maxCalibrationError"]:
        failures.append("untouched-test calibration error exceeds 0.10")
    if float(calibrator.coef_[0, 0]) <= 0:
        failures.append("calibration does not preserve the base model's ordering")
    if failures:
        artifact["reason"] = "; ".join(failures) + "."
        return artifact
    artifact["model"] = {
        "featureNames": list(FEATURE_NAMES), "imputation": imputation.tolist(), "means": means.tolist(), "scales": scales.tolist(),
        "coefficients": base.coef_[0].tolist(), "intercept": float(base.intercept_[0]),
        "calibrationCoefficient": float(calibrator.coef_[0, 0]), "calibrationIntercept": float(calibrator.intercept_[0]),
        "trainingRanges": ranges,
    }
    artifact["status"] = "Validated"
    artifact["reason"] = "Preset chronological validation gates passed; estimates remain conditional on the supplied universe and execution assumptions."
    return artifact


def _valid_plan(plan):
    if not isinstance(plan, dict) or plan.get("status") not in ("Ready", "Wait"):
        return False
    keys = ("invalidation", "entryLow", "referenceEntry", "entryHigh", "target")
    stop, low, entry, high, target = (_number(plan.get(key)) for key in keys)
    return (None not in (stop, low, entry, high, target) and 0 < stop < low <= entry <= high < target
            and low >= 1 and (target - high) / (high - stop) >= 1.5
            and plan.get("horizonSessions") == 20 and plan.get("entryValidForSessions") == 5)


def _valid_artifact_metadata(artifact):
    """Recheck serialized gates and support accounting before using coefficients."""
    def integer(value):
        return isinstance(value, int) and not isinstance(value, bool) and value >= 0

    def real(value):
        return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)

    def outcome_group(group, minimum=0):
        if not isinstance(group, dict) or not integer(group.get("samples")) or not integer(group.get("targetFirst")):
            return False
        count, successes = group["samples"], group["targetFirst"]
        if count < minimum or successes > count:
            return False
        if count == 0:
            return group.get("predictedPercent") is None and group.get("observedHitRatePercent") is None
        predicted, observed = group.get("predictedPercent"), group.get("observedHitRatePercent")
        return (real(predicted) and real(observed) and 0 <= predicted <= 100
                and observed == round(successes / count * 100, 2))

    try:
        if (type(artifact.get("schemaVersion")) is not int or artifact.get("schemaVersion") != 1 or artifact.get("event") != EVENT
                or artifact.get("gates") != GATES):
            return False
        trained = _day(artifact["trainedAt"])
        data, splits, validation, support = (artifact[key] for key in ("data", "splits", "validation", "support"))
        if trained is None or not all(isinstance(item, dict) for item in (data, splits, validation, support)):
            return False
        if (any(not integer(support.get(key)) for key in ("excludedCalibration", "excludedTest"))
                or support.get("trainingRanges") != artifact["model"].get("trainingRanges")):
            return False
        if any(not integer(data.get(key)) for key in ("inputEvents", "acceptedEvents", "rejectedEvents", "symbols")):
            return False
        if data["inputEvents"] != data["acceptedEvents"] + data["rejectedEvents"] or not GATES["symbols"] <= data["symbols"] <= data["acceptedEvents"]:
            return False
        for name, minimum in (("training", GATES["trainingSamples"]), ("calibration", GATES["calibrationSamples"]), ("test", GATES["testSamples"])):
            part = splits[name]
            if not isinstance(part, dict) or any(not integer(part.get(key)) for key in ("samples", "symbols", "targetFirst")):
                return False
            start, end, outcome_end = (_day(part.get(key)) for key in ("start", "end", "outcomeEnd"))
            if (None in (start, end, outcome_end) or not start <= end < outcome_end <= trained
                    or part["samples"] < minimum or not 0 < part["symbols"] <= min(part["samples"], data["symbols"])
                    or not 0 < part["targetFirst"] < part["samples"]):
                return False
        if (any(not integer(splits.get(key)) for key in ("purgedTraining", "purgedCalibration"))
                or data["acceptedEvents"] != sum(splits[name]["samples"] for name in ("training", "calibration", "test")) + splits["purgedTraining"] + splits["purgedCalibration"] + support["excludedCalibration"] + support["excludedTest"]
                or _day(splits["training"]["outcomeEnd"]) >= _day(splits["calibration"]["start"])
                or _day(splits["calibration"]["outcomeEnd"]) >= _day(splits["test"]["start"])):
            return False
        for name, minimum in (("calibration", GATES["calibrationEachClass"]), ("test", GATES["testEachClass"])):
            part = splits[name]
            if min(part["targetFirst"], part["samples"] - part["targetFirst"]) < minimum:
                return False
        if (not integer(validation.get("testSamples")) or not integer(validation.get("testSymbols"))
                or validation.get("testSamples") != splits["test"]["samples"] or validation.get("testSymbols") != splits["test"]["symbols"]
                or splits["test"]["symbols"] < GATES["testSymbols"] or validation.get("testStart") != splits["test"]["start"]
                or validation.get("testEnd") != splits["test"]["outcomeEnd"]):
            return False
        if any(not real(validation.get(key)) for key in ("brier", "baselineBrier", "calibrationError", "logLoss", "baselineLogLoss", "baselineRatePercent")):
            return False
        if (not 0 <= validation["brier"] < validation["baselineBrier"] <= 1
                or not 0 <= validation["calibrationError"] <= GATES["maxCalibrationError"]
                or min(validation["logLoss"], validation["baselineLogLoss"]) < 0):
            return False
        calibration_rate = splits["calibration"]["targetFirst"] / splits["calibration"]["samples"]
        test_rate = splits["test"]["targetFirst"] / splits["test"]["samples"]
        expected_baseline = test_rate * (1 - calibration_rate) ** 2 + (1 - test_rate) * calibration_rate ** 2
        if validation["baselineBrier"] != round(expected_baseline, 6) or validation["baselineRatePercent"] != round(calibration_rate * 100, 2):
            return False
        bins, setups, evidence = (validation[key] for key in ("bins", "setupSamples", "setupEvidence"))
        if not isinstance(bins, list) or len(bins) != 5 or not isinstance(setups, dict) or not isinstance(evidence, dict):
            return False
        for index, group in enumerate(bins):
            if (not outcome_group(group) or type(group.get("index")) is not int or group.get("index") != index or group.get("lowPercent") != index * 20
                    or group.get("highPercent") != (index + 1) * 20):
                return False
            if group["samples"]:
                if (not group["lowPercent"] <= group["predictedPercent"] <= group["highPercent"]
                        or not real(group.get("intervalLowPercent")) or not real(group.get("intervalHighPercent"))
                        or not 0 <= group["intervalLowPercent"] <= group["observedHitRatePercent"] <= group["intervalHighPercent"] <= 100):
                    return False
            elif group.get("intervalLowPercent") is not None or group.get("intervalHighPercent") is not None:
                return False
        if (sum(group["samples"] for group in bins) != validation["testSamples"]
                or sum(group["targetFirst"] for group in bins) != splits["test"]["targetFirst"]):
            return False
        error = sum(group["samples"] / validation["testSamples"] * abs(group["predictedPercent"] - group["observedHitRatePercent"]) / 100 for group in bins if group["samples"])
        if round(error, 6) != validation["calibrationError"]:
            return False
        if set(setups) != set(SETUPS) or set(evidence) != set(SETUPS):
            return False
        for setup in SETUPS:
            if not integer(setups[setup]) or not outcome_group(evidence[setup]) or setups[setup] != evidence[setup]["samples"]:
                return False
        return (sum(setups.values()) == validation["testSamples"]
                and sum(group["targetFirst"] for group in evidence.values()) == splits["test"]["targetFirst"])
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
        return False


def predict_probability(plan, technicals, context, artifact):
    """Return an integer-percent estimate only inside the validated support scope."""
    result = {"value": None, "status": "Insufficient evidence", "event": EVENT,
              "reason": "No validated probability artifact is available."}
    if not _valid_plan(plan):
        result["reason"] = "A valid 20-session entry/target/invalidation scenario is required."
        return result
    if not isinstance(artifact, dict) or artifact.get("status") != "Validated" or artifact.get("modelVersion") != MODEL_VERSION:
        if isinstance(artifact, dict) and isinstance(artifact.get("reason"), str):
            result["reason"] = artifact["reason"]
        return result
    result.update({"modelVersion": MODEL_VERSION, "asOf": artifact.get("trainedAt")})
    model, validation = artifact.get("model"), artifact.get("validation")
    if not isinstance(model, dict) or not isinstance(validation, dict):
        result["reason"] = "The probability artifact is incomplete."
        return result
    if not _valid_artifact_metadata(artifact):
        result["reason"] = "The probability artifact contains invalid validation metadata."
        return result
    day, trained = _day(plan.get("asOf")), _day(artifact.get("trainedAt"))
    if day is None or trained is None or abs((day - trained).days) > GATES["maxAgeDays"]:
        result["reason"] = "The probability model is stale or its dates cannot be verified."
        return result
    latest_outcome = _day(validation.get("testEnd"))
    if latest_outcome is None or latest_outcome > day:
        result["reason"] = "Validation uses outcomes after this signal; a historical prediction would leak future information."
        return result
    if (day - latest_outcome).days > GATES["maxAgeDays"]:
        result["reason"] = "The held-out validation period is stale; fresh model training alone cannot refresh old evidence."
        return result
    context = context or {}
    liquidity = _number(context.get("averageDailyValue"))
    price = _number(context.get("price"))
    setup = context.get("setup")
    if liquidity is None or liquidity < GATES["minDailyValue"] or price is None or price < 1:
        result["reason"] = "A C$1 minimum price and at least C$50,000 average daily traded value are required for probability support."
        return result
    setup_samples = _number(validation["setupSamples"].get(setup, 0)) if isinstance(setup, str) else None
    if setup not in SETUPS or setup_samples is None or setup_samples < GATES["setupTestSamples"]:
        result["reason"] = "This setup class has fewer than 75 untouched-test events."
        return result
    setup_evidence = validation["setupEvidence"][setup]
    if abs(setup_evidence["predictedPercent"] - setup_evidence["observedHitRatePercent"]) / 100 > GATES["maxSetupCalibrationError"]:
        result["reason"] = "This setup class has excessive held-out calibration error."
        return result
    features = build_features(plan, technicals, context)
    if sum(features[name] is None for name in NUMERIC_FEATURES) > 3:
        result["reason"] = "Too many current technical features are unavailable."
        return result
    try:
        if model.get("featureNames") != list(FEATURE_NAMES):
            raise ValueError("feature mismatch")
        arrays = {name: np.asarray(model[name], dtype=float) for name in ("imputation", "means", "scales", "coefficients")}
        if any(values.shape != (len(FEATURE_NAMES),) or not np.isfinite(values).all() for values in arrays.values()) or (arrays["scales"] <= 0).any():
            raise ValueError("invalid coefficients")
        scalars = [_number(model.get(name)) for name in ("intercept", "calibrationCoefficient", "calibrationIntercept")]
        if None in scalars or scalars[1] <= 0:
            raise ValueError("invalid calibration")
        ranges = {}
        for name in FEATURE_NAMES:
            bounds = model["trainingRanges"][name]
            lower, upper = (_number(item) for item in bounds)
            if lower is None or upper is None or lower > upper:
                raise ValueError("invalid training range")
            ranges[name] = lower, upper
        unsupported = _unsupported_feature(features, ranges)
        if unsupported is not None:
            result["reason"] = f"Current {unsupported} is outside the model's historical feature support."
            return result
        values = np.asarray([features[name] if features[name] is not None else arrays["imputation"][index] for index, name in enumerate(FEATURE_NAMES)])
        score = float(np.dot((values - arrays["means"]) / arrays["scales"], arrays["coefficients"]) + scalars[0])
        prediction = float(np.clip(_sigmoid(scalars[1] * score + scalars[2]), 0.01, 0.99))
        index = min(int(prediction * 5), 4)
        bucket = next(item for item in validation["bins"] if item.get("index") == index)
        bin_samples, observed = _number(bucket.get("samples")), _number(bucket.get("observedHitRatePercent"))
        if bin_samples is None:
            raise ValueError("invalid bin metadata")
        if bin_samples < GATES["binTestSamples"]:
            result["reason"] = "This probability band has fewer than 50 untouched-test events."
            return result
        if observed is None or not 0 <= observed <= 100:
            raise ValueError("invalid bin metadata")
        if abs(bucket["predictedPercent"] - observed) / 100 > GATES["maxBandCalibrationError"]:
            result["reason"] = "This probability band has excessive held-out calibration error."
            return result
    except (KeyError, TypeError, ValueError, AttributeError, StopIteration, OverflowError):
        result["reason"] = "The probability artifact contains invalid coefficients or support metadata."
        return result
    result.update({
        "value": int(math.floor(prediction * 100 + 0.5)), "status": "Estimated",
        "reason": "Estimated target-before-invalidation chance conditional on the model's reference-entry buy-limit fill, skipping opening gaps at or below invalidation. A different entry price requires a new estimate. Held-out historical validation does not guarantee this trade or future market conditions.",
        "validation": {**{name: validation[name] for name in ("testSamples", "testSymbols", "brier", "baselineBrier", "calibrationError", "testStart", "testEnd")},
                       "setupSamples": validation["setupSamples"][setup], "binSamples": bucket["samples"],
                       "observedHitRatePercent": bucket["observedHitRatePercent"]},
    })
    return result
