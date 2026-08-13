#!/usr/bin/env python3
"""Extract raw YOLOX + RTMPose Halpe-26 observations from personal videos.

This is an offline research Adapter. It intentionally does not count reps,
smooth landmarks, infer missing joints, or classify technique. Those decisions
belong to the Rust canonical and assessment layers. The selected person box is
locked by temporal continuity so mirrors and gym bystanders do not silently
become the active subject.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import tempfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import cv2
import numpy as np

HALPE26_NAMES = (
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee",
    "right_knee", "left_ankle", "right_ankle", "head", "neck",
    "hip_center", "left_big_toe", "right_big_toe", "left_small_toe",
    "right_small_toe", "left_heel", "right_heel",
)
COCO17_NAMES = HALPE26_NAMES[:17]

DETECTOR_URL = (
    "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/"
    "yolox_nano_8xb8-300e_humanart-40f6f0d0.zip"
)
POSE_URL = (
    "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/"
    "rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605.zip"
)
DETECTOR_SHA256 = "1450966de24902b18aada1a78913d7efd8fc8dcd51bd4d0d5591476bd4a38821"
POSE_SHA256 = "26f3a19e61304a600dfb82d1001d41d24343b89fc70a33ffc84657e0b0bf2ecf"
SCHEMA_VERSION = "maxpower-raw-pose-observation-sidecar/v2"
SUBJECT_POLICY_VERSION = "dominant-continuous-person/v5"
MAX_DETECTOR_HOLD_MS = 1_500.0

_DETECTOR: Any = None
_POSE: Any = None


@dataclass(frozen=True)
class ExtractionTask:
    capture_id: str
    source_video: str
    source_relpath: str
    output_file: str
    declared_duration_ms: float
    declared_frame_count: int
    sample_fps: float
    force: bool


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def clamp_bbox(box: Sequence[float], width: int, height: int) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = (float(value) for value in box[:4])
    x1 = min(max(x1, 0.0), float(width - 1))
    y1 = min(max(y1, 0.0), float(height - 1))
    x2 = min(max(x2, x1 + 1.0), float(width))
    y2 = min(max(y2, y1 + 1.0), float(height))
    return x1, y1, x2, y2


def bbox_iou(left: Sequence[float], right: Sequence[float]) -> float:
    lx1, ly1, lx2, ly2 = left[:4]
    rx1, ry1, rx2, ry2 = right[:4]
    ix1, iy1 = max(lx1, rx1), max(ly1, ry1)
    ix2, iy2 = min(lx2, rx2), min(ly2, ry2)
    intersection = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    left_area = max(0.0, lx2 - lx1) * max(0.0, ly2 - ly1)
    right_area = max(0.0, rx2 - rx1) * max(0.0, ry2 - ry1)
    union = left_area + right_area - intersection
    return intersection / union if union > 0 else 0.0


def _center_distance(left: Sequence[float], right: Sequence[float], diagonal: float) -> float:
    left_center = ((left[0] + left[2]) / 2, (left[1] + left[3]) / 2)
    right_center = ((right[0] + right[2]) / 2, (right[1] + right[3]) / 2)
    return math.hypot(left_center[0] - right_center[0], left_center[1] - right_center[1]) / diagonal


def select_subject_bbox(
    candidates: Sequence[Sequence[float]],
    previous: Sequence[float] | None,
    width: int,
    height: int,
) -> tuple[tuple[float, float, float, float] | None, str, float]:
    """Select one person without allowing mirror/bystander identity jumps."""
    if not candidates:
        return None, "no_detection", 0.0
    boxes = [clamp_bbox(box, width, height) for box in candidates]
    frame_area = float(width * height)
    diagonal = math.hypot(width, height)
    center_box = (width * 0.45, height * 0.45, width * 0.55, height * 0.55)
    largest_area = max((box[2] - box[0]) * (box[3] - box[1]) for box in boxes)

    if previous is not None:
        previous_area = max(1.0, (previous[2] - previous[0]) * (previous[3] - previous[1]))
        dominant = max(boxes, key=lambda box: (box[2] - box[0]) * (box[3] - box[1]))
        dominant_area = (dominant[2] - dominant[0]) * (dominant[3] - dominant[1])
        dominant_center_distance = _center_distance(dominant, center_box, diagonal)
        # Some captures begin with only a face, reflection, or distant person
        # before the exercising subject fills the frame. A tiny tentative lock
        # must not prevent that clearly dominant subject from being acquired.
        # The large area and centrality requirements keep this separate from a
        # normal mirror/bystander takeover.
        if (
            previous_area < frame_area * 0.05
            and dominant_area >= max(previous_area * 3.0, frame_area * 0.08)
            and dominant_center_distance <= 0.35
        ):
            return dominant, "dominant_subject_reacquired", 1.0

    ranked: list[tuple[float, tuple[float, float, float, float], float]] = []
    for box in boxes:
        area = (box[2] - box[0]) * (box[3] - box[1])
        area_relative = area / largest_area if largest_area > 0 else 0.0
        frame_area_ratio = min(1.0, area / max(frame_area * 0.35, 1.0))
        image_center = 1.0 - min(1.0, _center_distance(box, center_box, diagonal))
        if previous is None:
            score = area_relative * 0.55 + frame_area_ratio * 0.20 + image_center * 0.25
            continuity = 0.0
        else:
            continuity = bbox_iou(box, previous)
            center_continuity = 1.0 - min(1.0, _center_distance(box, previous, diagonal) * 3.0)
            score = continuity * 0.58 + center_continuity * 0.25 + area_relative * 0.12 + image_center * 0.05
        ranked.append((score, box, continuity))
    ranked.sort(key=lambda item: item[0], reverse=True)
    score, selected, continuity = ranked[0]
    if previous is not None:
        previous_area = max(1.0, (previous[2] - previous[0]) * (previous[3] - previous[1]))
        selected_area = (selected[2] - selected[0]) * (selected[3] - selected[1])
        size_ratio = selected_area / previous_area
        center_jump = _center_distance(selected, previous, diagonal)
        # A mirror/bystander takeover can happen through a similarly sized,
        # partially overlapping detection before it lands on the wrong
        # person. Gate the instantaneous displacement as well as size: a
        # subject performing a rep cannot teleport this far between sampled
        # frames. Treat the candidate as a detector miss so the caller holds
        # the last identity and can reacquire it later.
        identity_jump = continuity < 0.12 and center_jump > 0.10
        implausible_scale_jump = continuity < 0.05 and not (0.45 <= size_ratio <= 2.5)
        if identity_jump or implausible_scale_jump:
            return None, "identity_mismatch_rejected", float(score)
    reason = "initial_dominant_centered" if previous is None else "continuous_iou_center"
    return selected, reason, float(score)


def normalized_bbox(box: Sequence[float], width: int, height: int) -> dict[str, float]:
    return {
        "x": round(float(box[0]) / width, 6),
        "y": round(float(box[1]) / height, 6),
        "width": round(float(box[2] - box[0]) / width, 6),
        "height": round(float(box[3] - box[1]) / height, 6),
    }


def _initialize_worker(detector_path: str, pose_path: str) -> None:
    global _DETECTOR, _POSE
    from rtmlib import RTMPose, YOLOX

    # Avoid process-count × ORT-thread-count oversubscription.
    cv2.setNumThreads(1)
    _DETECTOR = YOLOX(
        detector_path,
        model_input_size=(416, 416),
        score_thr=0.3,
        backend="onnxruntime",
        device="cpu",
    )
    _POSE = RTMPose(
        pose_path,
        model_input_size=(192, 256),
        backend="onnxruntime",
        device="cpu",
    )


def _write_gzip_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    os.close(file_descriptor)
    try:
        with gzip.open(temp_name, "wt", encoding="utf-8", compresslevel=6) as target:
            json.dump(value, target, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def _already_complete(path: Path, sample_fps: float, declared_duration_ms: float) -> bool:
    if not path.is_file():
        return False
    try:
        with gzip.open(path, "rt", encoding="utf-8") as source:
            value = json.load(source)
        minimum_expected_samples = max(1, int(declared_duration_ms * sample_fps / 1000.0 * 0.85))
        return (
            value.get("schemaVersion") == SCHEMA_VERSION
            and value.get("poseSchema") == "halpe26"
            and value.get("inference", {}).get("sampleFps") == sample_fps
            and value.get("inference", {}).get("pose", {}).get("sha256") == POSE_SHA256
            and value.get("inference", {}).get("subjectSelection") == SUBJECT_POLICY_VERSION
            and value.get("summary", {}).get("sampledFrameCount", 0) >= minimum_expected_samples
        )
    except (OSError, ValueError, TypeError):
        return False


def extract_video(task: ExtractionTask) -> dict[str, Any]:
    output_path = Path(task.output_file)
    if not task.force and _already_complete(
        output_path, task.sample_fps, task.declared_duration_ms
    ):
        return {"captureId": task.capture_id, "status": "skipped", "output": task.output_file}

    source_path = Path(task.source_video)
    capture = cv2.VideoCapture(str(source_path))
    if not capture.isOpened():
        raise RuntimeError(f"Unable to open video: {source_path}")
    declared_fps = (
        task.declared_frame_count / task.declared_duration_ms * 1000.0
        if task.declared_duration_ms > 0 and task.declared_frame_count > 0
        else 30.0
    )
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    sample_period_ms = 1000.0 / task.sample_fps
    next_sample_ms = 0.0
    source_frame_index = -1
    last_timestamp_ms = -1.0
    previous_bbox: tuple[float, float, float, float] | None = None
    previous_detection_ms: float | None = None
    frames: list[dict[str, Any]] = []
    pose_score_sum = 0.0
    pose_frame_count = 0
    observed_detection_count = 0
    held_bbox_count = 0

    while True:
        ok, frame = capture.read()
        if not ok:
            break
        source_frame_index += 1
        container_timestamp_ms = float(capture.get(cv2.CAP_PROP_POS_MSEC))
        fallback_timestamp_ms = source_frame_index / declared_fps * 1000.0
        timestamp_ms = (
            container_timestamp_ms
            if math.isfinite(container_timestamp_ms)
            and container_timestamp_ms >= last_timestamp_ms
            and container_timestamp_ms <= task.declared_duration_ms + 2_000.0
            else fallback_timestamp_ms
        )
        last_timestamp_ms = timestamp_ms
        if timestamp_ms + 0.5 < next_sample_ms:
            continue
        while next_sample_ms <= timestamp_ms + 0.5:
            next_sample_ms += sample_period_ms
        raw_boxes = _DETECTOR(frame)
        candidates = [clamp_bbox(box, width, height) for box in raw_boxes]
        selected, reason, selection_score = select_subject_bbox(
            candidates, previous_bbox, width, height
        )
        detector_observed = selected is not None
        if selected is not None:
            previous_bbox = selected
            previous_detection_ms = timestamp_ms
            observed_detection_count += 1
        elif (
            previous_bbox is not None
            and previous_detection_ms is not None
            and timestamp_ms - previous_detection_ms <= MAX_DETECTOR_HOLD_MS
        ):
            selected = previous_bbox
            reason = "detector_gap_pose_hold"
            held_bbox_count += 1
        # Keep the last confirmed identity lock after the short pose-hold
        # window expires. We intentionally emit unknown observations until a
        # compatible detection returns; clearing the lock here would allow a
        # mirror or bystander to become a fresh "initial" subject.

        frame_record: dict[str, Any] = {
            "frameNumber": source_frame_index,
            "timestampMs": round(timestamp_ms, 3),
            "candidateBboxes": [normalized_bbox(box, width, height) for box in candidates],
            "selectedBbox": normalized_bbox(selected, width, height) if selected else None,
            "subjectSelection": {
                "policy": SUBJECT_POLICY_VERSION,
                "reason": reason,
                "score": round(selection_score, 6),
                "detectorObserved": detector_observed,
            },
            "landmarks": [],
            "observationQuality": {
                "meanKeypointScore": 0.0,
                "observedKeypointCount": 0,
                "cocoPrefixObservedCount": 0,
            },
        }
        if selected is not None:
            keypoints, scores = _POSE(frame, bboxes=[selected])
            points = keypoints[0]
            point_scores = scores[0]
            if len(points) != 26 or len(point_scores) != 26:
                raise RuntimeError(
                    f"Expected Halpe-26 output, got {points.shape} and {point_scores.shape}"
                )
            landmarks = []
            for point, score in zip(points, point_scores):
                score_value = max(0.0, min(1.0, float(score)))
                landmarks.append(
                    {
                        "x": round(float(point[0]) / width, 7),
                        "y": round(float(point[1]) / height, 7),
                        "z": None,
                        "visibility": round(score_value, 7),
                    }
                )
            mean_score = float(np.mean(point_scores))
            frame_record["landmarks"] = landmarks
            frame_record["observationQuality"] = {
                "meanKeypointScore": round(mean_score, 6),
                "observedKeypointCount": int(np.sum(point_scores >= 0.3)),
                "cocoPrefixObservedCount": int(np.sum(point_scores[:17] >= 0.3)),
            }
            pose_score_sum += mean_score
            pose_frame_count += 1
        frames.append(frame_record)

    capture.release()
    if not frames:
        raise RuntimeError(f"No frames sampled from video: {source_path}")
    sidecar = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "captureId": task.capture_id,
        "poseSchema": "halpe26",
        "keypointNames": HALPE26_NAMES,
        "coco17PrefixInvariant": list(HALPE26_NAMES[:17]) == list(COCO17_NAMES),
        "coordinateSpace": "image_normalized",
        "missingPointPolicy": "raw score retained; Rust canonical may mark unknown; no cross-person or mirror synthesis",
        "source": {
            "video": task.source_relpath,
            "sha256": sha256_file(source_path),
            "widthPx": width,
            "heightPx": height,
            "framesPerSecond": round(declared_fps, 6),
            "frameCount": task.declared_frame_count,
            "durationMs": task.declared_duration_ms,
        },
        "inference": {
            "pipeline": "yolox-nano-humanart+rtmpose-m-halpe26",
            "sampleFps": task.sample_fps,
            "detectorEverySampledFrame": True,
            "detector": {
                "family": "YOLOX nano",
                "inputSize": [416, 416],
                "source": DETECTOR_URL,
                "sha256": DETECTOR_SHA256,
                "classesUsed": ["person"],
                "equipmentClassesAvailable": [],
            },
            "pose": {
                "family": "RTMPose-m",
                "inputSize": [192, 256],
                "source": POSE_URL,
                "sha256": POSE_SHA256,
                "outputSchema": "halpe26",
            },
            "subjectSelection": SUBJECT_POLICY_VERSION,
            "maximumDetectorHoldMs": MAX_DETECTOR_HOLD_MS,
            "temporalSmoothing": "none_raw_observations_only",
        },
        "summary": {
            "sampledFrameCount": len(frames),
            "decodedFrameCount": source_frame_index + 1,
            "poseFrameCount": pose_frame_count,
            "detectorObservedFrameRatio": round(observed_detection_count / len(frames), 6),
            "heldDetectorGapFrameCount": held_bbox_count,
            "meanPoseScore": round(pose_score_sum / pose_frame_count, 6) if pose_frame_count else 0.0,
        },
        "frames": frames,
    }
    _write_gzip_json(output_path, sidecar)
    return {
        "captureId": task.capture_id,
        "status": "extracted",
        "output": task.output_file,
        **sidecar["summary"],
    }


def discover_model(root: Path, family: str) -> Path:
    models = sorted((root / family).rglob("end2end.onnx"))
    if len(models) != 1:
        raise RuntimeError(f"Expected one {family} end2end.onnx, found {len(models)}")
    return models[0]


def load_tasks(
    project_root: Path,
    dataset_path: Path,
    output_dir: Path,
    sample_fps: float,
    force: bool,
    only_capture: set[str],
    limit: int | None,
) -> list[ExtractionTask]:
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    archive_root = project_root / "public/archives/confirmed-captures"
    unique: dict[str, dict[str, Any]] = {}
    for record in dataset["records"]:
        unique.setdefault(record["sourceCaptureId"], record["source"])
    tasks = []
    for capture_id, source in sorted(unique.items()):
        if only_capture and capture_id not in only_capture:
            continue
        relative_video = source["video"]
        source_video = archive_root / relative_video
        if not source_video.is_file():
            raise FileNotFoundError(source_video)
        tasks.append(
            ExtractionTask(
                capture_id=capture_id,
                source_video=str(source_video),
                source_relpath=str(source_video.relative_to(project_root)),
                output_file=str(output_dir / f"{capture_id}.halpe26.json.gz"),
                declared_duration_ms=float(source["durationMs"]),
                declared_frame_count=int(source["frameCount"]),
                sample_fps=sample_fps,
                force=force,
            )
        )
    return tasks[:limit] if limit is not None else tasks


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset", default="data/training/personal-golden-segmentation-v2.json"
    )
    parser.add_argument(
        "--models", default="data/workflows/pose-stack/runtime/models"
    )
    parser.add_argument(
        "--output",
        default="data/workflows/action-trajectory-database/halpe26-v1/personal-observations",
    )
    parser.add_argument("--sample-fps", type=float, default=10.0)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--only-capture", action="append", default=[])
    parser.add_argument("--limit", type=int)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_root = Path.cwd().resolve()
    dataset_path = (project_root / args.dataset).resolve()
    models_root = (project_root / args.models).resolve()
    output_dir = (project_root / args.output).resolve()
    detector_path = discover_model(models_root, "yolox-nano-humanart")
    pose_path = discover_model(models_root, "rtmpose-m-halpe26")
    if sha256_file(detector_path) != DETECTOR_SHA256:
        raise RuntimeError("YOLOX model checksum mismatch")
    if sha256_file(pose_path) != POSE_SHA256:
        raise RuntimeError("RTMPose Halpe-26 model checksum mismatch")
    tasks = load_tasks(
        project_root,
        dataset_path,
        output_dir,
        args.sample_fps,
        args.force,
        set(args.only_capture),
        args.limit,
    )
    if not tasks:
        print(json.dumps({"status": "no_tasks"}))
        return 0
    results = []
    with ProcessPoolExecutor(
        max_workers=max(1, args.workers),
        initializer=_initialize_worker,
        initargs=(str(detector_path), str(pose_path)),
    ) as executor:
        future_to_task = {executor.submit(extract_video, task): task for task in tasks}
        for completed, future in enumerate(as_completed(future_to_task), start=1):
            result = future.result()
            results.append(result)
            print(json.dumps({"progress": f"{completed}/{len(tasks)}", **result}, ensure_ascii=False), flush=True)
    summary_path = output_dir / "extraction-summary.json"
    summary = {
        "schemaVersion": "maxpower-personal-halpe26-extraction-summary/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dataset": str(dataset_path.relative_to(project_root)),
        "sourceCount": len(tasks),
        "extractedCount": sum(result["status"] == "extracted" for result in results),
        "skippedCount": sum(result["status"] == "skipped" for result in results),
        "results": sorted(results, key=lambda result: result["captureId"]),
    }
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"summary": str(summary_path), "sourceCount": len(tasks)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
