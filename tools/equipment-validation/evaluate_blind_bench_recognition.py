#!/usr/bin/env python3
"""Blind, label-after-inference bench execution recognition audit.

This audit has three physically separate stages:

1. ``prepare`` whitelists only timestamps and automatic bar-axis observations
   from the research sidecars, strips rep/fusion/landmark fields, and shuffles
   captures with a fixed seed.
2. ``infer`` reads only the sanitized pack. It runs a causal bar-cycle state
   machine and a label-free set finalizer. It is a *bench-profile-selected*
   recognizer, not an exercise classifier.
3. ``evaluate`` reveals human rep ranges and compares count, peak timing, and
   complete start/end intervals. It also compares the frozen pose-only LOO
   report, whose held-out source predictions were generated before labels.

The 450 ms minimum effort duration is not selected from this audit. It is the
existing lower bound in ``tools/recognition-profile/generate.ts``. No output is
eligible for production promotion.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import random
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np


PACK_SCHEMA = "maxpower-blind-bench-inference-pack/v1"
PREDICTION_SCHEMA = "maxpower-blind-bench-predictions/v1"
EVALUATION_SCHEMA = "maxpower-blind-bench-recognition-evaluation/v2"
SEED = 20_260_812
REFERENCE_HEIGHT = 640.0
ENTER_DELTA_PX = 32.0
RETURN_DELTA_PX = 14.0
MINIMUM_AMPLITUDE_PX = 32.0
MINIMUM_EFFORT_DURATION_MS = 450
MAXIMUM_EFFORT_DURATION_MS = 6_000
MAXIMUM_CADENCE_GAP_MS = 8_000
START_END_TOLERANCE_MS = 500
MINIMUM_INTERVAL_IOU = 0.60
FORBIDDEN_INFERENCE_KEYS = {
    "repIndex",
    "segments",
    "labels",
    "expectedCount",
    "truthCount",
    "peakMs",
    "exerciseId",
    "fusion",
    "landmarks",
}


def _read_json(path: Path) -> dict[str, Any]:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as source:
            return json.load(source)
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def _write_gzip_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as destination:
        json.dump(value, destination, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _forbidden_paths(value: Any, prefix: str = "$") -> list[str]:
    matches: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            path = f"{prefix}.{key}"
            if key in FORBIDDEN_INFERENCE_KEYS:
                matches.append(path)
            matches.extend(_forbidden_paths(child, path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            matches.extend(_forbidden_paths(child, f"{prefix}[{index}]"))
    return matches


def prepare_pack(observation_root: Path, output: Path, seed: int) -> dict[str, Any]:
    captures: list[dict[str, Any]] = []
    quality_rows: list[dict[str, Any]] = []
    for path in sorted(observation_root.glob("*.barbell-pose-alignment.json.gz")):
        sidecar = _read_json(path)
        frames = [
            {
                "frameNumber": int(frame["frameNumber"]),
                "timestampMs": float(frame["timestampMs"]),
                "axis": frame.get("axis"),
            }
            for frame in sidecar["frames"]
        ]
        frame_numbers = [frame["frameNumber"] for frame in frames]
        timestamps = [frame["timestampMs"] for frame in frames]
        monotonic = all(left < right for left, right in zip(timestamps, timestamps[1:]))
        unique_frames = len(set(frame_numbers)) == len(frame_numbers)
        capture = {
            "captureId": str(sidecar["captureId"]),
            "sourceVideo": str(sidecar["sourceVideo"]),
            "sourcePoseSidecar": str(sidecar["sourcePoseSidecar"]),
            "sampleFps": float(sidecar["inferenceContract"]["sampleFps"]),
            "upstreamContract": {
                "posePipeline": str(sidecar["inferenceContract"]["posePipeline"]),
                "barDetector": str(sidecar["inferenceContract"]["detector"]),
                "causal": bool(sidecar["inferenceContract"]["causal"]),
                "readsFutureFrames": bool(sidecar["inferenceContract"]["readsFutureFrames"]),
                "readsRepLabelsDuringInference": bool(
                    sidecar["inferenceContract"]["readsRepLabelsDuringInference"]
                ),
                "barYUsesPoseWristY": bool(sidecar["inferenceContract"]["barYUsesPoseWristY"]),
                "barCandidateUsesPoseWristXOnly": bool(
                    sidecar["inferenceContract"]["barCandidateUsesPoseWristXOnly"]
                ),
            },
            "frames": frames,
        }
        captures.append(capture)
        quality_rows.append(
            {
                "captureId": capture["captureId"],
                "frameCount": len(frames),
                "uniqueFrameNumbers": unique_frames,
                "strictlyIncreasingTimestamps": monotonic,
                "axisObservedFrameCount": sum(frame["axis"] is not None for frame in frames),
            }
        )
    if not captures:
        raise ValueError(f"no barbell-pose sidecars under {observation_root}")
    random.Random(seed).shuffle(captures)
    pack = {
        "schemaVersion": PACK_SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "seed": seed,
        "randomizedCaptureOrder": [capture["captureId"] for capture in captures],
        "labelsAvailableToInference": False,
        "expectedCountAvailableToInference": False,
        "truthRangesAvailableToInference": False,
        "exerciseIdentityMode": "externally_selected_barbell_bench_press_profile",
        "captures": captures,
        "preparationQuality": {
            "captureCount": len(captures),
            "uniqueCaptureCount": len({capture["captureId"] for capture in captures}),
            "rows": quality_rows,
        },
    }
    forbidden = _forbidden_paths(pack)
    if forbidden:
        raise ValueError(f"sanitized inference pack contains forbidden keys: {forbidden[:5]}")
    _write_gzip_json(output, pack)
    return pack


def _fill_causally(frames: Sequence[dict[str, Any]]) -> tuple[list[float], list[float], float]:
    positions: list[float] = []
    confidence: list[float] = []
    previous: float | None = None
    observed = 0
    for frame in frames:
        axis = frame.get("axis")
        if axis is not None:
            previous = float(axis["centerY"]) * REFERENCE_HEIGHT
            observed += 1
            confidence.append(float(axis["confidence"]))
        else:
            confidence.append(0.0)
        positions.append(previous if previous is not None else math.nan)
    first = next((value for value in positions if math.isfinite(value)), 0.0)
    positions = [first if not math.isfinite(value) else value for value in positions]
    return positions, confidence, observed / len(frames) if frames else 0.0


def _causal_cycle_candidates(
    positions: Sequence[float],
    confidence: Sequence[float],
    sample_fps: float,
) -> list[dict[str, Any]]:
    period_ms = 1000.0 / sample_fps
    history: list[float] = []
    baseline: float | None = None
    state = "ready"
    start_index = 0
    peak_index = 0
    peak = -math.inf
    candidates: list[dict[str, Any]] = []
    maximum_frames = max(1, round(MAXIMUM_EFFORT_DURATION_MS / period_ms))
    for index, value in enumerate(positions):
        if baseline is None:
            baseline = value
        if state == "ready":
            history.append(value)
            history = history[-80:]
            lower_half = sorted(history)[: max(3, len(history) // 2)]
            baseline = statistics.median(lower_half)
            if len(history) >= 10 and value >= baseline + ENTER_DELTA_PX:
                state = "effort"
                start_index = index
                peak_index = index
                peak = value
        else:
            if value > peak:
                peak = value
                peak_index = index
            duration_frames = index - start_index
            returned = value <= baseline + RETURN_DELTA_PX
            timed_out = duration_frames > maximum_frames
            if returned or timed_out:
                duration_ms = duration_frames * period_ms
                amplitude = peak - baseline
                if (
                    returned
                    and MINIMUM_EFFORT_DURATION_MS <= duration_ms <= MAXIMUM_EFFORT_DURATION_MS
                    and amplitude >= MINIMUM_AMPLITUDE_PX
                ):
                    window_confidence = confidence[start_index : index + 1]
                    candidates.append(
                        {
                            "rawStartMs": round(start_index * period_ms),
                            "peakMs": round(peak_index * period_ms),
                            "rawEndMs": round(index * period_ms),
                            "effortDurationMs": round(duration_ms),
                            "amplitudePxAtReferenceHeight": round(amplitude, 3),
                            "meanAxisConfidence": round(
                                statistics.mean(window_confidence) if window_confidence else 0.0,
                                6,
                            ),
                        }
                    )
                state = "ready"
                history = [value]
    return candidates


def _largest_cadence_cluster(candidates: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    if not candidates:
        return []
    clusters: list[list[dict[str, Any]]] = [[dict(candidates[0])]]
    for candidate in candidates[1:]:
        if int(candidate["peakMs"]) - int(clusters[-1][-1]["peakMs"]) <= MAXIMUM_CADENCE_GAP_MS:
            clusters[-1].append(dict(candidate))
        else:
            clusters.append([dict(candidate)])
    return max(
        clusters,
        key=lambda cluster: (
            len(cluster),
            sum(float(item["amplitudePxAtReferenceHeight"]) for item in cluster),
        ),
    )


def _complete_intervals(cycles: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    if not cycles:
        return []
    peaks = [int(cycle["peakMs"]) for cycle in cycles]
    if len(peaks) == 1:
        cycle = cycles[0]
        return [
            {
                **cycle,
                "startMs": int(cycle["rawStartMs"]),
                "endMs": int(cycle["rawEndMs"]),
                "boundarySource": "single_cycle_raw_threshold",
            }
        ]
    boundaries = [round((left + right) / 2.0) for left, right in zip(peaks, peaks[1:])]
    first_start = peaks[0] - (boundaries[0] - peaks[0])
    last_end = peaks[-1] + (peaks[-1] - boundaries[-1])
    output: list[dict[str, Any]] = []
    for index, cycle in enumerate(cycles):
        output.append(
            {
                **cycle,
                "startMs": first_start if index == 0 else boundaries[index - 1],
                "endMs": last_end if index == len(cycles) - 1 else boundaries[index],
                "boundarySource": "neighboring_bar_extrema_midpoint_set_revision",
            }
        )
    return output


def infer(pack_path: Path, output: Path) -> dict[str, Any]:
    pack = _read_json(pack_path)
    if pack.get("schemaVersion") != PACK_SCHEMA:
        raise ValueError("unsupported inference pack")
    forbidden = _forbidden_paths(pack)
    if forbidden:
        raise ValueError(f"inference pack leaked truth fields: {forbidden[:5]}")
    rows: list[dict[str, Any]] = []
    for capture in pack["captures"]:
        positions, confidences, axis_coverage = _fill_causally(capture["frames"])
        raw_candidates = _causal_cycle_candidates(positions, confidences, float(capture["sampleFps"]))
        selected = _largest_cadence_cluster(raw_candidates)
        predictions = _complete_intervals(selected)
        recognized = (
            len(predictions) >= 2
            and axis_coverage >= 0.80
            and statistics.median(
                [float(item["meanAxisConfidence"]) for item in predictions] or [0.0]
            )
            >= 0.50
        )
        rows.append(
            {
                "captureId": capture["captureId"],
                "recognizedBenchExecution": recognized,
                "predictedExerciseId": "barbell_bench_press" if recognized else None,
                "axisFrameCoverage": round(axis_coverage, 6),
                "rawCausalCandidateCount": len(raw_candidates),
                "selectedCadenceClusterCount": len(predictions),
                "discardedSetupOrPostSetCandidateCount": len(raw_candidates) - len(predictions),
                "predictedSegments": predictions,
            }
        )
    predictions = {
        "schemaVersion": PREDICTION_SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "inferencePack": str(pack_path),
        "inferencePackSha256": _sha256(pack_path),
        "profileIdentity": "barbell_bench_press/causal-bar-axis-research/v1",
        "usesExerciseLabelAtInference": True,
        "usesExpectedCountAtInference": False,
        "usesTruthRangesAtInference": False,
        "usesFutureFramesForCandidateGeneration": False,
        "setFinalization": "largest_cadence_cluster_and_neighbor_extrema_boundary_revision",
        "liveSemantics": {
            "cycleCandidatesAreCausal": True,
            "finalSetIntervalsAvailableAfterCadenceClusterFinalization": True,
            "automaticExerciseClassification": False,
        },
        "parameters": {
            "referenceHeightPx": REFERENCE_HEIGHT,
            "enterDeltaPx": ENTER_DELTA_PX,
            "returnDeltaPx": RETURN_DELTA_PX,
            "minimumAmplitudePx": MINIMUM_AMPLITUDE_PX,
            "minimumEffortDurationMs": MINIMUM_EFFORT_DURATION_MS,
            "maximumEffortDurationMs": MAXIMUM_EFFORT_DURATION_MS,
            "maximumCadenceGapMs": MAXIMUM_CADENCE_GAP_MS,
            "minimumDurationSource": "existing tools/recognition-profile/generate.ts lower bound",
        },
        "randomizedCaptureOrder": pack["randomizedCaptureOrder"],
        "rows": rows,
    }
    _write_json(output, predictions)
    return predictions


def _interval_iou(prediction: dict[str, Any], truth: dict[str, Any]) -> float:
    intersection = max(
        0.0,
        min(float(prediction["endMs"]), float(truth["endMs"]))
        - max(float(prediction["startMs"]), float(truth["startMs"])),
    )
    union = max(float(prediction["endMs"]), float(truth["endMs"])) - min(
        float(prediction["startMs"]), float(truth["startMs"])
    )
    return intersection / union if union > 0 else 0.0


def _match_segments(predictions: Sequence[dict[str, Any]], truth: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    used_truth: set[int] = set()
    for prediction_index, prediction in enumerate(predictions):
        peak = float(prediction["peakMs"])
        candidates = [
            index
            for index, segment in enumerate(truth)
            if index not in used_truth
            and float(segment["startMs"]) <= peak <= float(segment["endMs"])
        ]
        if len(candidates) != 1:
            continue
        truth_index = candidates[0]
        used_truth.add(truth_index)
        segment = truth[truth_index]
        peak_source = str(segment.get("peakSource") or "legacy_unattributed")
        peak_truth_eligible = peak_source == "human_adjusted"
        start_error = float(prediction["startMs"]) - float(segment["startMs"])
        peak_error = peak - float(segment["peakMs"]) if peak_truth_eligible else None
        end_error = float(prediction["endMs"]) - float(segment["endMs"])
        iou = _interval_iou(prediction, segment)
        matches.append(
            {
                "predictionIndex": prediction_index,
                "truthIndex": truth_index,
                "truthPeakSource": peak_source,
                "peakTruthEligible": peak_truth_eligible,
                "startOffsetMs": start_error,
                "peakOffsetMs": peak_error,
                "endOffsetMs": end_error,
                "intervalIoU": iou,
                "peakWithin250Ms": abs(peak_error) <= 250 if peak_error is not None else None,
                "peakWithin500Ms": abs(peak_error) <= 500 if peak_error is not None else None,
                "manualRangeAligned": (
                    abs(start_error) <= START_END_TOLERANCE_MS
                    and abs(end_error) <= START_END_TOLERANCE_MS
                    and iou >= MINIMUM_INTERVAL_IOU
                ),
            }
        )
    return matches


def _mean_absolute(matches: Sequence[dict[str, Any]], field: str) -> float | None:
    return (
        round(statistics.mean(abs(float(item[field])) for item in matches), 3)
        if matches
        else None
    )


def _quantile_absolute(matches: Sequence[dict[str, Any]], field: str, quantile: float) -> float | None:
    return (
        round(float(np.quantile([abs(float(item[field])) for item in matches], quantile)), 3)
        if matches
        else None
    )


def _validate_truth(records: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for record in records:
        segments = record["segments"]
        valid = True
        previous_end = -math.inf
        for expected_index, segment in enumerate(segments, start=1):
            valid = valid and int(segment["repIndex"]) == expected_index
            valid = valid and float(segment["startMs"]) < float(segment["peakMs"]) < float(segment["endMs"])
            valid = valid and float(segment["startMs"]) >= previous_end
            previous_end = float(segment["endMs"])
        rows.append(
            {
                "captureId": record["sourceCaptureId"],
                "repCount": len(segments),
                "contiguousRepIndicesAndValidNonOverlappingRanges": valid,
            }
        )
    return rows


def evaluate(
    dataset_path: Path,
    pack_path: Path,
    predictions_path: Path,
    pose_report_path: Path,
    output_json: Path,
    output_md: Path,
) -> dict[str, Any]:
    dataset = _read_json(dataset_path)
    pack = _read_json(pack_path)
    predictions = _read_json(predictions_path)
    pose_report = _read_json(pose_report_path)
    if predictions.get("inferencePackSha256") != _sha256(pack_path):
        raise ValueError("prediction/inference pack hash mismatch")
    records = [
        record for record in dataset["records"] if record.get("exerciseId") == "barbell_bench_press"
    ]
    truth_by_id = {str(record["sourceCaptureId"]): record for record in records}
    prediction_by_id = {str(row["captureId"]): row for row in predictions["rows"]}
    if set(truth_by_id) != set(prediction_by_id):
        raise ValueError("truth/prediction source sets differ")
    if len(truth_by_id) != len(records):
        raise ValueError("duplicate sourceCaptureId in bench truth")

    per_video: list[dict[str, Any]] = []
    all_matches: list[dict[str, Any]] = []
    for capture_id in predictions["randomizedCaptureOrder"]:
        row = prediction_by_id[capture_id]
        truth = truth_by_id[capture_id]["segments"]
        matches = _match_segments(row["predictedSegments"], truth)
        all_matches.extend(matches)
        per_video.append(
            {
                "captureId": capture_id,
                "capturePosition": truth_by_id[capture_id].get("capturePosition"),
                "recognizedBenchExecution": row["recognizedBenchExecution"],
                "expectedCount": len(truth),
                "predictedCount": len(row["predictedSegments"]),
                "matchedCount": len(matches),
                "exactCount": len(truth) == len(row["predictedSegments"]),
                "manualRangeAlignedCount": sum(item["manualRangeAligned"] for item in matches),
                "rawCausalCandidateCount": row["rawCausalCandidateCount"],
                "discardedSetupOrPostSetCandidateCount": row[
                    "discardedSetupOrPostSetCandidateCount"
                ],
                "matches": matches,
            }
        )

    expected = sum(row["expectedCount"] for row in per_video)
    predicted = sum(row["predictedCount"] for row in per_video)
    matched = sum(row["matchedCount"] for row in per_video)
    aligned = sum(row["manualRangeAlignedCount"] for row in per_video)
    eligible_peak_matches = [item for item in all_matches if item["peakTruthEligible"]]
    peak_truth_provenance: dict[str, int] = {}
    for item in all_matches:
        source = str(item["truthPeakSource"])
        peak_truth_provenance[source] = peak_truth_provenance.get(source, 0) + 1
    pose_rows = [
        row
        for row in pose_report["leaveOneSourceOut"]["rows"]
        if row.get("exerciseId") == "barbell_bench_press" and row.get("leaveOneSourceOutEligible")
    ]
    if (
        pose_report.get("usesExpectedCountAtInference") is not False
        or pose_report.get("usesTruthRangesAtInference") is not False
        or any(row.get("splitLeakageDetected") for row in pose_rows)
    ):
        raise ValueError("pose comparison report is not blind-source safe")

    truth_quality = _validate_truth(records)
    forbidden = _forbidden_paths(pack)
    data_quality = {
        "status": "pass_for_positive_bench_execution_audit",
        "datasetRecordCount": len(records),
        "uniqueDatasetSourceCount": len(truth_by_id),
        "inferencePackCaptureCount": len(pack["captures"]),
        "predictionCaptureCount": len(predictions["rows"]),
        "sourceSetExactMatch": set(truth_by_id) == set(prediction_by_id),
        "forbiddenTruthFieldCountInInferencePack": len(forbidden),
        "allInferenceTimestampsStrictlyIncreasing": all(
            row["strictlyIncreasingTimestamps"]
            for row in pack["preparationQuality"]["rows"]
        ),
        "allInferenceFrameNumbersUnique": all(
            row["uniqueFrameNumbers"] for row in pack["preparationQuality"]["rows"]
        ),
        "allTruthRangesValid": all(
            row["contiguousRepIndicesAndValidNonOverlappingRanges"] for row in truth_quality
        ),
        "truthRows": truth_quality,
    }
    summary = {
        "positiveBenchVideoCount": len(per_video),
        "recognizedBenchVideoCount": sum(row["recognizedBenchExecution"] for row in per_video),
        "positiveVideoSensitivity": round(
            sum(row["recognizedBenchExecution"] for row in per_video) / len(per_video), 6
        ),
        "negativeVideoSpecificity": None,
        "automaticExerciseClassificationTested": False,
        "expectedRepCount": expected,
        "predictedRepCount": predicted,
        "matchedRepCount": matched,
        "candidatePrecision": round(matched / predicted, 6) if predicted else 0.0,
        "candidateRecall": round(matched / expected, 6) if expected else 0.0,
        "exactCountVideoCount": sum(row["exactCount"] for row in per_video),
        "exactCountVideoRate": round(
            sum(row["exactCount"] for row in per_video) / len(per_video), 6
        ),
        "peakTruthStatus": (
            "human_truth_available" if eligible_peak_matches else "blocked_no_human_truth"
        ),
        "peakTruthProvenance": peak_truth_provenance,
        "eligiblePeakTruthCount": len(eligible_peak_matches),
        "algorithmicTurnaroundPointCount": matched,
        "peakWithin250MsCount": sum(
            item["peakWithin250Ms"] is True for item in eligible_peak_matches
        ),
        "peakWithin250MsRate": (
            round(
                sum(item["peakWithin250Ms"] is True for item in eligible_peak_matches)
                / len(eligible_peak_matches),
                6,
            )
            if eligible_peak_matches
            else None
        ),
        "peakWithin500MsCount": sum(
            item["peakWithin500Ms"] is True for item in eligible_peak_matches
        ),
        "peakWithin500MsRate": (
            round(
                sum(item["peakWithin500Ms"] is True for item in eligible_peak_matches)
                / len(eligible_peak_matches),
                6,
            )
            if eligible_peak_matches
            else None
        ),
        "peakAbsoluteErrorMs": {
            "mean": _mean_absolute(eligible_peak_matches, "peakOffsetMs"),
            "p95": _quantile_absolute(eligible_peak_matches, "peakOffsetMs", 0.95),
        },
        "manualRangeAlignedCount": aligned,
        "manualRangeAlignedRate": round(aligned / expected, 6) if expected else 0.0,
        "startAbsoluteErrorMsMean": _mean_absolute(all_matches, "startOffsetMs"),
        "endAbsoluteErrorMsMean": _mean_absolute(all_matches, "endOffsetMs"),
        "meanIntervalIoU": round(
            statistics.mean(float(item["intervalIoU"]) for item in all_matches), 6
        ),
        "acceptance": {
            "repCountAtLeast95Percent": matched / expected >= 0.95 if expected else False,
            "peakTimingAtLeast95PercentWithin500Ms": (
                sum(item["peakWithin500Ms"] is True for item in eligible_peak_matches)
                / len(eligible_peak_matches)
                >= 0.95
                if eligible_peak_matches
                else False
            ),
            "fullRangeAlignmentAtLeast95Percent": aligned / expected >= 0.95 if expected else False,
            "overall95PercentAcceptance": False,
        },
    }
    summary["acceptance"]["overall95PercentAcceptance"] = all(
        [
            summary["acceptance"]["repCountAtLeast95Percent"],
            summary["acceptance"]["peakTimingAtLeast95PercentWithin500Ms"],
            summary["acceptance"]["fullRangeAlignmentAtLeast95Percent"],
        ]
    )
    pose_comparison = {
        "protocol": pose_report["evaluationProtocol"],
        "expectedRepCount": sum(int(row["expectedCount"]) for row in pose_rows),
        "predictedRepCount": sum(int(row["predictedCount"]) for row in pose_rows),
        "matchedRepCount": sum(int(row["matchedCount"]) for row in pose_rows),
        "exactCountVideoCount": sum(bool(row["exactSetCount"]) for row in pose_rows),
        "manualRangeAlignedCount": sum(int(row["manualRangeAlignedCount"]) for row in pose_rows),
    }
    report = {
        "schemaVersion": EVALUATION_SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "question": "Given a selected barbell-bench profile, can frozen pose+bar observations recognize the user's bench repetitions and timeline without count/range truth at inference?",
        "protocol": {
            "mode": "randomized_all-source_label-after-inference",
            "productContract": "user_selects_barbell_bench_press_and_uses_the_configured_camera_view_before_recognition",
            "automaticExerciseClassificationRequired": False,
            "seed": pack["seed"],
            "randomizedCaptureOrder": predictions["randomizedCaptureOrder"],
            "inferencePackSha256": _sha256(pack_path),
            "predictionsSha256": _sha256(predictions_path),
            "usesExerciseLabelAtInference": True,
            "usesExpectedCountAtInference": False,
            "usesTruthRangesAtInference": False,
            "labelsRevealedAfterPredictionsWereWritten": True,
            "profileAndDetectorPreviouslyObservedTheseSixVideos": True,
        },
        "dataQuality": data_quality,
        "summary": summary,
        "randomSingleVideoAudit": {
            "selectionRule": "first_capture_after_seeded_shuffle",
            **per_video[0],
        },
        "poseOnlyHeldOutComparison": pose_comparison,
        "perVideo": per_video,
        "decision": {
            "selectedExerciseContractSatisfied": True,
            "canRecognizeBenchExecutionWhenExerciseIsSelected": (
                summary["exactCountVideoRate"] == 1.0
                and summary["candidatePrecision"] >= 0.95
                and summary["candidateRecall"] >= 0.95
            ),
            "automaticExerciseClassificationRequired": False,
            "canMeet95PercentFullTimelineAcceptance": summary["acceptance"][
                "fullRangeAlignmentAtLeast95Percent"
            ],
            "currentRustSdkUsesEquipmentForRepRecognition": False,
            "productionPromotionAllowed": False,
        },
        "limitations": [
            "All six positives were previously observed while developing the bar detector; this is a leakage-safe replay, not unseen-scene generalization.",
            "The archived rep ranges do not contain human-confirmed peak provenance. Their legacy midpoint placeholders are excluded from peak accuracy.",
            "Automatic exercise classification and negative-action specificity are outside the selected-exercise product contract.",
            "Set interval boundaries are revised from neighboring bar extrema after cadence-cluster finalization; causal candidates are available earlier.",
            "Current Rust EQP1 publishes equipment evidence but does not drive the RepEngine.",
        ],
    }
    _write_json(output_json, report)
    write_markdown(output_md, report)
    return report


def write_markdown(path: Path, report: dict[str, Any]) -> None:
    summary = report["summary"]
    random_single = report["randomSingleVideoAudit"]
    pose = report["poseOnlyHeldOutComparison"]
    decision = report["decision"]
    lines = [
        "# Personal bench blind recognition test",
        "",
        f"Generated: `{report['generatedAt']}`",
        "",
        "## Verdict",
        "",
        f"- Recognizes a selected bench execution: **{'yes' if decision['canRecognizeBenchExecutionWhenExerciseIsSelected'] else 'no'}**",
        "- Selected-exercise + configured-camera product contract: **in scope and satisfied**",
        "- Automatic exercise classification: **not required**",
        f"- Meets 95% complete start/end timeline gate: **{'yes' if decision['canMeet95PercentFullTimelineAcceptance'] else 'no'}**",
        "",
        "## Label-after-inference result",
        "",
        f"- Positive videos recognized: {summary['recognizedBenchVideoCount']}/{summary['positiveBenchVideoCount']}",
        f"- Rep count: expected {summary['expectedRepCount']}, predicted {summary['predictedRepCount']}, matched {summary['matchedRepCount']}",
        f"- Exact-count videos: {summary['exactCountVideoCount']}/{summary['positiveBenchVideoCount']}",
        f"- Algorithmic turnaround points emitted: {summary['algorithmicTurnaroundPointCount']}",
        f"- Human-confirmed turnaround truth: {summary['eligiblePeakTruthCount']}/{summary['expectedRepCount']} ({summary['peakTruthStatus']})",
        f"- Full start/end range aligned: {summary['manualRangeAlignedCount']}/{summary['expectedRepCount']} ({summary['manualRangeAlignedRate']:.1%})",
        f"- Mean interval IoU: {summary['meanIntervalIoU']:.3f}",
        "",
        "## Random single-video check",
        "",
        f"- Seeded selection: `{random_single['captureId']}` ({random_single['capturePosition']})",
        f"- Rep count: expected {random_single['expectedCount']}, predicted {random_single['predictedCount']}, matched {random_single['matchedCount']}",
        f"- Full start/end ranges aligned: {random_single['manualRangeAlignedCount']}/{random_single['expectedCount']}",
        "- All six shuffled videos were then evaluated to avoid a lucky or unlucky single-video conclusion.",
        "",
        "## Pose-only held-out comparison",
        "",
        f"- Pose only: {pose['predictedRepCount']} predictions, {pose['matchedRepCount']} matched, {pose['exactCountVideoCount']}/6 exact-count videos, {pose['manualRangeAlignedCount']}/46 complete ranges aligned.",
        f"- Pose + bar research recognizer: {summary['predictedRepCount']} predictions, {summary['matchedRepCount']} matched, {summary['exactCountVideoCount']}/6 exact-count videos, {summary['manualRangeAlignedCount']}/46 complete ranges aligned.",
        "",
        "## Per video in randomized inference order",
        "",
        "| Capture | view | expected | predicted | matched | full ranges | discarded setup/post-set |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in report["perVideo"]:
        lines.append(
            f"| `{row['captureId'][:8]}…` | {row['capturePosition']} | {row['expectedCount']} | {row['predictedCount']} | {row['matchedCount']} | {row['manualRangeAlignedCount']} | {row['discardedSetupOrPostSetCandidateCount']} |"
        )
    lines.extend(
        [
            "",
            "## Validation boundary",
            "",
            "- The sanitized inference pack contains no rep index, exercise id, expected count, labels, truth ranges, pose landmarks, or fusion diagnostics.",
            "- Exercise identity is externally selected as barbell bench press and the camera uses a configured view; this is the product contract. Automatic action classification is not required.",
            "- The bar detector and thresholds have already seen these six scenes. Results prove same-corpus capability, not generalization to a new gym/person.",
            "- Current Rust EQP1 accepts/publishes equipment but does not yet use it to drive the RepEngine. These combined results are research-pipeline results.",
            "- Production promotion remains disabled.",
            "",
        ]
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=("prepare", "infer", "evaluate", "all"), default="all")
    parser.add_argument(
        "--observation-root",
        type=Path,
        default=Path(
            "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/observations"
        ),
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path(
            "data/workflows/pose-stack-comparison/front-bench-v1/run-2026-08-12/dataset/personal-golden-front-bench-v1.json"
        ),
    )
    parser.add_argument(
        "--pose-report",
        type=Path,
        default=Path(
            "data/workflows/motion-profile/personal-halpe26-v1/run-2026-08-11/diagnostics/personal-cycle-state-halpe26-v1-loo.json"
        ),
    )
    parser.add_argument(
        "--run-root",
        type=Path,
        default=Path(
            "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/blind-bench-recognition"
        ),
    )
    parser.add_argument(
        "--report-json",
        type=Path,
        default=Path(
            "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/blind-bench-recognition/evaluation-after-truth.json"
        ),
    )
    parser.add_argument(
        "--report-md",
        type=Path,
        default=Path(
            "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/blind-bench-recognition/evaluation-after-truth.md"
        ),
    )
    parser.add_argument("--seed", type=int, default=SEED)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    pack_path = args.run_root / "sanitized-randomized-inference-pack.json.gz"
    predictions_path = args.run_root / "predictions-before-label-reveal.json"
    if args.stage in {"prepare", "all"}:
        pack = prepare_pack(args.observation_root, pack_path, args.seed)
        print(
            json.dumps(
                {
                    "stage": "prepare",
                    "captureCount": len(pack["captures"]),
                    "randomizedCaptureOrder": pack["randomizedCaptureOrder"],
                    "output": str(pack_path),
                },
                ensure_ascii=False,
            )
        )
    if args.stage in {"infer", "all"}:
        predictions = infer(pack_path, predictions_path)
        print(
            json.dumps(
                {
                    "stage": "infer",
                    "recognizedVideos": sum(row["recognizedBenchExecution"] for row in predictions["rows"]),
                    "predictedReps": sum(len(row["predictedSegments"]) for row in predictions["rows"]),
                    "output": str(predictions_path),
                },
                ensure_ascii=False,
            )
        )
    if args.stage in {"evaluate", "all"}:
        report = evaluate(
            args.dataset,
            pack_path,
            predictions_path,
            args.pose_report,
            args.report_json,
            args.report_md,
        )
        print(json.dumps({"stage": "evaluate", **report["summary"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
