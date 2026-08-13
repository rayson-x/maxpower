#!/usr/bin/env python3
"""Train/evaluate research-only MM-Fit Halpe-26 set-periodicity priors.

MM-Fit supplies action and set-total labels, not rep boundaries or technique
quality.  This module therefore estimates only complete-set periodicity and
cycle-duration priors.  Every cross-validation fold selects its configuration
from other official-train subjects; expectedCount is never read by inference.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np


COCO_POINTS = (0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)
TORSO_POINTS = (5, 6, 11, 12)
ACTION_TEMPORAL_BIN_CANDIDATES = (4, 8)
ACTION_REGULARIZATION_CANDIDATES = (4.0, 8.0, 16.0)


@dataclass(frozen=True)
class PeriodicityConfig:
    smoothing_width: int
    frequency_penalty: float
    minimum_count: int = 3


@dataclass(frozen=True)
class CountCalibration:
    """Training-learned correction for a dominant second-harmonic count."""

    double_below_or_equal: int | None = None


@dataclass(frozen=True)
class ClipEvidence:
    source_sequence_id: str
    subject_id: str
    exercise_id: str
    expected_count: int
    timestamps: np.ndarray
    features: np.ndarray


def trajectory_descriptor(features: np.ndarray, *, temporal_bins: int = 0) -> np.ndarray:
    if len(features) == 0:
        raise ValueError("trajectory descriptor requires observed frames")
    velocity = np.zeros_like(features)
    if len(features) > 1:
        velocity[1:] = np.abs(features[1:] - features[:-1])
    statistics = np.concatenate((
        np.median(features, axis=0),
        np.std(features, axis=0),
        np.quantile(features, 0.10, axis=0),
        np.quantile(features, 0.90, axis=0),
        np.max(features, axis=0) - np.min(features, axis=0),
        np.mean(velocity, axis=0),
    ))
    if temporal_bins <= 0:
        return statistics
    if temporal_bins > 32 or 32 % temporal_bins != 0:
        raise ValueError("temporal bins must evenly divide the 32-sample trajectory")
    source_phase = np.linspace(0.0, 1.0, len(features))
    target_phase = np.linspace(0.0, 1.0, 32)
    resampled = np.stack([
        np.interp(target_phase, source_phase, features[:, index])
        for index in range(features.shape[1])
    ], axis=1)
    temporal_shape = np.concatenate([
        chunk.mean(axis=0) for chunk in np.array_split(resampled, temporal_bins)
    ])
    return np.concatenate((statistics, temporal_shape))


def fit_action_classifier(
    clips: list[ClipEvidence],
    *,
    temporal_bins: int = 4,
    regularization: float = 8.0,
) -> dict[str, Any]:
    if not clips:
        raise ValueError("action classifier requires training clips")
    labels = sorted({clip.exercise_id for clip in clips})
    descriptors = np.stack([
        trajectory_descriptor(clip.features, temporal_bins=temporal_bins)
        for clip in clips
    ])
    means = descriptors.mean(axis=0)
    scales = np.maximum(descriptors.std(axis=0), 1e-5)
    normalized = (descriptors - means) / scales
    design = np.column_stack([np.ones(len(normalized)), normalized])
    targets = np.zeros((len(clips), len(labels)), dtype=np.float64)
    label_index = {label: index for index, label in enumerate(labels)}
    for row, clip in enumerate(clips):
        targets[row, label_index[clip.exercise_id]] = 1.0
    # Dual ridge is stable when descriptor width exceeds the number of clips.
    dual = np.linalg.solve(
        design @ design.T + np.eye(len(design)) * regularization,
        targets,
    )
    weights = design.T @ dual
    return {
        "labels": labels,
        "descriptor": "statistics-plus-time-normalized-bin-means/v2",
        "temporalBins": temporal_bins,
        "means": means.tolist(),
        "scales": scales.tolist(),
        "weights": weights.tolist(),
        "regularization": regularization,
        "sourceSubjectIds": sorted({clip.subject_id for clip in clips}),
        "sourceSequenceCount": len(clips),
    }


def predict_action(classifier: dict[str, Any], features: np.ndarray) -> tuple[str, float]:
    descriptor = trajectory_descriptor(
        features,
        temporal_bins=int(classifier.get("temporalBins", 0)),
    )
    means = np.asarray(classifier["means"], dtype=np.float64)
    scales = np.asarray(classifier["scales"], dtype=np.float64)
    design = np.concatenate(([1.0], (descriptor - means) / scales))
    scores = design @ np.asarray(classifier["weights"], dtype=np.float64)
    best = int(np.argmax(scores))
    shifted = scores - np.max(scores)
    probabilities = np.exp(np.clip(shifted, -30.0, 0.0))
    confidence = float(probabilities[best] / max(np.sum(probabilities), 1e-9))
    return str(classifier["labels"][best]), confidence


def action_classification_metrics(rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    materialized = list(rows)
    labels = sorted({str(row["expectedExerciseId"]) for row in materialized})
    per_action = {}
    f1_values = []
    for label in labels:
        true_positive = sum(
            row["expectedExerciseId"] == label and row["predictedExerciseId"] == label
            for row in materialized
        )
        false_positive = sum(
            row["expectedExerciseId"] != label and row["predictedExerciseId"] == label
            for row in materialized
        )
        false_negative = sum(
            row["expectedExerciseId"] == label and row["predictedExerciseId"] != label
            for row in materialized
        )
        precision = true_positive / max(1, true_positive + false_positive)
        recall = true_positive / max(1, true_positive + false_negative)
        f1 = 2 * precision * recall / max(1e-9, precision + recall)
        f1_values.append(f1)
        per_action[label] = {
            "clipCount": sum(row["expectedExerciseId"] == label for row in materialized),
            "precision": round(precision, 6),
            "recall": round(recall, 6),
            "f1": round(f1, 6),
        }
    return {
        "clipCount": len(materialized),
        "accuracy": round(
            sum(row["expectedExerciseId"] == row["predictedExerciseId"] for row in materialized)
            / max(1, len(materialized)),
            6,
        ),
        "macroF1": round(sum(f1_values) / max(1, len(f1_values)), 6),
        "byExercise": per_action,
    }


def leave_one_subject_out_action_classification(
    clips: list[ClipEvidence],
) -> list[dict[str, Any]]:
    rows = []
    for held_out in sorted({clip.subject_id for clip in clips}):
        training = [clip for clip in clips if clip.subject_id != held_out]
        holdout = [clip for clip in clips if clip.subject_id == held_out]
        if not training:
            continue
        temporal_bins, regularization = select_action_classifier_config(training)
        classifier = fit_action_classifier(
            training,
            temporal_bins=temporal_bins,
            regularization=regularization,
        )
        for clip in holdout:
            predicted, confidence = predict_action(classifier, clip.features)
            rows.append({
                "sourceSequenceId": clip.source_sequence_id,
                "subjectId": clip.subject_id,
                "expectedExerciseId": clip.exercise_id,
                "predictedExerciseId": predicted,
                "confidence": round(confidence, 6),
                "selectedDescriptor": {
                    "temporalBins": temporal_bins,
                    "regularization": regularization,
                    "selectionProtocol": "inner-leave-one-train-subject-out",
                },
                "trainingSubjectIds": classifier["sourceSubjectIds"],
            })
    return rows


def select_action_classifier_config(clips: list[ClipEvidence]) -> tuple[int, float]:
    """Select action shape/regularization without observing the outer holdout."""
    subjects = sorted({clip.subject_id for clip in clips})
    candidates = [
        (temporal_bins, regularization)
        for temporal_bins in ACTION_TEMPORAL_BIN_CANDIDATES
        for regularization in ACTION_REGULARIZATION_CANDIDATES
    ]
    if len(subjects) < 2:
        return candidates[0]
    ranked = []
    for temporal_bins, regularization in candidates:
        rows = []
        for held_out in subjects:
            training = [clip for clip in clips if clip.subject_id != held_out]
            holdout = [clip for clip in clips if clip.subject_id == held_out]
            if not training or not holdout:
                continue
            classifier = fit_action_classifier(
                training,
                temporal_bins=temporal_bins,
                regularization=regularization,
            )
            for clip in holdout:
                predicted, _confidence = predict_action(classifier, clip.features)
                rows.append({
                    "expectedExerciseId": clip.exercise_id,
                    "predictedExerciseId": predicted,
                })
        metrics = action_classification_metrics(rows)
        recalls = [
            float(value["recall"])
            for value in metrics["byExercise"].values()
        ]
        ranked.append((
            -min(recalls, default=0.0),
            -float(metrics["macroF1"]),
            -float(metrics["accuracy"]),
            temporal_bins,
            regularization,
        ))
    ranked.sort()
    selected = ranked[0]
    return int(selected[-2]), float(selected[-1])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--canonical-sequences", required=True, type=Path)
    parser.add_argument("--model-output", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def finite(value: Any) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return None


def _point(frame: dict[str, Any], index: int) -> tuple[float, float, bool]:
    landmarks = frame.get("landmarks") or []
    if index >= len(landmarks):
        return 0.0, 0.0, False
    landmark = landmarks[index] or {}
    x = finite(landmark.get("x"))
    y = finite(landmark.get("y"))
    eligible = landmark.get("trainingObservationEligible") is True
    return (x or 0.0), (y or 0.0), bool(eligible and x is not None and y is not None)


def body_frame_features(poses: list[dict[str, Any]]) -> np.ndarray:
    """Mirror-invariant normalized features without filling missing keypoints."""
    rows: list[list[float]] = []
    for frame in poses:
        points = {index: _point(frame, index) for index in COCO_POINTS}
        torso = [points[index] for index in TORSO_POINTS]
        torso_valid = all(point[2] for point in torso)
        if torso_valid:
            center_x = sum(point[0] for point in torso) / 4.0
            center_y = sum(point[1] for point in torso) / 4.0
            shoulder_width = math.hypot(torso[0][0] - torso[1][0], torso[0][1] - torso[1][1])
            hip_width = math.hypot(torso[2][0] - torso[3][0], torso[2][1] - torso[3][1])
            left_torso = math.hypot(torso[0][0] - torso[2][0], torso[0][1] - torso[2][1])
            right_torso = math.hypot(torso[1][0] - torso[3][0], torso[1][1] - torso[3][1])
            scale = max(shoulder_width, hip_width, (left_torso + right_torso) / 2.0, 1e-4)
        else:
            center_x = center_y = 0.0
            scale = 1.0
        normalized: dict[int, tuple[float, float, bool]] = {}
        for index, (x, y, observed) in points.items():
            valid = observed and torso_valid
            normalized[index] = (
                abs((x - center_x) / scale) if valid else 0.0,
                (y - center_y) / scale if valid else 0.0,
                valid,
            )
        values: list[float] = []
        for left, right in ((5, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16)):
            lx, ly, lv = normalized[left]
            rx, ry, rv = normalized[right]
            pair_valid = lv and rv
            values.extend((
                (ly + ry) / 2.0 if pair_valid else 0.0,
                abs(ly - ry) if pair_valid else 0.0,
                (lx + rx) / 2.0 if pair_valid else 0.0,
                abs(lx - rx) if pair_valid else 0.0,
                float(pair_valid),
            ))
        for index in COCO_POINTS:
            x, y, valid = normalized[index]
            values.extend((x, y, float(valid)))
        rows.append(values)
    return np.asarray(rows, dtype=np.float64)


def smooth(values: np.ndarray, width: int) -> np.ndarray:
    if width <= 1 or len(values) <= 2:
        return values
    width = min(width, len(values) if len(values) % 2 else max(1, len(values) - 1))
    kernel = np.ones(width, dtype=np.float64) / width
    padded = np.pad(values, ((width // 2, width // 2), (0, 0)), mode="edge")
    return np.apply_along_axis(lambda column: np.convolve(column, kernel, mode="valid"), 0, padded)


def infer_periodic_count(
    features: np.ndarray,
    timestamps: np.ndarray,
    config: PeriodicityConfig,
) -> tuple[int, float]:
    """Infer a set count from motion alone; no expected count parameter exists."""
    if len(features) < 24 or len(timestamps) != len(features):
        return 0, 0.0
    values = smooth(features, config.smoothing_width)
    values = values - np.median(values, axis=0, keepdims=True)
    deviations = np.std(values, axis=0)
    useful = deviations > 1e-4
    values = values[:, useful]
    if values.shape[1] == 0:
        return 0, 0.0
    values = values / (np.std(values, axis=0, keepdims=True) + 1e-6)
    left, singular, _right = np.linalg.svd(values, full_matrices=False)
    component_count = min(10, singular.size)
    components = left[:, :component_count] * singular[:component_count]
    duration_s = max(1e-3, float(timestamps[-1] - timestamps[0]) / 1000.0)
    median_step_s = max(1e-3, float(np.median(np.diff(timestamps))) / 1000.0)
    max_count = min(30, max(config.minimum_count + 1, int(duration_s / max(0.30, median_step_s * 5))))
    phase = (timestamps - timestamps[0]) / max(timestamps[-1] - timestamps[0], 1e-6)
    ranked: list[tuple[float, int]] = []
    for count in range(config.minimum_count, max_count + 1):
        score = 0.0
        for harmonic, weight in ((1, 1.0), (2, 0.35), (3, 0.15)):
            cycles = count * harmonic
            if cycles >= len(features) / 3:
                continue
            cosine = np.cos(2 * np.pi * cycles * phase)
            sine = np.sin(2 * np.pi * cycles * phase)
            power = (
                (components.T @ cosine) ** 2 + (components.T @ sine) ** 2
            ) / (np.sum(components * components, axis=0) + 1e-6)
            score += weight * float(np.sort(power)[-min(5, power.size):].sum())
        ranked.append((score / (count ** config.frequency_penalty), count))
    ranked.sort(reverse=True)
    if not ranked:
        return 0, 0.0
    confidence = ranked[0][0] / max(ranked[0][0] + (ranked[1][0] if len(ranked) > 1 else 0.0), 1e-6)
    return ranked[0][1], float(confidence)


def summarize(rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    materialized = list(rows)
    if not materialized:
        return {
            "clipCount": 0,
            "truthRepCount": 0,
            "predictedRepCount": 0,
            "exactSetRatio": None,
            "offByOneRatio": None,
            "meanAbsoluteCountError": None,
        }
    errors = [abs(int(row["predictedCount"]) - int(row["expectedCount"])) for row in materialized]
    return {
        "clipCount": len(materialized),
        "truthRepCount": sum(int(row["expectedCount"]) for row in materialized),
        "predictedRepCount": sum(int(row["predictedCount"]) for row in materialized),
        "exactSetRatio": round(sum(error == 0 for error in errors) / len(errors), 6),
        "offByOneRatio": round(sum(error <= 1 for error in errors) / len(errors), 6),
        "meanAbsoluteCountError": round(sum(errors) / len(errors), 6),
    }


def apply_count_calibration(raw_count: int, calibration: CountCalibration) -> int:
    threshold = calibration.double_below_or_equal
    if threshold is not None and 0 < raw_count <= threshold:
        return raw_count * 2
    return raw_count


def fit_harmonic_count_calibration(rows: Iterable[dict[str, Any]]) -> CountCalibration:
    """Fit only a 2x low-frequency correction, never a memorized target count.

    Bilateral alternating actions often expose one full-body cycle for every two
    official repetitions.  The only permitted calibration is therefore a 2x
    correction below a learned raw-count boundary; additive offsets and
    action-specific constant answers are intentionally not candidates.
    """
    materialized = list(rows)
    if not materialized:
        return CountCalibration()
    raw_counts = sorted({
        int(row["rawPredictedCount"])
        for row in materialized
        if int(row["rawPredictedCount"]) > 0
    })
    candidates = [CountCalibration()] + [CountCalibration(value) for value in raw_counts]
    ranked = []
    for calibration in candidates:
        calibrated = [
            {
                "expectedCount": int(row["expectedCount"]),
                "predictedCount": apply_count_calibration(
                    int(row["rawPredictedCount"]), calibration,
                ),
            }
            for row in materialized
        ]
        metrics = summarize(calibrated)
        ranked.append((
            -(metrics["exactSetRatio"] or 0.0),
            metrics["meanAbsoluteCountError"] if metrics["meanAbsoluteCountError"] is not None else 999.0,
            -(metrics["offByOneRatio"] or 0.0),
            calibration.double_below_or_equal is not None,
            calibration.double_below_or_equal or 0,
            calibration,
        ))
    ranked.sort(key=lambda item: item[:-1])
    return ranked[0][-1]


def select_periodicity_profile(
    clips: list[ClipEvidence],
    configs: list[PeriodicityConfig],
) -> tuple[PeriodicityConfig, CountCalibration]:
    ranked = []
    for config in configs:
        raw_rows = []
        for clip in clips:
            raw_count, _confidence = infer_periodic_count(clip.features, clip.timestamps, config)
            raw_rows.append({
                "expectedCount": clip.expected_count,
                "rawPredictedCount": raw_count,
            })
        calibration = fit_harmonic_count_calibration(raw_rows)
        calibrated_rows = [
            {
                "expectedCount": row["expectedCount"],
                "predictedCount": apply_count_calibration(row["rawPredictedCount"], calibration),
            }
            for row in raw_rows
        ]
        metrics = summarize(calibrated_rows)
        ranked.append((
            -(metrics["exactSetRatio"] or 0.0),
            metrics["meanAbsoluteCountError"] if metrics["meanAbsoluteCountError"] is not None else 999.0,
            -(metrics["offByOneRatio"] or 0.0),
            calibration.double_below_or_equal is not None,
            calibration.double_below_or_equal or 0,
            config.smoothing_width,
            config.frequency_penalty,
            config,
            calibration,
        ))
    ranked.sort(key=lambda item: item[:-2])
    return ranked[0][-2], ranked[0][-1]


def select_config(
    clips: list[ClipEvidence],
    configs: list[PeriodicityConfig],
) -> PeriodicityConfig:
    return select_periodicity_profile(clips, configs)[0]


def leave_one_subject_out(
    clips: list[ClipEvidence],
    configs: list[PeriodicityConfig],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    subjects = sorted({clip.subject_id for clip in clips})
    for held_out in subjects:
        holdout = [clip for clip in clips if clip.subject_id == held_out]
        training = [clip for clip in clips if clip.subject_id != held_out]
        for exercise_id in sorted({clip.exercise_id for clip in holdout}):
            exercise_training = [clip for clip in training if clip.exercise_id == exercise_id]
            exercise_holdout = [clip for clip in holdout if clip.exercise_id == exercise_id]
            if not exercise_training:
                continue
            config, calibration = select_periodicity_profile(exercise_training, configs)
            training_subject_ids = sorted({clip.subject_id for clip in exercise_training})
            for clip in exercise_holdout:
                raw_count, confidence = infer_periodic_count(clip.features, clip.timestamps, config)
                predicted = apply_count_calibration(raw_count, calibration)
                rows.append({
                    "sourceSequenceId": clip.source_sequence_id,
                    "subjectId": clip.subject_id,
                    "exerciseId": clip.exercise_id,
                    "expectedCount": clip.expected_count,
                    "rawPredictedCount": raw_count,
                    "predictedCount": predicted,
                    "confidence": round(confidence, 6),
                    "selectedConfig": {
                        "smoothingWidth": config.smoothing_width,
                        "frequencyPenalty": config.frequency_penalty,
                        "minimumCount": config.minimum_count,
                    },
                    "selectedCountCalibration": {
                        "kind": "double-low-count-second-harmonic/v1",
                        "doubleBelowOrEqual": calibration.double_below_or_equal,
                    },
                    "trainingSubjectIds": training_subject_ids,
                })
    return rows


def load_clips(canonical: dict[str, Any]) -> list[ClipEvidence]:
    if canonical.get("requestedSplits") != ["train"]:
        raise ValueError("MM-Fit periodicity priors require a train-only canonical corpus")
    output = []
    for source_id, clip in sorted((canonical.get("clips") or {}).items()):
        if clip.get("split") != "train":
            raise ValueError(f"non-train canonical sequence leaked: {source_id}")
        set_bounds = clip.get("setBounds") or {}
        start_frame = int(set_bounds.get("startFrame", -1))
        end_frame = int(set_bounds.get("endFrame", -1))
        if start_frame < 0 or end_frame < start_frame:
            raise ValueError(f"MM-Fit canonical sequence is missing official set bounds: {source_id}")
        poses = [
            frame for frame in (clip.get("poses") or [])
            if start_frame <= int(frame.get("frameNumber", -1)) <= end_frame
        ]
        if not poses:
            raise ValueError(f"MM-Fit canonical set window has no observations: {source_id}")
        output.append(ClipEvidence(
            source_sequence_id=source_id,
            subject_id=str(clip["subjectId"]),
            exercise_id=str(clip["exerciseId"]),
            expected_count=int(clip["expectedCount"]),
            timestamps=np.asarray([float(frame["timestampMs"]) for frame in poses], dtype=np.float64),
            features=body_frame_features(poses),
        ))
    return output


def main() -> None:
    args = parse_args()
    canonical_bytes = args.canonical_sequences.read_bytes()
    canonical = json.loads(canonical_bytes)
    clips = load_clips(canonical)
    configs = [
        PeriodicityConfig(width, penalty)
        for width in (3, 5, 7, 9)
        for penalty in (0.0, 0.10, 0.20, 0.30)
    ]
    rows = leave_one_subject_out(clips, configs)
    action_rows = leave_one_subject_out_action_classification(clips)
    action_temporal_bins, action_regularization = select_action_classifier_config(clips)
    final_profiles = {}
    by_exercise: dict[str, list[ClipEvidence]] = defaultdict(list)
    for clip in clips:
        by_exercise[clip.exercise_id].append(clip)
    for exercise_id, exercise_clips in sorted(by_exercise.items()):
        config, calibration = select_periodicity_profile(exercise_clips, configs)
        durations = [
            max(1.0, float(clip.timestamps[-1] - clip.timestamps[0])) / max(1, clip.expected_count)
            for clip in exercise_clips if len(clip.timestamps) >= 2
        ]
        final_profiles[exercise_id] = {
            "sourceSubjectIds": sorted({clip.subject_id for clip in exercise_clips}),
            "sourceSequenceCount": len(exercise_clips),
            "periodicityConfig": {
                "smoothingWidth": config.smoothing_width,
                "frequencyPenalty": config.frequency_penalty,
                "minimumCount": config.minimum_count,
            },
            "countCalibration": {
                "kind": "double-low-count-second-harmonic/v1",
                "doubleBelowOrEqual": calibration.double_below_or_equal,
            },
            "weakCycleDurationMs": {
                "median": round(float(np.median(durations)), 3),
                "q10": round(float(np.quantile(durations, 0.10)), 3),
                "q90": round(float(np.quantile(durations, 0.90)), 3),
            } if durations else None,
        }
    report = {
        "schemaVersion": "maxpower-mmfit-halpe26-periodicity-loso/v1",
        "researchOnly": True,
        "productionPromotion": False,
        "evaluationProtocol": "leave-one-official-train-subject-out; config selected on other train subjects only",
        "usesExpectedCountAtInference": False,
        "annotationGranularity": "set_count",
        "notApplicable": [
            "per-rep start/peak/end alignment",
            "technique standardness",
            "compensation or cheating detection",
        ],
        "summary": summarize(rows),
        "byExercise": {
            exercise_id: summarize(row for row in rows if row["exerciseId"] == exercise_id)
            for exercise_id in sorted({row["exerciseId"] for row in rows})
        },
        "rows": rows,
        "actionClassification": {
            "protocol": (
                "nested leave-one-official-train-subject-out; descriptor and regularization "
                "selected by inner subject isolation"
            ),
            "usesExerciseLabelAtInference": False,
            "summary": action_classification_metrics(action_rows),
            "rows": action_rows,
        },
    }
    model = {
        "schemaVersion": "maxpower-mmfit-halpe26-periodicity-prior/v1",
        "researchOnly": True,
        "productionPromotion": False,
        "executionBackend": "python_offline_reference_only",
        "usesExpectedCountAtInference": False,
        "inputPoseSchema": "halpe26",
        "inputPipeline": canonical.get("inputPipeline"),
        "featureContract": "halpe26-coco17-prefix-mirror-invariant-observed-only/v1",
        "canonicalInput": str(args.canonical_sequences.resolve()),
        "canonicalInputSha256": hashlib.sha256(canonical_bytes).hexdigest(),
        "profiles": final_profiles,
        "actionClassifier": fit_action_classifier(
            clips,
            temporal_bins=action_temporal_bins,
            regularization=action_regularization,
        ),
    }
    args.model_output.parent.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.model_output.write_text(json.dumps(model, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"summary": report["summary"], "model": str(args.model_output), "report": str(args.output)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
