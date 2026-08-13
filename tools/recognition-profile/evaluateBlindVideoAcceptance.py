#!/usr/bin/env python3
"""Evaluate source-isolated video recognition without treating replay as accuracy.

The random source order is an audit aid. Acceptance always aggregates every
eligible held-out source so a lucky single-video draw cannot pass the gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = "maxpower-blind-video-acceptance/v1"


def _ratio(numerator: int | float, denominator: int | float) -> float:
    return float(numerator) / float(denominator) if denominator else 0.0


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _quantile(values: Iterable[float], quantile: float) -> float | None:
    ordered = sorted(float(value) for value in values if math.isfinite(float(value)))
    if not ordered:
        return None
    position = (len(ordered) - 1) * quantile
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def deterministic_audit_order(source_ids: Iterable[str], seed: str) -> list[str]:
    unique = sorted(set(str(source_id) for source_id in source_ids))
    return sorted(
        unique,
        key=lambda source_id: (
            hashlib.sha256(f"{seed}\0{source_id}".encode("utf-8")).hexdigest(),
            source_id,
        ),
    )


def _require_blind_protocol(report: dict[str, Any]) -> list[dict[str, Any]]:
    for flag in ("usesExpectedCountAtInference", "usesTruthRangesAtInference"):
        if report.get(flag) is not False:
            raise ValueError(f"{flag} must be false")
    if report.get("usesLegacyPeakLabels") is not False:
        raise ValueError("legacy peak labels cannot be used as held-out truth")
    protocol = report.get("evaluationProtocol")
    if not isinstance(protocol, dict):
        raise ValueError("evaluationProtocol is missing")
    if protocol.get("mode") != "exhaustive_leave_one_source_out":
        raise ValueError("evaluation must exhaustively leave out every source")
    if protocol.get("partitionUnit") != "sourceCaptureId":
        raise ValueError("partitionUnit must be sourceCaptureId")
    if protocol.get("inferenceBeforeLabelReveal") is not True:
        raise ValueError("labels must be revealed after inference")
    if protocol.get("aggregateAllHeldOutSources") is not True:
        raise ValueError("acceptance must aggregate every held-out source")

    held_out = report.get("leaveOneSourceOut")
    if not isinstance(held_out, dict) or held_out.get("mode") != "leave_one_source_out":
        raise ValueError("leaveOneSourceOut report is missing or invalid")
    rows = held_out.get("rows")
    if not isinstance(rows, list) or not rows:
        raise ValueError("leaveOneSourceOut rows are missing")
    eligible = [row for row in rows if row.get("leaveOneSourceOutEligible") is True]
    if not eligible:
        raise ValueError("no eligible held-out source exists")

    for row in eligible:
        source_id = str(row.get("sourceCaptureId"))
        held_out_id = str(row.get("heldOutSourceId"))
        training_ids = {str(value) for value in row.get("trainingSourceIds", [])}
        if not source_id or held_out_id != source_id:
            raise ValueError(f"held-out identity mismatch for {source_id}")
        if source_id in training_ids or row.get("splitLeakageDetected") is not False:
            raise ValueError(f"source leakage detected for {source_id}")
        if row.get("labelsRevealedAfterInference") is not True:
            raise ValueError(f"label reveal order is unproven for {source_id}")
    return eligible


def _aggregate_rows(
    rows: list[dict[str, Any]],
    thresholds: dict[str, Any],
) -> dict[str, Any]:
    truth = sum(int(row["truthCount"]) for row in rows)
    predicted = sum(int(row["predictedCount"]) for row in rows)
    matched = sum(int(row["matchedCount"]) for row in rows)
    start_end_tolerance = float(thresholds["startEndToleranceMs"])
    peak_tolerance = float(thresholds["peakToleranceMs"])
    minimum_iou = float(thresholds["minimumIntervalIoU"])

    aligned = 0
    peak_aligned = 0
    eligible_peak_truth = 0
    peak_truth_provenance: dict[str, int] = defaultdict(int)
    start_errors: list[float] = []
    peak_errors: list[float] = []
    end_errors: list[float] = []
    ious: list[float] = []
    for row in rows:
        for match in row.get("segmentMatches", []):
            start_error = abs(float(match["startOffsetMs"]))
            end_error = abs(float(match["endOffsetMs"]))
            iou = float(match["iou"])
            start_errors.append(start_error)
            end_errors.append(end_error)
            ious.append(iou)
            aligned += int(
                start_error <= start_end_tolerance
                and end_error <= start_end_tolerance
                and iou >= minimum_iou
            )
            peak_source = str(match.get("truthPeakSource") or "legacy_unattributed")
            peak_truth_provenance[peak_source] += 1
            peak_offset = match.get("peakOffsetMs")
            if (
                peak_source == "human_adjusted"
                and isinstance(peak_offset, (int, float))
                and math.isfinite(float(peak_offset))
            ):
                peak_error = abs(float(peak_offset))
                eligible_peak_truth += 1
                peak_errors.append(peak_error)
                peak_aligned += int(peak_error <= peak_tolerance)

    by_source: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_source[str(row["sourceCaptureId"])].append(row)
    exact_sets = 0
    exact_timelines = 0
    for parts in by_source.values():
        source_truth = sum(int(row["truthCount"]) for row in parts)
        source_expected = sum(int(row["expectedCount"]) for row in parts)
        source_predicted = sum(int(row["predictedCount"]) for row in parts)
        source_aligned = 0
        for row in parts:
            for match in row.get("segmentMatches", []):
                source_aligned += int(
                    abs(float(match["startOffsetMs"])) <= start_end_tolerance
                    and abs(float(match["endOffsetMs"])) <= start_end_tolerance
                    and float(match["iou"]) >= minimum_iou
                )
        count_exact = source_predicted == source_expected
        exact_sets += int(count_exact)
        exact_timelines += int(count_exact and source_aligned == source_truth)

    source_count = len(by_source)
    return {
        "sourceCaptureCount": source_count,
        "evaluationWindowCount": len(rows),
        "truthRangeCount": truth,
        "predictedCount": predicted,
        "matchedCount": matched,
        "candidatePrecision": _ratio(matched, predicted),
        "candidateRecall": _ratio(matched, truth),
        "exactSetSourceCount": exact_sets,
        "exactSetSourceRate": _ratio(exact_sets, source_count),
        "manualRangeAlignedCount": aligned,
        "manualRangeAlignedRate": _ratio(aligned, truth),
        "eligiblePeakTruthCount": eligible_peak_truth,
        "peakWithinToleranceCount": peak_aligned,
        "peakWithinToleranceRate": (
            _ratio(peak_aligned, eligible_peak_truth) if eligible_peak_truth else None
        ),
        "peakTruthProvenance": dict(sorted(peak_truth_provenance.items())),
        "exactTimelineSourceCount": exact_timelines,
        "exactTimelineSourceRate": _ratio(exact_timelines, source_count),
        "unmatchedTruthRangeCount": max(0, truth - matched),
        "unmatchedPredictionCount": max(0, predicted - matched),
        "absoluteBoundaryErrorMs": {
            "startMedian": _quantile(start_errors, 0.5),
            "startP95": _quantile(start_errors, 0.95),
            "peakMedian": _quantile(peak_errors, 0.5),
            "peakP95": _quantile(peak_errors, 0.95),
            "endMedian": _quantile(end_errors, 0.5),
            "endP95": _quantile(end_errors, 0.95),
        },
        "intervalIoU": {
            "median": _quantile(ious, 0.5),
            "p05": _quantile(ious, 0.05),
        },
    }


def _metric_failures(metrics: dict[str, Any], thresholds: dict[str, Any]) -> list[str]:
    failures = []
    for key in (
        "candidatePrecision",
        "candidateRecall",
        "exactSetSourceRate",
        "manualRangeAlignedRate",
    ):
        minimum = float(thresholds[key])
        if float(metrics[key]) < minimum:
            failures.append(f"{key}={metrics[key]:.2%} < {minimum:.2%}")
    minimum_peak_truth = int(thresholds.get("minimumEligiblePeakTruthCount", 1))
    eligible_peak_truth = int(metrics["eligiblePeakTruthCount"])
    if eligible_peak_truth < minimum_peak_truth:
        failures.append(
            f"eligiblePeakTruthCount={eligible_peak_truth} < {minimum_peak_truth}"
        )
    else:
        minimum_peak_rate = float(thresholds["peakWithinToleranceRate"])
        peak_rate = float(metrics["peakWithinToleranceRate"])
        if peak_rate < minimum_peak_rate:
            failures.append(
                f"peakWithinToleranceRate={peak_rate:.2%} < {minimum_peak_rate:.2%}"
            )
    return failures


def _by_exercise(
    rows: list[dict[str, Any]],
    thresholds: dict[str, Any],
) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row["exerciseId"])].append(row)
    output = []
    for exercise_id, parts in sorted(grouped.items()):
        metrics = _aggregate_rows(parts, thresholds)
        failures = _metric_failures(metrics, thresholds)
        output.append(
            {
                "exerciseId": exercise_id,
                "status": "pass" if not failures else "fail",
                "metrics": metrics,
                "failures": failures,
            }
        )
    return output


def evaluate(
    report: dict[str, Any],
    standard: dict[str, Any],
    technique_dataset: dict[str, Any],
    *,
    seed: str,
    audit_count: int,
) -> dict[str, Any]:
    if standard.get("schemaVersion") != "maxpower-blind-video-evaluation-standard/v1":
        raise ValueError("unsupported blind-video evaluation standard")
    rows = _require_blind_protocol(report)
    rep_thresholds = standard["thresholds"]["repAndPhase"]
    metrics = _aggregate_rows(rows, rep_thresholds)
    failures = _metric_failures(metrics, rep_thresholds)
    source_ids = sorted({str(row["sourceCaptureId"]) for row in rows})
    audit_sources = deterministic_audit_order(source_ids, seed)[: max(0, audit_count)]

    eligible_technique_reps = int(
        (technique_dataset.get("stats") or {}).get("eligibleRepCount", 0)
    )
    technique_status = str(technique_dataset.get("status") or "unmeasured")
    if eligible_technique_reps > 0:
        technique_status = "unmeasured_model_evaluation_missing"

    backend = str(report.get("executionBackend") or "unknown")
    runtime_status = (
        "pass" if backend == "rust_motion_sdk" else "fail_not_rust_runtime_model"
    )
    dimensions = {
        "subjectSelection": {
            "status": "unmeasured",
            "reason": "no manual foreground-person identity labels in this evaluation artifact",
        },
        "skeleton": {
            "status": "unmeasured_no_human_keypoint_ground_truth",
            "reason": "RTMPose scores and Rust continuity sources are observations, not keypoint accuracy truth",
        },
        "actionIdentity": {
            "status": "context_provided_not_measured"
            if report.get("usesExerciseLabelAtInference") is True
            else "unmeasured",
            "reason": "the cycle model selects an exercise-specific profile from the declared exercise context",
        },
        "repAndPhase": {
            "status": "pass" if not failures else "fail",
            "metrics": metrics,
            "thresholds": rep_thresholds,
            "failures": failures,
            "byExercise": _by_exercise(rows, rep_thresholds),
        },
        "equipmentPath": {
            "status": "blocked_no_detector_or_human_trajectory_labels",
            "reason": "human wrist points cannot substitute for barbell or dumbbell truth",
        },
        "techniqueQuality": {
            "status": technique_status,
            "eligibleGoldRepCount": eligible_technique_reps,
            "reason": "quality, compensation, and cannot-judge require reviewed structured labels",
        },
        "runtimeDelivery": {
            "status": runtime_status,
            "executionBackend": backend,
            "canonicalInputProvenance": report.get("canonicalInputProvenance"),
        },
    }
    required_passes = (
        dimensions["subjectSelection"]["status"] == "pass",
        dimensions["skeleton"]["status"] == "pass",
        dimensions["repAndPhase"]["status"] == "pass",
        dimensions["equipmentPath"]["status"] == "pass",
        dimensions["techniqueQuality"]["status"] == "pass",
        dimensions["runtimeDelivery"]["status"] == "pass",
    )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "standardVersion": standard["schemaVersion"],
        "overallStatus": "pass" if all(required_passes) else "fail",
        "productionPromotion": False,
        "protocol": {
            "mode": "exhaustive_leave_one_source_out_with_seeded_random_audit",
            "partitionUnit": "sourceCaptureId",
            "eligibleHeldOutSourceCount": len(source_ids),
            "inferenceBeforeLabelReveal": True,
            "acceptanceAggregatesAllHeldOutSources": True,
            "randomAuditSeed": seed,
            "randomAuditSources": audit_sources,
            "randomAuditIsAcceptanceMetric": False,
            "knownLimit": "subject/session/device grouping is not proven by this legacy source-only report",
        },
        "dimensions": dimensions,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--standard", required=True, type=Path)
    parser.add_argument("--technique-dataset", required=True, type=Path)
    parser.add_argument("--seed", required=True)
    parser.add_argument("--audit-count", type=int, default=1)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--enforce", action="store_true")
    args = parser.parse_args()
    try:
        report = json.loads(args.report.read_text(encoding="utf-8"))
        standard = json.loads(args.standard.read_text(encoding="utf-8"))
        technique_dataset = json.loads(args.technique_dataset.read_text(encoding="utf-8"))
        result = evaluate(
            report,
            standard,
            technique_dataset,
            seed=args.seed,
            audit_count=args.audit_count,
        )
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(f"blind video acceptance: invalid input: {error}")
        return 2
    result["inputs"] = {
        "report": str(args.report.resolve()),
        "reportSha256": _sha256(args.report),
        "standard": str(args.standard.resolve()),
        "standardSha256": _sha256(args.standard),
        "techniqueDataset": str(args.technique_dataset.resolve()),
        "techniqueDatasetSha256": _sha256(args.technique_dataset),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0 if result["overallStatus"] == "pass" or not args.enforce else 1


if __name__ == "__main__":
    raise SystemExit(main())
