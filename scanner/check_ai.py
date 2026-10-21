"""One uncached, manual AI connection check using explicitly synthetic evidence."""
from __future__ import annotations

from copy import deepcopy
import os
from pathlib import Path
import tempfile

from .ai import curate
from .demo import demo_scan
from .run import settings_from
from .yahoo import Cache


def main():
    if not os.environ.get("OPENAI_API_KEY", "").strip():
        print("AI connection check failed: OPENAI_API_KEY is missing.")
        return 1

    settings = settings_from(None)
    settings["ai_max_spend_usd"] = 0.05
    settings["ai_max_output_tokens"] = 1000
    # The scheduled scanner's per-run settings cannot increase this one-call check.
    os.environ["AI_MAX_SPEND_USD"] = "0.05"
    fixture = deepcopy(demo_scan(settings)["opportunities"][0])
    with tempfile.TemporaryDirectory(prefix="maple-ai-check-") as directory:
        analyzed, model, warnings = curate([fixture], settings, Cache(directory), 1)
    success = analyzed == 1 and fixture["analysisKind"] == "AI"
    status = "PASSED" if success else "FAILED"
    lines = [
        f"AI connection check: {status}",
        f"Model: {model}",
        f"Synthetic summaries successfully processed: {analyzed}/1",
        "A maximum of one API generation was attempted; there are no automatic retries.",
        "No live market data was fetched and no dashboard data was changed.",
        *warnings,
    ]
    for line in lines:
        print(line)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with Path(summary).open("a") as handle:
            handle.write("\n".join(lines) + "\n")
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
