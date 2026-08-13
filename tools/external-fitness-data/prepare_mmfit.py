#!/usr/bin/env python3
"""Convert MM-Fit COCO-18 set clips into research-only BlazePose33 JSON.gz.

Only exact shared joints are mapped. The derived COCO neck point and every
missing BlazePose joint remain visibility=0; no coordinates are fabricated.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
from pathlib import Path

import numpy as np


COCO18_TO_BLAZEPOSE33 = {
    0: 0, 14: 5, 15: 2, 16: 8, 17: 7,
    2: 12, 3: 14, 4: 16, 5: 11, 6: 13, 7: 15,
    8: 24, 9: 26, 10: 28, 11: 23, 12: 25, 13: 27,
}

ACTION_MAP = {
    "squats": "bodyweight_squat",
    "lunges": "alternating_lunge",
    "bicep_curls": "alternating_dumbbell_biceps_curl",
    "situps": "sit_up",
    "pushups": "push_up",
    "tricep_extensions": "overhead_triceps_extension",
    "dumbbell_rows": "standing_dumbbell_row",
    "jumping_jacks": "jumping_jack",
    "dumbbell_shoulder_press": "dumbbell_shoulder_press",
    "lateral_shoulder_raises": "lateral_raise",
}

SPLITS = {
    **{item: "train" for item in ("01", "02", "03", "04", "06", "07", "08", "16", "17", "18")},
    **{item: "validation" for item in ("14", "15", "19")},
    **{item: "test" for item in ("09", "10", "11")},
    **{item: "unseen_test" for item in ("00", "05", "12", "13", "20")},
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--width", type=float, default=1280.0)
    parser.add_argument("--height", type=float, default=720.0)
    parser.add_argument("--fps", type=float, default=30.0)
    parser.add_argument("--context-frames", type=int, default=30)
    args = parser.parse_args()
    if args.width <= 0 or args.height <= 0 or args.fps <= 0:
        raise SystemExit("width, height and fps must be positive")

    source_root = locate_workout_root(args.input)
    clips_root = args.output / "clips"
    clips_root.mkdir(parents=True, exist_ok=True)
    manifest = []

    for pose_path in sorted(source_root.glob("w*/w*_pose_2d.npy")):
        workout_id = pose_path.stem.removesuffix("_pose_2d")
        subject_id = workout_id.removeprefix("w")
        labels_path = pose_path.with_name(f"{workout_id}_labels.csv")
        if not labels_path.exists():
            raise FileNotFoundError(labels_path)
        pose = np.load(pose_path, mmap_mode="r")
        if pose.ndim != 3 or pose.shape[0] != 2 or pose.shape[2] != 19:
            raise ValueError(f"unexpected MM-Fit pose shape {pose.shape}: {pose_path}")
        frame_numbers = pose[0, :, 0].astype(np.int64)
        for label_index, row in enumerate(read_labels(labels_path), start=1):
            start, end, count, source_action = row
            exercise_id = ACTION_MAP.get(source_action)
            if exercise_id is None:
                continue
            left = int(np.searchsorted(frame_numbers, start - args.context_frames, side="left"))
            right = int(np.searchsorted(frame_numbers, end + args.context_frames, side="right"))
            output_name = f"{workout_id}-{label_index:03d}-{source_action}.json.gz"
            output_path = clips_root / output_name
            payload = {
                "schemaVersion": "maxpower-external-fitness-clip/v1",
                "datasetId": "mm-fit",
                "sourceSequenceId": f"{workout_id}:{label_index}",
                "subjectId": subject_id,
                "split": SPLITS.get(subject_id, "unknown"),
                "sourceAction": source_action,
                "exerciseId": exercise_id,
                "cameraView": "unknown",
                "intendedUse": ["offline_research", "benchmarking"],
                "forbiddenUse": ["production_profile_promotion", "form_reference"],
                "source": {
                    "topology": "coco18",
                    "sourceConfidenceAvailable": False,
                    "coordinateResolution": [args.width, args.height],
                    "framesPerSecond": args.fps,
                },
                "label": {
                    "startFrame": start,
                    "endFrame": end,
                    "totalRepetitions": count,
                    "annotationGranularity": "set_count",
                    "repBounds": [],
                },
                "frames": [
                    map_frame(pose[:, index, 1:], int(frame_numbers[index]), args.width, args.height, args.fps)
                    for index in range(left, right)
                ],
            }
            with gzip.open(output_path, "wt", encoding="utf-8", compresslevel=6) as stream:
                json.dump(payload, stream, separators=(",", ":"), allow_nan=False)
            manifest.append({
                "clipFile": str(output_path.relative_to(args.output)),
                "sourceSequenceId": payload["sourceSequenceId"],
                "subjectId": subject_id,
                "split": payload["split"],
                "sourceAction": source_action,
                "exerciseId": exercise_id,
                "expectedCount": count,
                "frameCount": right - left,
            })

    manifest_payload = {
        "schemaVersion": "maxpower-external-fitness-manifest/v1",
        "datasetId": "mm-fit",
        "policy": {
            "intendedUse": ["offline_research", "benchmarking"],
            "forbiddenUse": ["production_profile_promotion", "form_reference"],
            "cameraView": "unknown",
            "annotationGranularity": "set_count",
        },
        "coordinateAssumptions": {
            "width": args.width,
            "height": args.height,
            "fps": args.fps,
            "basis": "MM-Fit frame indices and observed 2D coordinate extent; override explicitly if source metadata differs",
        },
        "clips": manifest,
    }
    (args.output / "manifest.json").write_text(
        json.dumps(manifest_payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(args.output), "clipCount": len(manifest)}, ensure_ascii=False))


def locate_workout_root(root: Path) -> Path:
    candidates = [root, root / "mm-fit"]
    for candidate in candidates:
        if next(candidate.glob("w*/w*_pose_2d.npy"), None):
            return candidate
    raise FileNotFoundError(f"no MM-Fit workout folders below {root}")


def read_labels(path: Path):
    with path.open(newline="", encoding="utf-8") as stream:
        for row in csv.reader(stream):
            if len(row) != 4:
                raise ValueError(f"unexpected label row in {path}: {row}")
            yield int(row[0]), int(row[1]), int(row[2]), row[3]


def map_frame(source: np.ndarray, frame_number: int, width: float, height: float, fps: float):
    landmarks = [{"x": 0.0, "y": 0.0, "z": 0.0, "visibility": 0.0} for _ in range(33)]
    for source_index, target_index in COCO18_TO_BLAZEPOSE33.items():
        x = float(source[0, source_index])
        y = float(source[1, source_index])
        if not np.isfinite(x) or not np.isfinite(y) or (x == 0 and y == 0):
            continue
        landmarks[target_index] = {"x": x / width, "y": y / height, "z": 0.0, "visibility": 1.0}
    return {
        "frameNumber": frame_number,
        "timestampMs": frame_number * 1000.0 / fps,
        "landmarks": landmarks,
    }


if __name__ == "__main__":
    main()
