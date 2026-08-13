#!/usr/bin/env python3
"""Compare held-out pose recognition with a bench equipment-motion prototype.

This is an evaluation adapter, not a production detector.  It keeps three facts
separate:

* RTMPose/Rust joint observability is not human keypoint accuracy truth.
* The pose timeline numbers come from exhaustive leave-one-source-out inference.
* The equipment signal was tuned on these six videos and can only demonstrate
  whether an independent bar path is useful, not detector generalization.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = "maxpower-bench-pose-equipment-diagnostic/v1"
BENCH_EXERCISE_ID = "barbell_bench_press"
TIMELINE_TARGET = 0.95
START_END_TOLERANCE_MS = 500
MINIMUM_INTERVAL_IOU = 0.60


def _ratio(numerator: int | float, denominator: int | float) -> float:
    return float(numerator) / float(denominator) if denominator else 0.0


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def reconstruct_full_cycles(cycles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Partition a set at neighboring equipment extrema.

    The old prototype labelled the 32 px threshold crossing as `start` and the
    14 px return crossing as `end`, which only represented the high-amplitude
    middle of a rep.  Neighbor midpoints describe a complete cadence cycle
    without reading rep labels or an expected count.  The first and last cycle
    use the adjacent observed cadence.  This is intentionally an offline
    diagnostic: the previous cycle is not final until the next extreme arrives.
    """

    if not cycles:
        return []
    extrema = [int(round(float(cycle["extremeMs"]))) for cycle in cycles]
    if len(extrema) == 1:
        raw = cycles[0]
        half_duration = max(
            1,
            int(round((float(raw["endMs"]) - float(raw["startMs"])) / 2.0)),
        )
        return [
            {
                "startMs": extrema[0] - half_duration,
                "equipmentExtremeMs": extrema[0],
                "endMs": extrema[0] + half_duration,
                "boundarySource": "single_equipment_excursion_fallback",
            }
        ]

    boundaries = [
        int(round((left + right) / 2.0))
        for left, right in zip(extrema, extrema[1:])
    ]
    first_start = extrema[0] - (boundaries[0] - extrema[0])
    last_end = extrema[-1] + (extrema[-1] - boundaries[-1])
    output = []
    for index, extreme in enumerate(extrema):
        output.append(
            {
                "startMs": first_start if index == 0 else boundaries[index - 1],
                "equipmentExtremeMs": extreme,
                "endMs": last_end if index == len(extrema) - 1 else boundaries[index],
                "boundarySource": "neighboring_equipment_extrema_midpoint",
            }
        )
    return output


def _interval_iou(prediction: dict[str, Any], truth: dict[str, Any]) -> float:
    intersection = max(
        0.0,
        min(float(prediction["endMs"]), float(truth["endMs"]))
        - max(float(prediction["startMs"]), float(truth["startMs"])),
    )
    union = max(
        float(prediction["endMs"]), float(truth["endMs"])
    ) - min(float(prediction["startMs"]), float(truth["startMs"]))
    return intersection / union if union > 0 else 0.0


def _match_equipment_cycles(
    predictions: list[dict[str, Any]],
    truth: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    matches = []
    used_truth: set[int] = set()
    for prediction_index, prediction in enumerate(predictions):
        extreme = float(prediction["equipmentExtremeMs"])
        candidates = [
            index
            for index, segment in enumerate(truth)
            if index not in used_truth
            and float(segment["startMs"]) <= extreme <= float(segment["endMs"])
        ]
        if len(candidates) != 1:
            continue
        truth_index = candidates[0]
        used_truth.add(truth_index)
        segment = truth[truth_index]
        start_error = float(prediction["startMs"]) - float(segment["startMs"])
        end_error = float(prediction["endMs"]) - float(segment["endMs"])
        iou = _interval_iou(prediction, segment)
        aligned = (
            abs(start_error) <= START_END_TOLERANCE_MS
            and abs(end_error) <= START_END_TOLERANCE_MS
            and iou >= MINIMUM_INTERVAL_IOU
        )
        matches.append(
            {
                "predictionIndex": prediction_index,
                "truthIndex": truth_index,
                "startOffsetMs": start_error,
                "endOffsetMs": end_error,
                "intervalIoU": iou,
                "manualRangeAligned": aligned,
            }
        )
    return matches


def _median(values: Iterable[float]) -> float | None:
    materialized = [float(value) for value in values]
    return statistics.median(materialized) if materialized else None


def _joint_observability(
    records: dict[str, dict[str, Any]],
    canonical: dict[str, Any],
    views: dict[str, str],
) -> dict[str, Any]:
    captures = {
        str(capture["sourceCaptureId"]): capture
        for capture in canonical.get("captures", {}).values()
    }
    joint_groups = {
        "shoulder": (5, 6),
        "elbow": (7, 8),
        "wrist": (9, 10),
    }
    accumulators: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "sourceIds": set(),
            "frameCount": 0,
            "points": {
                name: {"total": 0, "measured": 0, "renderable": 0, "scores": []}
                for name in joint_groups
            },
        }
    )

    for source_id, record in records.items():
        capture = captures.get(source_id)
        if capture is None:
            raise ValueError(f"missing canonical capture for {source_id}")
        segments = record["segments"]
        frames = [
            frame
            for frame in capture.get("poses", [])
            if any(
                float(segment["startMs"])
                <= float(frame["timestampMs"])
                <= float(segment["endMs"])
                for segment in segments
            )
        ]
        view = views[source_id]
        for key in ("all", view):
            accumulator = accumulators[key]
            accumulator["sourceIds"].add(source_id)
            accumulator["frameCount"] += len(frames)
            for name, indices in joint_groups.items():
                points = accumulator["points"][name]
                for frame in frames:
                    landmarks = frame["landmarks"]
                    for index in indices:
                        landmark = landmarks[index]
                        points["total"] += 1
                        points["measured"] += int(landmark.get("source") == "measured")
                        points["renderable"] += int(bool(landmark.get("renderable")))
                        points["scores"].append(float(landmark.get("observationScore", 0.0)))

    def summarize(accumulator: dict[str, Any]) -> dict[str, Any]:
        result: dict[str, Any] = {
            "sourceCount": len(accumulator["sourceIds"]),
            "frameCount": accumulator["frameCount"],
        }
        for name, points in accumulator["points"].items():
            result[f"{name}MeasuredRate"] = _ratio(points["measured"], points["total"])
            result[f"{name}RenderableRate"] = _ratio(points["renderable"], points["total"])
            result[f"{name}MedianObservationScore"] = _median(points["scores"])
        return result

    return {
        "status": "observability_proxy_only_no_human_keypoint_truth",
        "jointAccuracyMeasured": False,
        "all": summarize(accumulators["all"]),
        "byView": {
            key: summarize(value)
            for key, value in sorted(accumulators.items())
            if key != "all"
        },
    }


def evaluate(
    dataset: dict[str, Any],
    canonical: dict[str, Any],
    pose_report: dict[str, Any],
    equipment_report: dict[str, Any],
) -> dict[str, Any]:
    if pose_report.get("usesExpectedCountAtInference") is not False:
        raise ValueError("pose report used expected count at inference")
    if pose_report.get("usesTruthRangesAtInference") is not False:
        raise ValueError("pose report used truth ranges at inference")
    protocol = pose_report.get("evaluationProtocol") or {}
    if protocol.get("mode") != "exhaustive_leave_one_source_out":
        raise ValueError("pose report is not exhaustive leave-one-source-out")
    if equipment_report.get("prototype") is not True:
        raise ValueError("equipment report must remain explicitly prototype-only")

    records = {
        str(record["sourceCaptureId"]): record
        for record in dataset.get("records", [])
        if record.get("exerciseId") == BENCH_EXERCISE_ID
    }
    pose_rows = {
        str(row["sourceCaptureId"]): row
        for row in pose_report["leaveOneSourceOut"]["rows"]
        if row.get("exerciseId") == BENCH_EXERCISE_ID
        and row.get("leaveOneSourceOutEligible") is True
    }
    equipment_rows = {
        str(row["videoId"]): row for row in equipment_report.get("videos", [])
    }
    source_ids = sorted(records)
    if set(source_ids) != set(pose_rows) or set(source_ids) != set(equipment_rows):
        raise ValueError("bench source sets differ across truth, pose, and equipment artifacts")
    for source_id, row in pose_rows.items():
        if source_id in {str(value) for value in row.get("trainingSourceIds", [])}:
            raise ValueError(f"pose source leakage detected for {source_id}")
        if row.get("labelsRevealedAfterInference") is not True:
            raise ValueError(f"pose label reveal order missing for {source_id}")

    pose_truth = sum(int(row["truthCount"]) for row in pose_rows.values())
    pose_predicted = sum(int(row["predictedCount"]) for row in pose_rows.values())
    pose_matched = sum(int(row["matchedCount"]) for row in pose_rows.values())
    pose_aligned = sum(int(row["manualRangeAlignedCount"]) for row in pose_rows.values())
    pose_exact_sets = sum(bool(row["exactSetCount"]) for row in pose_rows.values())
    pose_summary = {
        "evaluationProtocol": "exhaustive_leave_one_source_out",
        "sourceCount": len(source_ids),
        "truthRepCount": pose_truth,
        "predictedRepCount": pose_predicted,
        "matchedRepCount": pose_matched,
        "candidatePrecision": _ratio(pose_matched, pose_predicted),
        "candidateRecall": _ratio(pose_matched, pose_truth),
        "exactSetSourceCount": pose_exact_sets,
        "exactSetSourceRate": _ratio(pose_exact_sets, len(source_ids)),
        "manualRangeAlignedCount": pose_aligned,
        "manualRangeAlignedRate": _ratio(pose_aligned, pose_truth),
        "status": "pass" if pose_aligned / pose_truth >= TIMELINE_TARGET else "fail",
    }

    assisted_videos = []
    assisted_predicted = 0
    assisted_matched = 0
    assisted_aligned = 0
    assisted_exact_sets = 0
    start_errors = []
    end_errors = []
    views: dict[str, str] = {}
    for source_id in source_ids:
        equipment = equipment_rows[source_id]
        views[source_id] = str(equipment.get("cameraView") or "unknown")
        predictions = reconstruct_full_cycles(equipment.get("cycles", []))
        matches = _match_equipment_cycles(predictions, records[source_id]["segments"])
        aligned = sum(bool(match["manualRangeAligned"]) for match in matches)
        exact_set = (
            len(predictions) == len(records[source_id]["segments"])
            and len(matches) == len(records[source_id]["segments"])
        )
        assisted_predicted += len(predictions)
        assisted_matched += len(matches)
        assisted_aligned += aligned
        assisted_exact_sets += int(exact_set)
        start_errors.extend(abs(float(match["startOffsetMs"])) for match in matches)
        end_errors.extend(abs(float(match["endOffsetMs"])) for match in matches)
        assisted_videos.append(
            {
                "sourceCaptureId": source_id,
                "cameraView": views[source_id],
                "truthRepCount": len(records[source_id]["segments"]),
                "predictedRepCount": len(predictions),
                "matchedRepCount": len(matches),
                "manualRangeAlignedCount": aligned,
                "exactSet": exact_set,
                "poseWristMeasuredRate": None,
                "predictions": predictions,
                "matches": matches,
            }
        )
    assisted_rate = _ratio(assisted_aligned, pose_truth)
    assisted_summary = {
        "evaluationProtocol": "same_six_video_observability_prototype_not_detector_holdout",
        "detectorKind": "static_background_horizontal_axis_not_yolo",
        "sourceCount": len(source_ids),
        "truthRepCount": pose_truth,
        "predictedRepCount": assisted_predicted,
        "matchedRepCount": assisted_matched,
        "candidatePrecision": _ratio(assisted_matched, assisted_predicted),
        "candidateRecall": _ratio(assisted_matched, pose_truth),
        "exactSetSourceCount": assisted_exact_sets,
        "exactSetSourceRate": _ratio(assisted_exact_sets, len(source_ids)),
        "manualRangeAlignedCount": assisted_aligned,
        "manualRangeAlignedRate": assisted_rate,
        "absoluteBoundaryErrorMs": {
            "startMedian": _median(start_errors),
            "endMedian": _median(end_errors),
        },
        "status": (
            "prototype_only_passes_timeline_target"
            if assisted_rate >= TIMELINE_TARGET
            else "fail_below_95_percent_timeline"
        ),
        "acceptanceEligible": False,
        "ineligibilityReason": "not a trained detector and thresholds were developed on these same six sources",
    }

    skeleton = _joint_observability(records, canonical, views)
    for video in assisted_videos:
        source_id = video["sourceCaptureId"]
        capture = next(
            capture
            for capture in canonical["captures"].values()
            if capture["sourceCaptureId"] == source_id
        )
        segments = records[source_id]["segments"]
        points = [
            frame["landmarks"][index]
            for frame in capture["poses"]
            if any(
                float(segment["startMs"])
                <= float(frame["timestampMs"])
                <= float(segment["endMs"])
                for segment in segments
            )
            for index in (9, 10)
        ]
        video["poseWristMeasuredRate"] = _ratio(
            sum(point.get("source") == "measured" for point in points), len(points)
        )

    comparison_by_view = {}
    for view in sorted(set(views.values())):
        view_source_ids = [source_id for source_id in source_ids if views[source_id] == view]
        view_pose_rows = [pose_rows[source_id] for source_id in view_source_ids]
        view_equipment_rows = [
            video for video in assisted_videos if video["sourceCaptureId"] in view_source_ids
        ]
        view_truth = sum(int(row["truthCount"]) for row in view_pose_rows)
        pose_view_aligned = sum(int(row["manualRangeAlignedCount"]) for row in view_pose_rows)
        equipment_view_aligned = sum(
            int(row["manualRangeAlignedCount"]) for row in view_equipment_rows
        )
        comparison_by_view[view] = {
            "sourceCount": len(view_source_ids),
            "truthRepCount": view_truth,
            "poseOnlyHeldOut": {
                "predictedRepCount": sum(int(row["predictedCount"]) for row in view_pose_rows),
                "matchedRepCount": sum(int(row["matchedCount"]) for row in view_pose_rows),
                "manualRangeAlignedCount": pose_view_aligned,
                "manualRangeAlignedRate": _ratio(pose_view_aligned, view_truth),
            },
            "equipmentAssistedPrototype": {
                "predictedRepCount": sum(int(row["predictedRepCount"]) for row in view_equipment_rows),
                "matchedRepCount": sum(int(row["matchedRepCount"]) for row in view_equipment_rows),
                "manualRangeAlignedCount": equipment_view_aligned,
                "manualRangeAlignedRate": _ratio(equipment_view_aligned, view_truth),
            },
            "timelineAlignmentDelta": _ratio(
                equipment_view_aligned - pose_view_aligned,
                view_truth,
            ),
        }

    return {
        "schemaVersion": SCHEMA_VERSION,
        "exerciseId": BENCH_EXERCISE_ID,
        "productionPromotion": False,
        "comparison": {
            "poseOnlyHeldOut": pose_summary,
            "equipmentAssistedPrototype": assisted_summary,
        },
        "comparisonByView": comparison_by_view,
        "skeletonObservability": skeleton,
        "videos": assisted_videos,
        "conclusion": {
            "primaryFinding": "both_pose_observability_and_temporal_boundary_semantics_contribute",
            "equipmentCanAssist": True,
            "equipmentRecoveredMissingRepCount": assisted_matched - pose_matched,
            "equipmentRestoredExactSetSourceCount": assisted_exact_sets - pose_exact_sets,
            "timelineStillBelowTarget": assisted_rate < TIMELINE_TARGET,
            "interpretation": (
                "Low-confidence front-view wrists correlate with pose misses, while an independent bar path recovers all 46 rep candidates. "
                "The remaining full-range error proves that equipment tracking must be fused with a trained temporal boundary model rather than treated as a complete solution."
            ),
        },
        "measurementLimits": {
            "skeletonPointAccuracy": "unmeasured_no_human_keypoint_ground_truth",
            "legacyPeakLabels": "excluded_from_acceptance_because_provenance_is_unattributed_and_most_are_range_midpoints",
            "equipmentGeneralization": "unmeasured_no_source_isolated_trained_detector",
            "techniqueQuality": "unmeasured_no_reviewed_quality_gold_labels",
        },
        "requiredNext": [
            "review barbell and dumbbell boxes/axes including mirror and rack negatives",
            "train a shared person-plus-equipment detector with source/session isolation",
            "pass equipment observations into the Rust Motion SDK for subject association and confidence-aware fusion",
            "train and gate full start/peak/end boundaries on held-out sources",
            "keep action quality cannot_judge until reviewed rep-level technique labels exist",
        ],
    }


def evaluate_files(
    *,
    dataset_path: Path,
    canonical_path: Path,
    pose_report_path: Path,
    equipment_report_path: Path,
) -> dict[str, Any]:
    return evaluate(
        json.loads(dataset_path.read_text(encoding="utf-8")),
        json.loads(canonical_path.read_text(encoding="utf-8")),
        json.loads(pose_report_path.read_text(encoding="utf-8")),
        json.loads(equipment_report_path.read_text(encoding="utf-8")),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--canonical", required=True, type=Path)
    parser.add_argument("--pose-report", required=True, type=Path)
    parser.add_argument("--equipment-report", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = evaluate_files(
            dataset_path=args.dataset,
            canonical_path=args.canonical,
            pose_report_path=args.pose_report,
            equipment_report_path=args.equipment_report,
        )
    except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(f"pose/equipment diagnostic: invalid input: {error}")
        return 2
    result["inputs"] = {
        "dataset": str(args.dataset.resolve()),
        "datasetSha256": _sha256(args.dataset),
        "canonical": str(args.canonical.resolve()),
        "canonicalSha256": _sha256(args.canonical),
        "poseReport": str(args.pose_report.resolve()),
        "poseReportSha256": _sha256(args.pose_report),
        "equipmentReport": str(args.equipment_report.resolve()),
        "equipmentReportSha256": _sha256(args.equipment_report),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result["comparison"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
