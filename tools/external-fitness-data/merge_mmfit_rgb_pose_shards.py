#!/usr/bin/env python3
"""Merge independently extracted MM-Fit subject shards into one train snapshot."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from extract_mmfit_rgb_pose import (
    EXTRACTOR_VERSION,
    LANDMARKER_OPTIONS,
    POSE_DOMAIN,
    sha256_file,
)


def merge_shards(shards_root: Path, normalized_manifest_path: Path, output_root: Path) -> dict[str, Any]:
    normalized = json.loads(normalized_manifest_path.read_text(encoding="utf-8"))
    expected_clips = [entry for entry in normalized["clips"] if entry["split"] == "train"]
    expected_by_id = unique_by_sequence(expected_clips, "normalized train")
    shard_manifest_paths = sorted(shards_root.glob("*/manifest.json"))
    if not shard_manifest_paths:
        raise ValueError(f"No subject shard manifests found below {shards_root}")

    merged_by_id: dict[str, dict[str, Any]] = {}
    source_videos: list[dict[str, Any]] = []
    shard_provenance: list[dict[str, Any]] = []
    shared: dict[str, Any] | None = None
    resolved_output = output_root.resolve()

    for manifest_path in shard_manifest_paths:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        session = manifest_path.parent.name
        validate_shard_header(manifest, session)
        current_shared = {
            "poseDomain": manifest["poseDomain"],
            "modelAssetSha256": manifest["modelAssetSha256"],
            "mediapipeRuntimeVersion": manifest["mediapipeRuntimeVersion"],
            "delegate": manifest["delegate"],
            "landmarkerOptions": manifest["landmarkerOptions"],
            "extractorVersion": manifest["extractorVersion"],
        }
        if shared is None:
            shared = current_shared
        elif current_shared != shared:
            raise ValueError(f"Shard runtime provenance differs for {session}")

        videos = manifest.get("sourceVideos")
        if not isinstance(videos, list) or len(videos) != 1 or videos[0].get("sessionId") != session:
            raise ValueError(f"Shard sourceVideos must contain exactly {session}")
        video = videos[0]
        if not is_sha256(video.get("sourceVideoSha256")):
            raise ValueError(f"Shard {session} has invalid sourceVideoSha256")
        for field in ("widthPx", "heightPx", "fps", "frameCount"):
            if not isinstance(video.get(field), (int, float)) or video[field] <= 0:
                raise ValueError(f"Shard {session} has invalid source video {field}")
        if video.get("mirrored") is not False:
            raise ValueError(f"Shard {session} must record mirrored=false")
        source_videos.append(videos[0])
        shard_provenance.append({
            "sessionId": session,
            "manifestFile": manifest_path.resolve().relative_to(resolved_output).as_posix(),
            "manifestSha256": sha256_file(manifest_path),
        })

        shard_entries = unique_by_sequence(manifest.get("clips", []), f"shard {session}")
        for source_sequence_id, entry in shard_entries.items():
            if entry.get("split") != "train":
                raise ValueError(f"Non-train clip leaked into shard {session}: {source_sequence_id}")
            if source_sequence_id.split(":", 1)[0] != session:
                raise ValueError(f"Cross-session clip leaked into shard {session}: {source_sequence_id}")
            if source_sequence_id in merged_by_id:
                raise ValueError(f"Duplicate sourceSequenceId across shards: {source_sequence_id}")
            clip_path = (manifest_path.parent / entry["clipFile"]).resolve()
            if clip_path != manifest_path.parent.resolve() and not clip_path.is_relative_to(manifest_path.parent.resolve()):
                raise ValueError(f"Shard clip escapes its shard root: {entry['clipFile']}")
            if not clip_path.is_file():
                raise ValueError(f"Shard clip is missing: {clip_path}")
            expected_hash = entry.get("clipSha256")
            if not is_sha256(expected_hash):
                raise ValueError(f"Shard clip has invalid clipSha256: {source_sequence_id}")
            if sha256_file(clip_path) != expected_hash:
                raise ValueError(f"Shard clip SHA-256 mismatch: {source_sequence_id}")
            try:
                relative_clip = clip_path.relative_to(resolved_output).as_posix()
            except ValueError as error:
                raise ValueError(f"Shard clip is outside the final output root: {clip_path}") from error
            merged_by_id[source_sequence_id] = {**entry, "clipFile": relative_clip}

    missing = sorted(set(expected_by_id) - set(merged_by_id))
    unexpected = sorted(set(merged_by_id) - set(expected_by_id))
    if missing or unexpected:
        raise ValueError(
            f"Native shard coverage mismatch: missing={','.join(missing) or 'none'}; "
            f"unexpected={','.join(unexpected) or 'none'}"
        )
    metadata_fields = ("subjectId", "split", "sourceAction", "exerciseId", "expectedCount", "frameCount")
    for source_sequence_id, entry in merged_by_id.items():
        expected = expected_by_id[source_sequence_id]
        for field in metadata_fields:
            if entry.get(field) != expected.get(field):
                raise ValueError(
                    f"Native shard metadata mismatch for {source_sequence_id}: "
                    f"{field} expected={expected.get(field)} actual={entry.get(field)}"
                )

    assert shared is not None
    output = {
        "schemaVersion": "maxpower-mmfit-native-pose-manifest/v2",
        "complete": True,
        "datasetId": "mm-fit",
        **shared,
        "requestedSplits": ["train"],
        "requestedSessions": None,
        "requestedSequences": None,
        "sourceVideos": sorted(source_videos, key=lambda item: item["sessionId"]),
        "shardManifests": sorted(shard_provenance, key=lambda item: item["sessionId"]),
        "clips": [merged_by_id[source_sequence_id] for source_sequence_id in sorted(merged_by_id)],
    }
    output_root.mkdir(parents=True, exist_ok=True)
    destination = output_root / "manifest.json"
    temporary = output_root / "manifest.json.tmp"
    try:
        temporary.write_text(json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return output


def validate_shard_header(manifest: dict[str, Any], session: str) -> None:
    checks = {
        "schemaVersion": "maxpower-mmfit-native-pose-manifest/v2",
        "complete": True,
        "poseDomain": POSE_DOMAIN,
        "delegate": "CPU",
        "landmarkerOptions": LANDMARKER_OPTIONS,
        "extractorVersion": EXTRACTOR_VERSION,
        "requestedSplits": ["train"],
        "requestedSessions": [session],
        "requestedSequences": None,
    }
    for field, expected in checks.items():
        if manifest.get(field) != expected:
            raise ValueError(f"Shard {session} has invalid {field}: {manifest.get(field)!r}")
    if not is_sha256(manifest.get("modelAssetSha256")):
        raise ValueError(f"Shard {session} has invalid modelAssetSha256")
    if not manifest.get("mediapipeRuntimeVersion"):
        raise ValueError(f"Shard {session} is missing mediapipeRuntimeVersion")


def unique_by_sequence(clips: list[dict[str, Any]], label: str) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for entry in clips:
        source_sequence_id = entry.get("sourceSequenceId")
        if not isinstance(source_sequence_id, str) or not source_sequence_id:
            raise ValueError(f"{label} has a clip without sourceSequenceId")
        if source_sequence_id in result:
            raise ValueError(f"{label} has duplicate sourceSequenceId: {source_sequence_id}")
        result[source_sequence_id] = entry
    return result


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(character in "0123456789abcdef" for character in value)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shards-root", type=Path, default=Path("data/external/mm-fit/native-mediapipe33-heavy/shards"))
    parser.add_argument("--normalized-manifest", type=Path, default=Path("data/external/mm-fit/normalized/manifest.json"))
    parser.add_argument("--output", type=Path, default=Path("data/external/mm-fit/native-mediapipe33-heavy"))
    args = parser.parse_args()
    output = merge_shards(args.shards_root, args.normalized_manifest, args.output)
    print(json.dumps({
        "output": str(args.output / "manifest.json"),
        "clipCount": len(output["clips"]),
        "subjectCount": len(output["sourceVideos"]),
        "poseDomain": output["poseDomain"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
