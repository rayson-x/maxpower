#!/usr/bin/env python3
"""PROTOTYPE: causal bar-axis detection fused with an existing pose sidecar.

Question answered by this throwaway experiment:

    Can a frame-by-frame, image-derived barbell axis provide a useful constraint
    when RTMPose wrist/elbow observations drift during front/oblique bench press?

The detector uses only the current frame, a causal background estimate, and
past bar state. Human rep labels are revealed only after inference to check that
the detected path reaches the expected bench-press extreme. The pose wrist Y is
never used to select the bar Y; wrist X is used only to prefer shaft candidates
that span both hands. No source capture, label, Rust profile, or production
runtime is modified.
"""

from __future__ import annotations

import argparse
import gzip
import html
import json
import math
import statistics
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import cv2
import numpy as np


SCHEMA_VERSION = "maxpower-barbell-pose-alignment-prototype/v1"
UPPER_BODY_LINKS = ((5, 6), (5, 7), (7, 9), (6, 8), (8, 10), (5, 11), (6, 12))
WRIST_INDICES = (9, 10)
ELBOW_INDICES = (7, 8)
SHOULDER_INDICES = (5, 6)
HIP_INDICES = (11, 12)


@dataclass(frozen=True)
class Segment:
    x1: float
    y1: float
    x2: float
    y2: float
    center_y: float
    slope: float
    length: float


@dataclass(frozen=True)
class AxisCandidate:
    x1: float
    y_center: float
    x2: float
    slope: float
    base_score: float
    coverage: float
    span: float
    motion: float
    edge_strength: float
    cohesion: float
    wrist_x_support: float

    def y_at(self, x: float, width: float) -> float:
        return self.y_center + self.slope * (x - width / 2.0)


@dataclass
class TrackedAxis:
    initialized: bool = False
    y_center: float = 0.0
    velocity_y: float = 0.0
    slope: float = 0.0
    x1: float = 0.0
    x2: float = 0.0
    confidence: float = 0.0
    missed: int = 0

    def update(
        self,
        candidates: Sequence[AxisCandidate],
        width: int,
        height: int,
    ) -> dict[str, Any] | None:
        if not candidates:
            return self._predict(width, height)

        predicted_y = self.y_center + self.velocity_y if self.initialized else None
        scored: list[tuple[float, AxisCandidate]] = []
        for candidate in candidates:
            if predicted_y is None:
                continuity = 0.5
                combined = candidate.base_score
            else:
                distance = abs(candidate.y_center - predicted_y) / height
                continuity = math.exp(-0.5 * (distance / 0.075) ** 2)
                combined = 0.64 * candidate.base_score + 0.36 * continuity
            scored.append((combined, candidate))
        scored.sort(key=lambda item: item[0], reverse=True)
        combined, selected = scored[0]
        second = scored[1][0] if len(scored) > 1 else 0.0
        margin = max(0.0, min(1.0, (combined - second + 0.06) / 0.22))
        measurement_confidence = max(
            0.0,
            min(1.0, 0.72 * selected.base_score + 0.28 * margin),
        )

        if combined < 0.27:
            return self._predict(width, height)
        if predicted_y is not None:
            distance = abs(selected.y_center - predicted_y) / height
            if distance > 0.16 and selected.base_score < 0.68:
                return self._predict(width, height)

        previous_y = self.y_center if self.initialized else selected.y_center
        predicted_y = predicted_y if predicted_y is not None else selected.y_center
        residual = selected.y_center - predicted_y
        self.y_center = predicted_y + 0.74 * residual
        observed_delta = selected.y_center - previous_y
        self.velocity_y = 0.68 * self.velocity_y + 0.32 * observed_delta
        if self.initialized:
            self.slope = 0.7 * self.slope + 0.3 * selected.slope
            self.x1 = 0.7 * self.x1 + 0.3 * selected.x1
            self.x2 = 0.7 * self.x2 + 0.3 * selected.x2
        else:
            self.slope = selected.slope
            self.x1 = selected.x1
            self.x2 = selected.x2
        self.initialized = True
        self.confidence = measurement_confidence
        self.missed = 0
        return self._record("measured", selected, width, height)

    def _predict(self, width: int, height: int) -> dict[str, Any] | None:
        if not self.initialized or self.missed >= 4:
            self.confidence = 0.0
            return None
        self.y_center += self.velocity_y
        self.velocity_y *= 0.85
        self.confidence *= 0.72
        self.missed += 1
        if self.confidence < 0.16:
            return None
        return self._record("predicted", None, width, height)

    def _record(
        self,
        source: str,
        selected: AxisCandidate | None,
        width: int,
        height: int,
    ) -> dict[str, Any]:
        x1 = max(0.0, min(float(width - 1), self.x1))
        x2 = max(x1 + 1.0, min(float(width - 1), self.x2))
        y1 = self.y_center + self.slope * (x1 - width / 2.0)
        y2 = self.y_center + self.slope * (x2 - width / 2.0)
        output: dict[str, Any] = {
            "source": source,
            "confidence": round(float(self.confidence), 6),
            "x1": round(x1 / width, 7),
            "y1": round(y1 / height, 7),
            "x2": round(x2 / width, 7),
            "y2": round(y2 / height, 7),
            "centerY": round(self.y_center / height, 7),
            "slope": round(float(self.slope), 7),
        }
        if selected is not None:
            output["measurement"] = {
                "baseScore": round(selected.base_score, 6),
                "coverage": round(selected.coverage, 6),
                "span": round(selected.span, 6),
                "motion": round(selected.motion, 6),
                "edgeStrength": round(selected.edge_strength, 6),
                "cohesion": round(selected.cohesion, 6),
                "wristXSupport": round(selected.wrist_x_support, 6),
            }
        return output


def _read_json(path: Path) -> dict[str, Any]:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as source:
            return json.load(source)
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json_gz(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as destination:
        json.dump(value, destination, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _point(landmarks: Sequence[dict[str, Any]], index: int) -> tuple[float, float, float] | None:
    if index >= len(landmarks):
        return None
    item = landmarks[index]
    x = float(item.get("x", math.nan))
    y = float(item.get("y", math.nan))
    score = float(item.get("visibility", 0.0))
    if not math.isfinite(x) or not math.isfinite(y):
        return None
    return x, y, score


def _pose_search_context(
    landmarks: Sequence[dict[str, Any]],
    height: int,
) -> tuple[tuple[int, int], list[float]]:
    shoulders = [
        point
        for index in SHOULDER_INDICES
        if (point := _point(landmarks, index)) is not None and point[2] >= 0.2
    ]
    shoulder_y = statistics.median(point[1] for point in shoulders) if shoulders else 0.48
    y_min = max(0, round((shoulder_y - 0.38) * height))
    y_max = min(height - 1, round((shoulder_y + 0.20) * height))
    wrists = [
        point[0]
        for index in WRIST_INDICES
        if (point := _point(landmarks, index)) is not None and point[2] >= 0.12
    ]
    return (y_min, y_max), wrists


def _merged_length(intervals: Sequence[tuple[float, float]]) -> float:
    if not intervals:
        return 0.0
    ordered = sorted(intervals)
    total = 0.0
    start, end = ordered[0]
    for next_start, next_end in ordered[1:]:
        if next_start <= end + 3.0:
            end = max(end, next_end)
        else:
            total += end - start
            start, end = next_start, next_end
    return total + end - start


def _wrist_x_support(intervals: Sequence[tuple[float, float]], wrist_xs: Sequence[float], width: int) -> float:
    if not wrist_xs:
        return 0.5
    supported = 0
    tolerance = width * 0.055
    for normalized_x in wrist_xs:
        x = normalized_x * width
        if any(left - tolerance <= x <= right + tolerance for left, right in intervals):
            supported += 1
    return supported / len(wrist_xs)


def detect_axis_candidates(
    gray: np.ndarray,
    background: np.ndarray,
    landmarks: Sequence[dict[str, Any]],
    lsd: Any,
) -> list[AxisCandidate]:
    height, width = gray.shape
    (y_min, y_max), wrist_xs = _pose_search_context(landmarks, height)
    detected = lsd.detect(gray)[0]
    if detected is None:
        return []
    segments: list[Segment] = []
    for values in np.asarray(detected).reshape(-1, 4):
        x1, y1, x2, y2 = (float(value) for value in values)
        dx = x2 - x1
        dy = y2 - y1
        if abs(dx) < 1e-6:
            continue
        length = math.hypot(dx, dy)
        slope = dy / dx
        center_x = (x1 + x2) / 2.0
        center_y = (y1 + y2) / 2.0 + slope * (width / 2.0 - center_x)
        if length < width * 0.026 or abs(slope) > 0.18 or not (y_min <= center_y <= y_max):
            continue
        if x2 < x1:
            x1, x2 = x2, x1
            y1, y2 = y2, y1
        segments.append(Segment(x1, y1, x2, y2, center_y, slope, length))
    if not segments:
        return []

    groups: list[list[Segment]] = []
    for segment in sorted(segments, key=lambda item: item.center_y):
        chosen: list[Segment] | None = None
        for group in reversed(groups[-3:]):
            group_y = sum(item.center_y * item.length for item in group) / sum(item.length for item in group)
            if abs(segment.center_y - group_y) <= 7.0:
                chosen = group
                break
        if chosen is None:
            groups.append([segment])
        else:
            chosen.append(segment)

    motion_map = np.abs(gray.astype(np.float32) - background)
    vertical_edge = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3))
    candidates: list[AxisCandidate] = []
    for group in groups:
        intervals = [(item.x1, item.x2) for item in group]
        x1 = min(left for left, _ in intervals)
        x2 = max(right for _, right in intervals)
        span = (x2 - x1) / width
        coverage = _merged_length(intervals) / width
        if span < 0.20 or coverage < 0.075:
            continue
        total_length = sum(item.length for item in group)
        y_center = sum(item.center_y * item.length for item in group) / total_length
        slope = sum(item.slope * item.length for item in group) / total_length
        row = round(y_center)
        top = max(0, row - 4)
        bottom = min(height, row + 5)
        left = max(0, round(x1))
        right = min(width, round(x2) + 1)
        if right <= left or bottom <= top:
            continue
        motion = min(1.0, float(np.mean(motion_map[top:bottom, left:right])) / 30.0)
        edge_strength = min(1.0, float(np.mean(vertical_edge[top:bottom, left:right])) / 145.0)
        cohesion = min(1.0, coverage / max(span, 1e-6))
        wrist_support = _wrist_x_support(intervals, wrist_xs, width)
        coverage_score = min(1.0, coverage / 0.56)
        span_score = min(1.0, span / 0.78)
        base_score = (
            0.29 * coverage_score
            + 0.17 * span_score
            + 0.17 * motion
            + 0.14 * edge_strength
            + 0.11 * cohesion
            + 0.12 * wrist_support
        )
        candidates.append(
            AxisCandidate(
                x1=x1,
                y_center=y_center,
                x2=x2,
                slope=slope,
                base_score=base_score,
                coverage=coverage,
                span=span,
                motion=motion,
                edge_strength=edge_strength,
                cohesion=cohesion,
                wrist_x_support=wrist_support,
            )
        )
    return sorted(candidates, key=lambda item: item.base_score, reverse=True)


def _axis_y(axis: dict[str, Any], x: float) -> float:
    x1 = float(axis["x1"])
    x2 = float(axis["x2"])
    if abs(x2 - x1) < 1e-9:
        return float(axis["centerY"])
    ratio = (x - x1) / (x2 - x1)
    return float(axis["y1"]) + ratio * (float(axis["y2"]) - float(axis["y1"]))


def _torso_scale(landmarks: Sequence[dict[str, Any]]) -> float:
    shoulders = [_point(landmarks, index) for index in SHOULDER_INDICES]
    hips = [_point(landmarks, index) for index in HIP_INDICES]
    observed_shoulders = [point for point in shoulders if point is not None]
    observed_hips = [point for point in hips if point is not None]
    shoulder_width = 0.0
    if len(observed_shoulders) == 2:
        shoulder_width = math.dist(observed_shoulders[0][:2], observed_shoulders[1][:2])
    trunk = 0.0
    if observed_shoulders and observed_hips:
        shoulder_mid = (
            statistics.mean(point[0] for point in observed_shoulders),
            statistics.mean(point[1] for point in observed_shoulders),
        )
        hip_mid = (
            statistics.mean(point[0] for point in observed_hips),
            statistics.mean(point[1] for point in observed_hips),
        )
        trunk = math.dist(shoulder_mid, hip_mid)
    return max(0.10, shoulder_width, trunk)


def fuse_pose_with_axis(
    landmarks: Sequence[dict[str, Any]],
    axis: dict[str, Any] | None,
) -> dict[str, Any]:
    scale = _torso_scale(landmarks)
    wrists: list[dict[str, Any]] = []
    reliable_axis = axis is not None and float(axis["confidence"]) >= 0.32
    for index in WRIST_INDICES:
        point = _point(landmarks, index)
        if point is None:
            wrists.append({"index": index, "observed": False})
            continue
        x, y, score = point
        if axis is None:
            wrists.append(
                {
                    "index": index,
                    "observed": True,
                    "score": round(score, 6),
                    "x": round(x, 7),
                    "rawY": round(y, 7),
                    "fusedY": round(y, 7),
                    "axisSupported": False,
                }
            )
            continue
        bar_y = _axis_y(axis, x)
        error = abs(y - bar_y) / scale
        axis_supported = float(axis["x1"]) - 0.06 <= x <= float(axis["x2"]) + 0.06
        # Keep a good raw wrist untouched. The bar is a rescue constraint, not
        # a replacement pose head: require both weaker pose evidence and a
        # visible disagreement, or a large disagreement regardless of score.
        constrain = reliable_axis and axis_supported and (
            (score < 0.50 and error > 0.16) or error > 0.32
        )
        blend = min(0.86, 0.50 + max(0.0, 0.55 - score)) if constrain else 0.0
        fused_y = (1.0 - blend) * y + blend * bar_y
        wrists.append(
            {
                "index": index,
                "observed": True,
                "score": round(score, 6),
                "x": round(x, 7),
                "rawY": round(y, 7),
                "barY": round(bar_y, 7),
                "fusedY": round(fused_y, 7),
                "normalizedAxisError": round(error, 6),
                "axisSupported": axis_supported,
                "constrained": constrain,
            }
        )
    observed = [item for item in wrists if item.get("observed")]
    errors = [float(item["normalizedAxisError"]) for item in observed if "normalizedAxisError" in item]
    constrained = sum(bool(item.get("constrained")) for item in observed)
    low_score = any(float(item.get("score", 0.0)) < 0.5 for item in observed)
    if not reliable_axis:
        status = "bar_unavailable"
    elif not observed:
        status = "pose_wrist_unavailable"
    elif errors and max(errors) <= 0.30:
        status = "aligned"
    elif constrained and low_score:
        status = "bar_can_constrain_low_score_wrist"
    elif errors and max(errors) > 0.48:
        status = "pose_bar_conflict"
    else:
        status = "reviewable_disagreement"
    return {
        "torsoScale": round(scale, 7),
        "status": status,
        "wrists": wrists,
        "constrainedWristCount": constrained,
    }


def _segment_at(segments: Sequence[dict[str, Any]], timestamp_ms: float) -> int | None:
    for segment in segments:
        if float(segment["startMs"]) <= timestamp_ms <= float(segment["endMs"]):
            return int(segment["repIndex"])
    return None


def _percentile(values: Iterable[float], percentile: float) -> float | None:
    materialized = np.asarray([float(value) for value in values], dtype=np.float64)
    if not len(materialized):
        return None
    return round(float(np.quantile(materialized, percentile)), 6)


def _correlation(left: Sequence[float], right: Sequence[float]) -> float | None:
    if len(left) < 4 or len(right) != len(left):
        return None
    left_values = np.asarray(left, dtype=np.float64)
    right_values = np.asarray(right, dtype=np.float64)
    if float(np.std(left_values)) < 1e-7 or float(np.std(right_values)) < 1e-7:
        return None
    return round(float(np.corrcoef(left_values, right_values)[0, 1]), 6)


def _coefficient_of_variation(values: Sequence[float]) -> float | None:
    if len(values) < 3:
        return None
    mean = statistics.mean(values)
    return round(statistics.pstdev(values) / mean, 6) if mean > 1e-8 else None


def summarize_frames(
    frames: Sequence[dict[str, Any]],
    segments: Sequence[dict[str, Any]],
) -> dict[str, Any]:
    rep_frames = [frame for frame in frames if frame["repIndex"] is not None]
    axis_frames = [frame for frame in rep_frames if frame["axis"] is not None]
    measured = [frame for frame in axis_frames if frame["axis"]["source"] == "measured"]
    confident = [frame for frame in axis_frames if float(frame["axis"]["confidence"]) >= 0.32]
    statuses: dict[str, int] = {}
    for frame in rep_frames:
        status = str(frame["fusion"]["status"])
        statuses[status] = statuses.get(status, 0) + 1

    bar_jumps: list[float] = []
    raw_wrist_jumps: list[float] = []
    fused_wrist_jumps: list[float] = []
    bar_motion: list[float] = []
    pose_motion: list[float] = []
    direction_aligned = 0
    direction_pairs = 0
    raw_forearms: dict[int, list[float]] = {9: [], 10: []}
    fused_forearms: dict[int, list[float]] = {9: [], 10: []}

    previous_by_rep: dict[int, dict[str, Any]] = {}
    for frame in rep_frames:
        rep_index = int(frame["repIndex"])
        previous = previous_by_rep.get(rep_index)
        if previous is not None and frame["timestampMs"] - previous["timestampMs"] <= 160:
            if frame["axis"] is not None and previous["axis"] is not None:
                delta_bar = float(frame["axis"]["centerY"]) - float(previous["axis"]["centerY"])
                bar_jumps.append(abs(delta_bar))
                current_wrist_y = [
                    float(item["rawY"])
                    for item in frame["fusion"]["wrists"]
                    if item.get("observed")
                ]
                previous_wrist_y = [
                    float(item["rawY"])
                    for item in previous["fusion"]["wrists"]
                    if item.get("observed")
                ]
                if current_wrist_y and previous_wrist_y:
                    delta_pose = statistics.median(current_wrist_y) - statistics.median(previous_wrist_y)
                    bar_motion.append(delta_bar)
                    pose_motion.append(delta_pose)
                    if abs(delta_bar) >= 0.002 or abs(delta_pose) >= 0.002:
                        direction_pairs += 1
                        direction_aligned += int(delta_bar * delta_pose >= 0)
            previous_wrists = {
                int(item["index"]): item
                for item in previous["fusion"]["wrists"]
                if item.get("observed")
            }
            for item in frame["fusion"]["wrists"]:
                index = int(item["index"])
                if not item.get("observed") or index not in previous_wrists:
                    continue
                scale = max(
                    0.10,
                    (float(frame["fusion"]["torsoScale"]) + float(previous["fusion"]["torsoScale"])) / 2.0,
                )
                raw_wrist_jumps.append(abs(float(item["rawY"]) - float(previous_wrists[index]["rawY"])) / scale)
                fused_wrist_jumps.append(abs(float(item["fusedY"]) - float(previous_wrists[index]["fusedY"])) / scale)
        previous_by_rep[rep_index] = frame

        landmarks = frame["landmarks"]
        wrist_records = {int(item["index"]): item for item in frame["fusion"]["wrists"] if item.get("observed")}
        for elbow_index, wrist_index in zip(ELBOW_INDICES, WRIST_INDICES):
            elbow = _point(landmarks, elbow_index)
            wrist = wrist_records.get(wrist_index)
            if elbow is None or wrist is None:
                continue
            scale = float(frame["fusion"]["torsoScale"])
            raw_length = math.dist((elbow[0], elbow[1]), (float(wrist["x"]), float(wrist["rawY"]))) / scale
            fused_length = math.dist((elbow[0], elbow[1]), (float(wrist["x"]), float(wrist["fusedY"]))) / scale
            raw_forearms[wrist_index].append(raw_length)
            fused_forearms[wrist_index].append(fused_length)

    checkpoint_rows: list[dict[str, Any]] = []
    for segment in segments:
        samples: dict[str, dict[str, Any] | None] = {}
        for field in ("startMs", "peakMs", "endMs"):
            target = float(segment[field])
            samples[field] = min(
                (frame for frame in frames if frame["axis"] is not None),
                key=lambda frame: abs(float(frame["timestampMs"]) - target),
                default=None,
            )
        if any(sample is None for sample in samples.values()):
            checkpoint_rows.append({"repIndex": segment["repIndex"], "available": False})
            continue
        positions = {field: float(sample["axis"]["centerY"]) for field, sample in samples.items() if sample is not None}
        amplitude = positions["peakMs"] - (positions["startMs"] + positions["endMs"]) / 2.0
        aligned = amplitude > 0.008
        checkpoint_rows.append(
            {
                "repIndex": segment["repIndex"],
                "available": True,
                "positions": {key: round(value, 7) for key, value in positions.items()},
                "amplitude": round(amplitude, 7),
                "directionAligned": aligned,
            }
        )

    raw_cv_values = [value for values in raw_forearms.values() if (value := _coefficient_of_variation(values)) is not None]
    fused_cv_values = [value for values in fused_forearms.values() if (value := _coefficient_of_variation(values)) is not None]
    available_checkpoints = [row for row in checkpoint_rows if row.get("available")]
    constrained_frames = sum(frame["fusion"]["constrainedWristCount"] > 0 for frame in rep_frames)
    conflict_frames = statuses.get("pose_bar_conflict", 0) + statuses.get("bar_can_constrain_low_score_wrist", 0)
    return {
        "repFrameCount": len(rep_frames),
        "barAxisFrameCoverage": round(len(axis_frames) / len(rep_frames), 6) if rep_frames else 0.0,
        "barAxisMeasuredFrameCoverage": round(len(measured) / len(rep_frames), 6) if rep_frames else 0.0,
        "barAxisConfidentFrameCoverage": round(len(confident) / len(rep_frames), 6) if rep_frames else 0.0,
        "barAxisJumpP95FrameHeight": _percentile(bar_jumps, 0.95),
        "barAxisCatastrophicJumpRate": round(sum(value > 0.08 for value in bar_jumps) / len(bar_jumps), 6) if bar_jumps else None,
        "phaseDirectionAlignedCount": sum(bool(row.get("directionAligned")) for row in available_checkpoints),
        "phaseCheckpointCount": len(available_checkpoints),
        "phaseCheckpointRows": checkpoint_rows,
        "poseBarMotionCorrelation": _correlation(bar_motion, pose_motion),
        "poseBarMotionDirectionAgreement": round(direction_aligned / direction_pairs, 6) if direction_pairs else None,
        "rawWristJumpP95Torso": _percentile(raw_wrist_jumps, 0.95),
        "barConstrainedWristJumpP95Torso": _percentile(fused_wrist_jumps, 0.95),
        "rawForearmLengthCvMean": round(statistics.mean(raw_cv_values), 6) if raw_cv_values else None,
        "barConstrainedForearmLengthCvMean": round(statistics.mean(fused_cv_values), 6) if fused_cv_values else None,
        "barConstraintCandidateFrameCount": constrained_frames,
        "poseBarConflictFrameCount": conflict_frames,
        "fusionStatusCounts": statuses,
    }


def _draw_overlay(
    image: np.ndarray,
    pose_frame: dict[str, Any],
    axis: dict[str, Any] | None,
    fusion: dict[str, Any],
    rep_index: int | None,
) -> np.ndarray:
    height, width = image.shape[:2]
    landmarks = pose_frame.get("landmarks", [])
    for left, right in UPPER_BODY_LINKS:
        a = _point(landmarks, left)
        b = _point(landmarks, right)
        if a is None or b is None:
            continue
        color = (80, 235, 190) if min(a[2], b[2]) >= 0.5 else (0, 155, 255)
        cv2.line(image, (round(a[0] * width), round(a[1] * height)), (round(b[0] * width), round(b[1] * height)), color, 2, cv2.LINE_AA)
    for index in (*SHOULDER_INDICES, *ELBOW_INDICES, *WRIST_INDICES):
        point = _point(landmarks, index)
        if point is None:
            continue
        color = (80, 235, 190) if point[2] >= 0.5 else (0, 155, 255)
        cv2.circle(image, (round(point[0] * width), round(point[1] * height)), 4, color, -1, cv2.LINE_AA)

    if axis is not None:
        color = (255, 220, 40) if axis["source"] == "measured" else (255, 120, 30)
        cv2.line(
            image,
            (round(float(axis["x1"]) * width), round(float(axis["y1"]) * height)),
            (round(float(axis["x2"]) * width), round(float(axis["y2"]) * height)),
            color,
            3,
            cv2.LINE_AA,
        )
    for item in fusion["wrists"]:
        if not item.get("observed") or "barY" not in item:
            continue
        x = round(float(item["x"]) * width)
        raw_y = round(float(item["rawY"]) * height)
        bar_y = round(float(item["barY"]) * height)
        fused_y = round(float(item["fusedY"]) * height)
        error_color = (60, 60, 255) if float(item["normalizedAxisError"]) > 0.48 else (80, 180, 255)
        cv2.line(image, (x, raw_y), (x, bar_y), error_color, 1, cv2.LINE_AA)
        if item.get("constrained"):
            cv2.circle(image, (x, fused_y), 5, (255, 255, 0), 2, cv2.LINE_AA)

    cv2.rectangle(image, (0, 0), (width, 55), (6, 10, 13), -1)
    rep_text = f"REP {rep_index}" if rep_index is not None else "OUTSIDE LABELLED REP"
    bar_text = "BAR unavailable" if axis is None else f"BAR {axis['source']} {float(axis['confidence']):.2f}"
    cv2.putText(image, rep_text, (10, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (210, 255, 90), 1, cv2.LINE_AA)
    cv2.putText(image, bar_text, (10, 39), cv2.FONT_HERSHEY_SIMPLEX, 0.46, (255, 220, 40), 1, cv2.LINE_AA)
    cv2.putText(image, str(fusion["status"]), (145, 39), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (245, 245, 245), 1, cv2.LINE_AA)
    return image


def process_capture(
    project_root: Path,
    record: dict[str, Any],
    pose_sidecar_path: Path,
    output_root: Path,
    render_width: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    capture_id = str(record["sourceCaptureId"])
    pose = _read_json(pose_sidecar_path)
    video_path = project_root / "public/archives/confirmed-captures" / record["source"]["video"]
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Unable to open {video_path}")
    source_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    source_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    render_height = round(source_height * render_width / source_width)
    sample_fps = float(pose["inference"]["sampleFps"])
    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    tracker = TrackedAxis()
    background: np.ndarray | None = None
    frame_index = -1
    target_index = 0
    pose_frames = pose["frames"]
    output_frames: list[dict[str, Any]] = []

    overlay_dir = output_root / "overlays"
    overlay_dir.mkdir(parents=True, exist_ok=True)
    temporary_video = overlay_dir / f"{capture_id}.prototype.avi"
    final_video = overlay_dir / f"{capture_id}.barbell-pose-alignment.mp4"
    writer = cv2.VideoWriter(
        str(temporary_video),
        cv2.VideoWriter_fourcc(*"MJPG"),
        sample_fps,
        (render_width, render_height),
    )
    if not writer.isOpened():
        raise RuntimeError(f"Unable to create {temporary_video}")

    try:
        while target_index < len(pose_frames):
            ok, source_frame = capture.read()
            if not ok:
                break
            frame_index += 1
            target_frame = pose_frames[target_index]
            target_number = int(target_frame["frameNumber"])
            if frame_index < target_number:
                continue
            if frame_index > target_number:
                target_index += 1
                continue
            resized = cv2.resize(source_frame, (render_width, render_height), interpolation=cv2.INTER_AREA)
            gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
            gray = cv2.GaussianBlur(gray, (3, 3), 0)
            if background is None:
                background = gray.astype(np.float32)
            landmarks = target_frame.get("landmarks", [])
            candidates = detect_axis_candidates(gray, background, landmarks, lsd)
            axis = tracker.update(candidates, render_width, render_height)
            background = 0.99 * background + 0.01 * gray.astype(np.float32)
            fusion = fuse_pose_with_axis(landmarks, axis)
            timestamp_ms = float(target_frame["timestampMs"])
            rep_index = _segment_at(record["segments"], timestamp_ms)
            output_frames.append(
                {
                    "frameNumber": target_number,
                    "timestampMs": timestamp_ms,
                    "repIndex": rep_index,
                    "axis": axis,
                    "fusion": fusion,
                    "landmarks": landmarks,
                    "candidateCount": len(candidates),
                }
            )
            writer.write(_draw_overlay(resized, target_frame, axis, fusion, rep_index))
            target_index += 1
    finally:
        writer.release()
        capture.release()

    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(temporary_video),
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "22",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(final_video),
        ],
        check=True,
    )
    temporary_video.unlink(missing_ok=True)
    summary = summarize_frames(output_frames, record["segments"])
    sidecar = {
        "schemaVersion": SCHEMA_VERSION,
        "prototype": True,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "captureId": capture_id,
        "sourceVideo": str(video_path.relative_to(project_root)),
        "sourcePoseSidecar": str(pose_sidecar_path.relative_to(project_root)),
        "inferenceContract": {
            "causal": True,
            "readsFutureFrames": False,
            "readsRepLabelsDuringInference": False,
            "barYUsesPoseWristY": False,
            "barCandidateUsesPoseWristXOnly": True,
            "detector": "LSD horizontal shaft groups + causal background + alpha-beta path",
            "sampleFps": sample_fps,
            "posePipeline": pose["inference"]["pipeline"],
        },
        "summary": summary,
        "frames": output_frames,
    }
    sidecar_path = output_root / "observations" / f"{capture_id}.barbell-pose-alignment.json.gz"
    _write_json_gz(sidecar_path, sidecar)
    return summary, {
        "captureId": capture_id,
        "video": str(final_video),
        "sidecar": str(sidecar_path),
        **summary,
    }


def _weighted_mean(rows: Sequence[dict[str, Any]], field: str, weight: str) -> float | None:
    usable = [row for row in rows if row.get(field) is not None and float(row.get(weight, 0)) > 0]
    total_weight = sum(float(row[weight]) for row in usable)
    if not usable or total_weight <= 0:
        return None
    return round(sum(float(row[field]) * float(row[weight]) for row in usable) / total_weight, 6)


def aggregate_report(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    rep_frames = sum(int(row["repFrameCount"]) for row in rows)
    checkpoints = sum(int(row["phaseCheckpointCount"]) for row in rows)
    aligned_checkpoints = sum(int(row["phaseDirectionAlignedCount"]) for row in rows)
    constrained_frames = sum(int(row["barConstraintCandidateFrameCount"]) for row in rows)
    conflict_frames = sum(int(row["poseBarConflictFrameCount"]) for row in rows)
    coverage = _weighted_mean(rows, "barAxisFrameCoverage", "repFrameCount") or 0.0
    measured_coverage = _weighted_mean(rows, "barAxisMeasuredFrameCoverage", "repFrameCount") or 0.0
    confident_coverage = _weighted_mean(rows, "barAxisConfidentFrameCoverage", "repFrameCount") or 0.0
    direction_rate = aligned_checkpoints / checkpoints if checkpoints else 0.0
    raw_jump = _weighted_mean(rows, "rawWristJumpP95Torso", "repFrameCount")
    fused_jump = _weighted_mean(rows, "barConstrainedWristJumpP95Torso", "repFrameCount")
    raw_cv = _weighted_mean(rows, "rawForearmLengthCvMean", "repFrameCount")
    fused_cv = _weighted_mean(rows, "barConstrainedForearmLengthCvMean", "repFrameCount")
    observable = coverage >= 0.90 and direction_rate >= 0.85
    improves_jump = raw_jump is not None and fused_jump is not None and fused_jump < raw_jump
    useful = observable and constrained_frames > 0 and improves_jump
    return {
        "videoCount": len(rows),
        "repFrameCount": rep_frames,
        "barAxisFrameCoverage": round(coverage, 6),
        "barAxisMeasuredFrameCoverage": round(measured_coverage, 6),
        "barAxisConfidentFrameCoverage": round(confident_coverage, 6),
        "phaseDirectionAlignedCount": aligned_checkpoints,
        "phaseCheckpointCount": checkpoints,
        "phaseDirectionAlignedRate": round(direction_rate, 6),
        "barConstraintCandidateFrameCount": constrained_frames,
        "poseBarConflictFrameCount": conflict_frames,
        "rawWristJumpP95TorsoVideoWeighted": raw_jump,
        "barConstrainedWristJumpP95TorsoVideoWeighted": fused_jump,
        "rawForearmLengthCvVideoWeighted": raw_cv,
        "barConstrainedForearmLengthCvVideoWeighted": fused_cv,
        "decision": {
            "barTrajectoryObservableWithoutNewFineLabels": observable,
            "barConstraintShowsPoseAlignmentBenefit": useful,
            "humanKeypointAccuracyProven": False,
            "equipmentEndpointAccuracyProven": False,
            "productionPromotionAllowed": False,
        },
    }


def write_markdown(path: Path, report: dict[str, Any], project_root: Path) -> None:
    summary = report["summary"]
    rows = report["videos"]
    lines = [
        "# Personal bench barbell + pose alignment prototype",
        "",
        f"Generated: `{report['generatedAt']}`",
        "",
        "## Question",
        "",
        "Can a causal, automatically detected barbell shaft trajectory constrain drifting RTMPose wrists without asking the user for frame-by-frame shaft labels?",
        "",
        "## Aggregate result",
        "",
        f"- Rep-window bar trajectory coverage: **{summary['barAxisFrameCoverage']:.1%}**",
        f"- Confident bar trajectory coverage: **{summary['barAxisConfidentFrameCoverage']:.1%}**",
        f"- Label checkpoints with expected bench direction: **{summary['phaseDirectionAlignedCount']}/{summary['phaseCheckpointCount']} ({summary['phaseDirectionAlignedRate']:.1%})**",
        f"- Frames where the bar can constrain at least one wrist: **{summary['barConstraintCandidateFrameCount']}**",
        f"- Raw wrist jump P95 / torso: `{summary['rawWristJumpP95TorsoVideoWeighted']}`",
        f"- Bar-constrained wrist jump P95 / torso: `{summary['barConstrainedWristJumpP95TorsoVideoWeighted']}`",
        "",
        "This proves only trajectory observability and internal consistency. There is still no human shaft/keypoint truth, so it does not prove pixel accuracy.",
        "",
        "## Per video",
        "",
        "| Capture | bar coverage | confident | phase direction | motion corr | constrained frames | conflicts | overlay |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for row in rows:
        video_path = Path(row["video"])
        relative_video = video_path.relative_to(project_root)
        correlation = row["poseBarMotionCorrelation"]
        lines.append(
            f"| `{row['captureId'][:8]}…` | {row['barAxisFrameCoverage']:.1%} | {row['barAxisConfidentFrameCoverage']:.1%} | "
            f"{row['phaseDirectionAlignedCount']}/{row['phaseCheckpointCount']} | {correlation if correlation is not None else '—'} | "
            f"{row['barConstraintCandidateFrameCount']} | {row['poseBarConflictFrameCount']} | [`mp4`](../../{relative_video}) |"
        )
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "- The detector is a throwaway classical-vision prototype, not a trained YOLOX equipment class.",
            "- It is causal: no future frames and no rep labels are read during detection.",
            "- Wrist Y is excluded from bar-Y selection. Wrist X is used only to prefer shaft segments spanning both hands.",
            "- Fused wrists are diagnostic projections in generated sidecars/overlays only; raw RTMPose and Rust production profiles remain unchanged.",
            "- Mirror/reflection identity and exact shaft endpoints remain unverified without a small independent spot-check set.",
            "",
        ]
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def write_viewer(path: Path, report: dict[str, Any]) -> None:
    viewer_rows = [
        {
            **{key: value for key, value in row.items() if key not in {"phaseCheckpointRows"}},
            "video": f"overlays/{Path(row['video']).name}",
        }
        for row in report["videos"]
    ]
    state = json.dumps({"summary": report["summary"], "videos": viewer_rows}, ensure_ascii=False).replace("</", "<\\/")
    document = f"""<!doctype html>
<html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
<title>PROTOTYPE · 杠铃 + 骨架对齐检查</title><style>
body{{margin:0;background:#0a0e10;color:#e7efec;font:15px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}}main{{max-width:1180px;margin:auto;padding:28px}}h1{{font-size:24px;color:#c8ff42}}.notice{{border:1px solid #5f6b66;padding:14px;background:#111719}}.grid{{display:grid;grid-template-columns:minmax(300px,420px) 1fr;gap:18px;margin-top:18px}}video{{width:100%;max-height:72vh;background:#000}}button{{background:#151d20;color:#dfe8e5;border:1px solid #697773;padding:10px 14px;margin:4px;cursor:pointer}}button.active{{border-color:#c8ff42;color:#c8ff42}}.metrics{{display:grid;grid-template-columns:1fr 1fr;gap:8px}}.metric{{background:#111719;padding:10px;border-left:3px solid #55ddea}}.label{{color:#84928e;font-size:12px}}.value{{font-size:18px}}#status{{white-space:pre-wrap;background:#111719;padding:12px;overflow:auto}}@media(max-width:800px){{.grid{{grid-template-columns:1fr}}}}
</style></head><body><main><h1>PROTOTYPE · 杠铃轨迹约束骨架</h1>
<p class=\"notice\">问题：不新增逐帧精细标注时，自动检测到的杠铃杆轨迹能否暴露 RTMPose 腕部漂移，并生成更连续的诊断骨架？这是研究原型，不写入生产 profile。</p>
<div id=\"buttons\"></div><div class=\"grid\"><section><video id=\"video\" controls playsinline></video></section><section><div class=\"metrics\" id=\"metrics\"></div><h3>完整状态</h3><pre id=\"status\"></pre></section></div>
<script>const DATA={state};let selected=0;const $=s=>document.querySelector(s);function metric(label,value){{return `<div class=metric><div class=label>${{label}}</div><div class=value>${{value}}</div></div>`}}function render(){{const row=DATA.videos[selected];$('#buttons').innerHTML=DATA.videos.map((v,i)=>`<button class=${{i===selected?'active':''}} data-i=${{i}}>${{v.captureId.slice(0,8)}}…</button>`).join('');document.querySelectorAll('button').forEach(b=>b.onclick=()=>{{selected=Number(b.dataset.i);render()}});$('#video').src=row.video;$('#metrics').innerHTML=metric('杠铃轨迹覆盖',(row.barAxisFrameCoverage*100).toFixed(1)+'%')+metric('高置信覆盖',(row.barAxisConfidentFrameCoverage*100).toFixed(1)+'%')+metric('方向检查',row.phaseDirectionAlignedCount+'/'+row.phaseCheckpointCount)+metric('可约束帧',row.barConstraintCandidateFrameCount)+metric('腕部原始跳点 P95',row.rawWristJumpP95Torso??'—')+metric('杠铃约束后 P95',row.barConstrainedWristJumpP95Torso??'—');$('#status').textContent=JSON.stringify(row,null,2)}}render();</script></main></body></html>"""
    path.write_text(document, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path("data/workflows/pose-stack-comparison/front-bench-v1/run-2026-08-12/dataset/personal-golden-front-bench-v1.json"),
    )
    parser.add_argument(
        "--pose-root",
        type=Path,
        default=Path("data/workflows/pose-stack-comparison/front-bench-v1/run-2026-08-12/observations/yolox-rtmpose"),
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12"),
    )
    parser.add_argument(
        "--report-json",
        type=Path,
        default=Path(
            "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/prototype-evaluation.json"
        ),
    )
    parser.add_argument(
        "--report-md",
        type=Path,
        default=Path(
            "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/prototype-evaluation.md"
        ),
    )
    parser.add_argument("--render-width", type=int, default=360)
    parser.add_argument("--only-capture", action="append", default=[])
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_root = Path.cwd().resolve()
    dataset = _read_json(args.dataset)
    requested = set(args.only_capture)
    records = [
        record
        for record in dataset["records"]
        if record.get("exerciseId") == "barbell_bench_press"
        and (not requested or record["sourceCaptureId"] in requested)
    ]
    if not records:
        raise RuntimeError("No bench-press captures matched")
    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        capture_id = str(record["sourceCaptureId"])
        sidecar = args.pose_root / f"{capture_id}.halpe26.json.gz"
        if not sidecar.is_file():
            raise RuntimeError(f"Missing pose sidecar: {sidecar}")
        _, row = process_capture(project_root, record, sidecar.resolve(), output_root, args.render_width)
        rows.append(row)
        print(json.dumps({"progress": f"{index}/{len(records)}", "captureId": capture_id, "barCoverage": row["barAxisFrameCoverage"]}, ensure_ascii=False), flush=True)
    summary = aggregate_report(rows)
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "prototype": True,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "question": "Can causal auto-detected barbell trajectory constrain RTMPose wrist drift without new fine-grained user labels?",
        "scope": {
            "exerciseId": "barbell_bench_press",
            "videoCount": len(rows),
            "posePipeline": "YOLOX HumanArt + RTMPose Halpe-26",
            "equipmentPipeline": "causal shaft line groups + causal background + alpha-beta path",
        },
        "summary": summary,
        "videos": rows,
        "limitations": [
            "No human bar-axis endpoint truth; phase direction is not pixel accuracy.",
            "No human keypoint truth; fused wrist continuity is not PCK.",
            "Wrist X helps choose a shaft candidate, while wrist Y is excluded from bar-Y selection.",
            "Prototype output is diagnostic only and cannot be promoted.",
        ],
    }
    args.report_json.parent.mkdir(parents=True, exist_ok=True)
    args.report_json.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    write_markdown(args.report_md, report, project_root)
    write_viewer(output_root / "barbell-pose-alignment-prototype.html", report)
    print(json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
