#!/usr/bin/env python3
"""Train a research-only closed-cycle profile from manual rep ranges.

This candidate deliberately ignores legacy peak labels. It learns an
exercise-specific, mirror-invariant motion axis from manual start/end ranges,
then detects complete depart/return cycles without using expected rep count.
The current sequence-level robust normalization is non-causal, so artifacts
from this script are diagnostic and may not be promoted to the streaming SDK.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np


sys.path.insert(0, str(Path(__file__).resolve().parent))
from trainTemporalTemplates import Sequence, load_json, load_sequences, nearest_index  # noqa: E402


SMOOTHING_FRAMES = 5
TOP_FEATURE_COUNT = 5


@dataclass(frozen=True)
class SelectedFeature:
    name: str
    index: int
    direction: int
    score: float


@dataclass(frozen=True)
class CycleParameters:
    minimum_duration_ms: float
    maximum_duration_ms: float
    search_half_window_ms: float
    minimum_prominence: float


@dataclass(frozen=True)
class CycleCandidate:
    start_index: int
    peak_index: int
    end_index: int
    prominence: float


@dataclass(frozen=True)
class CandidateEvidence:
    signal_prominence: float
    channel_prominence_q25: float
    channel_prominence_min: float
    channel_direction_agreement: float
    endpoint_closure_ratio: float
    endpoint_closure_q75: float
    peak_phase_mad: float
    endpoint_signal_residual_ratio: float
    duration_log_error: float
    rise_fall_log_ratio: float
    nearest_peak_gap_ratio: float
    farthest_peak_gap_ratio: float
    nearest_duration_log_ratio: float

    def vector(self) -> np.ndarray:
        return np.asarray(tuple(asdict(self).values()), dtype=np.float64)


@dataclass(frozen=True)
class CandidateClassifier:
    classifier_kind: str
    feature_names: tuple[str, ...]
    means: tuple[float, ...]
    scales: tuple[float, ...]
    support_vectors: tuple[tuple[float, ...], ...]
    support_labels: tuple[bool, ...]
    neighbor_count: int
    threshold: float
    positive_count: int
    negative_count: int


def compute_candidate_evidence(
    timestamps: np.ndarray,
    signal: np.ndarray,
    channels: np.ndarray,
    candidates: list[CycleCandidate],
    candidate_index: int,
    *,
    median_duration_ms: float,
) -> CandidateEvidence:
    candidate = candidates[candidate_index]
    window = channels[candidate.start_index : candidate.end_index + 1]
    spans = np.maximum(window.max(axis=0) - window.min(axis=0), 1e-6)
    channel_prominence = channels[candidate.peak_index] - np.maximum(
        channels[candidate.start_index],
        channels[candidate.end_index],
    )
    peak_phase = np.argmax(window, axis=0) / max(1, len(window) - 1)
    closure = np.abs(
        channels[candidate.start_index] - channels[candidate.end_index]
    ) / spans
    duration_ms = max(
        1.0,
        float(timestamps[candidate.end_index] - timestamps[candidate.start_index]),
    )
    rise_ms = max(
        1.0,
        float(timestamps[candidate.peak_index] - timestamps[candidate.start_index]),
    )
    fall_ms = max(
        1.0,
        float(timestamps[candidate.end_index] - timestamps[candidate.peak_index]),
    )
    neighbor_peak_gaps: list[float] = []
    neighbor_duration_ratios: list[float] = []
    for neighbor_index in (candidate_index - 1, candidate_index + 1):
        if not 0 <= neighbor_index < len(candidates):
            continue
        neighbor = candidates[neighbor_index]
        neighbor_peak_gaps.append(
            abs(float(timestamps[candidate.peak_index] - timestamps[neighbor.peak_index]))
            / max(median_duration_ms, 1.0)
        )
        neighbor_duration_ms = max(
            1.0,
            float(timestamps[neighbor.end_index] - timestamps[neighbor.start_index]),
        )
        neighbor_duration_ratios.append(abs(float(np.log(duration_ms / neighbor_duration_ms))))
    if neighbor_peak_gaps:
        nearest_peak_gap_ratio = min(neighbor_peak_gaps)
        farthest_peak_gap_ratio = max(neighbor_peak_gaps)
        nearest_duration_log_ratio = min(neighbor_duration_ratios)
    else:
        nearest_peak_gap_ratio = 10.0
        farthest_peak_gap_ratio = 10.0
        nearest_duration_log_ratio = 10.0
    return CandidateEvidence(
        signal_prominence=float(candidate.prominence),
        channel_prominence_q25=float(np.quantile(channel_prominence, 0.25)),
        channel_prominence_min=float(np.min(channel_prominence)),
        channel_direction_agreement=float(np.mean(channel_prominence > 0)),
        endpoint_closure_ratio=float(np.mean(closure)),
        endpoint_closure_q75=float(np.quantile(closure, 0.75)),
        peak_phase_mad=float(np.median(np.abs(peak_phase - np.median(peak_phase)))),
        endpoint_signal_residual_ratio=abs(
            float(signal[candidate.start_index] - signal[candidate.end_index])
        )
        / max(candidate.prominence, 1e-6),
        duration_log_error=abs(
            float(np.log(duration_ms / max(median_duration_ms, 1.0)))
        ),
        rise_fall_log_ratio=abs(float(np.log(rise_ms / fall_ms))),
        nearest_peak_gap_ratio=nearest_peak_gap_ratio,
        farthest_peak_gap_ratio=farthest_peak_gap_ratio,
        nearest_duration_log_ratio=nearest_duration_log_ratio,
    )


def _classifier_score(classifier: CandidateClassifier, evidence: CandidateEvidence) -> float:
    values = evidence.vector()
    means = np.asarray(classifier.means, dtype=np.float64)
    scales = np.asarray(classifier.scales, dtype=np.float64)
    support = np.asarray(classifier.support_vectors, dtype=np.float64)
    labels = np.asarray(classifier.support_labels, dtype=np.float64)
    normalized = (values - means) / scales
    distances = np.sum(np.square(support - normalized), axis=1)
    indices = np.argsort(distances)[: min(classifier.neighbor_count, len(support))]
    weights = 1.0 / (np.sqrt(distances[indices]) + 0.25)
    return float(np.sum(weights * labels[indices]) / max(np.sum(weights), 1e-9))


def classify_candidate(classifier: CandidateClassifier, evidence: CandidateEvidence) -> bool:
    return _classifier_score(classifier, evidence) >= classifier.threshold


def fit_candidate_classifier(
    samples: list[tuple[CandidateEvidence, bool]],
) -> CandidateClassifier | None:
    positive_count = sum(label for _, label in samples)
    negative_count = len(samples) - positive_count
    if positive_count == 0 or negative_count == 0:
        return None
    features = np.stack([evidence.vector() for evidence, _ in samples], axis=0)
    labels = np.asarray([float(label) for _, label in samples], dtype=np.float64)
    means = features.mean(axis=0)
    scales = np.maximum(features.std(axis=0), 1e-6)
    normalized = (features - means) / scales
    neighbor_count = min(9, max(1, len(normalized) - 1))
    scores = []
    for index, value in enumerate(normalized):
        distances = np.sum(np.square(normalized - value), axis=1)
        distances[index] = np.inf
        indices = np.argsort(distances)[:neighbor_count]
        neighbor_weights = 1.0 / (np.sqrt(distances[indices]) + 0.25)
        scores.append(
            float(np.sum(neighbor_weights * labels[indices]) / max(np.sum(neighbor_weights), 1e-9))
        )
    scores = np.asarray(scores, dtype=np.float64)
    best: tuple[tuple[float, float, float, float], float] | None = None
    for threshold in sorted(set(float(score) for score in scores)) + [1.000001]:
        accepted = scores >= threshold
        true_positive = int(np.sum(accepted & (labels == 1)))
        false_positive = int(np.sum(accepted & (labels == 0)))
        false_negative = int(np.sum(~accepted & (labels == 1)))
        precision = true_positive / max(1, true_positive + false_positive)
        recall = true_positive / max(1, true_positive + false_negative)
        f1 = 2 * precision * recall / max(1e-9, precision + recall)
        rank = (min(precision, recall), f1, recall, threshold)
        if best is None or rank > best[0]:
            best = (rank, threshold)
    assert best is not None
    return CandidateClassifier(
        classifier_kind="standardized-knn-candidate-quality/v1",
        feature_names=tuple(CandidateEvidence.__dataclass_fields__),
        means=tuple(float(value) for value in means),
        scales=tuple(float(value) for value in scales),
        support_vectors=tuple(tuple(float(value) for value in row) for row in normalized),
        support_labels=tuple(bool(value) for value in labels),
        neighbor_count=neighbor_count,
        threshold=best[1],
        positive_count=positive_count,
        negative_count=negative_count,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--canonical-sequences", required=True, type=Path)
    parser.add_argument("--model-output", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--prominence-multiplier", type=float, default=0.45)
    return parser.parse_args()


def _smooth(values: np.ndarray) -> np.ndarray:
    radius = SMOOTHING_FRAMES // 2
    if len(values) == 0:
        return values
    padded = np.pad(values, ((radius, radius), (0, 0)), mode="edge")
    kernel = np.ones(SMOOTHING_FRAMES, dtype=np.float64) / SMOOTHING_FRAMES
    return np.apply_along_axis(lambda column: np.convolve(column, kernel, mode="valid"), 0, padded)


def feature_library(sequence: Sequence) -> tuple[np.ndarray, list[str]]:
    base = sequence.features[:, :71]
    geometry = base[:, 63:71]
    columns: list[np.ndarray] = []
    names: list[str] = []

    def add(name: str, values: np.ndarray) -> None:
        names.append(name)
        columns.append(values)

    geometry_names = (
        "left_elbow_angle",
        "right_elbow_angle",
        "left_shoulder_angle",
        "right_shoulder_angle",
        "wrist_distance",
        "elbow_distance",
        "left_wrist_shoulder_distance",
        "right_wrist_shoulder_distance",
    )
    for index, name in enumerate(geometry_names):
        add(name, geometry[:, index])

    for name, left, right in (
        ("elbow_angle", geometry[:, 0], geometry[:, 1]),
        ("shoulder_angle", geometry[:, 2], geometry[:, 3]),
        ("wrist_shoulder_distance", geometry[:, 6], geometry[:, 7]),
    ):
        add(f"{name}_mean", (left + right) / 2)
        add(f"{name}_min", np.minimum(left, right))
        add(f"{name}_max", np.maximum(left, right))
        add(f"{name}_diff", np.abs(left - right))

    for name, left_index, right_index in (
        ("shoulder", 1, 2),
        ("elbow", 3, 4),
        ("wrist", 5, 6),
        ("hip", 7, 8),
    ):
        left_x = base[:, left_index * 7 + 5]
        left_y = base[:, left_index * 7 + 6]
        right_x = base[:, right_index * 7 + 5]
        right_y = base[:, right_index * 7 + 6]
        add(f"{name}_y_mean", (left_y + right_y) / 2)
        add(f"{name}_y_min", np.minimum(left_y, right_y))
        add(f"{name}_y_max", np.maximum(left_y, right_y))
        add(f"{name}_y_diff", np.abs(left_y - right_y))
        add(f"{name}_x_width", np.abs(left_x - right_x))
        add(f"{name}_x_abs_mean", (np.abs(left_x) + np.abs(right_x)) / 2)
        add(f"{name}_x_abs_min", np.minimum(np.abs(left_x), np.abs(right_x)))
        add(f"{name}_x_abs_max", np.maximum(np.abs(left_x), np.abs(right_x)))

    shoulder_y = (base[:, 1 * 7 + 6] + base[:, 2 * 7 + 6]) / 2
    elbow_y = (base[:, 3 * 7 + 6] + base[:, 4 * 7 + 6]) / 2
    wrist_y = (base[:, 5 * 7 + 6] + base[:, 6 * 7 + 6]) / 2
    add("wrist_minus_shoulder", wrist_y - shoulder_y)
    add("elbow_minus_shoulder", elbow_y - shoulder_y)
    add("wrist_minus_elbow", wrist_y - elbow_y)
    return _smooth(np.stack(columns, axis=1)), names


def normalize_sequence(features: np.ndarray) -> np.ndarray:
    low, high = np.quantile(features, (0.05, 0.95), axis=0)
    return (features - low) / np.maximum(high - low, 1e-4)


def select_features(
    training: list[Sequence],
    cache: dict[int, tuple[np.ndarray, list[str]]],
    top_count: int = TOP_FEATURE_COUNT,
) -> list[SelectedFeature]:
    width = cache[id(training[0])][0].shape[1]
    observations: list[list[tuple[float, float, float]]] = [[] for _ in range(width)]
    for sequence in training:
        normalized = normalize_sequence(cache[id(sequence)][0])
        for segment in sequence.record.get("segments") or []:
            start = nearest_index(sequence.timestamps, float(segment["startMs"]))
            end = nearest_index(sequence.timestamps, float(segment["endMs"]))
            baseline = (normalized[start] + normalized[end]) / 2
            window = normalized[start : end + 1]
            positive = window.max(axis=0) - baseline
            negative = baseline - window.min(axis=0)
            closure = np.abs(normalized[start] - normalized[end])
            for index in range(width):
                observations[index].append(
                    (float(positive[index]), float(negative[index]), float(closure[index]))
                )

    names = cache[id(training[0])][1]
    ranked: list[SelectedFeature] = []
    for index, items in enumerate(observations):
        values = np.asarray(items, dtype=np.float64)
        direction = 1 if np.median(values[:, 0] - values[:, 1]) >= 0 else -1
        excursion = values[:, 0] if direction == 1 else values[:, 1]
        opposite = values[:, 1] if direction == 1 else values[:, 0]
        consistency = float(np.mean(excursion > opposite))
        score = float(
            (np.quantile(excursion, 0.2) - 0.5 * np.quantile(values[:, 2], 0.8))
            * consistency
        )
        ranked.append(SelectedFeature(names[index], index, direction, score))
    return sorted(ranked, key=lambda item: (item.score, item.name), reverse=True)[:top_count]


def cycle_signal(
    sequence: Sequence,
    selected: list[SelectedFeature],
    cache: dict[int, tuple[np.ndarray, list[str]]],
) -> np.ndarray:
    normalized = normalize_sequence(cache[id(sequence)][0])
    channels = [item.direction * normalized[:, item.index] for item in selected]
    return np.mean(np.stack(channels, axis=1), axis=1)


def fit_cycle_parameters(
    training: list[Sequence],
    selected: list[SelectedFeature],
    cache: dict[int, tuple[np.ndarray, list[str]]],
    prominence_multiplier: float,
) -> CycleParameters:
    durations: list[float] = []
    prominences: list[float] = []
    for sequence in training:
        signal = cycle_signal(sequence, selected, cache)
        for segment in sequence.record.get("segments") or []:
            start = nearest_index(sequence.timestamps, float(segment["startMs"]))
            end = nearest_index(sequence.timestamps, float(segment["endMs"]))
            peak = start + int(np.argmax(signal[start : end + 1]))
            durations.append(float(sequence.timestamps[end] - sequence.timestamps[start]))
            prominences.append(float(signal[peak] - max(signal[start], signal[end])))
    return CycleParameters(
        minimum_duration_ms=max(250.0, float(np.quantile(durations, 0.05)) * 0.65),
        maximum_duration_ms=float(np.quantile(durations, 0.95)) * 1.35,
        search_half_window_ms=float(np.median(durations)) * 0.62,
        minimum_prominence=max(
            0.02,
            float(np.quantile(prominences, 0.10)) * prominence_multiplier,
        ),
    )


def detect_cycles(
    timestamps: np.ndarray,
    signal: np.ndarray,
    *,
    minimum_duration_ms: float,
    maximum_duration_ms: float,
    search_half_window_ms: float,
    minimum_prominence: float,
) -> list[CycleCandidate]:
    if len(signal) < 3 or float(np.max(signal) - np.min(signal)) <= 1e-8:
        return []
    local_peaks = np.flatnonzero(
        (signal[1:-1] >= signal[:-2]) & (signal[1:-1] > signal[2:])
    ) + 1
    candidates: list[CycleCandidate] = []
    for peak in local_peaks:
        lower_time = float(timestamps[peak]) - search_half_window_ms
        upper_time = float(timestamps[peak]) + search_half_window_ms
        lower = int(np.searchsorted(timestamps, lower_time, side="left"))
        upper = min(
            len(signal) - 1,
            int(np.searchsorted(timestamps, upper_time, side="right")),
        )
        start = lower + int(np.argmin(signal[lower : peak + 1]))
        end = peak + int(np.argmin(signal[peak : upper + 1]))
        duration = float(timestamps[end] - timestamps[start])
        prominence = float(signal[peak] - max(signal[start], signal[end]))
        if (
            minimum_duration_ms <= duration <= maximum_duration_ms
            and prominence >= minimum_prominence
        ):
            candidates.append(CycleCandidate(start, int(peak), end, prominence))

    selected: list[CycleCandidate] = []
    for item in sorted(candidates, key=lambda value: (-value.prominence, value.start_index)):
        overlaps = any(
            max(
                0,
                min(item.end_index, other.end_index)
                - max(item.start_index, other.start_index),
            )
            / max(
                1,
                min(
                    item.end_index - item.start_index,
                    other.end_index - other.start_index,
                ),
            )
            >= 0.45
            for other in selected
        )
        if not overlaps:
            selected.append(item)
    return sorted(selected, key=lambda value: value.start_index)


def _interval_iou(truth: dict[str, Any], predicted: dict[str, float]) -> float:
    intersection = max(
        0.0,
        min(float(truth["endMs"]), predicted["endMs"])
        - max(float(truth["startMs"]), predicted["startMs"]),
    )
    union = max(float(truth["endMs"]), predicted["endMs"]) - min(
        float(truth["startMs"]), predicted["startMs"]
    )
    return intersection / union if union > 0 else 0.0


def match_manual_ranges(
    truth: list[dict[str, Any]],
    predicted: list[dict[str, float]],
) -> tuple[int, int, list[dict[str, Any]]]:
    remaining = set(range(len(predicted)))
    matches: list[dict[str, Any]] = []
    aligned = 0
    for truth_index, segment in enumerate(truth):
        if not remaining:
            break
        truth_center = (float(segment["startMs"]) + float(segment["endMs"])) / 2
        candidate = max(
            remaining,
            key=lambda index: (
                _interval_iou(segment, predicted[index]),
                -abs(
                    (predicted[index]["startMs"] + predicted[index]["endMs"]) / 2
                    - truth_center
                ),
            ),
        )
        prediction = predicted[candidate]
        iou = _interval_iou(segment, prediction)
        center = (prediction["startMs"] + prediction["endMs"]) / 2
        if iou < 0.2 and abs(center - truth_center) > 1_500:
            continue
        remaining.remove(candidate)
        start_offset = prediction["startMs"] - float(segment["startMs"])
        truth_peak_source = str(segment.get("peakSource") or "legacy_unattributed")
        peak_offset = (
            prediction["peakMs"] - float(segment["peakMs"])
            if truth_peak_source == "human_adjusted"
            else None
        )
        end_offset = prediction["endMs"] - float(segment["endMs"])
        is_aligned = abs(start_offset) <= 500 and abs(end_offset) <= 500 and iou >= 0.6
        aligned += int(is_aligned)
        matches.append(
            {
                "truthIndex": truth_index,
                "predictedIndex": candidate,
                "startOffsetMs": start_offset,
                "peakOffsetMs": peak_offset,
                "truthPeakSource": truth_peak_source,
                "endOffsetMs": end_offset,
                "iou": iou,
                "aligned": is_aligned,
            }
        )
    return len(matches), aligned, matches


def _candidate_training_samples(
    training: list[Sequence],
    selected: list[SelectedFeature],
    parameters: CycleParameters,
    cache: dict[int, tuple[np.ndarray, list[str]]],
) -> list[tuple[CandidateEvidence, bool]]:
    durations = [
        float(segment["endMs"] - segment["startMs"])
        for sequence in training
        for segment in sequence.record.get("segments") or []
    ]
    median_duration_ms = float(np.median(durations))
    samples: list[tuple[CandidateEvidence, bool]] = []
    for sequence in training:
        normalized = normalize_sequence(cache[id(sequence)][0])
        channels = np.stack(
            [item.direction * normalized[:, item.index] for item in selected],
            axis=1,
        )
        signal = channels.mean(axis=1)
        candidates = detect_cycles(
            sequence.timestamps,
            signal,
            minimum_duration_ms=parameters.minimum_duration_ms,
            maximum_duration_ms=parameters.maximum_duration_ms,
            search_half_window_ms=parameters.search_half_window_ms,
            minimum_prominence=parameters.minimum_prominence,
        )
        predicted = [
            {
                "startMs": float(sequence.timestamps[item.start_index]),
                "peakMs": float(sequence.timestamps[item.peak_index]),
                "endMs": float(sequence.timestamps[item.end_index]),
            }
            for item in candidates
        ]
        _, _, matches = match_manual_ranges(sequence.record.get("segments") or [], predicted)
        positive_indices = {int(match["predictedIndex"]) for match in matches}
        negative_windows = sequence.record.get("reviewedNegativeWindows") or []
        for index, candidate in enumerate(candidates):
            evidence = compute_candidate_evidence(
                sequence.timestamps,
                signal,
                channels,
                candidates,
                index,
                median_duration_ms=median_duration_ms,
            )
            if index in positive_indices:
                samples.append((evidence, True))
                continue
            peak_ms = float(sequence.timestamps[candidate.peak_index])
            if any(
                float(window["startMs"]) <= peak_ms <= float(window["endMs"])
                for window in negative_windows
            ):
                samples.append((evidence, False))
    return samples


def fit_training_candidate_classifier(
    training: list[Sequence],
    selected: list[SelectedFeature],
    parameters: CycleParameters,
    cache: dict[int, tuple[np.ndarray, list[str]]],
) -> CandidateClassifier | None:
    return fit_candidate_classifier(
        _candidate_training_samples(training, selected, parameters, cache)
    )


def build_profile(
    training: list[Sequence],
    cache: dict[int, tuple[np.ndarray, list[str]]],
    prominence_multiplier: float,
) -> tuple[list[SelectedFeature], CycleParameters]:
    selected = select_features(training, cache)
    parameters = fit_cycle_parameters(training, selected, cache, prominence_multiplier)
    return selected, parameters


def evaluate_leave_one_source_out(
    sequences: list[Sequence],
    cache: dict[int, tuple[np.ndarray, list[str]]],
    prominence_multiplier: float,
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for sequence in sequences:
        source_id = sequence.record.get("sourceCaptureId") or sequence.record["captureId"]
        training = [
            item
            for item in sequences
            if item.record["exerciseId"] == sequence.record["exerciseId"]
            and (item.record.get("sourceCaptureId") or item.record["captureId"]) != source_id
        ]
        training_source_ids = sorted(
            {
                str(item.record.get("sourceCaptureId") or item.record["captureId"])
                for item in training
            }
        )
        selected: list[SelectedFeature] = []
        parameters: CycleParameters | None = None
        classifier: CandidateClassifier | None = None
        candidates: list[CycleCandidate] = []
        evidences: list[CandidateEvidence] = []
        if training:
            selected, parameters = build_profile(training, cache, prominence_multiplier)
            classifier = fit_training_candidate_classifier(
                training,
                selected,
                parameters,
                cache,
            )
            normalized = normalize_sequence(cache[id(sequence)][0])
            channels = np.stack(
                [item.direction * normalized[:, item.index] for item in selected],
                axis=1,
            )
            signal = channels.mean(axis=1)
            candidates = detect_cycles(
                sequence.timestamps,
                signal,
                minimum_duration_ms=parameters.minimum_duration_ms,
                maximum_duration_ms=parameters.maximum_duration_ms,
                search_half_window_ms=parameters.search_half_window_ms,
                minimum_prominence=parameters.minimum_prominence,
            )
            durations = [
                float(segment["endMs"] - segment["startMs"])
                for item in training
                for segment in item.record.get("segments") or []
            ]
            median_duration_ms = float(np.median(durations))
            evidences = [
                compute_candidate_evidence(
                    sequence.timestamps,
                    signal,
                    channels,
                    candidates,
                    index,
                    median_duration_ms=median_duration_ms,
                )
                for index in range(len(candidates))
            ]
        raw_predicted = [
            {
                "startMs": float(sequence.timestamps[item.start_index]),
                "peakMs": float(sequence.timestamps[item.peak_index]),
                "endMs": float(sequence.timestamps[item.end_index]),
                "score": item.prominence,
                "candidateQualityScore": (
                    _classifier_score(classifier, evidences[index])
                    if classifier is not None
                    else None
                ),
                "candidateEvidence": asdict(evidences[index]) if evidences else None,
                "supervision": "closed_cycle_range_candidate",
            }
            for index, item in enumerate(candidates)
        ]
        accepted_indices = [
            index
            for index, evidence in enumerate(evidences)
            if classifier is None or classify_candidate(classifier, evidence)
        ]
        predicted = [raw_predicted[index] for index in accepted_indices]
        needs_review = [
            raw_predicted[index]
            for index in range(len(raw_predicted))
            if index not in accepted_indices
        ]
        truth = sequence.record.get("segments") or []
        raw_matched, _, _ = match_manual_ranges(truth, raw_predicted)
        matched, aligned, matches = match_manual_ranges(truth, predicted)
        rows.append(
            {
                "captureId": sequence.record["captureId"],
                "sourceCaptureId": source_id,
                "heldOutSourceId": source_id,
                "trainingSourceIds": training_source_ids,
                "splitLeakageDetected": source_id in training_source_ids,
                "labelsRevealedAfterInference": True,
                "exerciseId": sequence.record["exerciseId"],
                "capturePosition": sequence.record["capturePosition"],
                "leaveOneSourceOutEligible": bool(training),
                "expectedCount": int(sequence.record["expectedCount"]),
                "truthCount": len(truth),
                "rawCandidateCount": len(raw_predicted),
                "rawMatchedCount": raw_matched,
                "predictedCount": len(predicted),
                "needsReviewCandidateCount": len(needs_review),
                "matchedCount": matched,
                "manualRangeAlignedCount": aligned,
                "exactSetCount": len(predicted) == int(sequence.record["expectedCount"]),
                "selectedFeatures": [asdict(item) for item in selected],
                "parameters": asdict(parameters) if parameters else None,
                "candidateClassifier": asdict(classifier) if classifier else None,
                "rawCandidateSegments": raw_predicted,
                "predictedSegments": predicted,
                "needsReviewSegments": needs_review,
                "segmentMatches": matches,
            }
        )

    by_source: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_source[row["sourceCaptureId"]].append(row)
    exact_sets = sum(
        sum(row["predictedCount"] for row in parts)
        == sum(row["expectedCount"] for row in parts)
        for parts in by_source.values()
    )
    exact_ranges = sum(
        sum(row["predictedCount"] for row in parts)
        == sum(row["expectedCount"] for row in parts)
        and sum(row["manualRangeAlignedCount"] for row in parts)
        == sum(row["truthCount"] for row in parts)
        for parts in by_source.values()
    )
    return {
        "mode": "leave_one_source_out",
        "summary": {
            "evaluationWindowCount": len(rows),
            "sourceCaptureCount": len(by_source),
            "eligibleEvaluationWindowCount": sum(
                row["leaveOneSourceOutEligible"] for row in rows
            ),
            "expectedCount": sum(row["expectedCount"] for row in rows),
            "truthRangeCount": sum(row["truthCount"] for row in rows),
            "eligibleTruthRangeCount": sum(
                row["truthCount"] for row in rows if row["leaveOneSourceOutEligible"]
            ),
            "rawCandidateCount": sum(row["rawCandidateCount"] for row in rows),
            "rawMatchedCount": sum(row["rawMatchedCount"] for row in rows),
            "eligibleRawCandidateCount": sum(
                row["rawCandidateCount"]
                for row in rows
                if row["leaveOneSourceOutEligible"]
            ),
            "eligibleRawMatchedCount": sum(
                row["rawMatchedCount"]
                for row in rows
                if row["leaveOneSourceOutEligible"]
            ),
            "predictedCount": sum(row["predictedCount"] for row in rows),
            "needsReviewCandidateCount": sum(
                row["needsReviewCandidateCount"] for row in rows
            ),
            "matchedCount": sum(row["matchedCount"] for row in rows),
            "eligibleMatchedCount": sum(
                row["matchedCount"] for row in rows if row["leaveOneSourceOutEligible"]
            ),
            "manualRangeAlignedCount": sum(row["manualRangeAlignedCount"] for row in rows),
            "exactSetSourceCaptureCount": exact_sets,
            "exactSetAndManualRangeSourceCaptureCount": exact_ranges,
        },
        "rows": rows,
    }


def main() -> None:
    args = parse_args()
    canonical = load_json(args.canonical_sequences)
    sequences = load_sequences(args.dataset, args.archive, canonical)
    cache = {id(sequence): feature_library(sequence) for sequence in sequences}
    by_exercise: dict[str, list[Sequence]] = defaultdict(list)
    for sequence in sequences:
        by_exercise[sequence.record["exerciseId"]].append(sequence)

    profiles: dict[str, Any] = {}
    for exercise_id, exercise_sequences in sorted(by_exercise.items()):
        selected, parameters = build_profile(
            exercise_sequences,
            cache,
            args.prominence_multiplier,
        )
        classifier = fit_training_candidate_classifier(
            exercise_sequences,
            selected,
            parameters,
            cache,
        )
        profiles[exercise_id] = {
            "sourceCaptureCount": len(
                {
                    sequence.record.get("sourceCaptureId") or sequence.record["captureId"]
                    for sequence in exercise_sequences
                }
            ),
            "selectedFeatures": [asdict(item) for item in selected],
            "parameters": asdict(parameters),
            "candidateClassifier": asdict(classifier) if classifier else None,
        }

    dataset_bytes = args.dataset.read_bytes()
    model = {
        "schemaVersion": "maxpower-personal-cycle-state-profile/v1",
        "researchOnly": True,
        "productionPromotion": False,
        "executionBackend": "python_offline_reference_only",
        "usesExpectedCountAtInference": False,
        "usesTruthRangesAtInference": False,
        "usesExerciseLabelAtInference": True,
        "usesLegacyPeakLabels": False,
        "peakEvaluationTruthPolicy": "human_adjusted_only",
        "usesReviewedNegativeWindowsForTrainingOnly": True,
        "normalization": "per_sequence_quantile_05_95_noncausal",
        "featureContract": "halpe26-coco17-prefix-mirror-invariant-geometry/v1",
        "dataset": str(args.dataset.resolve()),
        "datasetSha256": hashlib.sha256(dataset_bytes).hexdigest(),
        "canonicalInput": str(args.canonical_sequences.resolve()),
        "prominenceMultiplier": args.prominence_multiplier,
        "profiles": profiles,
    }
    leave_one_out = evaluate_leave_one_source_out(
        sequences,
        cache,
        args.prominence_multiplier,
    )
    report = {
        "schemaVersion": "maxpower-personal-cycle-state-diagnostic/v1",
        "researchOnly": True,
        "productionPromotion": False,
        "usesExpectedCountAtInference": False,
        "usesTruthRangesAtInference": False,
        "usesExerciseLabelAtInference": True,
        "usesLegacyPeakLabels": False,
        "peakEvaluationTruthPolicy": "human_adjusted_only",
        "usesReviewedNegativeWindowsForTrainingOnly": True,
        "executionBackend": "python_offline_reference_only",
        "evaluationProtocol": {
            "mode": "exhaustive_leave_one_source_out",
            "partitionUnit": "sourceCaptureId",
            "inferenceBeforeLabelReveal": True,
            "aggregateAllHeldOutSources": True,
            "randomSingleSourceIsAuditOnly": True,
        },
        "canonicalInputProvenance": {
            "schemaVersion": canonical.get("schemaVersion"),
            "inputPipeline": canonical.get("inputPipeline"),
            "inputPoseSchema": canonical.get("inputPoseSchema"),
            "stabilization": canonical.get("stabilization"),
            "rustWasmSha256": canonical.get("rustWasmSha256"),
        },
        "limitations": [
            "sequence-level quantile normalization is non-causal and must be replaced before streaming integration",
            "pull_up and push_up have one source each and cannot pass leave-one-source-out evaluation",
            "technique quality and compensation labels are not available",
        ],
        "leaveOneSourceOut": leave_one_out,
        "modelArtifact": str(args.model_output.resolve()),
    }
    args.model_output.parent.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.model_output.write_text(
        json.dumps(model, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(leave_one_out["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
