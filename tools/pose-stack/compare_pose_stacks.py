#!/usr/bin/env python3
"""Run frozen YOLOX pose-stack variants on complete personal videos.

This research Adapter changes one seam at a time:

* ``yolox-rtmpose`` keeps the existing dominant/continuous subject selector;
* ``yolox-rtmpose-bytetrack`` adds two-stage online detection association;
* ``yolox-movenet-thunder`` keeps the baseline selector and changes pose head.

All variants emit the existing 26-slot Halpe sidecar contract. MoveNet fills
only the COCO-17 prefix and leaves slots 17-25 explicitly unknown. Model score
and temporal stability are diagnostics, never keypoint accuracy truth.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import statistics
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import cv2
import numpy as np
import onnxruntime as ort
from scipy.optimize import linear_sum_assignment

from extract_personal_halpe26 import (
    HALPE26_NAMES,
    MAX_DETECTOR_HOLD_MS,
    POSE_SHA256,
    clamp_bbox,
    normalized_bbox,
    select_subject_bbox,
    sha256_file,
)


SCHEMA_VERSION = "maxpower-raw-pose-observation-sidecar/v2"
COMPARISON_VERSION = "maxpower-pose-stack-comparison-extraction/v1"
YOLOX_MODEL_SHA256 = "1450966de24902b18aada1a78913d7efd8fc8dcd51bd4d0d5591476bd4a38821"
MOVENET_THUNDER_SHA256 = "41641538679ec79b07d4101e591dda47d098c09af29607674b2a40b8a3798dd3"
NECESSARY_UPPER_BODY_JOINTS = (5, 6, 7, 8, 9, 10)
UPPER_BODY_BONES = ((5, 7), (7, 9), (6, 8), (8, 10))


@dataclass(frozen=True)
class Detection:
    bbox: tuple[float, float, float, float]
    score: float


@dataclass
class Track:
    track_id: int
    bbox: np.ndarray
    score: float
    velocity: np.ndarray = field(default_factory=lambda: np.zeros(4, dtype=np.float64))
    hits: int = 1
    missed: int = 0
    observed: bool = True

    def predict(self) -> None:
        self.bbox = self.bbox + self.velocity
        self.missed += 1
        self.observed = False

    def update(self, detection: Detection) -> None:
        observed = np.asarray(detection.bbox, dtype=np.float64)
        delta = observed - self.bbox
        self.velocity = self.velocity * 0.7 + delta * 0.3
        self.bbox = observed
        self.score = detection.score
        self.hits += 1
        self.missed = 0
        self.observed = True


class YoloxDetector:
    """Official end-to-end HumanArt YOLOX with scores preserved."""

    def __init__(self, model_path: Path) -> None:
        self.session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name

    def detect(self, frame: np.ndarray, minimum_score: float) -> list[Detection]:
        height, width = frame.shape[:2]
        ratio = min(416.0 / width, 416.0 / height)
        draw_width = max(1, round(width * ratio))
        draw_height = max(1, round(height * ratio))
        canvas = np.full((416, 416, 3), 114, dtype=np.uint8)
        canvas[:draw_height, :draw_width] = cv2.resize(frame, (draw_width, draw_height))
        input_tensor = np.transpose(canvas.astype(np.float32), (2, 0, 1))[None]
        dets, labels = self.session.run(None, {self.input_name: input_tensor})
        detections: list[Detection] = []
        for row, label in zip(dets[0], labels[0]):
            score = float(row[4])
            if int(label) != 0 or score < minimum_score:
                continue
            detections.append(
                Detection(
                    bbox=clamp_bbox(tuple(float(value) / ratio for value in row[:4]), width, height),
                    score=score,
                )
            )
        return sorted(detections, key=lambda item: item.score, reverse=True)


class DominantContinuitySelector:
    def __init__(self) -> None:
        self.previous: tuple[float, float, float, float] | None = None
        self.last_observed_ms: float | None = None

    def select(
        self,
        detections: Sequence[Detection],
        timestamp_ms: float,
        width: int,
        height: int,
    ) -> tuple[tuple[float, float, float, float] | None, dict[str, Any]]:
        eligible = [item for item in detections if item.score >= 0.3]
        selected, reason, score = select_subject_bbox(
            [item.bbox for item in eligible], self.previous, width, height
        )
        detector_observed = selected is not None
        if selected is not None:
            self.previous = selected
            self.last_observed_ms = timestamp_ms
        elif (
            self.previous is not None
            and self.last_observed_ms is not None
            and timestamp_ms - self.last_observed_ms <= MAX_DETECTOR_HOLD_MS
        ):
            selected = self.previous
            reason = "detector_gap_pose_hold"
        return selected, {
            "policy": "dominant-continuous-person/v5",
            "reason": reason,
            "score": round(float(score), 6),
            "detectorObserved": detector_observed,
            "trackId": None,
        }


class ByteTrackSubjectSelector:
    """Dependency-light ByteTrack-style two-stage online association.

    High-confidence detections establish tracks. Existing tracks may then be
    recovered by lower-confidence detections. A constant-velocity state keeps
    the subject box alive through short misses. The tracker does not infer
    object class or pose and cannot turn a wrong YOLOX detection into truth.
    """

    def __init__(self, sample_fps: float) -> None:
        self.tracks: list[Track] = []
        self.next_id = 1
        self.subject_id: int | None = None
        self.maximum_missed = max(1, round(sample_fps * MAX_DETECTOR_HOLD_MS / 1000.0))
        self.switch_count = 0

    @staticmethod
    def _iou(left: Sequence[float], right: Sequence[float]) -> float:
        x1 = max(left[0], right[0])
        y1 = max(left[1], right[1])
        x2 = min(left[2], right[2])
        y2 = min(left[3], right[3])
        intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
        left_area = max(0.0, left[2] - left[0]) * max(0.0, left[3] - left[1])
        right_area = max(0.0, right[2] - right[0]) * max(0.0, right[3] - right[1])
        union = left_area + right_area - intersection
        return intersection / union if union > 0 else 0.0

    def _associate(
        self,
        track_indices: Sequence[int],
        detections: Sequence[Detection],
        minimum_iou: float,
    ) -> tuple[set[int], set[int]]:
        if not track_indices or not detections:
            return set(), set()
        costs = np.ones((len(track_indices), len(detections)), dtype=np.float64)
        for row, track_index in enumerate(track_indices):
            for column, detection in enumerate(detections):
                costs[row, column] = 1.0 - self._iou(
                    self.tracks[track_index].bbox, detection.bbox
                )
        rows, columns = linear_sum_assignment(costs)
        matched_tracks: set[int] = set()
        matched_detections: set[int] = set()
        for row, column in zip(rows, columns):
            if 1.0 - costs[row, column] < minimum_iou:
                continue
            track_index = track_indices[row]
            self.tracks[track_index].update(detections[column])
            matched_tracks.add(track_index)
            matched_detections.add(column)
        return matched_tracks, matched_detections

    def update(self, detections: Sequence[Detection]) -> None:
        for track in self.tracks:
            track.predict()
        high = [item for item in detections if item.score >= 0.5]
        low = [item for item in detections if 0.1 <= item.score < 0.5]
        all_track_indices = list(range(len(self.tracks)))
        matched_high_tracks, matched_high_detections = self._associate(
            all_track_indices, high, minimum_iou=0.2
        )
        remaining_tracks = [
            index for index in all_track_indices if index not in matched_high_tracks
        ]
        self._associate(remaining_tracks, low, minimum_iou=0.1)
        for index, detection in enumerate(high):
            if index in matched_high_detections:
                continue
            self.tracks.append(
                Track(
                    track_id=self.next_id,
                    bbox=np.asarray(detection.bbox, dtype=np.float64),
                    score=detection.score,
                )
            )
            self.next_id += 1
        self.tracks = [track for track in self.tracks if track.missed <= self.maximum_missed]

    def select(
        self,
        detections: Sequence[Detection],
        timestamp_ms: float,
        width: int,
        height: int,
    ) -> tuple[tuple[float, float, float, float] | None, dict[str, Any]]:
        del timestamp_ms
        self.update(detections)
        selected_track = next(
            (track for track in self.tracks if track.track_id == self.subject_id), None
        )
        reason = "bytetrack_subject_continuity"
        if selected_track is None:
            observed_tracks = [track for track in self.tracks if track.observed]
            if observed_tracks:
                selected_box, _, _ = select_subject_bbox(
                    [track.bbox for track in observed_tracks], None, width, height
                )
                if selected_box is not None:
                    selected_track = min(
                        observed_tracks,
                        key=lambda track: 1.0 - self._iou(track.bbox, selected_box),
                    )
                    if self.subject_id is not None and self.subject_id != selected_track.track_id:
                        self.switch_count += 1
                    self.subject_id = selected_track.track_id
                    reason = "bytetrack_initial_or_reacquired_subject"
        if selected_track is None:
            return None, {
                "policy": "bytetrack-two-stage-subject/v1",
                "reason": "no_active_track",
                "score": 0.0,
                "detectorObserved": False,
                "trackId": self.subject_id,
            }
        selected = clamp_bbox(selected_track.bbox, width, height)
        return selected, {
            "policy": "bytetrack-two-stage-subject/v1",
            "reason": reason if selected_track.observed else "bytetrack_motion_hold",
            "score": round(float(selected_track.score), 6),
            "detectorObserved": selected_track.observed,
            "trackId": selected_track.track_id,
        }


class RtmposeEstimator:
    keypoint_count = 26

    def __init__(self, model_path: Path) -> None:
        from rtmlib import RTMPose

        self.model = RTMPose(
            str(model_path),
            model_input_size=(192, 256),
            backend="onnxruntime",
            device="cpu",
        )

    def estimate(
        self,
        frame: np.ndarray,
        bbox: tuple[float, float, float, float],
    ) -> list[dict[str, float | None]]:
        height, width = frame.shape[:2]
        keypoints, scores = self.model(frame, bboxes=[bbox])
        if keypoints.shape != (1, 26, 2) or scores.shape != (1, 26):
            raise RuntimeError(f"Unexpected RTMPose output: {keypoints.shape}, {scores.shape}")
        return [
            {
                "x": round(float(point[0]) / width, 7),
                "y": round(float(point[1]) / height, 7),
                "z": None,
                "visibility": round(float(np.clip(score, 0.0, 1.0)), 7),
            }
            for point, score in zip(keypoints[0], scores[0])
        ]


def map_movenet_keypoints(
    values: np.ndarray,
    crop: tuple[float, float, float],
    width: int,
    height: int,
) -> list[dict[str, float | None]]:
    crop_x, crop_y, crop_size = crop
    landmarks: list[dict[str, float | None]] = []
    for y, x, score in values:
        landmarks.append(
            {
                "x": round((crop_x + float(x) * crop_size) / width, 7),
                "y": round((crop_y + float(y) * crop_size) / height, 7),
                "z": None,
                "visibility": round(float(np.clip(score, 0.0, 1.0)), 7),
            }
        )
    landmarks.extend(
        {"x": 0.0, "y": 0.0, "z": None, "visibility": 0.0}
        for _ in range(26 - len(landmarks))
    )
    return landmarks


class MoveNetThunderEstimator:
    keypoint_count = 17

    def __init__(self, model_path: Path) -> None:
        os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
        import tensorflow as tf

        self.interpreter = tf.lite.Interpreter(model_path=str(model_path), num_threads=1)
        self.interpreter.allocate_tensors()
        self.input_detail = self.interpreter.get_input_details()[0]
        self.output_detail = self.interpreter.get_output_details()[0]

    @staticmethod
    def crop_geometry(
        bbox: tuple[float, float, float, float]
    ) -> tuple[float, float, float]:
        center_x = (bbox[0] + bbox[2]) / 2.0
        center_y = (bbox[1] + bbox[3]) / 2.0
        size = max(bbox[2] - bbox[0], bbox[3] - bbox[1]) * 1.25
        return center_x - size / 2.0, center_y - size / 2.0, size

    def estimate(
        self,
        frame: np.ndarray,
        bbox: tuple[float, float, float, float],
    ) -> list[dict[str, float | None]]:
        height, width = frame.shape[:2]
        crop_x, crop_y, crop_size = self.crop_geometry(bbox)
        scale = 256.0 / crop_size
        transform = np.asarray(
            [[scale, 0.0, -crop_x * scale], [0.0, scale, -crop_y * scale]],
            dtype=np.float32,
        )
        crop = cv2.warpAffine(
            frame,
            transform,
            (256, 256),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(0, 0, 0),
        )
        rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)[None].astype(np.uint8)
        self.interpreter.set_tensor(self.input_detail["index"], rgb)
        self.interpreter.invoke()
        values = self.interpreter.get_tensor(self.output_detail["index"])[0, 0]
        return map_movenet_keypoints(values, (crop_x, crop_y, crop_size), width, height)


@dataclass(frozen=True)
class PipelineSpec:
    pipeline_id: str
    pipeline_label: str
    pose_kind: str
    selector_kind: str
    minimum_detector_score: float


PIPELINES = {
    "yolox-rtmpose": PipelineSpec(
        "yolox-rtmpose",
        "yolox-nano-humanart+rtmpose-m-halpe26",
        "rtmpose",
        "dominant",
        0.3,
    ),
    "yolox-rtmpose-bytetrack": PipelineSpec(
        "yolox-rtmpose-bytetrack",
        "yolox-nano-humanart+bytetrack-v1+rtmpose-m-halpe26",
        "rtmpose",
        "bytetrack",
        0.1,
    ),
    "yolox-movenet-thunder": PipelineSpec(
        "yolox-movenet-thunder",
        "yolox-nano-humanart+movenet-thunder-coco17-prefix-halpe26",
        "movenet",
        "dominant",
        0.3,
    ),
}


def quantile(values: Sequence[float], q: float) -> float | None:
    return round(float(np.quantile(values, q)), 6) if values else None


def write_gzip_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    os.close(descriptor)
    try:
        with gzip.open(temporary, "wt", encoding="utf-8", compresslevel=6) as target:
            json.dump(value, target, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def torso_scale(landmarks: Sequence[dict[str, Any]]) -> float | None:
    required = (5, 6, 11, 12)
    if any(float(landmarks[index]["visibility"]) < 0.3 for index in required):
        return None
    shoulder = (
        (float(landmarks[5]["x"]) + float(landmarks[6]["x"])) / 2.0,
        (float(landmarks[5]["y"]) + float(landmarks[6]["y"])) / 2.0,
    )
    hip = (
        (float(landmarks[11]["x"]) + float(landmarks[12]["x"])) / 2.0,
        (float(landmarks[11]["y"]) + float(landmarks[12]["y"])) / 2.0,
    )
    value = math.hypot(shoulder[0] - hip[0], shoulder[1] - hip[1])
    return value if value > 1e-6 else None


def pose_diagnostics(frames: Sequence[dict[str, Any]]) -> dict[str, Any]:
    necessary_scores: list[float] = []
    necessary_usable = 0
    necessary_total = 0
    out_of_frame = 0
    finite_points = 0
    normalized_jumps: list[float] = []
    bone_lengths: dict[tuple[int, int], list[float]] = {bone: [] for bone in UPPER_BODY_BONES}
    previous: list[dict[str, Any]] | None = None
    for frame in frames:
        landmarks = frame["landmarks"]
        if len(landmarks) != 26:
            previous = None
            continue
        scale = torso_scale(landmarks)
        for index in NECESSARY_UPPER_BODY_JOINTS:
            score = float(landmarks[index]["visibility"])
            necessary_scores.append(score)
            necessary_total += 1
            necessary_usable += int(score >= 0.3)
        for landmark in landmarks:
            if float(landmark["visibility"]) <= 0:
                continue
            finite_points += 1
            x, y = float(landmark["x"]), float(landmark["y"])
            out_of_frame += int(not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0))
        if scale is not None:
            for bone in UPPER_BODY_BONES:
                left, right = (landmarks[index] for index in bone)
                if min(float(left["visibility"]), float(right["visibility"])) < 0.3:
                    continue
                length = math.hypot(
                    float(left["x"]) - float(right["x"]),
                    float(left["y"]) - float(right["y"]),
                ) / scale
                bone_lengths[bone].append(length)
            if previous is not None:
                for index in NECESSARY_UPPER_BODY_JOINTS:
                    if min(
                        float(landmarks[index]["visibility"]),
                        float(previous[index]["visibility"]),
                    ) < 0.3:
                        continue
                    normalized_jumps.append(
                        math.hypot(
                            float(landmarks[index]["x"]) - float(previous[index]["x"]),
                            float(landmarks[index]["y"]) - float(previous[index]["y"]),
                        ) / scale
                    )
        previous = landmarks
    bone_cvs = []
    for values in bone_lengths.values():
        if len(values) >= 2 and statistics.mean(values) > 1e-9:
            bone_cvs.append(statistics.pstdev(values) / statistics.mean(values))
    return {
        "keypointAccuracyTruth": "blocked_no_human_keypoint_consensus",
        "necessaryJointModelScoreMean": round(statistics.mean(necessary_scores), 6) if necessary_scores else None,
        "necessaryJointScoreAtLeastPoint3Rate": round(necessary_usable / necessary_total, 6) if necessary_total else None,
        "outOfFrameObservedPointRate": round(out_of_frame / finite_points, 6) if finite_points else None,
        "necessaryJointNormalizedJumpP95": quantile(normalized_jumps, 0.95),
        "upperBodyBoneLengthCvMean": round(statistics.mean(bone_cvs), 6) if bone_cvs else None,
        "warning": "model score and stability are not PCK or alignment accuracy",
    }


def load_sources(
    dataset_path: Path,
    exercise: str | None,
    capture_ids: set[str],
) -> list[dict[str, Any]]:
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    unique: dict[str, dict[str, Any]] = {}
    for record in dataset["records"]:
        if exercise and record["exerciseId"] != exercise:
            continue
        source_id = record["sourceCaptureId"]
        if capture_ids and source_id not in capture_ids:
            continue
        unique.setdefault(source_id, record["source"])
    return [
        {"captureId": capture_id, "source": source}
        for capture_id, source in sorted(unique.items())
    ]


def make_pose_estimator(spec: PipelineSpec, pose_model: Path, movenet_model: Path) -> Any:
    return (
        RtmposeEstimator(pose_model)
        if spec.pose_kind == "rtmpose"
        else MoveNetThunderEstimator(movenet_model)
    )


def extract_capture(
    project_root: Path,
    capture_id: str,
    source: dict[str, Any],
    output_path: Path,
    spec: PipelineSpec,
    detector: YoloxDetector,
    pose_estimator: Any,
    sample_fps: float,
) -> dict[str, Any]:
    video_path = project_root / "public/archives/confirmed-captures" / source["video"]
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Unable to open video: {video_path}")
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    declared_duration_ms = float(source["durationMs"])
    declared_frame_count = int(source["frameCount"])
    declared_fps = declared_frame_count / declared_duration_ms * 1000.0
    selector: Any = (
        ByteTrackSubjectSelector(sample_fps)
        if spec.selector_kind == "bytetrack"
        else DominantContinuitySelector()
    )
    next_sample_ms = 0.0
    sample_period_ms = 1000.0 / sample_fps
    frame_index = -1
    last_timestamp_ms = -1.0
    frames: list[dict[str, Any]] = []
    inference_times: list[float] = []
    detector_observed = 0
    pose_frames = 0
    track_ids: list[int] = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frame_index += 1
        container_ms = float(capture.get(cv2.CAP_PROP_POS_MSEC))
        fallback_ms = frame_index / declared_fps * 1000.0
        timestamp_ms = (
            container_ms
            if math.isfinite(container_ms)
            and container_ms >= last_timestamp_ms
            and container_ms <= declared_duration_ms + 2_000.0
            else fallback_ms
        )
        last_timestamp_ms = timestamp_ms
        if timestamp_ms + 0.5 < next_sample_ms:
            continue
        while next_sample_ms <= timestamp_ms + 0.5:
            next_sample_ms += sample_period_ms
        started = time.perf_counter()
        detections = detector.detect(frame, spec.minimum_detector_score)
        selected, selection = selector.select(detections, timestamp_ms, width, height)
        landmarks: list[dict[str, Any]] = []
        if selected is not None:
            landmarks = pose_estimator.estimate(frame, selected)
            pose_frames += 1
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        inference_times.append(elapsed_ms)
        detector_observed += int(selection["detectorObserved"])
        if selection["trackId"] is not None:
            track_ids.append(int(selection["trackId"]))
        observed_scores = [float(item["visibility"]) for item in landmarks]
        frames.append(
            {
                "frameNumber": frame_index,
                "timestampMs": round(timestamp_ms, 3),
                "candidateBboxes": [
                    {**normalized_bbox(item.bbox, width, height), "score": round(item.score, 6)}
                    for item in detections
                ],
                "selectedBbox": normalized_bbox(selected, width, height) if selected else None,
                "subjectSelection": selection,
                "landmarks": landmarks,
                "observationQuality": {
                    "meanKeypointScore": round(statistics.mean(observed_scores), 6) if observed_scores else 0.0,
                    "observedKeypointCount": sum(score >= 0.3 for score in observed_scores),
                    "cocoPrefixObservedCount": sum(score >= 0.3 for score in observed_scores[:17]),
                },
            }
        )
    capture.release()
    if not frames:
        raise RuntimeError(f"No frames sampled from {video_path}")
    sidecar = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "captureId": capture_id,
        "poseSchema": "halpe26",
        "keypointNames": HALPE26_NAMES,
        "coco17PrefixInvariant": True,
        "coordinateSpace": "image_normalized",
        "missingPointPolicy": "missing slots remain visibility=0; no synthesis or cross-person fusion",
        "source": {
            "video": str(video_path.relative_to(project_root)),
            "sha256": sha256_file(video_path),
            "widthPx": width,
            "heightPx": height,
            "framesPerSecond": round(declared_fps, 6),
            "frameCount": declared_frame_count,
            "durationMs": declared_duration_ms,
        },
        "inference": {
            "pipeline": spec.pipeline_label,
            "sampleFps": sample_fps,
            "detectorEverySampledFrame": True,
            "detector": {
                "family": "YOLOX nano HumanArt",
                "inputSize": [416, 416],
                "sha256": YOLOX_MODEL_SHA256,
                "minimumScore": spec.minimum_detector_score,
                "classesUsed": ["person"],
            },
            "pose": {
                "family": "RTMPose-m" if spec.pose_kind == "rtmpose" else "MoveNet Thunder",
                "inputSize": [192, 256] if spec.pose_kind == "rtmpose" else [256, 256],
                "sha256": POSE_SHA256 if spec.pose_kind == "rtmpose" else MOVENET_THUNDER_SHA256,
                "nativeOutputSchema": "halpe26" if spec.pose_kind == "rtmpose" else "coco17",
                "outputSchema": "halpe26",
                "unknownOutputSlots": [] if spec.pose_kind == "rtmpose" else list(range(17, 26)),
            },
            "subjectSelection": selection["policy"],
            "temporalSmoothing": "none_raw_pose_observations_only",
        },
        "summary": {
            "sampledFrameCount": len(frames),
            "decodedFrameCount": frame_index + 1,
            "poseFrameCount": pose_frames,
            "poseFrameRate": round(pose_frames / len(frames), 6),
            "detectorObservedFrameRatio": round(detector_observed / len(frames), 6),
            "subjectTrackIdCount": len(set(track_ids)),
            "subjectTrackSwitchCount": getattr(selector, "switch_count", 0),
            "inferenceMs": {
                "mean": round(statistics.mean(inference_times), 6),
                "p50": quantile(inference_times, 0.5),
                "p95": quantile(inference_times, 0.95),
            },
            "poseDiagnostics": pose_diagnostics(frames),
        },
        "frames": frames,
    }
    write_gzip_json(output_path, sidecar)
    return {
        "captureId": capture_id,
        "output": str(output_path),
        **sidecar["summary"],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=Path("data/training/personal-golden-segmentation-v2.json"))
    parser.add_argument("--archive", type=Path, default=Path("public/archives/confirmed-captures"))
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--exercise", default="barbell_bench_press")
    parser.add_argument("--only-capture", action="append", default=[])
    parser.add_argument("--pipeline", action="append", choices=sorted(PIPELINES), default=[])
    parser.add_argument("--sample-fps", type=float, default=10.0)
    parser.add_argument("--force", action="store_true")
    parser.add_argument(
        "--yolox-model",
        type=Path,
        default=Path("data/workflows/pose-stack/runtime/models/yolox-nano-humanart/20230928/yolox_onnx/yolox_nano_8xb8-300e_humanart-40f6f0d0/end2end.onnx"),
    )
    parser.add_argument(
        "--rtmpose-model",
        type=Path,
        default=Path("data/workflows/pose-stack/runtime/models/rtmpose-m-halpe26/20230831/rtmpose_onnx/rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605/end2end.onnx"),
    )
    parser.add_argument(
        "--movenet-model",
        type=Path,
        default=Path("data/workflows/pose-stack/runtime/models/movenet-thunder/movenet-thunder-float16-v4.tflite"),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_root = Path.cwd().resolve()
    dataset_path = args.dataset.resolve()
    output_root = args.output_root.resolve()
    pipelines = args.pipeline or list(PIPELINES)
    for model, expected in (
        (args.yolox_model, YOLOX_MODEL_SHA256),
        (args.rtmpose_model, POSE_SHA256),
        (args.movenet_model, MOVENET_THUNDER_SHA256),
    ):
        if not model.is_file() or sha256_file(model) != expected:
            raise RuntimeError(f"Model missing or checksum mismatch: {model}")
    sources = load_sources(dataset_path, args.exercise or None, set(args.only_capture))
    if not sources:
        raise RuntimeError("No source videos matched the comparison scope")
    run_results = []
    for pipeline_id in pipelines:
        spec = PIPELINES[pipeline_id]
        detector = YoloxDetector(args.yolox_model)
        pose_estimator = make_pose_estimator(spec, args.rtmpose_model, args.movenet_model)
        results = []
        for index, item in enumerate(sources, start=1):
            output_path = output_root / "observations" / pipeline_id / f"{item['captureId']}.halpe26.json.gz"
            if output_path.is_file() and not args.force:
                with gzip.open(output_path, "rt", encoding="utf-8") as source_file:
                    existing = json.load(source_file)
                if (
                    existing.get("inference", {}).get("pipeline") == spec.pipeline_label
                    and existing.get("inference", {}).get("sampleFps") == args.sample_fps
                ):
                    result = {"captureId": item["captureId"], "output": str(output_path), "status": "skipped"}
                    results.append(result)
                    print(json.dumps({"pipeline": pipeline_id, "progress": f"{index}/{len(sources)}", **result}), flush=True)
                    continue
            result = extract_capture(
                project_root,
                item["captureId"],
                item["source"],
                output_path,
                spec,
                detector,
                pose_estimator,
                args.sample_fps,
            )
            result["status"] = "extracted"
            results.append(result)
            print(json.dumps({"pipeline": pipeline_id, "progress": f"{index}/{len(sources)}", **result}, ensure_ascii=False), flush=True)
        summary = {
            "schemaVersion": COMPARISON_VERSION,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "pipelineId": pipeline_id,
            "pipeline": spec.pipeline_label,
            "exerciseId": args.exercise,
            "sampleFps": args.sample_fps,
            "sourceCaptureCount": len(sources),
            "results": results,
        }
        summary_path = output_root / "extraction" / f"{pipeline_id}.json"
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        run_results.append(summary)
    print(json.dumps({"outputRoot": str(output_root), "pipelines": pipelines, "sourceCaptureCount": len(sources)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
