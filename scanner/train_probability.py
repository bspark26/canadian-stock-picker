"""Local-only historical training: python -m scanner.train_probability.

No AI calls. Raw history/events stay in ignored cache directories. Only JSON
model coefficients and aggregate validation evidence may be published.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
import time

import numpy as np
import pandas as pd
import yfinance as yf

from .run import settings_from
from .technicals import number
from .yahoo import Cache, YahooSource, expected_completed_session

DISCLAIMER = (
    "Pilot based on today's Yahoo Canadian equity directory, not a historical constituent master. "
    "Delisted/missing listings and survivorship bias are not resolved. Technical price-only event estimates; "
    "no historical fundamentals, trading-cost profitability, intraday ordering certainty or future return guarantee. "
    "Reported stock splits restart the usable history; unexplained extreme price jumps are rejected."
)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
    temporary.replace(path)


def select_cohort(quotes, maximum):
    """Deterministic sector/exchange round robin; this is a training sample only."""
    groups = {}
    # Cboe's directory can repeat an issuer's TSX venue. Avoid training on the
    # same economic stock twice just because its ticker has another suffix.
    primary_bases = {row.get("symbol", "").rsplit(".", 1)[0] for row in quotes if row.get("symbol", "").endswith((".TO", ".V", ".CN"))}
    for quote in quotes:
        symbol = quote.get("symbol", "")
        name = f" {quote.get('shortName', '')} {quote.get('longName', '')} ".upper()
        price = number(quote.get("regularMarketPrice"))
        if not symbol or quote.get("quoteType", "EQUITY") != "EQUITY" or " CDR " in name or "CAD HEDGED" in name:
            continue
        if symbol.endswith(".NE") and symbol.rsplit(".", 1)[0] in primary_bases:
            continue
        if re.search(r"-(?:DB|WT|RT|NT)", symbol) or any(word in name for word in ("DEBENTURE", "WARRANT", " RIGHTS")):
            continue
        if quote.get("currency") not in (None, "CAD") or price is not None and price < 1:
            continue
        group = (quote.get("scannerExchange") or quote.get("exchange", "Unknown"), quote.get("sector") or "Unknown")
        volume = number(quote.get("averageDailyVolume3Month")) or number(quote.get("regularMarketVolume")) or 0
        groups.setdefault(group, []).append((-(price or 0) * volume, symbol, quote))
    for rows in groups.values():
        rows.sort(key=lambda row: (row[0], row[1]))
    chosen, seen = [], set()
    while groups and len(chosen) < maximum:
        for group in sorted(list(groups)):
            _, symbol, quote = groups[group].pop(0)
            if symbol not in seen:
                seen.add(symbol)
                chosen.append(quote)
            if not groups[group]:
                del groups[group]
            if len(chosen) >= maximum:
                break
    return chosen


def clean_history(frame):
    """Keep the post-last-split segment to avoid retrospective price-floor bias."""
    if frame.empty:
        raise ValueError("empty history")
    frame = frame.copy()
    if frame.index.tz is not None:
        frame.index = frame.index.tz_localize(None)
    frame = frame[frame.index.date <= pd.Timestamp(expected_completed_session()).date()]
    split_count, last_split = 0, None
    if "Stock Splits" in frame:
        splits = frame.index[pd.to_numeric(frame["Stock Splits"], errors="coerce").fillna(0) != 0]
        split_count = len(splits)
        if split_count:
            last_split = splits[-1].date().isoformat()
            frame = frame[frame.index > splits[-1]]
    columns = ["Open", "High", "Low", "Close", "Volume"]
    values = frame[columns].astype(float)
    if not values.index.is_monotonic_increasing or values.index.has_duplicates:
        raise ValueError("unordered or duplicate history")
    if not np.isfinite(values.to_numpy()).all() or (values[columns[:4]] <= 0).any().any() or (values.Volume < 0).any():
        raise ValueError("invalid or missing OHLCV")
    if (values.High < values[["Open", "Low", "Close"]].max(axis=1)).any() or (values.Low > values[["Open", "High", "Close"]].min(axis=1)).any():
        raise ValueError("invalid daily range")
    changes = values.Close / values.Close.shift()
    if ((changes > 4) | (changes < 0.25)).any():
        raise ValueError("unverified extreme price jump")
    if len(values) < 500:
        raise ValueError("fewer than 500 usable post-split daily bars")
    return values, {"reportedSplits": split_count, "lastSplit": last_split}


def collect(cohort, period, cache_root):
    cache = Cache(cache_root)
    session = expected_completed_session()
    records, failures = [], []
    for index, quote in enumerate(cohort):
        symbol = quote["symbol"]
        key = f"history-v1-{symbol}-{period}-{session}"
        cached = cache.get("histories", key, 168)
        if cached:
            records.append({"symbol": symbol, "path": str(cache.path("histories", key)), "exchange": quote.get("scannerExchange"), "sector": quote.get("sector")})
            print(f"[{index + 1}/{len(cohort)}] {symbol}: cached", flush=True)
            continue
        try:
            ticker = yf.Ticker(symbol)
            frame = ticker.history(period=period, interval="1d", auto_adjust=False, actions=True, repair=False, timeout=20)
            currency = (ticker.history_metadata or {}).get("currency")
            if currency != "CAD":
                raise ValueError("unconfirmed CAD trading currency")
            frame, actions = clean_history(frame)
            bars = [{"date": day.date().isoformat(), **{column: float(row[column]) for column in frame.columns}} for day, row in frame.iterrows()]
            cache.put("histories", key, {"symbol": symbol, "currency": currency, "bars": bars, **actions})
            records.append({"symbol": symbol, "path": str(cache.path("histories", key)), "exchange": quote.get("scannerExchange"), "sector": quote.get("sector")})
            print(f"[{index + 1}/{len(cohort)}] {symbol}: {len(frame)} usable bars", flush=True)
        except Exception as exc:
            failures.append({"symbol": symbol, "reason": f"{type(exc).__name__}: {exc}"[:180]})
            print(f"[{index + 1}/{len(cohort)}] {symbol}: skipped ({type(exc).__name__})", flush=True)
        time.sleep(0.3)
    return {"asOf": session, "period": period, "selected": len(cohort), "usable": len(records), "records": records, "failures": failures, "limitations": DISCLAIMER}


def load_frame(path):
    record = json.loads(Path(path).read_text())
    frame = pd.DataFrame(record["bars"])
    frame.index = pd.to_datetime(frame.pop("date"))
    return frame


def train(manifest, output, report):
    from .probability import train_model
    from .probability_events import historical_events
    events = []
    for index, record in enumerate(manifest["records"]):
        rows = historical_events(record["symbol"], load_frame(record["path"]))
        # Inference uses the same floor; do not train the model on untradeably
        # thin examples and then imply support for a liquid entry.
        rows = [row for row in rows if row["features"].get("logDollarVolume") is not None and row["features"]["logDollarVolume"] >= np.log10(50000)]
        events.extend(rows)
        print(f"Events [{index + 1}/{len(manifest['records'])}] {record['symbol']}: {len(rows)}", flush=True)
    if not events:
        raise ValueError("No usable historical events; existing model preserved")
    event_path = Path(".cache/probability/events.json")
    write_json(event_path, events)
    fingerprint = hashlib.sha256(event_path.read_bytes()).hexdigest()
    artifact = train_model(events)
    artifact["dataset"] = {
        "asOf": manifest["asOf"], "period": manifest["period"], "selectedSymbols": manifest["selected"],
        "usableHistories": manifest["usable"], "eventSymbols": len({row["symbol"] for row in events}),
        "events": len(events), "sha256": fingerprint, "limitations": DISCLAIMER,
        "selection": "Deterministic round robin by present-day exchange and sector, ordered by provider dollar-volume proxy within each group. Not a whole-market backtest.",
    }
    write_json(output, artifact)
    aggregate = {key: value for key, value in artifact.items() if key not in ("model", "coefficients", "intercept", "medians", "means", "scales", "calibrator", "support")}
    write_json(report, aggregate)
    print(f"Saved model {output} and aggregate report {report}", flush=True)
    return artifact


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--universe", help="Previously discovered Yahoo universe JSON, quotes field")
    parser.add_argument("--max-symbols", type=int, default=180)
    parser.add_argument("--period", choices=("5y", "10y"), default="10y")
    parser.add_argument("--manifest", default=".cache/probability/manifest.json")
    parser.add_argument("--collect-only", action="store_true")
    parser.add_argument("--train-only", action="store_true")
    parser.add_argument("--output", default="models/probability.json")
    parser.add_argument("--report", default="public/data/probability-validation.json")
    args = parser.parse_args(argv)
    if args.max_symbols < 1 or args.collect_only and args.train_only:
        parser.error("Use a positive cohort size and one operation mode")
    try:
        if args.train_only:
            manifest = json.loads(Path(args.manifest).read_text())
        else:
            quotes = json.loads(Path(args.universe).read_text())["quotes"] if args.universe else YahooSource(settings_from(None)).universe()[0]
            manifest = collect(select_cohort(quotes, args.max_symbols), args.period, ".cache/probability")
            manifest["collectedAt"] = datetime.now(timezone.utc).isoformat()
            write_json(args.manifest, manifest)
            print(f"Collected {manifest['usable']} of {manifest['selected']} training histories", flush=True)
        if not args.collect_only:
            train(manifest, args.output, args.report)
        return 0
    except Exception as exc:
        print(f"Probability training failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
