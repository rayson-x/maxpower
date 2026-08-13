#!/usr/bin/env python3
"""Causal frame-stream audit for selected-profile barbell bench press.

The inference stage consumes only time-ordered pose/equipment observations. It
never loads rep labels, a complete-set normalization, or a future frame. Human
review events are opened only by the separate evaluation stage.

This is a deterministic prerecorded-stream harness. It validates online state
semantics and timeline accuracy, but does not claim camera/device throughput;
that requires the same interface to be driven by a live camera on target
hardware.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import statistics
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np


PACK_SCHEMA = "maxpower-causal-bench-stream-pack/v1"
PREDICTION_SCHEMA = "maxpower-causal-bench-stream-predictions/v1"
EVALUATION_SCHEMA = "maxpower-causal-bench-stream-evaluation/v1"
REFERENCE_HEIGHT = 640.0
ENTER_DELTA_PX = 32.0
RETURN_DELTA_PX = 14.0
TURNAROUND_CONFIRM_DELTA_PX = 2.0
TURNAROUND_CONFIRM_SAMPLES = 2
REVERSE_STEP_EPSILON_PX = 0.5
MINIMUM_EFFORT_DURATION_MS = 450.0
MAXIMUM_EFFORT_DURATION_MS = 6_000.0
MAXIMUM_CADENCE_GAP_MS = 8_000.0
MINIMUM_AMPLITUDE_PX = 32.0
MINIMUM_READY_SAMPLES = 10
MAXIMUM_READY_HISTORY = 80
MINIMUM_AXIS_CONFIDENCE = 0.16
TRUTH_KEYS = {
    "humanPeakTruth",
    "humanTruth",
    "repIndex",
    "reps",
    "segments",
    "expectedCount",
    "truthCount",
    "turnaroundMs",
    "startMs",
    "endMs",
    "reviewStatus",
    "reviewerId",
}


def read_json(path: Path) -> dict[str, Any]:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as source:
            return json.load(source)
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict[str, Any], *, gzip_output: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if gzip_output or path.suffix == ".gz":
        with gzip.open(path, "wt", encoding="utf-8") as destination:
            json.dump(value, destination, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        return
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def truth_paths(value: Any, prefix: str = "$") -> list[str]:
    matches: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            path = f"{prefix}.{key}"
            if key in TRUTH_KEYS:
                matches.append(path)
            matches.extend(truth_paths(child, path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            matches.extend(truth_paths(child, f"{prefix}[{index}]"))
    return matches


def prepare_pack(observation_root: Path, output: Path) -> dict[str, Any]:
    captures: list[dict[str, Any]] = []
    for path in sorted(observation_root.glob("*.barbell-pose-alignment.json.gz")):
        sidecar = read_json(path)
        contract = sidecar["inferenceContract"]
        if not contract.get("causal") or contract.get("readsFutureFrames"):
            raise ValueError(f"non-causal upstream observation: {path}")
        frames = [
            {
                "frameNumber": int(frame["frameNumber"]),
                "timestampMs": float(frame["timestampMs"]),
                "axis": frame.get("axis"),
                "landmarks": frame.get("landmarks", []),
            }
            for frame in sidecar["frames"]
        ]
        captures.append(
            {
                "captureId": str(sidecar["captureId"]),
                "sourceVideo": str(sidecar["sourceVideo"]),
                "sampleFps": float(contract["sampleFps"]),
                "upstreamContract": {
                    "causal": True,
                    "readsFutureFrames": False,
                    "posePipeline": str(contract["posePipeline"]),
                    "equipmentPipeline": str(contract["detector"]),
                },
                "frames": frames,
            }
        )
    if not captures:
        raise ValueError(f"no barbell-pose observations under {observation_root}")
    pack = {
        "schemaVersion": PACK_SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "profileIdentity": "barbell_bench_press/front/causal-bar-axis-research-v1",
        "exerciseIdentityMode": "user_selected_before_set",
        "labelsAvailableToInference": False,
        "truthAvailableToInference": False,
        "captureOrder": [capture["captureId"] for capture in captures],
        "captures": captures,
    }
    leaked = truth_paths(pack)
    if leaked:
        raise ValueError(f"truth leaked into stream pack: {leaked[:5]}")
    write_json(output, pack, gzip_output=True)
    return pack


def percentile(values: Iterable[float], quantile: float) -> float | None:
    materialized = [float(value) for value in values]
    return round(float(np.quantile(materialized, quantile)), 3) if materialized else None


def mean_absolute(values: Iterable[float]) -> float | None:
    materialized = [abs(float(value)) for value in values]
    return round(statistics.mean(materialized), 3) if materialized else None


@dataclass
class CausalCadenceGate:
    pending: dict[str, Any] | None = None
    active: bool = False
    last_candidate_end_ms: float | None = None
    confirmed: list[dict[str, Any]] = field(default_factory=list)
    rejected: list[dict[str, Any]] = field(default_factory=list)

    def advance_time(self, timestamp_ms: float) -> list[dict[str, Any]]:
        if self.last_candidate_end_ms is None:
            return []
        if timestamp_ms - self.last_candidate_end_ms <= MAXIMUM_CADENCE_GAP_MS:
            return []
        events: list[dict[str, Any]] = []
        if self.pending is not None:
            rejected = {**self.pending, "rejectionReason": "isolated_cycle_without_cadence_support"}
            self.rejected.append(rejected)
            events.append(_event("rep_candidate_rejected", timestamp_ms, rejected))
        if self.active:
            events.append(_event("set_cluster_closed", timestamp_ms, {"reason": "cadence_gap"}))
        self.pending = None
        self.active = False
        self.last_candidate_end_ms = None
        return events

    def accept(self, candidate: dict[str, Any], emitted_at_ms: float) -> list[dict[str, Any]]:
        events = self.advance_time(emitted_at_ms)
        self.last_candidate_end_ms = float(candidate["endMs"])
        if self.active:
            events.extend(self._confirm([candidate], emitted_at_ms))
            return events
        if self.pending is None:
            self.pending = candidate
            events.append(_event("rep_candidate_pending", emitted_at_ms, candidate))
            return events
        previous = self.pending
        self.pending = None
        self.active = True
        events.append(_event("set_cluster_started", emitted_at_ms, {"candidateCount": 2}))
        events.extend(self._confirm([previous, candidate], emitted_at_ms))
        return events

    def finish(self, timestamp_ms: float) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        if self.pending is not None:
            rejected = {**self.pending, "rejectionReason": "isolated_cycle_at_explicit_finish"}
            self.rejected.append(rejected)
            events.append(_event("rep_candidate_rejected", timestamp_ms, rejected))
            self.pending = None
        if self.active:
            events.append(_event("set_cluster_closed", timestamp_ms, {"reason": "explicit_finish"}))
        self.active = False
        self.last_candidate_end_ms = None
        return events

    def _confirm(
        self, candidates: Sequence[dict[str, Any]], emitted_at_ms: float
    ) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        for candidate in candidates:
            confirmed = {
                **candidate,
                "repIndex": len(self.confirmed) + 1,
                "confirmedAtMs": emitted_at_ms,
                "confirmationDelayMs": round(emitted_at_ms - float(candidate["endMs"]), 3),
            }
            self.confirmed.append(confirmed)
            events.append(_event("rep_confirmed", emitted_at_ms, confirmed))
        return events


def _event(event_type: str, emitted_at_ms: float, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": event_type,
        "emittedAtMs": round(float(emitted_at_ms), 3),
        "futureFrameReadCount": 0,
        **payload,
    }


@dataclass
class CausalBenchStreamRecognizer:
    sample_fps: float
    state: str = "ready"
    ready_history: list[float] = field(default_factory=list)
    baseline: float | None = None
    start_ms: float | None = None
    start_frame: int | None = None
    low_point: float = -math.inf
    low_point_ms: float | None = None
    low_point_frame: int | None = None
    turnaround_confirmed: bool = False
    turnaround_confirmed_at_ms: float | None = None
    previous_effort_position: float | None = None
    reverse_sample_count: int = 0
    effort_axis_confidence: list[float] = field(default_factory=list)
    effort_observed_samples: int = 0
    effort_total_samples: int = 0
    events: list[dict[str, Any]] = field(default_factory=list)
    trajectory: list[dict[str, Any]] = field(default_factory=list)
    raw_candidates: list[dict[str, Any]] = field(default_factory=list)
    cadence: CausalCadenceGate = field(default_factory=CausalCadenceGate)

    def update(self, frame: dict[str, Any]) -> None:
        frame_number = int(frame["frameNumber"])
        timestamp_ms = float(frame["timestampMs"])
        self.events.extend(self.cadence.advance_time(timestamp_ms))
        axis = frame.get("axis")
        confidence = float(axis.get("confidence", 0.0)) if axis else 0.0
        position = (
            float(axis["centerY"]) * REFERENCE_HEIGHT
            if axis is not None and confidence >= MINIMUM_AXIS_CONFIDENCE
            else None
        )
        if self.state == "effort":
            self.effort_total_samples += 1
            if position is not None:
                self.effort_observed_samples += 1
                self.effort_axis_confidence.append(confidence)

        emitted_before = len(self.events)
        if position is not None:
            if self.state == "ready":
                self._update_ready(frame_number, timestamp_ms, position, confidence)
            else:
                self._update_effort(frame_number, timestamp_ms, position)

        self.trajectory.append(
            {
                "frameNumber": frame_number,
                "timestampMs": round(timestamp_ms, 3),
                "axisObserved": axis is not None,
                "axisUsable": position is not None,
                "axisSource": axis.get("source") if axis else None,
                "axisConfidence": round(confidence, 6),
                "barCenterYAtReferenceHeightPx": round(position, 3) if position is not None else None,
                "barAxisSlope": float(axis["slope"]) if axis else None,
                "stateAfterFrame": self.state,
                "eventTypes": [event["type"] for event in self.events[emitted_before:]],
                "futureFrameReadCount": 0,
            }
        )

    def finish(self) -> None:
        timestamp_ms = float(self.trajectory[-1]["timestampMs"]) if self.trajectory else 0.0
        self.events.extend(self.cadence.finish(timestamp_ms))

    def _update_ready(
        self, frame_number: int, timestamp_ms: float, position: float, confidence: float
    ) -> None:
        self.ready_history.append(position)
        self.ready_history = self.ready_history[-MAXIMUM_READY_HISTORY:]
        lower_half = sorted(self.ready_history)[: max(3, len(self.ready_history) // 2)]
        self.baseline = statistics.median(lower_half)
        if (
            len(self.ready_history) >= MINIMUM_READY_SAMPLES
            and position >= self.baseline + ENTER_DELTA_PX
        ):
            self.state = "effort"
            self.start_ms = timestamp_ms
            self.start_frame = frame_number
            self.low_point = position
            self.low_point_ms = timestamp_ms
            self.low_point_frame = frame_number
            self.turnaround_confirmed = False
            self.turnaround_confirmed_at_ms = None
            self.previous_effort_position = position
            self.reverse_sample_count = 0
            self.effort_axis_confidence = [confidence]
            self.effort_observed_samples = 1
            self.effort_total_samples = 1
            self.events.append(
                _event(
                    "movement_started",
                    timestamp_ms,
                    {
                        "startMs": round(timestamp_ms, 3),
                        "sourceFrameNumber": frame_number,
                        "baselinePx": round(self.baseline, 3),
                    },
                )
            )

    def _update_effort(self, frame_number: int, timestamp_ms: float, position: float) -> None:
        assert self.baseline is not None
        assert self.start_ms is not None
        if position > self.low_point:
            self.low_point = position
            self.low_point_ms = timestamp_ms
            self.low_point_frame = frame_number
            self.reverse_sample_count = 0
        elif (
            self.previous_effort_position is not None
            and self.previous_effort_position - position >= REVERSE_STEP_EPSILON_PX
        ):
            self.reverse_sample_count += 1
        else:
            self.reverse_sample_count = 0
        if (
            not self.turnaround_confirmed
            and self.low_point_ms is not None
            and timestamp_ms > self.low_point_ms
            and self.reverse_sample_count >= TURNAROUND_CONFIRM_SAMPLES
            and self.low_point - position >= TURNAROUND_CONFIRM_DELTA_PX
        ):
            self.turnaround_confirmed = True
            self.turnaround_confirmed_at_ms = timestamp_ms
            self.events.append(
                _event(
                    "turnaround_confirmed",
                    timestamp_ms,
                    {
                        "turnaroundMs": round(self.low_point_ms, 3),
                        "confirmedAtMs": round(timestamp_ms, 3),
                        "confirmationDelayMs": round(timestamp_ms - self.low_point_ms, 3),
                        "sourceFrameNumber": frame_number,
                        "turnaroundFrameNumber": self.low_point_frame,
                        "barCenterYAtReferenceHeightPx": round(self.low_point, 3),
                    },
                )
            )

        self.previous_effort_position = position

        duration_ms = timestamp_ms - self.start_ms
        returned = self.turnaround_confirmed and position <= self.baseline + RETURN_DELTA_PX
        timed_out = duration_ms > MAXIMUM_EFFORT_DURATION_MS
        if not returned and not timed_out:
            return
        amplitude = self.low_point - self.baseline
        if returned and duration_ms >= MINIMUM_EFFORT_DURATION_MS and amplitude >= MINIMUM_AMPLITUDE_PX:
            candidate = {
                "startMs": round(self.start_ms, 3),
                "turnaroundMs": round(float(self.low_point_ms), 3),
                "turnaroundConfirmedAtMs": round(float(self.turnaround_confirmed_at_ms), 3),
                "endMs": round(timestamp_ms, 3),
                "durationMs": round(duration_ms, 3),
                "amplitudePxAtReferenceHeight": round(amplitude, 3),
                "axisFrameCoverage": round(
                    self.effort_observed_samples / self.effort_total_samples, 6
                ),
                "meanAxisConfidence": round(
                    statistics.mean(self.effort_axis_confidence), 6
                )
                if self.effort_axis_confidence
                else 0.0,
                "boundarySource": "causal_threshold_and_confirmed_reversal",
            }
            self.raw_candidates.append(candidate)
            self.events.append(_event("rep_candidate_sealed", timestamp_ms, candidate))
            self.events.extend(self.cadence.accept(candidate, timestamp_ms))
        else:
            self.events.append(
                _event(
                    "movement_rejected",
                    timestamp_ms,
                    {
                        "reason": "timeout_or_incomplete_cycle",
                        "startMs": round(self.start_ms, 3),
                        "endMs": round(timestamp_ms, 3),
                        "durationMs": round(duration_ms, 3),
                        "amplitudePxAtReferenceHeight": round(amplitude, 3),
                    },
                )
            )
        self._reset_after_effort(position)

    def _reset_after_effort(self, position: float) -> None:
        self.state = "ready"
        self.ready_history = [position]
        self.baseline = position
        self.start_ms = None
        self.start_frame = None
        self.low_point = -math.inf
        self.low_point_ms = None
        self.low_point_frame = None
        self.turnaround_confirmed = False
        self.turnaround_confirmed_at_ms = None
        self.previous_effort_position = None
        self.reverse_sample_count = 0
        self.effort_axis_confidence = []
        self.effort_observed_samples = 0
        self.effort_total_samples = 0


def _landmark(frame: dict[str, Any], index: int) -> tuple[float, float, float] | None:
    landmarks = frame.get("landmarks", [])
    if len(landmarks) <= index:
        return None
    point = landmarks[index]
    score = float(point.get("visibility", 0.0))
    if score < 0.3:
        return None
    return float(point["x"]), float(point["y"]), score


def _angle(a: tuple[float, float, float], b: tuple[float, float, float], c: tuple[float, float, float]) -> float | None:
    left = (a[0] - b[0], a[1] - b[1])
    right = (c[0] - b[0], c[1] - b[1])
    denominator = math.hypot(*left) * math.hypot(*right)
    if denominator <= 1e-9:
        return None
    cosine = max(-1.0, min(1.0, (left[0] * right[0] + left[1] * right[1]) / denominator))
    return math.degrees(math.acos(cosine))


def bilateral_metrics(
    frames: Sequence[dict[str, Any]], segment: dict[str, Any]
) -> dict[str, Any]:
    selected = [
        frame
        for frame in frames
        if float(segment["startMs"]) <= float(frame["timestampMs"]) <= float(segment["endMs"])
    ]
    sides = {"left": (5, 7, 9), "right": (6, 8, 10)}
    side_rows: dict[str, dict[str, Any]] = {}
    for side, (shoulder_index, elbow_index, wrist_index) in sides.items():
        wrists: list[tuple[float, float]] = []
        angles: list[float] = []
        usable = 0
        for frame in selected:
            shoulder = _landmark(frame, shoulder_index)
            elbow = _landmark(frame, elbow_index)
            wrist = _landmark(frame, wrist_index)
            if wrist is not None:
                wrists.append((float(frame["timestampMs"]), wrist[1]))
            if shoulder is not None and elbow is not None and wrist is not None:
                angle = _angle(shoulder, elbow, wrist)
                if angle is not None:
                    angles.append(angle)
                    usable += 1
        turnaround_ms = max(wrists, key=lambda item: item[1])[0] if wrists else None
        wrist_rom = max((item[1] for item in wrists), default=None)
        if wrist_rom is not None:
            wrist_rom -= min(item[1] for item in wrists)
        side_rows[side] = {
            "completeArmFrameRate": round(usable / len(selected), 6) if selected else 0.0,
            "wristObservedFrameRate": round(len(wrists) / len(selected), 6) if selected else 0.0,
            "wristTurnaroundMs": turnaround_ms,
            "wristVerticalRomImageRatio": round(wrist_rom, 7) if wrist_rom is not None else None,
            "elbowAngleRomDegrees": round(max(angles) - min(angles), 3) if angles else None,
        }
    left = side_rows["left"]
    right = side_rows["right"]
    turn_gap = (
        abs(float(left["wristTurnaroundMs"]) - float(right["wristTurnaroundMs"]))
        if left["wristTurnaroundMs"] is not None and right["wristTurnaroundMs"] is not None
        else None
    )
    rom_values = [left["wristVerticalRomImageRatio"], right["wristVerticalRomImageRatio"]]
    rom_gap = None
    if all(value is not None for value in rom_values):
        denominator = statistics.mean(float(value) for value in rom_values)
        if denominator > 1e-9:
            rom_gap = abs(float(rom_values[0]) - float(rom_values[1])) / denominator
    axis_samples = [
        (float(frame["timestampMs"]), frame["axis"])
        for frame in selected
        if frame.get("axis") is not None and float(frame["axis"].get("confidence", 0.0)) >= 0.32
    ]
    tilt_signed = [float(axis["y2"]) - float(axis["y1"]) for _, axis in axis_samples]
    tilt = [abs(value) for value in tilt_signed]
    bar_left_turnaround_ms = (
        max(axis_samples, key=lambda item: float(item[1]["y1"]))[0] if axis_samples else None
    )
    bar_right_turnaround_ms = (
        max(axis_samples, key=lambda item: float(item[1]["y2"]))[0] if axis_samples else None
    )
    bar_turnaround_gap = (
        abs(bar_left_turnaround_ms - bar_right_turnaround_ms)
        if bar_left_turnaround_ms is not None and bar_right_turnaround_ms is not None
        else None
    )
    observable = (
        min(left["completeArmFrameRate"], right["completeArmFrameRate"]) >= 0.70
        and len(axis_samples) / len(selected) >= 0.80
        if selected
        else False
    )
    return {
        "status": "provisional_model_evidence" if observable else "cannot_judge",
        "claim": "visible_bilateral_coordination_not_force",
        "left": left,
        "right": right,
        "wristTurnaroundGapMs": round(turn_gap, 3) if turn_gap is not None else None,
        "wristRomRelativeGap": round(rom_gap, 6) if rom_gap is not None else None,
        "barAxisUsableFrameRate": round(len(axis_samples) / len(selected), 6) if selected else 0.0,
        "barLeftEndpointTurnaroundMs": bar_left_turnaround_ms,
        "barRightEndpointTurnaroundMs": bar_right_turnaround_ms,
        "barEndpointTurnaroundGapMs": round(bar_turnaround_gap, 3)
        if bar_turnaround_gap is not None
        else None,
        "barEndpointHeightDifferenceImageRatioP95": percentile(tilt, 0.95),
        "barDynamicTiltRangeImageRatio": round(max(tilt_signed) - min(tilt_signed), 7)
        if tilt_signed
        else None,
        "interpretation": "measurement_only_no_reviewed_standard_threshold",
    }


def replay_capture_stream(
    capture_id: str, frames: Sequence[dict[str, Any]], sample_fps: float
) -> dict[str, Any]:
    recognizer = CausalBenchStreamRecognizer(sample_fps=sample_fps)
    started = time.perf_counter()
    for frame in frames:
        recognizer.update(frame)
    recognizer.finish()
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    confirmed = recognizer.cadence.confirmed
    return {
        "captureId": capture_id,
        "sampleFps": sample_fps,
        "inputFrameCount": len(frames),
        "trajectorySampleCount": len(recognizer.trajectory),
        "rawCandidateCount": len(recognizer.raw_candidates),
        "confirmedRepCount": len(confirmed),
        "rejectedIsolatedCandidateCount": len(recognizer.cadence.rejected),
        "events": recognizer.events,
        "trajectory": recognizer.trajectory,
        "predictedSegments": [
            {**segment, "bilateral": bilateral_metrics(frames, segment)} for segment in confirmed
        ],
        "harnessProcessingMs": round(elapsed_ms, 3),
        "harnessProcessingFramesPerSecond": round(len(frames) / (elapsed_ms / 1000.0), 3)
        if elapsed_ms > 0
        else None,
        "futureFrameReadCount": 0,
    }


def infer_pack(pack_path: Path, output: Path | None = None) -> dict[str, Any]:
    pack = read_json(pack_path)
    if pack.get("schemaVersion") != PACK_SCHEMA:
        raise ValueError("unsupported stream pack")
    leaked = truth_paths(pack)
    if leaked:
        raise ValueError(f"truth leaked into stream inference pack: {leaked[:5]}")
    rows = [
        replay_capture_stream(
            capture_id=str(capture["captureId"]),
            frames=capture["frames"],
            sample_fps=float(capture["sampleFps"]),
        )
        for capture in pack["captures"]
    ]
    predictions = {
        "schemaVersion": PREDICTION_SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "inferencePack": str(pack_path),
        "inferencePackSha256": sha256(pack_path),
        "profileIdentity": pack["profileIdentity"],
        "usesExerciseLabelAtInference": True,
        "usesExpectedCountAtInference": False,
        "usesTruthRangesAtInference": False,
        "usesFutureFrames": False,
        "usesWholeSetNormalization": False,
        "emitsTurnaroundBeforeRepEnd": True,
        "boundarySource": "causal_threshold_and_confirmed_reversal",
        "parameters": {
            "referenceHeightPx": REFERENCE_HEIGHT,
            "enterDeltaPx": ENTER_DELTA_PX,
            "returnDeltaPx": RETURN_DELTA_PX,
            "turnaroundConfirmDeltaPx": TURNAROUND_CONFIRM_DELTA_PX,
            "turnaroundConfirmSamples": TURNAROUND_CONFIRM_SAMPLES,
            "reverseStepEpsilonPx": REVERSE_STEP_EPSILON_PX,
            "minimumEffortDurationMs": MINIMUM_EFFORT_DURATION_MS,
            "maximumEffortDurationMs": MAXIMUM_EFFORT_DURATION_MS,
            "minimumAmplitudePx": MINIMUM_AMPLITUDE_PX,
            "maximumCadenceGapMs": MAXIMUM_CADENCE_GAP_MS,
        },
        "rows": rows,
    }
    if output is not None:
        write_json(output, predictions)
    return predictions


def latest_review_truth(path: Path) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        capture_id = str(event["captureId"])
        previous = latest.get(capture_id)
        if previous is None or str(event["recordedAt"]) >= str(previous["recordedAt"]):
            latest[capture_id] = event
    return {
        capture_id: event
        for capture_id, event in latest.items()
        if event.get("reviewStatus") == "submitted" and event.get("humanPeakTruth") is True
    }


def interval_iou(prediction: dict[str, Any], truth: dict[str, Any]) -> float:
    intersection = max(
        0.0,
        min(float(prediction["endMs"]), float(truth["endMs"]))
        - max(float(prediction["startMs"]), float(truth["startMs"])),
    )
    union = max(float(prediction["endMs"]), float(truth["endMs"])) - min(
        float(prediction["startMs"]), float(truth["startMs"])
    )
    return intersection / union if union > 0 else 0.0


def match_segments(
    predictions: Sequence[dict[str, Any]], truths: Sequence[dict[str, Any]]
) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    used: set[int] = set()
    for prediction_index, prediction in enumerate(predictions):
        candidates = [
            index
            for index, truth in enumerate(truths)
            if index not in used
            and float(truth["startMs"])
            <= float(prediction["turnaroundMs"])
            <= float(truth["endMs"])
        ]
        if len(candidates) != 1:
            continue
        truth_index = candidates[0]
        used.add(truth_index)
        truth = truths[truth_index]
        start_offset = float(prediction["startMs"]) - float(truth["startMs"])
        turnaround_offset = float(prediction["turnaroundMs"]) - float(truth["turnaroundMs"])
        end_offset = float(prediction["endMs"]) - float(truth["endMs"])
        matches.append(
            {
                "predictionIndex": prediction_index,
                "truthIndex": truth_index,
                "startOffsetMs": round(start_offset, 3),
                "turnaroundOffsetMs": round(turnaround_offset, 3),
                "endOffsetMs": round(end_offset, 3),
                "turnaroundConfirmationDelayMs": round(
                    float(prediction["turnaroundConfirmedAtMs"])
                    - float(prediction["turnaroundMs"]),
                    3,
                ),
                "turnaroundWithin250Ms": abs(turnaround_offset) <= 250.0,
                "turnaroundWithin500Ms": abs(turnaround_offset) <= 500.0,
                "intervalIoU": round(interval_iou(prediction, truth), 6),
                "truthTurnaroundSource": truth.get("turnaroundSource"),
            }
        )
    return matches


def evaluate(
    pack_path: Path,
    predictions_path: Path,
    reviews_path: Path,
    output_json: Path,
    output_md: Path,
) -> dict[str, Any]:
    pack = read_json(pack_path)
    predictions = read_json(predictions_path)
    if predictions.get("inferencePackSha256") != sha256(pack_path):
        raise ValueError("prediction/inference pack hash mismatch")
    truth = latest_review_truth(reviews_path)
    rows_by_id = {str(row["captureId"]): row for row in predictions["rows"]}
    if set(rows_by_id) != set(truth):
        raise ValueError(
            f"submitted review truth and prediction captures differ: predictions={sorted(rows_by_id)}, truth={sorted(truth)}"
        )
    per_capture: list[dict[str, Any]] = []
    all_matches: list[dict[str, Any]] = []
    for capture_id in pack["captureOrder"]:
        prediction = rows_by_id[capture_id]
        truth_event = truth[capture_id]
        truth_reps = truth_event["reps"]
        matches = match_segments(prediction["predictedSegments"], truth_reps)
        all_matches.extend(matches)
        per_capture.append(
            {
                "captureId": capture_id,
                "capturePosition": truth_event.get("capturePosition"),
                "truthRepCount": len(truth_reps),
                "predictedRepCount": len(prediction["predictedSegments"]),
                "matchedRepCount": len(matches),
                "exactCount": len(truth_reps) == len(prediction["predictedSegments"]),
                "rawCandidateCount": prediction["rawCandidateCount"],
                "rejectedIsolatedCandidateCount": prediction["rejectedIsolatedCandidateCount"],
                "matches": matches,
                "bilateral": [segment["bilateral"] for segment in prediction["predictedSegments"]],
            }
        )
    truth_count = sum(row["truthRepCount"] for row in per_capture)
    predicted_count = sum(row["predictedRepCount"] for row in per_capture)
    matched_count = sum(row["matchedRepCount"] for row in per_capture)
    turnaround_offsets = [float(match["turnaroundOffsetMs"]) for match in all_matches]
    confirmation_delays = [float(match["turnaroundConfirmationDelayMs"]) for match in all_matches]
    provisional_bilateral = sum(
        item["status"] == "provisional_model_evidence"
        for row in per_capture
        for item in row["bilateral"]
    )
    pose_equipment_disagreements = sum(
        item["status"] == "provisional_model_evidence"
        and item.get("wristTurnaroundGapMs") is not None
        and float(item["wristTurnaroundGapMs"]) >= 300.0
        and item.get("barEndpointTurnaroundGapMs") is not None
        and float(item["barEndpointTurnaroundGapMs"]) <= 100.0
        for row in per_capture
        for item in row["bilateral"]
    )
    summary = {
        "captureCount": len(per_capture),
        "humanConfirmedTruthRepCount": truth_count,
        "predictedRepCount": predicted_count,
        "matchedRepCount": matched_count,
        "repPrecision": round(matched_count / predicted_count, 6) if predicted_count else 0.0,
        "repRecall": round(matched_count / truth_count, 6) if truth_count else 0.0,
        "exactCountCaptureCount": sum(row["exactCount"] for row in per_capture),
        "exactCountCaptureRate": round(
            sum(row["exactCount"] for row in per_capture) / len(per_capture), 6
        ),
        "turnaroundWithin250MsCount": sum(match["turnaroundWithin250Ms"] for match in all_matches),
        "turnaroundWithin250MsRate": round(
            sum(match["turnaroundWithin250Ms"] for match in all_matches) / len(all_matches), 6
        )
        if all_matches
        else 0.0,
        "turnaroundWithin500MsCount": sum(match["turnaroundWithin500Ms"] for match in all_matches),
        "turnaroundWithin500MsRate": round(
            sum(match["turnaroundWithin500Ms"] for match in all_matches) / len(all_matches), 6
        )
        if all_matches
        else 0.0,
        "turnaroundAbsoluteErrorMs": {
            "mean": mean_absolute(turnaround_offsets),
            "p95": percentile([abs(value) for value in turnaround_offsets], 0.95),
        },
        "turnaroundConfirmationDelayMs": {
            "median": percentile(confirmation_delays, 0.50),
            "p95": percentile(confirmation_delays, 0.95),
        },
        "startAbsoluteErrorMsMean": mean_absolute(match["startOffsetMs"] for match in all_matches),
        "endAbsoluteErrorMsMean": mean_absolute(match["endOffsetMs"] for match in all_matches),
        "meanIntervalIoU": round(
            statistics.mean(float(match["intervalIoU"]) for match in all_matches), 6
        )
        if all_matches
        else 0.0,
        "bilateralCoordinationProvisionalModelEvidenceRepCount": provisional_bilateral,
        "bilateralCoordinationCannotJudgeRepCount": predicted_count - provisional_bilateral,
        "poseEquipmentTimingDisagreementCandidateCount": pose_equipment_disagreements,
    }
    acceptance = {
        "strictCausalNoFutureFrames": (
            predictions.get("usesFutureFrames") is False
            and predictions.get("usesWholeSetNormalization") is False
            and all(row.get("futureFrameReadCount") == 0 for row in predictions["rows"])
        ),
        "repPrecisionAtLeast95Percent": summary["repPrecision"] >= 0.95,
        "repRecallAtLeast95Percent": summary["repRecall"] >= 0.95,
        "turnaroundAtLeast95PercentWithin250Ms": summary["turnaroundWithin250MsRate"] >= 0.95,
        "turnaroundConfirmationP95AtMost300Ms": (
            summary["turnaroundConfirmationDelayMs"]["p95"] is not None
            and summary["turnaroundConfirmationDelayMs"]["p95"] <= 300.0
        ),
        "targetDeviceLiveThroughputMeasured": False,
        "overallRealtimeProductAcceptance": False,
    }
    report = {
        "schemaVersion": EVALUATION_SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "question": "Can the selected front-bench profile process observations causally, identify every rep and confirm the actual lowest point without future frames?",
        "protocol": {
            "mode": "prerecorded_frames_replayed_in_timestamp_order",
            "exerciseSelectedBeforeSet": True,
            "labelsLoadedOnlyAfterPredictionsPersisted": True,
            "usesFutureFrames": False,
            "usesWholeSetNormalization": False,
            "cameraCaptureAndTargetDeviceInferenceMeasured": False,
            "truthProvenance": "user submitted 46 review reps; turnarounds were human-confirmed from visible algorithm candidates",
            "independentManualTurnaroundPlacement": False,
        },
        "summary": summary,
        "acceptance": acceptance,
        "perCapture": per_capture,
        "standardFormBoundary": {
            "status": "not_yet_validated",
            "currentOutput": "measured trajectory and bilateral coordination features only",
            "cannotClaim": [
                "actual left/right force symmetry",
                "muscle activation",
                "scapular retraction from the current front/foot-end view",
                "one universal ideal trajectory for every body/load/intent",
            ],
            "requiredNext": "reviewed standard and deviation envelopes split by exact bench variant, view, anthropometry and intent",
        },
        "decision": {
            "causalTimelineAlgorithmReadyForLiveCameraIntegration": all(
                acceptance[key]
                for key in (
                    "strictCausalNoFutureFrames",
                    "repPrecisionAtLeast95Percent",
                    "repRecallAtLeast95Percent",
                    "turnaroundAtLeast95PercentWithin250Ms",
                    "turnaroundConfirmationP95AtMost300Ms",
                )
            ),
            "liveCameraProductCapabilityProven": False,
            "reason": "camera acquisition, model inference latency, backpressure, frame drops and target-device thermal behavior were not exercised by this prerecorded-observation replay",
            "productionPromotion": False,
        },
    }
    write_json(output_json, report)
    write_markdown(output_md, report)
    return report


def write_markdown(path: Path, report: dict[str, Any]) -> None:
    summary = report["summary"]
    acceptance = report["acceptance"]
    lines = [
        "# 个人正面卧推：因果实时轨迹回放验收",
        "",
        "## 结论",
        "",
        f"- 严格不读未来帧：**{'通过' if acceptance['strictCausalNoFutureFrames'] else '失败'}**。",
        f"- 46 次人工确认 rep：预测 {summary['predictedRepCount']}，匹配 {summary['matchedRepCount']}；precision {summary['repPrecision']:.1%}，recall {summary['repRecall']:.1%}。",
        f"- 最低点误差 ≤250 ms：{summary['turnaroundWithin250MsCount']}/{summary['humanConfirmedTruthRepCount']}（{summary['turnaroundWithin250MsRate']:.1%}）。",
        f"- 最低点误差 MAE/P95：{summary['turnaroundAbsoluteErrorMs']['mean']} / {summary['turnaroundAbsoluteErrorMs']['p95']} ms。",
        f"- 最低点因果确认延迟 median/P95：{summary['turnaroundConfirmationDelayMs']['median']} / {summary['turnaroundConfirmationDelayMs']['p95']} ms。",
        f"- 有足够模型输出可计算双侧候选指标的 rep：{summary['bilateralCoordinationProvisionalModelEvidenceRepCount']}/{summary['predictedRepCount']}；这不是人工 PCK 验证过的准确骨架，其余必须返回 cannot_judge。",
        f"- 腕点显示 ≥300 ms 时差、但杠轴两端 ≤100 ms 的骨架—器械冲突：{summary['poseEquipmentTimingDisagreementCandidateCount']} rep；不得据此提示用户左右发力问题。",
        "- 这证明逐帧时序算法是否可因果工作，不证明手机实时相机已经达标；目标机的采集、推理延迟、掉帧、背压和热稳定性仍未测。",
        "",
        "## 每条视频",
        "",
        "| Capture | 机位 | truth | predicted | matched | exact | raw | isolated rejected |",
        "| --- | --- | ---: | ---: | ---: | --- | ---: | ---: |",
    ]
    for row in report["perCapture"]:
        lines.append(
            f"| `{row['captureId'][:8]}…` | {row['capturePosition']} | {row['truthRepCount']} | {row['predictedRepCount']} | {row['matchedRepCount']} | {'yes' if row['exactCount'] else 'no'} | {row['rawCandidateCount']} | {row['rejectedIsolatedCandidateCount']} |"
        )
    lines.extend(
        [
            "",
            "## 标准动作与双侧发力边界",
            "",
            "当前保存的是实际杠铃、腕、肘轨迹和可见双侧协调指标。单目正面视频不能把轨迹差直接写成左右真实力量差。标准动作判断还需要同一卧推变式/机位/训练意图下，经教练审核并独立验证的可接受 envelope；个人历史只可作为个人稳定基线，不能自动成为标准。",
            "",
            "## 下一道门",
            "",
            "把完全相同的逐帧接口接到摄像头与 YOLOX + RTMPose + 器械跟踪，记录 capture timestamp、inference start/end、drop/backpressure、Rust event timestamp，并在目标 Android/iOS/Web 设备上重复同一组指标。",
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
        "--reviews",
        type=Path,
        default=Path(
            "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/bench-phase-review-events-v1.jsonl"
        ),
    )
    parser.add_argument(
        "--run-root",
        type=Path,
        default=Path(
            "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/realtime-causal-replay-v1"
        ),
    )
    parser.add_argument(
        "--report-json",
        type=Path,
        default=Path(
            "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/realtime-causal-replay-v1/evaluation-after-truth.json"
        ),
    )
    parser.add_argument(
        "--report-md",
        type=Path,
        default=Path(
            "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/realtime-causal-replay-v1/evaluation-after-truth.md"
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    pack_path = args.run_root / "stream-pack-without-truth.json.gz"
    predictions_path = args.run_root / "predictions-before-truth.json"
    if args.stage in {"prepare", "all"}:
        pack = prepare_pack(args.observation_root, pack_path)
        print(json.dumps({"stage": "prepare", "captures": len(pack["captures"]), "output": str(pack_path)}, ensure_ascii=False))
    if args.stage in {"infer", "all"}:
        predictions = infer_pack(pack_path, predictions_path)
        print(
            json.dumps(
                {
                    "stage": "infer",
                    "predictedReps": sum(row["confirmedRepCount"] for row in predictions["rows"]),
                    "output": str(predictions_path),
                },
                ensure_ascii=False,
            )
        )
    if args.stage in {"evaluate", "all"}:
        report = evaluate(
            pack_path,
            predictions_path,
            args.reviews,
            args.report_json,
            args.report_md,
        )
        print(json.dumps({"stage": "evaluate", **report["summary"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
