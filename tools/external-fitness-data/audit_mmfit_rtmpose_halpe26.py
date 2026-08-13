#!/usr/bin/env python3
"""Integrity and subject-continuity audit for train-only MM-Fit Halpe-26."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
from typing import Any


TRAIN_SESSIONS = ("w01", "w02", "w03", "w04", "w06", "w07", "w08", "w16", "w17", "w18")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def safe_child(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    resolved_root = root.resolve()
    if candidate != resolved_root and resolved_root not in candidate.parents:
        raise ValueError(f"clip escapes corpus root: {relative}")
    return candidate


def audit_clip(item: dict[str, Any], clip: dict[str, Any]) -> dict[str, Any]:
    source_id = item["sourceSequenceId"]
    if (
        clip.get("sourceSequenceId") != source_id
        or clip.get("split") != "train"
        or clip.get("poseSchema") != "halpe26"
    ):
        raise ValueError(f"clip identity/schema mismatch: {source_id}")
    label = clip.get("label") or {}
    if (
        label.get("annotationGranularity") != "set_count"
        or label.get("repBounds") != []
        or clip.get("repBounds") != []
        or clip.get("techniqueQuality") != "unknown"
        or clip.get("compensation") != "unknown"
    ):
        raise ValueError(f"clip contains unsupported supervision: {source_id}")
    frames = clip.get("frames") or []
    if not frames:
        raise ValueError(f"clip has no RTMPose frames: {source_id}")
    detector_observed = 0
    empty = 0
    low_coco = 0
    selected_centers: list[tuple[float, float]] = []
    for frame in frames:
        landmarks = frame.get("landmarks") or []
        if len(landmarks) not in (0, 26):
            raise ValueError(f"frame is not empty or Halpe-26: {source_id}")
        detector_observed += int((frame.get("subjectSelection") or {}).get("detectorObserved") is True)
        empty += int(len(landmarks) == 0)
        low_coco += int(int((frame.get("observationQuality") or {}).get("cocoPrefixObservedCount", 0)) < 12)
        box = frame.get("selectedBbox")
        if box:
            selected_centers.append((
                float(box["x"]) + float(box["width"]) / 2,
                float(box["y"]) + float(box["height"]) / 2,
            ))
    center_jumps = [
        math.hypot(right[0] - left[0], right[1] - left[1])
        for left, right in zip(selected_centers, selected_centers[1:])
    ]
    count = len(frames)
    detector_rate = detector_observed / count
    empty_rate = empty / count
    low_coco_rate = low_coco / count
    max_center_jump = max(center_jumps, default=0.0)
    flags = []
    if detector_rate < 0.50:
        flags.append("detector_hold_dominates")
    if empty_rate > 0.05:
        flags.append("empty_frame_rate_gt_5pct")
    if low_coco_rate > 0.05:
        flags.append("coco_prefix_low_rate_gt_5pct")
    if max_center_jump > 0.15:
        flags.append("subject_box_jump_gt_0_15")
    return {
        "sourceSequenceId": source_id,
        "subjectId": item["subjectId"],
        "exerciseId": item["exerciseId"],
        "frameCount": count,
        "detectorObservedCount": detector_observed,
        "emptyFrameCount": empty,
        "lowCocoPrefixFrameCount": low_coco,
        "detectorObservedRate": round(detector_rate, 6),
        "emptyFrameRate": round(empty_rate, 6),
        "lowCocoPrefixFrameRate": round(low_coco_rate, 6),
        "maximumSelectedBoxCenterJump": round(max_center_jump, 6),
        "visualReviewRequired": bool(flags),
        "flags": flags,
    }


def audit_corpus(root: Path, *, expected_clip_count: int = 301) -> dict[str, Any]:
    manifest_path = root / "manifest.json"
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest.get("complete") is not True or manifest.get("requestedSplits") != ["train"]:
        raise ValueError("MM-Fit RTMPose corpus is not a complete train-only snapshot")
    clips = manifest.get("clips") or []
    if len(clips) != expected_clip_count:
        raise ValueError(f"MM-Fit RTMPose clip coverage mismatch: {len(clips)} != {expected_clip_count}")
    sessions = sorted({item["sourceSequenceId"].split(":", 1)[0] for item in clips})
    if expected_clip_count == 301 and sessions != list(TRAIN_SESSIONS):
        raise ValueError(f"MM-Fit RTMPose train sessions mismatch: {sessions}")
    identities: set[str] = set()
    rows = []
    corpus_hash = hashlib.sha256()
    for item in sorted(clips, key=lambda value: value["sourceSequenceId"]):
        source_id = item["sourceSequenceId"]
        if source_id in identities:
            raise ValueError(f"duplicate MM-Fit RTMPose clip: {source_id}")
        identities.add(source_id)
        if item.get("split") != "train":
            raise ValueError(f"non-train clip leaked: {source_id}:{item.get('split')}")
        clip_path = safe_child(root, item["clipFile"])
        actual_hash = sha256_file(clip_path)
        if actual_hash != item.get("clipSha256"):
            raise ValueError(f"clip SHA-256 mismatch: {source_id}")
        with gzip.open(clip_path, "rt", encoding="utf-8") as source:
            clip = json.load(source)
        rows.append(audit_clip(item, clip))
        corpus_hash.update(source_id.encode())
        corpus_hash.update(b"\0")
        corpus_hash.update(actual_hash.encode())
        corpus_hash.update(b"\n")
    frame_count = sum(row["frameCount"] for row in rows)
    detector_count = sum(row["detectorObservedCount"] for row in rows)
    empty_count = sum(row["emptyFrameCount"] for row in rows)
    low_coco_count = sum(row["lowCocoPrefixFrameCount"] for row in rows)
    review = [row for row in rows if row["visualReviewRequired"]]
    return {
        "schemaVersion": "maxpower-mmfit-rtmpose-halpe26-audit/v1",
        "researchOnly": True,
        "productionPromotion": False,
        "integrityStatus": "passed",
        "datasetId": "mm-fit",
        "requestedSplits": ["train"],
        "manifest": str(manifest_path.resolve()),
        "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "corpusSha256": corpus_hash.hexdigest(),
        "summary": {
            "sessionCount": len(sessions),
            "clipCount": len(rows),
            "frameCount": frame_count,
            "detectorObservedRate": round(detector_count / frame_count, 6),
            "emptyFrameRate": round(empty_count / frame_count, 6),
            "lowCocoPrefixFrameRate": round(low_coco_count / frame_count, 6),
            "visualReviewRequiredClipCount": len(review),
            "maximumSelectedBoxCenterJump": max((row["maximumSelectedBoxCenterJump"] for row in rows), default=0.0),
        },
        "visualReviewQueue": review,
        "rows": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("data/external/mm-fit/native-rtmpose-halpe26"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-clips", type=int, default=301)
    args = parser.parse_args()
    report = audit_corpus(args.input, expected_clip_count=args.expected_clips)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "summary": report["summary"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
