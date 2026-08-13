#!/usr/bin/env python3
"""Build a frozen human-keypoint review queue for front/mirror bench press.

The queue is an evaluation asset, not training truth. RTMPose and Rust points are
retained only as `humanTruth: false` proposals. Images are split consistently
with the existing personal equipment challenge and every selected source is
kept in the frozen test split.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import subprocess
from pathlib import Path
from typing import Any, Iterable


SCHEMA = "maxpower-personal-pose-keypoint-review-queue/v1"
REQUIRED_JOINTS = (
    (5, "left_shoulder"),
    (6, "right_shoulder"),
    (7, "left_elbow"),
    (8, "right_elbow"),
    (9, "left_wrist"),
    (10, "right_wrist"),
    (11, "left_hip"),
    (12, "right_hip"),
)
TARGET_SOURCE_IDS = (
    "a51c8a692c2a5a5b40cda482065cc6d5",
    "b8af1ab860d6bbb43cd3f2cadc71506c",
    "bc29e11c23f97a4b1ccaf321ba1e9db7",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def nearest_frame(frames: list[dict[str, Any]], timestamp_ms: float) -> dict[str, Any]:
    return min(frames, key=lambda frame: (abs(float(frame["timestampMs"]) - timestamp_ms), int(frame["frameNumber"])))


def phase_for_timestamp(segments: list[dict[str, Any]], timestamp_ms: float) -> dict[str, Any] | None:
    for segment in segments:
        if float(segment["startMs"]) <= timestamp_ms <= float(segment["endMs"]):
            anchors = {name: float(segment[f"{name}Ms"]) for name in ("start", "peak", "end")}
            phase = min(anchors, key=lambda name: abs(anchors[name] - timestamp_ms))
            return {"repIndex": int(segment["repIndex"]), "phase": phase}
    return None


def required_joint_score(frame: dict[str, Any]) -> float:
    scores = []
    landmarks = frame["landmarks"]
    for index, _ in REQUIRED_JOINTS:
        landmark = landmarks[index]
        value = landmark.get("visibility")
        scores.append(float(value) if isinstance(value, (int, float)) and math.isfinite(value) else 0.0)
    return min(scores)


def select_review_frames(
    frames: list[dict[str, Any]],
    segments: list[dict[str, Any]],
    target_count: int,
) -> list[dict[str, Any]]:
    """Deterministically stratify phase anchors, hard frames and clean context."""
    if target_count < 1 or len(frames) < target_count:
        raise ValueError("target frame count exceeds available observations")
    selected: dict[int, dict[str, Any]] = {}

    def add(frame: dict[str, Any], reason: str) -> None:
        number = int(frame["frameNumber"])
        if number not in selected and len(selected) < target_count:
            context = phase_for_timestamp(segments, float(frame["timestampMs"]))
            selected[number] = {"frame": frame, "selectionReason": reason, "phaseContext": context}

    # Preserve every labelled start/peak/end anchor first.
    for segment in segments:
        for phase in ("start", "peak", "end"):
            add(nearest_frame(frames, float(segment[f"{phase}Ms"])), f"human_phase_{phase}")

    in_rep = [
        frame for frame in frames
        if phase_for_timestamp(segments, float(frame["timestampMs"])) is not None
        and int(frame["frameNumber"]) not in selected
    ]
    # Failure-enriched frames expose low-confidence overclaims.
    for frame in sorted(in_rep, key=lambda value: (required_joint_score(value), int(value["frameNumber"]))):
        if len(selected) >= max(len(selected), target_count - 8):
            break
        add(frame, "lowest_required_joint_score")

    # Add broad temporal coverage rather than clustering only around failures.
    remaining_rep = [frame for frame in in_rep if int(frame["frameNumber"]) not in selected]
    for index in quantile_indices(len(remaining_rep), max(0, target_count - len(selected) - 4)):
        add(remaining_rep[index], "rep_interval_quantile")

    # Setup/rest is required to measure false reliable declarations outside reps.
    context = [
        frame for frame in frames
        if phase_for_timestamp(segments, float(frame["timestampMs"])) is None
        and int(frame["frameNumber"]) not in selected
    ]
    for index in quantile_indices(len(context), min(4, target_count - len(selected))):
        add(context[index], "setup_or_rest_quantile")

    # Deterministic fallback for very short or unusual captures.
    for index in quantile_indices(len(frames), target_count):
        add(frames[index], "whole_video_quantile_fallback")
    for frame in frames:
        add(frame, "sequential_fallback")
    if len(selected) != target_count:
        raise ValueError(f"could only select {len(selected)} of {target_count} frames")
    return sorted(selected.values(), key=lambda value: int(value["frame"]["frameNumber"]))


def quantile_indices(length: int, count: int) -> list[int]:
    if length <= 0 or count <= 0:
        return []
    count = min(length, count)
    return sorted({min(length - 1, int(((index + 0.5) * length) / count)) for index in range(count)})


def compact_landmarks(frame: dict[str, Any], canonical: bool) -> list[dict[str, Any]]:
    points = []
    for index, name in REQUIRED_JOINTS:
        source = frame["landmarks"][index]
        point = {
            "index": index,
            "name": name,
            "x": source.get("x"),
            "y": source.get("y"),
            "score": source.get("observationScore", source.get("visibility", 0)),
            "humanTruth": False,
        }
        if canonical:
            point.update({
                "source": source.get("source", "unknown"),
                "predicted": bool(source.get("predicted", False)),
                "renderable": bool(source.get("renderable", False)),
                "usable": bool(source.get("usable", False)),
            })
        points.append(point)
    return points


def canonical_by_timestamp(capture: dict[str, Any], timestamp_ms: float) -> dict[str, Any]:
    return min(capture["poses"], key=lambda pose: abs(float(pose["timestampMs"]) - timestamp_ms))


def materialize_image(video: Path, timestamp_ms: float, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{timestamp_ms / 1000:.6f}", "-i", str(video),
        "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", "-q:v", "2", str(output),
    ]
    subprocess.run(command, check=True)


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_gzip_json(path: Path) -> Any:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def find_records(dataset: dict[str, Any]) -> dict[str, dict[str, Any]]:
    records = {
        record["sourceCaptureId"]: record
        for record in dataset["records"]
        if record.get("exerciseId") == "barbell_bench_press"
        and record.get("capturePosition") == "front"
        and record.get("sourceCaptureId") in TARGET_SOURCE_IDS
    }
    if set(records) != set(TARGET_SOURCE_IDS):
        raise ValueError("front bench source set changed")
    return records


def build_queue(args: argparse.Namespace) -> dict[str, Any]:
    project = Path(args.project_root).resolve()
    dataset_path = (project / args.dataset).resolve()
    canonical_path = (project / args.canonical).resolve()
    observations_root = (project / args.observations).resolve()
    output_root = (project / args.output_root).resolve()
    dataset = load_json(dataset_path)
    canonical = load_json(canonical_path)
    records = find_records(dataset)
    items: list[dict[str, Any]] = []
    source_documents = []
    detector_hashes: set[str] = set()
    pose_hashes: set[str] = set()

    for source_id in TARGET_SOURCE_IDS:
        record = records[source_id]
        sidecar_path = observations_root / f"{source_id}.halpe26.json.gz"
        sidecar = load_gzip_json(sidecar_path)
        canonical_key = record["source"]["keypoints"]
        canonical_capture = canonical["captures"][canonical_key]
        if sidecar["captureId"] != source_id or canonical_capture["sourceCaptureId"] != source_id:
            raise ValueError(f"source lineage mismatch: {source_id}")
        if sidecar["poseSchema"] != "halpe26" or canonical_capture["poseSchema"] != "halpe26":
            raise ValueError("pose schema changed")
        video_path = (project / sidecar["source"]["video"]).resolve()
        if sha256(video_path) != sidecar["source"]["sha256"]:
            raise ValueError(f"video hash mismatch: {source_id}")
        detector_hashes.add(sidecar["inference"]["detector"]["sha256"])
        pose_hashes.add(sidecar["inference"]["pose"]["sha256"])
        selected = select_review_frames(sidecar["frames"], record["segments"], args.frames_per_source)
        source_documents.append({
            "sourceCaptureId": source_id,
            "split": "test",
            "video": str(video_path.relative_to(project)),
            "videoSha256": sidecar["source"]["sha256"],
            "rawPose": str(sidecar_path.relative_to(project)),
            "rawPoseSha256": sha256(sidecar_path),
            "selectedFrameCount": len(selected),
        })
        for selection in selected:
            frame = selection["frame"]
            frame_number = int(frame["frameNumber"])
            timestamp_ms = float(frame["timestampMs"])
            image_rel = Path("images") / source_id / f"frame-{frame_number:06d}.jpg"
            image_path = output_root / image_rel
            if args.execute:
                materialize_image(video_path, timestamp_ms, image_path)
            image_hash = sha256(image_path) if image_path.exists() else None
            canonical_frame = canonical_by_timestamp(canonical_capture, timestamp_ms)
            items.append({
                "reviewItemId": f"pose-keypoint:{source_id}:frame:{frame_number}",
                "sourceCaptureId": source_id,
                "exerciseId": "barbell_bench_press",
                "capturePosition": "front",
                "equipmentContext": "barbell",
                "mirrorPresent": True,
                "split": "test",
                "frameNumber": frame_number,
                "timestampMs": timestamp_ms,
                "selectionReason": selection["selectionReason"],
                "phaseContext": selection["phaseContext"],
                "image": str(image_rel),
                "imageSha256": image_hash,
                "rawRtmpose": {
                    "timestampMs": timestamp_ms,
                    "requiredJoints": compact_landmarks(frame, canonical=False),
                    "humanTruth": False,
                },
                "rustCanonical": {
                    "timestampMs": float(canonical_frame["timestampMs"]),
                    "requiredJoints": compact_landmarks(canonical_frame, canonical=True),
                    "humanTruth": False,
                },
                "humanTruth": False,
            })

    if len(detector_hashes) != 1 or len(pose_hashes) != 1:
        raise ValueError("model hashes differ across source sidecars")
    items.sort(key=lambda item: (item["sourceCaptureId"], item["frameNumber"]))
    queue = {
        "schemaVersion": SCHEMA,
        "purpose": "human_keypoint_truth_for_front_mirror_bench_pose_accuracy",
        "exerciseId": "barbell_bench_press",
        "capturePosition": "front",
        "equipmentContext": "barbell",
        "mirrorPresent": True,
        "poseSchema": "halpe26",
        "requiredJoints": [{"index": index, "name": name} for index, name in REQUIRED_JOINTS],
        "normalization": "torso_length=distance(midpoint_shoulders,midpoint_hips)",
        "acceptance": {
            "pckThresholdTorsoRatio": 0.10,
            "requiredJointPckMinimum": 0.95,
            "requiredJointUsableFrameRateMinimum": 0.95,
            "occludedOrAmbiguousMeasuredOverclaimMaximum": 0.01,
            "minimumHumanKeypointFramesPerExactContext": 100,
        },
        "splitPolicy": "capture-disjoint-preserve-personal-tuning-challenge/v1",
        "allItemsFrozenTest": True,
        "trainerReadable": False,
        "productionPromotion": False,
        "humanReviewedItemCount": 0,
        "materialized": bool(args.execute),
        "modelFreeze": {
            "pipeline": "yolox-nano-humanart+rtmpose-m-halpe26",
            "detectorSha256": next(iter(detector_hashes)),
            "poseSha256": next(iter(pose_hashes)),
            "rustWasmSha256": canonical["rustWasmSha256"],
        },
        "sourceDataset": str(dataset_path.relative_to(project)),
        "sourceDatasetSha256": sha256(dataset_path),
        "canonicalDataset": str(canonical_path.relative_to(project)),
        "canonicalDatasetSha256": sha256(canonical_path),
        "selectionPolicy": {
            "framesPerSource": args.frames_per_source,
            "strata": [
                "every_human_start_peak_end_anchor",
                "lowest_required_joint_score",
                "rep_interval_quantiles",
                "setup_or_rest_quantiles",
            ],
        },
        "sourceCaptures": source_documents,
        "stats": {
            "sourceCaptureCount": len(source_documents),
            "itemCount": len(items),
            "testItemCount": len(items),
            "requiredJointCount": len(REQUIRED_JOINTS),
        },
        "blockedReasons": [
            "all_items_require_human_keypoint_review",
            "single_known_person_cannot_prove_cross_user_pose_generalization",
            "no_pose_pck_until_human_truth_is_submitted",
        ],
        "items": items,
    }
    return queue


def write_queue(queue: dict[str, Any], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = stable_json(queue)
    with output.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as handle:
            handle.write(payload)


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--dataset", default="data/training/personal-golden-segmentation-v2.json")
    parser.add_argument("--canonical", default="data/workflows/motion-profile/personal-halpe26-v1/run-2026-08-11/corpus/personal-rust-canonical-v2.json")
    parser.add_argument("--observations", default="data/workflows/action-trajectory-database/halpe26-v1/personal-observations")
    parser.add_argument("--output-root", default="data/pose-validation/front-bench-halpe26-v1")
    parser.add_argument("--output", default="data/pose-validation/front-bench-halpe26-v1/pose-keypoint-review-queue-v1.json.gz")
    parser.add_argument("--frames-per-source", type=int, default=40)
    parser.add_argument("--execute", action="store_true")
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    queue = build_queue(args)
    output = Path(args.project_root).resolve() / args.output
    write_queue(queue, output)
    print(json.dumps({
        "output": str(output),
        "queueSha256": sha256(output),
        "materialized": queue["materialized"],
        "stats": queue["stats"],
        "blockedReasons": queue["blockedReasons"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
