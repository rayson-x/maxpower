#!/usr/bin/env python3
"""Audit whether Halpe-26 observations can support the reviewed rep timeline.

This is an observation/alignment audit, not a rep-recognition score.  It asks
whether the selected subject and the minimum kinematic chains needed by the
temporal recognizer are present around every human start/peak/end boundary.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


# Rust's Halpe Adapter admits RTMPose SimCC responses on their own model scale;
# they must not inherit MediaPipe's 0.5 visibility threshold.
SCORE_THRESHOLD = 0.12
BOUNDARY_TOLERANCE_MS = 250.0
MIN_INTERVAL_READY_RATIO = 0.70

TORSO = (5, 6, 11, 12)
LEFT_ARM = (5, 7, 9)
RIGHT_ARM = (6, 8, 10)
BILATERAL_EXERCISES = {
    "barbell_bench_press",
    "barbell_row",
    "lat_pulldown",
    "lateral_raise",
    "machine_chest_press",
    "pull_up",
    "push_up",
    "rear_delt_fly",
    "seated_row",
    "seated_shoulder_press",
    "straight_arm_pulldown",
}


def load_json(path: Path) -> Any:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as source:
            return json.load(source)
    return json.loads(path.read_text(encoding="utf-8"))


def finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(float(value))


def group_ready(landmarks: list[dict[str, Any]], indices: Iterable[int]) -> bool:
    if len(landmarks) != 26:
        return False
    return all(
        finite(landmarks[index].get("x"))
        and finite(landmarks[index].get("y"))
        and float(landmarks[index].get("visibility", 0.0)) >= SCORE_THRESHOLD
        for index in indices
    )


def frame_readiness(frame: dict[str, Any]) -> dict[str, bool]:
    landmarks = frame.get("landmarks") or []
    torso = group_ready(landmarks, TORSO)
    left_arm = group_ready(landmarks, LEFT_ARM)
    right_arm = group_ready(landmarks, RIGHT_ARM)
    return {
        "pose": len(landmarks) == 26,
        "torso": torso,
        "leftArm": left_arm,
        "rightArm": right_arm,
        "movementTask": torso and (left_arm or right_arm),
        "bilateral": torso and left_arm and right_arm,
    }


def nearest_boundary(
    frames: list[dict[str, Any]], boundary_ms: float, readiness_key: str
) -> dict[str, Any]:
    if not frames:
        return {"sampleErrorMs": None, "readyErrorMs": None, "readyWithinTolerance": False}
    sample_error = min(abs(float(frame["timestampMs"]) - boundary_ms) for frame in frames)
    ready_errors = [
        abs(float(frame["timestampMs"]) - boundary_ms)
        for frame in frames
        if frame["readiness"][readiness_key]
    ]
    ready_error = min(ready_errors) if ready_errors else None
    return {
        "sampleErrorMs": round(sample_error, 3),
        "readyErrorMs": round(ready_error, 3) if ready_error is not None else None,
        "readyWithinTolerance": ready_error is not None and ready_error <= BOUNDARY_TOLERANCE_MS,
    }


def ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 6) if denominator else 0.0


def audit_record(record: dict[str, Any], sidecar: dict[str, Any]) -> dict[str, Any]:
    annotated_frames = [
        {**frame, "readiness": frame_readiness(frame)} for frame in sidecar["frames"]
    ]
    window = record.get("evaluationWindow")
    if window:
        annotated_frames = [
            frame
            for frame in annotated_frames
            if float(window["startMs"]) <= float(frame["timestampMs"]) <= float(window["endMs"])
        ]

    readiness_key = (
        "bilateral" if record["exerciseId"] in BILATERAL_EXERCISES else "movementTask"
    )
    rep_rows = []
    for segment in record.get("segments") or []:
        start_ms = float(segment["startMs"])
        end_ms = float(segment["endMs"])
        interval = [
            frame
            for frame in annotated_frames
            if start_ms <= float(frame["timestampMs"]) <= end_ms
        ]
        movement_ready = sum(frame["readiness"]["movementTask"] for frame in interval)
        assessment_ready = sum(frame["readiness"][readiness_key] for frame in interval)
        boundaries = {
            name: nearest_boundary(annotated_frames, float(segment[key]), readiness_key)
            for name, key in (("start", "startMs"), ("peak", "peakMs"), ("end", "endMs"))
        }
        interval_ready_ratio = ratio(assessment_ready, len(interval))
        trackable = (
            bool(interval)
            and interval_ready_ratio >= MIN_INTERVAL_READY_RATIO
            and all(item["readyWithinTolerance"] for item in boundaries.values())
        )
        rep_rows.append(
            {
                "repIndex": segment["repIndex"],
                "startMs": start_ms,
                "peakMs": float(segment["peakMs"]),
                "endMs": end_ms,
                "sampleCount": len(interval),
                "poseFrameRatio": ratio(sum(frame["readiness"]["pose"] for frame in interval), len(interval)),
                "movementTaskReadyRatio": ratio(movement_ready, len(interval)),
                "assessmentReadyRatio": interval_ready_ratio,
                "boundaries": boundaries,
                "trackableFromObservations": trackable,
            }
        )

    return {
        "captureId": record["captureId"],
        "sourceCaptureId": record["sourceCaptureId"],
        "exerciseId": record["exerciseId"],
        "capturePosition": record["capturePosition"],
        "readinessRequirement": readiness_key,
        "expectedCount": record["expectedCount"],
        "humanBoundaryCount": len(record.get("segments") or []),
        "sampledFrameCount": len(annotated_frames),
        "poseFrameRatio": ratio(sum(frame["readiness"]["pose"] for frame in annotated_frames), len(annotated_frames)),
        "movementTaskReadyRatio": ratio(
            sum(frame["readiness"]["movementTask"] for frame in annotated_frames),
            len(annotated_frames),
        ),
        "bilateralReadyRatio": ratio(
            sum(frame["readiness"]["bilateral"] for frame in annotated_frames),
            len(annotated_frames),
        ),
        "trackableRepCount": sum(row["trackableFromObservations"] for row in rep_rows),
        "reps": rep_rows,
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    reps = [rep for row in rows for rep in row["reps"]]
    boundary_rows = [boundary for rep in reps for boundary in rep["boundaries"].values()]
    exercise_counts: dict[str, Counter[str]] = defaultdict(Counter)
    for row in rows:
        exercise_counts[row["exerciseId"]]["reps"] += row["humanBoundaryCount"]
        exercise_counts[row["exerciseId"]]["trackable"] += row["trackableRepCount"]
    sample_errors = [float(item["sampleErrorMs"]) for item in boundary_rows if item["sampleErrorMs"] is not None]
    ready_errors = [float(item["readyErrorMs"]) for item in boundary_rows if item["readyErrorMs"] is not None]
    return {
        "recordCount": len(rows),
        "sourceCaptureCount": len({row["sourceCaptureId"] for row in rows}),
        "expectedRepCount": sum(row["expectedCount"] for row in rows),
        "humanBoundaryRepCount": len(reps),
        "trackableRepCount": sum(rep["trackableFromObservations"] for rep in reps),
        "trackableRepRatio": ratio(sum(rep["trackableFromObservations"] for rep in reps), len(reps)),
        "boundaryCount": len(boundary_rows),
        "boundaryReadyWithin250msCount": sum(item["readyWithinTolerance"] for item in boundary_rows),
        "boundaryReadyWithin250msRatio": ratio(
            sum(item["readyWithinTolerance"] for item in boundary_rows), len(boundary_rows)
        ),
        "meanNearestSampleErrorMs": round(sum(sample_errors) / len(sample_errors), 3) if sample_errors else None,
        "maxNearestSampleErrorMs": round(max(sample_errors), 3) if sample_errors else None,
        "meanNearestReadyErrorMs": round(sum(ready_errors) / len(ready_errors), 3) if ready_errors else None,
        "byExercise": {
            exercise: {
                "humanBoundaryRepCount": counts["reps"],
                "trackableRepCount": counts["trackable"],
                "trackableRepRatio": ratio(counts["trackable"], counts["reps"]),
            }
            for exercise, counts in sorted(exercise_counts.items())
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset", default="data/training/personal-golden-segmentation-v2.json"
    )
    parser.add_argument(
        "--sidecars",
        default="data/workflows/action-trajectory-database/halpe26-v1/personal-observations",
    )
    parser.add_argument(
        "--output",
        default="data/workflows/action-trajectory-database/halpe26-v1/diagnostics/personal-halpe26-observation-alignment.json",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_root = Path.cwd().resolve()
    dataset = load_json(project_root / args.dataset)
    sidecar_dir = project_root / args.sidecars
    sidecars: dict[str, dict[str, Any]] = {}
    rows = []
    for record in dataset["records"]:
        source_id = record["sourceCaptureId"]
        if source_id not in sidecars:
            sidecars[source_id] = load_json(sidecar_dir / f"{source_id}.halpe26.json.gz")
        rows.append(audit_record(record, sidecars[source_id]))
    artifact = {
        "schemaVersion": "maxpower-personal-halpe26-observation-alignment/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "evaluationMode": "human-timeline-observation-readiness-not-recognition-accuracy",
        "thresholds": {
            "rawRtmposeSimccScore": SCORE_THRESHOLD,
            "boundaryToleranceMs": BOUNDARY_TOLERANCE_MS,
            "minimumIntervalReadyRatio": MIN_INTERVAL_READY_RATIO,
        },
        "summary": summarize(rows),
        "rows": rows,
        "limitations": [
            "Pose observations are not manually keyed landmark ground truth.",
            "Trackable means sufficient visible evidence exists near the reviewed timeline; it does not mean the temporal recognizer predicted the rep.",
            "Bilateral readiness is deliberately stricter than movement-task readiness.",
        ],
    }
    output_path = project_root / args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(artifact["summary"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
