#!/usr/bin/env python3
"""Gate leave-one-source-out temporal recognition without replaying videos."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def _ratio(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def evaluate(
    report: dict[str, Any],
    dataset: dict[str, Any],
    minimum: float,
) -> tuple[dict[str, Any], list[str]]:
    held_out = report.get("leaveOneSourceOut")
    if not isinstance(held_out, dict):
        raise ValueError("report is missing leaveOneSourceOut")
    if held_out.get("mode") != "leave_one_source_out":
        raise ValueError("report is not source-isolated leave-one-source-out evaluation")

    summary = held_out.get("summary")
    if not isinstance(summary, dict):
        raise ValueError("leaveOneSourceOut is missing summary")

    truth_boundaries = int(summary["truthBoundaryCount"])
    source_captures = int(summary["sourceCaptureCount"])
    aligned = int(summary["alignedCount"])
    exact_sets = int(summary["exactSetSourceCaptureCount"])
    exact_timelines = int(summary["exactSetAndAvailableBoundarySourceCaptureCount"])

    records = {
        str(record["captureId"]): record
        for record in dataset.get("records", [])
    }
    provenance = {
        "human_adjusted": 0,
        "algorithm_candidate": 0,
        "range_midpoint": 0,
        "legacy_unattributed": 0,
    }
    exact_midpoints = 0
    for record in records.values():
        for segment in record.get("segments", []):
            source = segment.get("peakSource", "legacy_unattributed")
            provenance[source if source in provenance else "legacy_unattributed"] += 1
            midpoint = (float(segment["startMs"]) + float(segment["endMs"])) / 2
            exact_midpoints += int(abs(float(segment["peakMs"]) - midpoint) <= 1)

    manual_range_aligned = 0
    human_peak_aligned = 0
    by_source: dict[str, list[dict[str, Any]]] = {}
    for row in held_out.get("rows", []):
        record = records.get(str(row["captureId"]), {})
        segments = record.get("segments", [])
        interval_aligned = 0
        for match in row.get("segmentMatches", []):
            range_ok = (
                abs(float(match["startOffsetMs"])) <= 500
                and abs(float(match["endOffsetMs"])) <= 500
                and float(match["iou"]) >= 0.6
            )
            interval_aligned += int(range_ok)
            truth_index = int(match["truthIndex"])
            if (
                truth_index < len(segments)
                and segments[truth_index].get("peakSource") == "human_adjusted"
                and abs(float(match["peakOffsetMs"])) <= 250
            ):
                human_peak_aligned += 1
        manual_range_aligned += interval_aligned
        part = dict(row)
        part["manualRangeAlignedCount"] = interval_aligned
        by_source.setdefault(str(row["sourceCaptureId"]), []).append(part)

    exact_manual_range_sources = sum(
        sum(int(row["predictedCount"]) for row in parts)
        == sum(int(row["expectedCount"]) for row in parts)
        and sum(int(row["manualRangeAlignedCount"]) for row in parts)
        == sum(int(row["truthCount"]) for row in parts)
        for parts in by_source.values()
    )
    human_peak_truth = provenance["human_adjusted"]

    metrics = {
        "mode": held_out["mode"],
        "truthBoundaryCount": truth_boundaries,
        "sourceCaptureCount": source_captures,
        "legacyMixedPhaseAlignedCount": aligned,
        "legacyMixedPhaseAlignedRate": _ratio(aligned, truth_boundaries),
        "manualRangeAlignedCount": manual_range_aligned,
        "manualRangeAlignedRate": _ratio(manual_range_aligned, truth_boundaries),
        "exactSetSourceCaptureCount": exact_sets,
        "exactSetSourceCaptureRate": _ratio(exact_sets, source_captures),
        "legacyExactTimelineSourceCaptureCount": exact_timelines,
        "legacyExactTimelineSourceCaptureRate": _ratio(exact_timelines, source_captures),
        "exactManualRangeSourceCaptureCount": exact_manual_range_sources,
        "exactManualRangeSourceCaptureRate": _ratio(exact_manual_range_sources, source_captures),
        "peakProvenance": provenance,
        "exactMidpointPeakCount": exact_midpoints,
        "humanPeakTruthCoverageRate": _ratio(human_peak_truth, truth_boundaries),
        "humanPeakAlignedCount": human_peak_aligned,
        "humanPeakAlignedRate": _ratio(human_peak_aligned, human_peak_truth),
        "minimumRequiredRate": minimum,
    }

    failures = []
    for key in (
        "manualRangeAlignedRate",
        "exactSetSourceCaptureRate",
        "exactManualRangeSourceCaptureRate",
        "humanPeakTruthCoverageRate",
        "humanPeakAlignedRate",
    ):
        if metrics[key] < minimum:
            failures.append(f"{key}={metrics[key]:.2%} < {minimum:.2%}")
    return metrics, failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--minimum", type=float, default=0.95)
    args = parser.parse_args()

    try:
        report = json.loads(args.report.read_text(encoding="utf-8"))
        dataset = json.loads(args.dataset.read_text(encoding="utf-8"))
        metrics, failures = evaluate(report, dataset, args.minimum)
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(f"temporal generalization gate: invalid report: {error}", file=sys.stderr)
        return 2

    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    if failures:
        print("temporal generalization gate: FAIL", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print("temporal generalization gate: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
