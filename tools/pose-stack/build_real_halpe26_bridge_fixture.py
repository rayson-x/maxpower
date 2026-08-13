#!/usr/bin/env python3
"""Freeze a real YOLOX-box + RTMPose Halpe-26 sequence for bridge parity.

The input sidecar contributes detector boxes and exact source frame numbers.
RTMPose is rerun on every detected person box so the fixture contains genuine
multi-candidate observations. No point is copied between candidates, predicted,
or synthesized. Candidate IDs use the same frame-to-frame IoU rule as the Web,
Android, and iOS observation adapters.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import cv2
import numpy as np


SCHEMA_VERSION = "maxpower-real-halpe26-multi-candidate-fixture/v1"
CANDIDATE_ID_IOU = 0.2
TORSO_INDICES = (5, 6, 11, 12)


@dataclass(frozen=True)
class TrackedBox:
    candidate_id: int
    bbox: tuple[float, float, float, float]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def bbox_iou(left: Sequence[float], right: Sequence[float]) -> float:
    x1 = max(float(left[0]), float(right[0]))
    y1 = max(float(left[1]), float(right[1]))
    x2 = min(float(left[2]), float(right[2]))
    y2 = min(float(left[3]), float(right[3]))
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    left_area = max(0.0, float(left[2]) - float(left[0])) * max(
        0.0, float(left[3]) - float(left[1])
    )
    right_area = max(0.0, float(right[2]) - float(right[0])) * max(
        0.0, float(right[3]) - float(right[1])
    )
    union = left_area + right_area - intersection
    return intersection / union if union > 0 else 0.0


def assign_candidate_ids(
    boxes: Sequence[tuple[float, float, float, float]],
    previous: Sequence[TrackedBox],
    next_id: int,
) -> tuple[list[TrackedBox], int]:
    remaining = set(range(len(previous)))
    tracked: list[TrackedBox] = []
    for box in boxes:
        best_index = -1
        best_overlap = 0.0
        for index in remaining:
            overlap = bbox_iou(box, previous[index].bbox)
            if overlap > best_overlap:
                best_index = index
                best_overlap = overlap
        if best_index >= 0 and best_overlap >= CANDIDATE_ID_IOU:
            remaining.remove(best_index)
            candidate_id = previous[best_index].candidate_id
        else:
            candidate_id = next_id
            next_id += 1
        tracked.append(TrackedBox(candidate_id, box))
    return tracked, next_id


def sample_torso_color(
    frame_bgr: np.ndarray,
    landmarks: Sequence[Sequence[float]],
) -> list[float]:
    if len(landmarks) != 26 or any(landmarks[index][3] < 0.2 for index in TORSO_INDICES):
        return [0.0, 0.0, 0.0]
    height, width = frame_bgr.shape[:2]
    xs = [float(landmarks[index][0]) * width for index in TORSO_INDICES]
    ys = [float(landmarks[index][1]) * height for index in TORSO_INDICES]
    x1 = max(0, min(width - 1, math.floor(min(xs))))
    x2 = max(x1 + 1, min(width, math.ceil(max(xs))))
    y1 = max(0, min(height - 1, math.floor(min(ys))))
    y2 = max(y1 + 1, min(height, math.ceil(max(ys))))
    area = (x2 - x1) * (y2 - y1)
    stride = max(1, int(math.sqrt(area / 4096.0)))
    pixels = frame_bgr[y1:y2:stride, x1:x2:stride]
    if pixels.size == 0:
        return [0.0, 0.0, 0.0]
    bgr = pixels.reshape(-1, 3).mean(axis=0)
    return [round(float(bgr[2]) / 255.0, 7), round(float(bgr[1]) / 255.0, 7), round(float(bgr[0]) / 255.0, 7)]


def _xyxy_from_normalized(box: dict[str, float], width: int, height: int) -> tuple[float, float, float, float]:
    x1 = float(box["x"]) * width
    y1 = float(box["y"]) * height
    return (
        x1,
        y1,
        x1 + float(box["width"]) * width,
        y1 + float(box["height"]) * height,
    )


def _normalized_xywh(box: Sequence[float], width: int, height: int) -> list[float]:
    return [
        round(float(box[0]) / width, 7),
        round(float(box[1]) / height, 7),
        round(float(box[2] - box[0]) / width, 7),
        round(float(box[3] - box[1]) / height, 7),
    ]


def _load_sidecar(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as source:
        return json.load(source)


def _read_exact_frame(capture: cv2.VideoCapture, frame_number: int) -> np.ndarray:
    capture.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
    ok, frame = capture.read()
    if not ok:
        raise RuntimeError(f"Unable to decode source frame {frame_number}")
    decoded = int(capture.get(cv2.CAP_PROP_POS_FRAMES)) - 1
    if decoded != frame_number:
        raise RuntimeError(f"Requested frame {frame_number}, decoder returned {decoded}")
    return frame


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    os.close(descriptor)
    try:
        with open(temp_name, "w", encoding="utf-8") as target:
            json.dump(value, target, ensure_ascii=False, indent=2, allow_nan=False)
            target.write("\n")
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def build_fixture(args: argparse.Namespace) -> dict[str, Any]:
    sidecar = _load_sidecar(args.sidecar)
    source_video = args.repo_root / sidecar["source"]["video"]
    selected_frames = [
        frame
        for frame in sidecar["frames"]
        if args.start_ms <= float(frame["timestampMs"]) <= args.end_ms
    ]
    if len(selected_frames) < 2:
        raise ValueError("The requested interval must contain at least two sampled frames")
    if not any(len(frame.get("candidateBboxes", [])) >= 2 for frame in selected_frames):
        raise ValueError("The requested interval has no multi-candidate frame")

    from rtmlib import RTMPose

    pose = RTMPose(
        str(args.pose_model),
        model_input_size=(192, 256),
        backend="onnxruntime",
        device="cpu",
    )
    capture = cv2.VideoCapture(str(source_video))
    if not capture.isOpened():
        raise RuntimeError(f"Unable to open source video: {source_video}")
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    previous: list[TrackedBox] = []
    next_id = 0
    fixture_frames: list[dict[str, Any]] = []
    try:
        for frame_record in selected_frames:
            frame = _read_exact_frame(capture, int(frame_record["frameNumber"]))
            boxes = [
                _xyxy_from_normalized(box, width, height)
                for box in frame_record.get("candidateBboxes", [])
            ]
            boxes.sort(key=lambda box: (box[2] - box[0]) * (box[3] - box[1]), reverse=True)
            previous, next_id = assign_candidate_ids(boxes, previous, next_id)
            candidates: list[dict[str, Any]] = []
            if previous:
                keypoints, scores = pose(frame, bboxes=[item.bbox for item in previous])
                if len(keypoints) != len(previous) or len(scores) != len(previous):
                    raise RuntimeError("RTMPose candidate batch cardinality mismatch")
                for tracked, points, point_scores in zip(previous, keypoints, scores):
                    if len(points) != 26 or len(point_scores) != 26:
                        raise RuntimeError("Expected RTMPose Halpe-26 output")
                    landmarks = [
                        [
                            round(float(point[0]) / width, 7),
                            round(float(point[1]) / height, 7),
                            0.0,
                            round(max(0.0, min(1.0, float(score))), 7),
                        ]
                        for point, score in zip(points, point_scores)
                    ]
                    candidates.append(
                        {
                            "candidateId": tracked.candidate_id,
                            "bbox": _normalized_xywh(tracked.bbox, width, height),
                            "torsoColor": sample_torso_color(frame, landmarks),
                            "landmarks": landmarks,
                        }
                    )
            fixture_frames.append(
                {
                    "sourceFrameNumber": int(frame_record["frameNumber"]),
                    "timestampMs": int(round(float(frame_record["timestampMs"]))),
                    "candidates": candidates,
                }
            )
    finally:
        capture.release()

    return {
        "schemaVersion": SCHEMA_VERSION,
        "status": "research_fixture_not_promoted",
        "purpose": "byte-exact Web/Android/iOS Rust bridge replay on real mirror-gym observations",
        "source": {
            "captureId": sidecar["captureId"],
            "video": sidecar["source"]["video"],
            "videoSha256": sha256_file(source_video),
            "sidecar": str(args.sidecar.relative_to(args.repo_root)),
            "sidecarSha256": sha256_file(args.sidecar),
            "widthPx": width,
            "heightPx": height,
            "startMs": args.start_ms,
            "endMs": args.end_ms,
            "scene": "front barbell bench press with wall mirror and gym bystanders",
        },
        "observation": {
            "detector": "YOLOX-nano HumanArt boxes retained from raw sidecar",
            "detectorModelSha256": sidecar["inference"]["detector"]["sha256"],
            "pose": "RTMPose-m Halpe-26 rerun independently on every candidate box",
            "poseModel": str(args.pose_model.relative_to(args.repo_root)),
            "poseModelSha256": sha256_file(args.pose_model),
            "candidateIdPolicy": "frame IoU >= 0.2; identical to Web/Android/iOS adapters",
            "missingPointPolicy": "no synthesis, no candidate mixing, raw finite RTMPose points only",
        },
        "bridgeConfig": {
            "sequenceId": "mobile-native",
            "fusionCode": 1,
            "poseSchema": "halpe26",
            "poseSchemaCode": 1,
            "profileCode": 0,
            "active": False,
        },
        "frames": fixture_frames,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--sidecar", type=Path, required=True)
    parser.add_argument("--pose-model", type=Path, required=True)
    parser.add_argument("--start-ms", type=int, default=20_500)
    parser.add_argument("--end-ms", type=int, default=21_800)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.repo_root = args.repo_root.resolve()
    args.sidecar = args.sidecar.resolve()
    args.pose_model = args.pose_model.resolve()
    args.output = args.output.resolve()
    return args


def main() -> None:
    args = parse_args()
    fixture = build_fixture(args)
    _write_json(args.output, fixture)
    print(json.dumps({
        "output": str(args.output),
        "frames": len(fixture["frames"]),
        "multiCandidateFrames": sum(len(frame["candidates"]) >= 2 for frame in fixture["frames"]),
        "maximumCandidateCount": max(len(frame["candidates"]) for frame in fixture["frames"]),
        "sha256": sha256_file(args.output),
    }, indent=2))


if __name__ == "__main__":
    main()
