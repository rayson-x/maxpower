#!/usr/bin/env python3
"""Gate the research closed-cycle candidate on source-isolated range truth."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def _ratio(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def evaluate(report: dict[str, Any], minimum: float) -> tuple[dict[str, Any], list[str]]:
    if report.get("usesExpectedCountAtInference") is not False:
        raise ValueError("report must prove expectedCount is not used at inference")
    if report.get("usesLegacyPeakLabels") is not False:
        raise ValueError("report must prove legacy peak labels are not used")
    held_out = report.get("leaveOneSourceOut")
    if not isinstance(held_out, dict) or held_out.get("mode") != "leave_one_source_out":
        raise ValueError("report is not leave-one-source-out")
    summary = held_out.get("summary")
    if not isinstance(summary, dict):
        raise ValueError("leaveOneSourceOut is missing summary")

    truth = int(summary["truthRangeCount"])
    raw_predicted = int(summary.get("rawCandidateCount", summary["predictedCount"]))
    raw_matched = int(summary.get("rawMatchedCount", summary["matchedCount"]))
    predicted = int(summary["predictedCount"])
    matched = int(summary["matchedCount"])
    aligned = int(summary["manualRangeAlignedCount"])
    sources = int(summary["sourceCaptureCount"])
    exact_sets = int(summary["exactSetSourceCaptureCount"])
    exact_ranges = int(summary["exactSetAndManualRangeSourceCaptureCount"])
    metrics = {
        "mode": held_out["mode"],
        "truthRangeCount": truth,
        "rawCandidateCount": raw_predicted,
        "rawMatchedCount": raw_matched,
        "rawCandidatePrecision": _ratio(raw_matched, raw_predicted),
        "rawCandidateRecall": _ratio(raw_matched, truth),
        "predictedCount": predicted,
        "matchedCount": matched,
        "candidatePrecision": _ratio(matched, predicted),
        "candidateRecall": _ratio(matched, truth),
        "eligibleTruthRangeCount": int(summary.get("eligibleTruthRangeCount", truth)),
        "eligibleRawCandidateRecall": _ratio(
            int(summary.get("eligibleRawMatchedCount", raw_matched)),
            int(summary.get("eligibleTruthRangeCount", truth)),
        ),
        "manualRangeAlignedCount": aligned,
        "manualRangeAlignedRate": _ratio(aligned, truth),
        "sourceCaptureCount": sources,
        "exactSetSourceCaptureCount": exact_sets,
        "exactSetSourceCaptureRate": _ratio(exact_sets, sources),
        "exactSetAndManualRangeSourceCaptureCount": exact_ranges,
        "exactSetAndManualRangeSourceCaptureRate": _ratio(exact_ranges, sources),
        "minimumRequiredRate": minimum,
    }
    failures = []
    for key in (
        "candidatePrecision",
        "candidateRecall",
        "manualRangeAlignedRate",
        "exactSetSourceCaptureRate",
        "exactSetAndManualRangeSourceCaptureRate",
    ):
        if metrics[key] < minimum:
            failures.append(f"{key}={metrics[key]:.2%} < {minimum:.2%}")
    return metrics, failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    parser.add_argument("--minimum", type=float, default=0.95)
    args = parser.parse_args()
    try:
        report = json.loads(args.report.read_text(encoding="utf-8"))
        metrics, failures = evaluate(report, args.minimum)
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(f"cycle state generalization gate: invalid report: {error}", file=sys.stderr)
        return 2
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    if failures:
        print("cycle state generalization gate: FAIL", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("cycle state generalization gate: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
