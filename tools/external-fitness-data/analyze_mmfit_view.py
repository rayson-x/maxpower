#!/usr/bin/env python3
"""Estimate a body-orientation proxy from MM-Fit 2D/3D shoulder and hip axes.

The published pose files do not carry recoverable camera identity/extrinsics.
This output must never be interpreted as a MaxPower physical capture position.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = locate_root(args.input)
    clips = []

    for directory in sorted(root.glob("w*")):
        workout_id = directory.name
        pose_2d = np.load(directory / f"{workout_id}_pose_2d.npy", mmap_mode="r")
        pose_3d = np.load(directory / f"{workout_id}_pose_3d.npy", mmap_mode="r")
        frame_numbers = pose_2d[0, :, 0].astype(np.int64)
        labels = read_labels(directory / f"{workout_id}_labels.csv")
        for label_index, (start, end, count, action) in enumerate(labels, start=1):
            left = int(np.searchsorted(frame_numbers, start, side="left"))
            right = int(np.searchsorted(frame_numbers, end, side="right"))
            yaw = body_axis_yaw(pose_3d[:, left:right, 1:])
            ratio = shoulder_width_to_torso(pose_2d[:, left:right, 1:])
            median_yaw = finite_percentile(yaw, 50)
            yaw_iqr = finite_percentile(yaw, 75) - finite_percentile(yaw, 25)
            yaw_p90 = finite_percentile(yaw, 90)
            median_ratio = finite_percentile(ratio, 50)
            orientation, confidence = classify(median_yaw, yaw_iqr, yaw_p90, median_ratio)
            clips.append({
                "sourceSequenceId": f"{workout_id}:{label_index}",
                "workoutId": workout_id,
                "sourceAction": action,
                "expectedCount": count,
                "bodyOrientationProxy": orientation,
                "confidence": confidence,
                "shoulderHipAxisYawMedianDeg": round(median_yaw, 4),
                "shoulderHipAxisYawIqrDeg": round(yaw_iqr, 4),
                "shoulderHipAxisYawP90Deg": round(yaw_p90, 4),
                "shoulderWidthToTorsoMedian": round(median_ratio, 4),
            })

    by_action = defaultdict(list)
    by_workout = defaultdict(list)
    for clip in clips:
        by_action[clip["sourceAction"]].append(clip)
        by_workout[clip["workoutId"]].append(clip)
    payload = {
        "schemaVersion": "maxpower-external-body-orientation-analysis/v2",
        "datasetId": "mm-fit",
        "method": {
            "yaw": "median absolute x-z angle of H36M left-right shoulder and hip axes",
            "twoDimensionalCheck": "COCO-18 shoulder width divided by shoulder-midpoint to hip-midpoint length",
            "classes": {"front": "yaw<=15", "oblique45": "15<yaw<60", "side": "yaw>=60"},
            "physicalCameraPosition": "unknown; the proxy is not camera ID, yaw, or MaxPower capturePosition",
            "refusal": "unknown when axes are unstable or 2D shoulder spread conflicts with yaw",
        },
        "summary": summarize(clips),
        "byAction": {key: summarize(value) for key, value in sorted(by_action.items())},
        "byWorkout": {key: summarize(value) for key, value in sorted(by_workout.items())},
        "clips": clips,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "summary": payload["summary"]}, ensure_ascii=False))


def locate_root(root: Path) -> Path:
    for candidate in (root, root / "mm-fit"):
        if next(candidate.glob("w*/w*_pose_2d.npy"), None):
            return candidate
    raise FileNotFoundError(root)


def read_labels(path: Path):
    with path.open(newline="", encoding="utf-8") as stream:
        return [(int(a), int(b), int(count), action) for a, b, count, action in csv.reader(stream)]


def body_axis_yaw(pose_3d: np.ndarray) -> np.ndarray:
    # H36M-17: hips L/R=1/4, shoulders R/L=11/14.
    shoulder_dx = pose_3d[0, :, 11] - pose_3d[0, :, 14]
    shoulder_dz = pose_3d[2, :, 11] - pose_3d[2, :, 14]
    hip_dx = pose_3d[0, :, 1] - pose_3d[0, :, 4]
    hip_dz = pose_3d[2, :, 1] - pose_3d[2, :, 4]
    shoulder = np.degrees(np.arctan2(np.abs(shoulder_dz), np.abs(shoulder_dx) + 1e-9))
    hip = np.degrees(np.arctan2(np.abs(hip_dz), np.abs(hip_dx) + 1e-9))
    return np.nanmedian(np.stack([shoulder, hip]), axis=0)


def shoulder_width_to_torso(pose_2d: np.ndarray) -> np.ndarray:
    # COCO-18: shoulders R/L=2/5, hips R/L=8/11.
    shoulder_width = np.hypot(
        pose_2d[0, :, 2] - pose_2d[0, :, 5],
        pose_2d[1, :, 2] - pose_2d[1, :, 5],
    )
    shoulder_mid_x = (pose_2d[0, :, 2] + pose_2d[0, :, 5]) / 2
    shoulder_mid_y = (pose_2d[1, :, 2] + pose_2d[1, :, 5]) / 2
    hip_mid_x = (pose_2d[0, :, 8] + pose_2d[0, :, 11]) / 2
    hip_mid_y = (pose_2d[1, :, 8] + pose_2d[1, :, 11]) / 2
    torso = np.hypot(shoulder_mid_x - hip_mid_x, shoulder_mid_y - hip_mid_y)
    return shoulder_width / (torso + 1e-9)


def classify(yaw: float, iqr: float, p90: float, ratio: float):
    if not all(np.isfinite(value) for value in (yaw, iqr, p90, ratio)) or iqr > 35:
        return "unknown", "low"
    if yaw <= 15 and p90 <= 30 and ratio >= 0.35:
        return "front", "high"
    if 15 < yaw < 60:
        return "oblique45", "medium"
    if yaw >= 60 and ratio < 0.45:
        return "side", "medium"
    return "unknown", "low"


def summarize(clips):
    orientations = defaultdict(int)
    for clip in clips:
        orientations[clip["bodyOrientationProxy"]] += 1
    return {
        "clipCount": len(clips),
        "orientationCounts": dict(sorted(orientations.items())),
        "medianYawDeg": round(float(np.median([clip["shoulderHipAxisYawMedianDeg"] for clip in clips])), 4),
        "medianShoulderWidthToTorso": round(float(np.median([clip["shoulderWidthToTorsoMedian"] for clip in clips])), 4),
    }


def finite_percentile(values: np.ndarray, percentile: float) -> float:
    finite = values[np.isfinite(values)]
    return float(np.percentile(finite, percentile)) if finite.size else float("nan")


if __name__ == "__main__":
    main()
