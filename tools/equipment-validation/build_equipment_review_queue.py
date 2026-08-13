#!/usr/bin/env python3
"""Freeze a capture-disjoint human review queue for equipment observations.

The input manifest contains unreviewed geometry proposals. This builder keeps
those proposals as suggestions, hashes every source asset, and preserves the
personal corpus tuning/challenge boundary at the capture level. It never turns
pseudo labels into training truth.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "maxpower-equipment-review-queue/v1"
SPLIT_POLICY = "capture-disjoint-preserve-personal-tuning-challenge/v1"
VALIDATION_SEED = "maxpower-equipment-validation-source-v1"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def derive_source_splits(
    personal_records: list[dict[str, Any]],
    source_ids: set[str],
    sample_counts: Counter[str] | None = None,
) -> tuple[dict[str, str], list[str]]:
    records = {record.get("captureId"): record for record in personal_records}
    if len(records) != len(personal_records):
        raise ValueError("personal dataset has duplicate captureId")
    missing = sorted(source_ids - records.keys())
    if missing:
        raise ValueError(f"personal dataset is missing equipment sources: {missing}")

    development: list[str] = []
    challenge: list[str] = []
    for source_id in sorted(source_ids):
        eligibility = records[source_id].get("eligibility", {})
        tuning = eligibility.get("tuning") is True
        is_challenge = eligibility.get("challenge") is True
        if tuning == is_challenge:
            raise ValueError(f"equipment source has ambiguous tuning/challenge role: {source_id}")
        (development if tuning else challenge).append(source_id)

    blockers: list[str] = []
    split_by_source = {source_id: "test" for source_id in challenge}
    if len(development) >= 2:
        counts = sample_counts or Counter()
        validation_source = min(
            development,
            key=lambda source_id: (
                counts[source_id],
                sha256_bytes(f"{VALIDATION_SEED}:{source_id}".encode()),
            ),
        )
        split_by_source.update(
            {
                source_id: "validation" if source_id == validation_source else "train"
                for source_id in development
            }
        )
    elif development:
        split_by_source[development[0]] = "train"
        blockers.append("no_source_disjoint_validation_capture")
    else:
        blockers.append("no_training_capture")

    if not challenge:
        blockers.append("no_frozen_challenge_capture")
    if sum(split == "train" for split in split_by_source.values()) < 2:
        blockers.append("fewer_than_two_training_source_captures")
    return split_by_source, blockers


def build_queue(
    manifest: dict[str, Any],
    personal_dataset: dict[str, Any],
    asset_root: Path,
    manifest_sha256: str,
) -> dict[str, Any]:
    if manifest.get("schemaVersion") != "bar-axis-pseudo-label-dataset/v1":
        raise ValueError("unsupported equipment pseudo-label manifest")
    samples = manifest.get("samples")
    records = personal_dataset.get("records")
    if not isinstance(samples, list) or not isinstance(records, list):
        raise ValueError("equipment review inputs are incomplete")
    source_ids = {sample.get("videoId") for sample in samples}
    if None in source_ids or not all(isinstance(value, str) and value for value in source_ids):
        raise ValueError("equipment sample has invalid videoId")
    sample_counts = Counter(sample["videoId"] for sample in samples)
    split_by_source, split_blockers = derive_source_splits(records, source_ids, sample_counts)
    personal_by_id = {record["captureId"]: record for record in records}

    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for sample in sorted(samples, key=lambda value: (value["videoId"], value["frameIndex"])):
        video_id = sample["videoId"]
        frame_index = sample.get("frameIndex")
        timestamp_ms = sample.get("timestampMs")
        if not isinstance(frame_index, int) or frame_index < 0:
            raise ValueError("equipment sample has invalid frameIndex")
        if not isinstance(timestamp_ms, (int, float)) or timestamp_ms < 0:
            raise ValueError("equipment sample has invalid timestampMs")
        review_item_id = f"equipment:{video_id}:frame:{frame_index}"
        if review_item_id in seen:
            raise ValueError(f"duplicate equipment review item: {review_item_id}")
        seen.add(review_item_id)
        image_relative = Path(sample["image"])
        preview_relative = Path(sample["preview"])
        if image_relative.is_absolute() or preview_relative.is_absolute() or ".." in image_relative.parts or ".." in preview_relative.parts:
            raise ValueError("equipment sample asset path escapes asset root")
        image_path = asset_root / image_relative
        preview_path = asset_root / preview_relative
        if not image_path.is_file() or not preview_path.is_file():
            raise ValueError(f"equipment sample asset is missing: {review_item_id}")
        pseudo = sample.get("pseudoLabel", {})
        axis_y = pseudo.get("axisYNormalized")
        if not isinstance(axis_y, (int, float)) or not 0 <= axis_y <= 1:
            raise ValueError(f"equipment sample has invalid pseudo axis: {review_item_id}")
        personal = personal_by_id[video_id]
        source_video = asset_root.parent.parent / personal["source"]["video"]
        # The personal dataset stores paths relative to confirmed-captures.
        if not source_video.is_file():
            source_video = Path("public/archives/confirmed-captures") / personal["source"]["video"]
        if not source_video.is_file():
            raise ValueError(f"source video is missing: {video_id}")
        items.append(
            {
                "reviewItemId": review_item_id,
                "sourceCaptureId": video_id,
                "sourceVideo": str(source_video),
                "sourceVideoSha256": sha256_file(source_video),
                "capturePosition": personal["capturePosition"],
                "analysisView": personal["analysisView"],
                "split": split_by_source[video_id],
                "frameIndex": frame_index,
                "timestampMs": timestamp_ms,
                "sampleKind": sample["sampleKind"],
                "repIndex": sample.get("repIndex"),
                "phase": sample.get("phase"),
                "image": str(image_relative),
                "imageSha256": sha256_file(image_path),
                "preview": str(preview_relative),
                "previewSha256": sha256_file(preview_path),
                "proposal": {
                    "kind": "barbell_shaft",
                    "axis": {"x1": 0.05, "y1": axis_y, "x2": 0.95, "y2": axis_y},
                    "confidenceRatio": pseudo.get("confidenceRatio"),
                    "source": pseudo.get("source"),
                    "reviewPriority": pseudo.get("reviewPriority"),
                    "reviewReason": pseudo.get("reviewReason"),
                    "humanTruth": False,
                },
            }
        )

    source_stats = []
    sample_counts = Counter(item["sourceCaptureId"] for item in items)
    for source_id in sorted(source_ids):
        record = personal_by_id[source_id]
        source_stats.append(
            {
                "sourceCaptureId": source_id,
                "capturePosition": record["capturePosition"],
                "analysisView": record["analysisView"],
                "split": split_by_source[source_id],
                "sampleCount": sample_counts[source_id],
            }
        )
    split_stats = Counter(item["split"] for item in items)
    blockers = [
        *split_blockers,
        "single_person_legacy_subject_group",
        "geometry_prototype_used_all_sources_for_candidate_generation",
        "no_unseen_subject_equipment_test",
        "all_items_require_human_review",
    ]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "sourceManifestSha256": manifest_sha256,
        "splitPolicy": SPLIT_POLICY,
        "validationSelectionSeed": VALIDATION_SEED,
        "validationSelectionPolicy": "smallest_tuning_capture_by_sample_count_then_seeded_hash",
        "promotionAllowed": False,
        "blockedReasons": blockers,
        "stats": {
            "itemCount": len(items),
            "sourceCount": len(source_ids),
            "trainItems": split_stats["train"],
            "validationItems": split_stats["validation"],
            "testItems": split_stats["test"],
            "humanReviewedItems": 0,
        },
        "sourceGroups": source_stats,
        "items": items,
    }


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
    parser.add_argument("--manifest", type=Path, default=Path("data/equipment-validation/bar-axis-v1/manifest.json"))
    parser.add_argument("--personal-dataset", type=Path, default=Path("data/training/personal-golden-segmentation-v2.json"))
    parser.add_argument("--asset-root", type=Path, default=Path("data/equipment-validation/bar-axis-v1"))
    parser.add_argument("--output", type=Path, default=Path("data/equipment-validation/bar-axis-v1/equipment-review-queue-v1.json.gz"))
    args = parser.parse_args()
    manifest_bytes = args.manifest.read_bytes()
    queue = build_queue(
        json.loads(manifest_bytes),
        json.loads(args.personal_dataset.read_text(encoding="utf-8")),
        args.asset_root,
        sha256_bytes(manifest_bytes),
    )
    write_gzip(args.output, queue)
    print(
        json.dumps(
            {
                "output": str(args.output),
                "queueSha256": sha256_file(args.output),
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
