#!/usr/bin/env python3
"""Build a train-only, subject-isolated MM-Fit dumbbell review queue.

Official MM-Fit validation/test/unseen subjects are intentionally out of scope.
OpenPose wrists are used only to center annotation suggestions; every equipment
label remains humanTruth=false until submitted through a review surface.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import subprocess
import tempfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "maxpower-mmfit-dumbbell-review-queue/v1"
SPLIT_POLICY = "mmfit-official-train-inner-subject-holdout/v1"
DUMBBELL_ACTIONS = {
    "bicep_curls",
    "dumbbell_rows",
    "dumbbell_shoulder_press",
    "lateral_shoulder_raises",
    "tricep_extensions",
}
EQUIPMENT_SPLIT_BY_SUBJECT = {
    "01": "train",
    "02": "train",
    "03": "train",
    "04": "train",
    "06": "train",
    "07": "train",
    "08": "validation",
    "16": "validation",
    "17": "test",
    "18": "test",
}
IN_SET_QUANTILES = (0.10, 0.35, 0.65, 0.90)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_official_md5(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        checksum, filename = raw.split(maxsplit=1)
        filename = filename.lstrip("*")
        if len(checksum) != 32 or not all(character in "0123456789abcdef" for character in checksum):
            raise ValueError(f"invalid official MM-Fit MD5 row: {raw}")
        result[filename] = checksum
    return result


def sample_frame_numbers(label: dict[str, Any], frames: list[dict[str, Any]], dumbbell_action: bool) -> list[tuple[int, str]]:
    available = sorted(int(frame["frameNumber"]) for frame in frames)
    if not available:
        raise ValueError("MM-Fit clip has no frames")
    start = int(label["startFrame"])
    end = int(label["endFrame"])
    if end <= start:
        raise ValueError("MM-Fit set window is invalid")
    requested: list[tuple[int, str]]
    if dumbbell_action:
        requested = [
            (start - 15, "pre_set_context"),
            *[
                (round(start + (end - start) * quantile), f"in_set_q{round(quantile * 100):02d}")
                for quantile in IN_SET_QUANTILES
            ],
            (end + 15, "post_set_context"),
        ]
    else:
        requested = [(round((start + end) / 2), "non_dumbbell_action_context")]
    selected: list[tuple[int, str]] = []
    used: set[int] = set()
    for frame_number, sample_kind in requested:
        nearest = min(available, key=lambda available_frame: (abs(available_frame - frame_number), available_frame))
        if nearest not in used:
            selected.append((nearest, sample_kind))
            used.add(nearest)
    return selected


def wrist_proposals(frame: dict[str, Any]) -> list[dict[str, Any]]:
    landmarks = frame.get("landmarks")
    if not isinstance(landmarks, list) or len(landmarks) < 17:
        return []
    proposals: list[dict[str, Any]] = []
    for hand, index in (("left", 15), ("right", 16)):
        wrist = landmarks[index]
        if not isinstance(wrist, dict) or float(wrist.get("visibility", 0)) <= 0:
            continue
        x = float(wrist["x"])
        y = float(wrist["y"])
        if not math.isfinite(x) or not math.isfinite(y):
            continue
        half_width = 0.075
        half_height = 0.085
        x1 = max(0.0, x - half_width)
        y1 = max(0.0, y - half_height)
        x2 = min(1.0, x + half_width)
        y2 = min(1.0, y + half_height)
        proposals.append(
            {
                "proposalId": f"wrist-roi:{hand}",
                "kind": "dumbbell",
                "hand": hand,
                "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "source": "mmfit_openpose18_mapped_wrist_roi/v1",
                "humanTruth": False,
            }
        )
    return proposals


def plan_queue(normalized_manifest: dict[str, Any], normalized_root: Path, rgb_root: Path) -> dict[str, Any]:
    if normalized_manifest.get("schemaVersion") != "maxpower-external-fitness-manifest/v1":
        raise ValueError("unsupported MM-Fit normalized manifest")
    clips = normalized_manifest.get("clips")
    if not isinstance(clips, list):
        raise ValueError("MM-Fit normalized manifest is missing clips")
    official_md5 = parse_official_md5(rgb_root / "MD5SUMS.official")
    items: list[dict[str, Any]] = []
    source_videos: dict[str, dict[str, Any]] = {}
    seen_review_ids: set[str] = set()
    for summary in clips:
        if summary.get("split") != "train":
            continue
        subject_id = str(summary.get("subjectId", ""))
        if subject_id not in EQUIPMENT_SPLIT_BY_SUBJECT:
            raise ValueError(f"unexpected MM-Fit train subject: {subject_id}")
        source_sequence_id = str(summary["sourceSequenceId"])
        source_action = str(summary["sourceAction"])
        dumbbell_action = source_action in DUMBBELL_ACTIONS
        clip_path = normalized_root / str(summary["clipFile"])
        with gzip.open(clip_path, "rt", encoding="utf-8") as source:
            clip = json.load(source)
        if clip.get("split") != "train" or clip.get("sourceSequenceId") != source_sequence_id:
            raise ValueError(f"MM-Fit clip lineage mismatch: {source_sequence_id}")
        label = clip.get("label")
        frames = clip.get("frames")
        if not isinstance(label, dict) or not isinstance(frames, list):
            raise ValueError(f"MM-Fit clip is incomplete: {source_sequence_id}")
        if label.get("annotationGranularity") != "set_count" or label.get("repBounds") != []:
            raise ValueError(f"MM-Fit supervision granularity changed: {source_sequence_id}")
        session_id = f"w{subject_id}"
        video_name = f"{session_id}_rgb.mp4"
        video_path = rgb_root / video_name
        if not video_path.is_file():
            raise ValueError(f"MM-Fit train RGB is missing: {video_name}")
        if video_name not in official_md5:
            raise ValueError(f"MM-Fit official MD5 is missing: {video_name}")
        source_videos[session_id] = {
            "sessionId": session_id,
            "subjectId": subject_id,
            "officialSplit": "train",
            "equipmentSplit": EQUIPMENT_SPLIT_BY_SUBJECT[subject_id],
            "video": str(video_path),
            "officialMd5": official_md5[video_name],
        }
        frame_by_number = {int(frame["frameNumber"]): frame for frame in frames}
        fps = float(clip["source"]["framesPerSecond"])
        for frame_number, sample_kind in sample_frame_numbers(label, frames, dumbbell_action):
            frame = frame_by_number[frame_number]
            review_item_id = f"mmfit-equipment:{source_sequence_id}:frame:{frame_number}"
            if review_item_id in seen_review_ids:
                raise ValueError(f"duplicate MM-Fit equipment review item: {review_item_id}")
            seen_review_ids.add(review_item_id)
            safe_sequence = source_sequence_id.replace(":", "-")
            image = f"images/{session_id}/{safe_sequence}/frame-{frame_number:06d}.jpg"
            items.append(
                {
                    "reviewItemId": review_item_id,
                    "datasetId": "mm-fit",
                    "sourceSequenceId": source_sequence_id,
                    "sourceAction": source_action,
                    "exerciseId": str(summary["exerciseId"]),
                    "subjectId": subject_id,
                    "sessionId": session_id,
                    "officialSplit": "train",
                    "split": EQUIPMENT_SPLIT_BY_SUBJECT[subject_id],
                    "frameIndex": frame_number,
                    "timestampMs": frame_number / fps * 1000,
                    "sampleKind": sample_kind,
                    "setCountTruth": int(label["totalRepetitions"]),
                    "repBounds": [],
                    "image": image,
                    "proposal": {
                        "kind": "dumbbell_instances",
                        "instances": wrist_proposals(frame) if dumbbell_action else [],
                        "source": "annotation_aid_only/v1",
                        "humanTruth": False,
                    },
                }
            )
    items.sort(key=lambda item: (item["subjectId"], item["sourceSequenceId"], item["frameIndex"]))
    split_counts = Counter(item["split"] for item in items)
    action_counts = Counter(item["sourceAction"] for item in items)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "datasetId": "mm-fit",
        "sourceDatasetLicense": {
            "spdx": "CC-BY-4.0",
            "record": "Zenodo record 7672767",
            "attributionRequired": True,
        },
        "officialSourceSplit": "train",
        "excludedOfficialSplits": ["validation", "test", "unseen_test"],
        "splitPolicy": SPLIT_POLICY,
        "equipmentSplitBySubject": EQUIPMENT_SPLIT_BY_SUBJECT,
        "promotionAllowed": False,
        "blockedReasons": [
            "all_items_require_human_review",
            "wrist_rois_are_annotation_aids_not_equipment_truth",
            "official_train_inner_holdout_is_not_official_test",
            "no_dumbbell_detector_trained",
        ],
        "stats": {
            "itemCount": len(items),
            "sourceSequenceCount": len({item["sourceSequenceId"] for item in items}),
            "subjectCount": len({item["subjectId"] for item in items}),
            "trainItems": split_counts["train"],
            "validationItems": split_counts["validation"],
            "testItems": split_counts["test"],
            "dumbbellActionItems": sum(count for action, count in action_counts.items() if action in DUMBBELL_ACTIONS),
            "backgroundActionItems": sum(count for action, count in action_counts.items() if action not in DUMBBELL_ACTIONS),
            "humanReviewedItems": 0,
        },
        "actionCounts": dict(sorted(action_counts.items())),
        "sourceVideos": [source_videos[key] for key in sorted(source_videos)],
        "items": items,
    }


def extract_frame(video_path: Path, timestamp_ms: float, output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if not output_path.is_file():
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                f"{timestamp_ms / 1000:.6f}",
                "-i",
                str(video_path),
                "-frames:v",
                "1",
                "-vf",
                "scale=640:-2",
                "-q:v",
                "3",
                "-y",
                str(output_path),
            ],
            check=True,
        )
    return sha256_file(output_path)


def materialize(queue: dict[str, Any], asset_root: Path, workers: int) -> dict[str, Any]:
    video_by_session = {entry["sessionId"]: Path(entry["video"]) for entry in queue["sourceVideos"]}

    def work(item: dict[str, Any]) -> tuple[str, str]:
        output_path = asset_root / item["image"]
        checksum = extract_frame(video_by_session[item["sessionId"]], float(item["timestampMs"]), output_path)
        return item["reviewItemId"], checksum

    checksums: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        for index, (review_item_id, checksum) in enumerate(executor.map(work, queue["items"]), start=1):
            checksums[review_item_id] = checksum
            if index % 100 == 0 or index == len(queue["items"]):
                print(f"[mmfit-dumbbell-review] materialized {index}/{len(queue['items'])}", flush=True)
    for item in queue["items"]:
        item["imageSha256"] = checksums[item["reviewItemId"]]
    queue["materialized"] = True
    return queue


def canonical_json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def write_gzip(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = gzip.compress(canonical_json_bytes(value), compresslevel=9, mtime=0)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    os.close(descriptor)
    try:
        Path(temporary).write_bytes(body)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--normalized-manifest", type=Path, default=Path("data/external/mm-fit/normalized/manifest.json"))
    parser.add_argument("--normalized-root", type=Path, default=Path("data/external/mm-fit/normalized"))
    parser.add_argument("--rgb-root", type=Path, default=Path("data/external/mm-fit/rgb"))
    parser.add_argument("--asset-root", type=Path, default=Path("data/equipment-validation/mmfit-dumbbell-v1"))
    parser.add_argument("--output", type=Path, default=Path("data/equipment-validation/mmfit-dumbbell-v1/mmfit-dumbbell-review-queue-v1.json.gz"))
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    manifest = json.loads(args.normalized_manifest.read_text(encoding="utf-8"))
    queue = plan_queue(manifest, args.normalized_root, args.rgb_root)
    if args.execute:
        queue = materialize(queue, args.asset_root, args.workers)
        write_gzip(args.output, queue)
    print(
        json.dumps(
            {
                "mode": "execute" if args.execute else "plan",
                "output": str(args.output),
                "queueSha256": sha256_file(args.output) if args.execute else None,
                "stats": queue["stats"],
                "promotionAllowed": False,
                "blockedReasons": queue["blockedReasons"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
