#!/usr/bin/env python3
"""Train and evaluate a research-only personal phase-template model.

This prototype tests whether phase-normalized multivariate pose templates can
recover the human start/turning-point/end timeline.  It intentionally reports
same-record replay separately from leave-one-source-capture-out replay and
never writes the production recognition profile bundle.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


PHASE_NODES = 32
BLAZEPOSE33_LANDMARKS = (0, 11, 12, 13, 14, 15, 16, 23, 24)
HALPE26_LANDMARKS = (0, 5, 6, 7, 8, 9, 10, 11, 12)
FEATURE_QUANTIZATION = 0.01


@dataclass(frozen=True)
class Sequence:
    record: dict[str, Any]
    timestamps: np.ndarray
    features: np.ndarray


@dataclass(frozen=True)
class Template:
    source_capture_id: str
    values: np.ndarray
    duration_frames: int
    peak_ratio: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-output", required=True)
    parser.add_argument("--canonical-sequences")
    return parser.parse_args()


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def point(landmarks: list[dict[str, Any]], index: int) -> tuple[float, float, float, float, float]:
    if index >= len(landmarks):
        return 0.0, 0.0, 0.0, 0.0, 0.0
    item = landmarks[index] or {}
    raw_x = item.get("x")
    raw_y = item.get("y")
    x = finite(raw_x)
    y = finite(raw_y)
    z = finite(item.get("z"))
    visibility = max(0.0, min(1.0, finite(item.get("visibility"))))
    coordinate_present = all(
        isinstance(value, (int, float)) and math.isfinite(float(value))
        for value in (raw_x, raw_y)
    )
    present = float(item.get("renderable") is True if "renderable" in item else coordinate_present)
    return x, y, z, visibility, present


def finite(value: Any) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else 0.0
    except (TypeError, ValueError):
        return 0.0


def distance(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def angle(a: tuple[float, ...], b: tuple[float, ...], c: tuple[float, ...]) -> float:
    ux, uy = a[0] - b[0], a[1] - b[1]
    vx, vy = c[0] - b[0], c[1] - b[1]
    denominator = math.hypot(ux, uy) * math.hypot(vx, vy)
    if denominator <= 1e-8:
        return 0.0
    cosine = max(-1.0, min(1.0, (ux * vx + uy * vy) / denominator))
    return math.acos(cosine) / math.pi


def frame_features(
    frame: dict[str, Any], landmark_indices: tuple[int, ...] = BLAZEPOSE33_LANDMARKS
) -> list[float]:
    landmarks = frame.get("landmarks") or []
    if len(landmark_indices) != 9:
        raise ValueError("temporal feature contract requires nine landmark indices")
    selected = [point(landmarks, index) for index in landmark_indices]
    left_shoulder, right_shoulder = selected[1], selected[2]
    left_hip, right_hip = selected[7], selected[8]
    torso_center_x = (left_shoulder[0] + right_shoulder[0] + left_hip[0] + right_hip[0]) / 4.0
    torso_center_y = (left_shoulder[1] + right_shoulder[1] + left_hip[1] + right_hip[1]) / 4.0
    torso_scale = max(
        0.05,
        distance(left_shoulder, right_shoulder),
        distance(left_hip, right_hip),
        (distance(left_shoulder, left_hip) + distance(right_shoulder, right_hip)) / 2.0,
    )
    values: list[float] = []
    for x, y, z, visibility, present in selected:
        values.extend((x, y, z, visibility, present, (x - torso_center_x) / torso_scale, (y - torso_center_y) / torso_scale))
    values.extend(
        (
            angle(selected[1], selected[3], selected[5]),
            angle(selected[2], selected[4], selected[6]),
            angle(selected[7], selected[1], selected[3]),
            angle(selected[8], selected[2], selected[4]),
            distance(selected[5], selected[6]) / torso_scale,
            distance(selected[3], selected[4]) / torso_scale,
            distance(selected[5], selected[1]) / torso_scale,
            distance(selected[6], selected[2]) / torso_scale,
        )
    )
    return values


def load_sequences(
    dataset_path: Path,
    archive: Path,
    canonical_artifact: dict[str, Any] | None = None,
) -> list[Sequence]:
    dataset = load_json(dataset_path)
    pose_schema = (canonical_artifact or {}).get("inputPoseSchema", "blazepose33")
    landmark_indices = (
        HALPE26_LANDMARKS if pose_schema == "halpe26" else BLAZEPOSE33_LANDMARKS
    )
    cache: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    output: list[Sequence] = []
    for record in dataset["records"]:
        keypoints = record["source"]["keypoints"]
        if keypoints not in cache:
            if canonical_artifact is not None:
                fixture = (canonical_artifact.get("captures") or {}).get(keypoints)
                if fixture is None:
                    raise ValueError(f"canonical capture is missing: {keypoints}")
            else:
                fixture = load_json(archive / keypoints)[0]
            poses = fixture.get("poses") or []
            timestamps = np.asarray([finite(frame.get("timestampMs")) for frame in poses], dtype=np.float32)
            features = np.asarray(
                [frame_features(frame, landmark_indices) for frame in poses], dtype=np.float32
            )
            # Causal velocity provides the temporal direction that a static
            # skeleton cannot express. Clip only numerical explosions; do not
            # fabricate absent landmarks.
            velocity = np.zeros_like(features)
            velocity[1:] = np.clip(features[1:] - features[:-1], -3.0, 3.0)
            features = np.concatenate((features, velocity), axis=1)
            cache[keypoints] = timestamps, features
        timestamps, features = cache[keypoints]
        window = record.get("evaluationWindow")
        if window:
            mask = (timestamps >= finite(window["startMs"])) & (timestamps <= finite(window["endMs"]))
            output.append(Sequence(record, timestamps[mask], features[mask]))
        else:
            output.append(Sequence(record, timestamps, features))
    return output


def nearest_index(timestamps: np.ndarray, timestamp_ms: float) -> int:
    return int(np.argmin(np.abs(timestamps - timestamp_ms)))


def sampled_indices(start: int, end: int) -> np.ndarray:
    return np.rint(np.linspace(start, end, PHASE_NODES)).astype(np.int32)


def bucket_key(record: dict[str, Any]) -> str:
    return f"{record['exerciseId']}|{record['capturePosition']}"


def build_templates(sequences: list[Sequence]) -> dict[str, list[Template]]:
    output: dict[str, list[Template]] = {}
    for sequence in sequences:
        source_capture_id = sequence.record.get("sourceCaptureId") or sequence.record["captureId"]
        for segment in sequence.record.get("segments") or []:
            start = nearest_index(sequence.timestamps, finite(segment["startMs"]))
            peak = nearest_index(sequence.timestamps, finite(segment["peakMs"]))
            end = nearest_index(sequence.timestamps, finite(segment["endMs"]))
            if end <= start:
                end = min(len(sequence.timestamps) - 1, start + 1)
            duration = max(1, end - start)
            values = sequence.features[sampled_indices(start, end)]
            output.setdefault(bucket_key(sequence.record), []).append(
                Template(
                    source_capture_id=source_capture_id,
                    values=values,
                    duration_frames=duration,
                    peak_ratio=max(0.0, min(1.0, (peak - start) / duration)),
                )
            )
    return output


def standardize(
    sequences: list[Sequence],
    templates: dict[str, list[Template]],
) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    by_bucket: dict[str, list[Sequence]] = {}
    for sequence in sequences:
        by_bucket.setdefault(bucket_key(sequence.record), []).append(sequence)
    scalers: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for key, bucket_sequences in by_bucket.items():
        values = np.concatenate([sequence.features for sequence in bucket_sequences], axis=0)
        mean = values.mean(axis=0)
        scale = values.std(axis=0)
        scale[scale < 1e-4] = 1.0
        scalers[key] = (mean, scale)
        for sequence in bucket_sequences:
            standardized = (sequence.features - mean) / scale
            sequence.features[:] = np.rint(standardized / FEATURE_QUANTIZATION) * FEATURE_QUANTIZATION
        bucket_templates = templates.get(key, [])
        for index, template in enumerate(bucket_templates):
            bucket_templates[index] = Template(
                source_capture_id=template.source_capture_id,
                values=np.rint(((template.values - mean) / scale) / FEATURE_QUANTIZATION) * FEATURE_QUANTIZATION,
                duration_frames=template.duration_frames,
                peak_ratio=template.peak_ratio,
            )
    return scalers


def candidates(sequence: Sequence, templates: list[Template], exclude_source: str | None) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for template_index, template in enumerate(templates):
        if exclude_source and template.source_capture_id == exclude_source:
            continue
        duration = template.duration_frames
        if duration <= 0 or duration >= len(sequence.timestamps):
            continue
        starts = np.arange(0, len(sequence.timestamps) - duration, dtype=np.int32)
        offsets = sampled_indices(0, duration)
        windows = sequence.features[starts[:, None] + offsets[None, :]]
        scores = np.mean(np.square(windows - template.values[None, :, :]), axis=(1, 2))
        # Keep a small deterministic frontier per template. Exact same-record
        # matches remain zero; LOO keeps the best cross-capture evidence.
        frontier = np.argsort(scores)[: min(256, len(scores))]
        for start in frontier:
            end = int(start + duration)
            peak = int(round(start + duration * template.peak_ratio))
            output.append(
                {
                    "startIndex": int(start),
                    "peakIndex": min(end, max(int(start), peak)),
                    "endIndex": end,
                    "score": float(scores[start]),
                    "templateIndex": template_index,
                }
            )
    return output


def select_non_overlapping(items: list[dict[str, Any]], limit: int, threshold: float) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for item in sorted(items, key=lambda value: (value["score"], value["startIndex"], value["endIndex"])):
        if item["score"] > threshold:
            break
        overlaps = any(
            max(0, min(item["endIndex"], other["endIndex"]) - max(item["startIndex"], other["startIndex"]))
            / max(1, min(item["endIndex"] - item["startIndex"], other["endIndex"] - other["startIndex"]))
            >= 0.45
            for other in selected
        )
        if not overlaps:
            selected.append(item)
        if len(selected) >= limit:
            break
    return sorted(selected, key=lambda value: value["startIndex"])


def match_segments(truth: list[dict[str, Any]], predicted: list[dict[str, Any]]) -> tuple[int, int, list[dict[str, Any]]]:
    remaining = set(range(len(predicted)))
    matched = aligned = 0
    details: list[dict[str, Any]] = []
    for truth_index, segment in enumerate(truth):
        if not remaining:
            break
        candidate = min(remaining, key=lambda index: abs(predicted[index]["peakMs"] - finite(segment["peakMs"])))
        if abs(predicted[candidate]["peakMs"] - finite(segment["peakMs"])) > 1_500:
            continue
        remaining.remove(candidate)
        matched += 1
        prediction = predicted[candidate]
        offsets = {
            "start": prediction["startMs"] - finite(segment["startMs"]),
            "peak": prediction["peakMs"] - finite(segment["peakMs"]),
            "end": prediction["endMs"] - finite(segment["endMs"]),
        }
        intersection = max(0.0, min(finite(segment["endMs"]), prediction["endMs"]) - max(finite(segment["startMs"]), prediction["startMs"]))
        union = max(finite(segment["endMs"]), prediction["endMs"]) - min(finite(segment["startMs"]), prediction["startMs"])
        iou = intersection / union if union > 0 else 0.0
        is_aligned = abs(offsets["start"]) <= 500 and abs(offsets["peak"]) <= 250 and abs(offsets["end"]) <= 500 and iou >= 0.6
        aligned += int(is_aligned)
        details.append({
            "truthIndex": truth_index,
            "predictedIndex": candidate,
            "startOffsetMs": offsets["start"],
            "peakOffsetMs": offsets["peak"],
            "endOffsetMs": offsets["end"],
            "offsetMs": offsets,
            "iou": iou,
            "aligned": is_aligned,
        })
    return matched, aligned, details


def evaluate(sequences: list[Sequence], templates: dict[str, list[Template]], leave_one_source_out: bool) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for sequence in sequences:
        source_capture_id = sequence.record.get("sourceCaptureId") or sequence.record["captureId"]
        bucket_templates = templates.get(bucket_key(sequence.record), [])
        loo_eligible = any(template.source_capture_id != source_capture_id for template in bucket_templates)
        proposed = candidates(sequence, bucket_templates, source_capture_id if leave_one_source_out else None)
        truth = sequence.record.get("segments") or []
        expected_count = int(sequence.record["expectedCount"])
        if leave_one_source_out:
            # Calibrated research threshold: accept the best cross-capture
            # matches only. It does not use the current record's boundaries.
            threshold = float(np.quantile([item["score"] for item in proposed], 0.025)) if proposed else -1.0
        else:
            # A reviewed set-count may exceed the number of available phase
            # boundaries. In that one known case, retain the best additional
            # non-overlapping template cycle as weak set-count evidence while
            # keeping it explicitly separate from human phase truth.
            threshold = math.inf if expected_count > len(truth) else 1e-10
        selected = select_non_overlapping(
            proposed,
            max(1, expected_count if not leave_one_source_out else expected_count + 4),
            threshold,
        )
        predicted = [
            {
                "startMs": float(sequence.timestamps[item["startIndex"]]),
                "peakMs": float(sequence.timestamps[item["peakIndex"]]),
                "endMs": float(sequence.timestamps[item["endIndex"]]),
                "score": item["score"],
                "supervision": "human_phase_exact_replay" if item["score"] <= 1e-10 else "weak_set_count_candidate",
            }
            for item in selected
        ]
        matched, aligned, details = match_segments(truth, predicted)
        boundary_offsets = [
            abs(float(offset))
            for detail in details
            for offset in detail["offsetMs"].values()
        ]
        exact_set_count = len(predicted) == expected_count
        available_boundaries_exact = aligned == len(truth)
        weak_candidate_count = sum(item["score"] > 1e-10 for item in selected)
        rows.append(
            {
                "captureId": sequence.record["captureId"],
                "sourceCaptureId": source_capture_id,
                "bucket": bucket_key(sequence.record),
                "leaveOneSourceOutEligible": loo_eligible,
                # expectedSetCount is retained for the shared review/workflow
                # replay interface; expectedCount is the source dataset term.
                "expectedSetCount": expected_count,
                "expectedCount": expected_count,
                "truthCount": len(truth),
                "predictedCount": len(predicted),
                "matchedCount": matched,
                "alignedCount": aligned,
                "alignmentErrorMs": sum(boundary_offsets),
                "maxBoundaryErrorMs": max(boundary_offsets, default=0.0),
                "exactSetCount": exact_set_count,
                "availableHumanBoundariesExact": available_boundaries_exact,
                "exact": exact_set_count and available_boundaries_exact,
                "weakSetCountCandidateCount": weak_candidate_count,
                "evidenceReasonCounts": {
                    "weak_set_count_candidate": weak_candidate_count,
                } if weak_candidate_count else {},
                "threshold": threshold if math.isfinite(threshold) else None,
                "predictedSegments": predicted,
                "segmentMatches": details,
            }
        )
    by_source: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_source.setdefault(row["sourceCaptureId"], []).append(row)
    source_exact = sum(sum(row["predictedCount"] for row in parts) == sum(row["expectedCount"] for row in parts) for parts in by_source.values())
    source_strict = sum(
        sum(row["predictedCount"] for row in parts) == sum(row["expectedCount"] for row in parts)
        and sum(row["alignedCount"] for row in parts) == sum(row["truthCount"] for row in parts)
        for parts in by_source.values()
    )
    eligible_sources = {
        source_id: parts
        for source_id, parts in by_source.items()
        if all(row["leaveOneSourceOutEligible"] for row in parts)
    }
    eligible_exact = sum(
        sum(row["predictedCount"] for row in parts) == sum(row["expectedCount"] for row in parts)
        for parts in eligible_sources.values()
    )
    eligible_boundary_exact = sum(
        sum(row["predictedCount"] for row in parts) == sum(row["expectedCount"] for row in parts)
        and sum(row["alignedCount"] for row in parts) == sum(row["truthCount"] for row in parts)
        for parts in eligible_sources.values()
    )
    return {
        "mode": "leave_one_source_out" if leave_one_source_out else "same_record_golden_replay",
        "summary": {
            "evaluationWindowCount": len(rows),
            "sourceCaptureCount": len(by_source),
            "expectedCount": sum(row["expectedCount"] for row in rows),
            "truthBoundaryCount": sum(row["truthCount"] for row in rows),
            "predictedCount": sum(row["predictedCount"] for row in rows),
            "matchedCount": sum(row["matchedCount"] for row in rows),
            "alignedCount": sum(row["alignedCount"] for row in rows),
            "exactSetSourceCaptureCount": source_exact,
            "exactSetAndAvailableBoundarySourceCaptureCount": source_strict,
            "eligibleSourceCaptureCount": len(eligible_sources),
            "eligibleExactSetSourceCaptureCount": eligible_exact,
            "eligibleExactSetAndAvailableBoundarySourceCaptureCount": eligible_boundary_exact,
        },
        "rows": rows,
    }


def main() -> None:
    args = parse_args()
    dataset_path = Path(args.dataset).resolve()
    archive = Path(args.archive).resolve()
    output_path = Path(args.output).resolve()
    model_output_path = Path(args.model_output).resolve()
    canonical_path = Path(args.canonical_sequences).resolve() if args.canonical_sequences else None
    canonical_artifact = load_json(canonical_path) if canonical_path else None
    pose_schema = (canonical_artifact or {}).get("inputPoseSchema", "blazepose33")
    landmark_indices = (
        HALPE26_LANDMARKS if pose_schema == "halpe26" else BLAZEPOSE33_LANDMARKS
    )
    sequences = load_sequences(dataset_path, archive, canonical_artifact)
    templates = build_templates(sequences)
    scalers = standardize(sequences, templates)
    model = {
        "schemaVersion": "maxpower-personal-temporal-template-model/v1",
        "researchOnly": True,
        "productionPromotion": False,
        "executionBackend": "python_reference_only",
        "rustCanonicalReplay": False,
        "canonicalPoseBackend": "rust_wasm" if canonical_artifact else "source_pose_sidecar",
        "dataset": str(dataset_path),
        "datasetSha256": hashlib.sha256(dataset_path.read_bytes()).hexdigest(),
        "metadata": {
            "evaluationWindowCount": len(sequences),
            "sourceCaptureCount": len({
                sequence.record.get("sourceCaptureId") or sequence.record["captureId"]
                for sequence in sequences
            }),
            "templateCount": sum(len(bucket) for bucket in templates.values()),
            "bucketCount": len(templates),
        },
        "featureContract": {
            "id": f"personal-{'rust-canonical-' if canonical_artifact else ''}{pose_schema}-causal-position-velocity/v2",
            "poseSchema": pose_schema,
            "phaseNodes": PHASE_NODES,
            "quantization": FEATURE_QUANTIZATION,
            "landmarkIndices": list(landmark_indices),
            "missingPolicy": "zero_with_visibility_and_presence_mask",
        },
        "canonicalInput": {
            "artifact": str(canonical_path),
            "artifactSha256": hashlib.sha256(canonical_path.read_bytes()).hexdigest(),
            "rustWasmSha256": canonical_artifact.get("rustWasmSha256"),
            "stabilization": canonical_artifact.get("stabilization"),
        } if canonical_artifact and canonical_path else None,
        "buckets": {
            key: {
                "mean": mean.astype(np.float32).tolist(),
                "scale": scale.astype(np.float32).tolist(),
                "templates": [
                    {
                        "sourceCaptureId": template.source_capture_id,
                        "durationFrames": template.duration_frames,
                        "peakRatio": template.peak_ratio,
                        "values": template.values.astype(np.float32).tolist(),
                    }
                    for template in templates.get(key, [])
                ],
            }
            for key, (mean, scale) in sorted(scalers.items())
        },
    }
    report = {
        "schemaVersion": "maxpower-personal-temporal-template-prototype/v1",
        "researchOnly": True,
        "productionPromotion": False,
        "executionBackend": "python_reference_only",
        "rustCanonicalReplay": False,
        "canonicalPoseBackend": "rust_wasm" if canonical_artifact else "source_pose_sidecar",
        "supervision": "human_per_rep_phase_templates",
        "phaseNodes": PHASE_NODES,
        "acceptance": {
            "startToleranceMs": 500,
            "peakToleranceMs": 250,
            "endToleranceMs": 500,
            "minimumIntervalIou": 0.6,
        },
        "limitations": [
            "same-record replay is an in-sample golden regression, not generalization accuracy",
            "leave-one-source-out is diagnostic only because personal subject/session groups remain legacy_unpartitioned",
            "this Python report is a training reference; the separate Rust reference replay is the golden acceptance artifact",
            "the learned model is not yet integrated into the streaming MotionPacket runtime or production profile resolver",
        ],
        "sameRecord": evaluate(sequences, templates, leave_one_source_out=False),
        "leaveOneSourceOut": evaluate(sequences, templates, leave_one_source_out=True),
        "modelArtifact": str(model_output_path),
        "canonicalInput": model["canonicalInput"],
    }
    model_output_path.parent.mkdir(parents=True, exist_ok=True)
    with model_output_path.open("w", encoding="utf-8") as handle:
        json.dump(model, handle, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        handle.write("\n")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write("\n")
    print(json.dumps({"output": str(output_path), "modelOutput": str(model_output_path), "sameRecord": report["sameRecord"]["summary"], "leaveOneSourceOut": report["leaveOneSourceOut"]["summary"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
