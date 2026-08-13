#!/usr/bin/env python3
"""Extract train-only MM-Fit RGB with YOLOX + RTMPose Halpe-26.

The official MM-Fit normalized clips provide global RGB frame numbers and
set-level counts. This Adapter samples those exact frames, emits raw Halpe-26
observations, and never manufactures per-rep, form-quality, compensation, or
missing-keypoint truth. Validation, test, and unseen subjects are rejected.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from fractions import Fraction
import gzip
import hashlib
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from typing import Any, Iterator, Sequence

import numpy as np


POSE_ADAPTER_PATH = Path(__file__).resolve().parents[1] / "pose-stack" / "extract_personal_halpe26.py"
POSE_ADAPTER_SPEC = importlib.util.spec_from_file_location("personal_halpe26_adapter", POSE_ADAPTER_PATH)
assert POSE_ADAPTER_SPEC and POSE_ADAPTER_SPEC.loader
pose_adapter = importlib.util.module_from_spec(POSE_ADAPTER_SPEC)
sys.modules[POSE_ADAPTER_SPEC.name] = pose_adapter
POSE_ADAPTER_SPEC.loader.exec_module(pose_adapter)


EXTRACTOR_VERSION = "mmfit-yolox-rtmpose-halpe26/v1"
SCHEMA_VERSION = "maxpower-mmfit-native-halpe26/v1"
MANIFEST_SCHEMA_VERSION = "maxpower-mmfit-native-halpe26-manifest/v1"
POSE_DOMAIN = "mmfit_yolox_nano_humanart_rtmpose_m_halpe26_cpu"
PIPELINE = "yolox-nano-humanart+rtmpose-m-halpe26"
HALPE26_NAMES = pose_adapter.HALPE26_NAMES
DETECTOR_SHA256 = pose_adapter.DETECTOR_SHA256
POSE_SHA256 = pose_adapter.POSE_SHA256
SUBJECT_POLICY_VERSION = pose_adapter.SUBJECT_POLICY_VERSION
MAX_DETECTOR_HOLD_MS = pose_adapter.MAX_DETECTOR_HOLD_MS


@dataclass(frozen=True)
class SessionTask:
    session_id: str
    video: str
    normalized_root: str
    output_root: str
    clip_entries: tuple[dict[str, Any], ...]
    sample_fps: float
    force: bool


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_clip(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as source:
        return json.load(source)


def write_deterministic_gzip_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with temporary.open("wb") as raw_stream:
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw_stream, compresslevel=6, mtime=0) as compressed:
                with io.TextIOWrapper(compressed, encoding="utf-8") as text_stream:
                    json.dump(
                        value,
                        text_stream,
                        ensure_ascii=False,
                        separators=(",", ":"),
                        sort_keys=True,
                        allow_nan=False,
                    )
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    try:
        temporary.write_text(
            json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def validate_train_item(item: dict[str, Any]) -> None:
    if item.get("split") != "train":
        raise ValueError(
            f"MM-Fit RTMPose extraction accepts only the official train split: "
            f"{item.get('sourceSequenceId', 'unknown')}={item.get('split')}"
        )


def sample_frame_numbers(
    frame_numbers: Sequence[int],
    *,
    source_fps: float,
    sample_fps: float,
) -> list[int]:
    if source_fps <= 0 or sample_fps <= 0:
        raise ValueError("source_fps and sample_fps must be positive")
    ordered = sorted(set(int(frame) for frame in frame_numbers))
    if not ordered:
        return []
    stride = max(1, int(round(source_fps / min(source_fps, sample_fps))))
    first = ordered[0]
    selected = [frame for frame in ordered if (frame - first) % stride == 0]
    if selected[-1] != ordered[-1]:
        selected.append(ordered[-1])
    return selected


def build_clip_payload(
    *,
    item: dict[str, Any],
    source_clip: dict[str, Any],
    frames: list[dict[str, Any]],
    detector_hash: str,
    pose_hash: str,
    sample_fps: float,
    video_provenance: dict[str, Any],
) -> dict[str, Any]:
    validate_train_item(item)
    label = source_clip["label"]
    if label.get("annotationGranularity") != "set_count" or label.get("repBounds") != []:
        raise ValueError(
            f"MM-Fit RTMPose extraction cannot manufacture per-rep truth: {item['sourceSequenceId']}"
        )
    for frame in frames:
        landmarks = frame.get("landmarks") or []
        if landmarks and len(landmarks) != 26:
            raise ValueError(
                f"RTMPose output is not Halpe-26 for {item['sourceSequenceId']}: {len(landmarks)}"
            )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "datasetId": "mm-fit",
        "sourceSequenceId": item["sourceSequenceId"],
        "subjectId": item["subjectId"],
        "split": "train",
        "sourceAction": item["sourceAction"],
        "exerciseId": item["exerciseId"],
        "poseSchema": "halpe26",
        "keypointNames": HALPE26_NAMES,
        "poseDomain": POSE_DOMAIN,
        "coordinateSpace": "image_normalized",
        "missingPointPolicy": "unknown; never synthesize",
        "observation": {
            "pipeline": PIPELINE,
            "extractorVersion": EXTRACTOR_VERSION,
            "sampleFps": sample_fps,
            "detectorEverySampledFrame": True,
            "detectorModelSha256": detector_hash,
            "poseModelSha256": pose_hash,
            "subjectSelection": SUBJECT_POLICY_VERSION,
            "maximumDetectorHoldMs": MAX_DETECTOR_HOLD_MS,
            "temporalSmoothing": "none_raw_observations_only",
            "sourceVideo": video_provenance,
        },
        "label": label,
        "repBounds": [],
        "techniqueQuality": "unknown",
        "compensation": "unknown",
        "frames": frames,
    }


def parse_frame_rate(value: str) -> float:
    fps = float(Fraction(value))
    if fps <= 0:
        raise ValueError(f"invalid video frame rate: {value}")
    return fps


def probe_video(path: Path) -> dict[str, Any]:
    command = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,avg_frame_rate,nb_frames,duration",
        "-of", "json", str(path),
    ]
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
    except (FileNotFoundError, subprocess.CalledProcessError) as error:
        raise RuntimeError(f"ffprobe failed for {path}: {error}") from error
    streams = json.loads(result.stdout).get("streams") or []
    if len(streams) != 1:
        raise RuntimeError(f"Expected one video stream in {path}")
    stream = streams[0]
    fps = parse_frame_rate(stream["avg_frame_rate"])
    frame_count = int(stream.get("nb_frames") or round(float(stream.get("duration", 0)) * fps))
    return {
        "widthPx": int(stream["width"]),
        "heightPx": int(stream["height"]),
        "fps": fps,
        "frameCount": frame_count,
    }


def _read_exact(stream: Any, count: int) -> bytes:
    chunks: list[bytes] = []
    remaining = count
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            if not chunks:
                return b""
            raise EOFError(f"truncated BGR frame: expected {count} bytes")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def iter_bgr_frames(path: Path, width: int, height: int) -> Iterator[tuple[int, np.ndarray]]:
    command = [
        "ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(path),
        "-map", "0:v:0", "-fps_mode", "passthrough",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "pipe:1",
    ]
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError as error:
        raise RuntimeError("ffmpeg is required for MM-Fit RGB extraction") from error
    if process.stdout is None or process.stderr is None:
        process.kill()
        raise RuntimeError("ffmpeg pipes could not be created")
    frame_bytes = width * height * 3
    natural_eof = False
    try:
        frame_index = 0
        while True:
            payload = _read_exact(process.stdout, frame_bytes)
            if not payload:
                natural_eof = True
                break
            yield frame_index, np.frombuffer(payload, dtype=np.uint8).reshape((height, width, 3))
            frame_index += 1
    finally:
        if process.poll() is None:
            if natural_eof:
                process.wait()
            else:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        error_output = process.stderr.read().decode("utf-8", errors="replace").strip()
        if natural_eof and process.returncode:
            raise RuntimeError(f"ffmpeg failed for {path}: {error_output or process.returncode}")


def _frame_landmarks(
    frame: np.ndarray,
    selected: Sequence[float],
    width: int,
    height: int,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    keypoints, scores = pose_adapter._POSE(frame, bboxes=[selected])
    points = keypoints[0]
    point_scores = scores[0]
    if len(points) != 26 or len(point_scores) != 26:
        raise RuntimeError(f"Expected Halpe-26 output, got {points.shape} and {point_scores.shape}")
    landmarks = []
    for point, score in zip(points, point_scores):
        visibility = max(0.0, min(1.0, float(score)))
        landmarks.append(
            {
                "x": round(float(point[0]) / width, 7),
                "y": round(float(point[1]) / height, 7),
                "z": None,
                "visibility": round(visibility, 7),
            }
        )
    return landmarks, {
        "meanKeypointScore": round(float(np.mean(point_scores)), 6),
        "observedKeypointCount": int(np.sum(point_scores >= 0.3)),
        "cocoPrefixObservedCount": int(np.sum(point_scores[:17] >= 0.3)),
    }


def _shard_is_complete(path: Path, session: str, sample_fps: float) -> bool:
    if not path.is_file():
        return False
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        if not (
            manifest.get("complete") is True
            and manifest.get("extractorVersion") == EXTRACTOR_VERSION
            and manifest.get("requestedSplits") == ["train"]
            and manifest.get("requestedSessions") == [session]
            and manifest.get("sampleFps") == sample_fps
            and manifest.get("detectorModelSha256") == DETECTOR_SHA256
            and manifest.get("poseModelSha256") == POSE_SHA256
        ):
            return False
        for entry in manifest.get("clips") or []:
            clip_path = path.parent / entry["clipFile"]
            if not clip_path.is_file() or sha256_file(clip_path) != entry.get("clipSha256"):
                return False
        return bool(manifest.get("clips"))
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return False


def extract_session(task: SessionTask) -> dict[str, Any]:
    session = task.session_id
    output_root = Path(task.output_root)
    shard_root = output_root / "shards" / session
    shard_manifest_path = shard_root / "manifest.json"
    if not task.force and _shard_is_complete(shard_manifest_path, session, task.sample_fps):
        manifest = json.loads(shard_manifest_path.read_text(encoding="utf-8"))
        return {"sessionId": session, "status": "skipped", "clipCount": len(manifest["clips"])}

    video = Path(task.video)
    normalized_root = Path(task.normalized_root)
    video_info = probe_video(video)
    width = int(video_info["widthPx"])
    height = int(video_info["heightPx"])
    fps = float(video_info["fps"])
    video_provenance = {
        "sessionId": session,
        "sourceVideoSha256": sha256_file(video),
        **video_info,
        "mirrored": False,
    }
    clips_by_destination: dict[Path, tuple[dict[str, Any], dict[str, Any]]] = {}
    targets: dict[int, list[Path]] = {}
    for item in task.clip_entries:
        validate_train_item(item)
        clip = load_clip(normalized_root / item["clipFile"])
        destination = shard_root / f"{item['sourceSequenceId'].replace(':', '-')}.json.gz"
        clips_by_destination[destination] = (item, clip)
        frame_numbers = sample_frame_numbers(
            [int(frame["frameNumber"]) for frame in clip["frames"]],
            source_fps=fps,
            sample_fps=task.sample_fps,
        )
        for frame_number in frame_numbers:
            targets.setdefault(frame_number, []).append(destination)
    remaining = set(targets)
    if not remaining:
        raise RuntimeError(f"No official target frames for {session}")
    maximum_target = max(remaining)
    written: dict[Path, list[dict[str, Any]]] = {path: [] for path in clips_by_destination}
    trackers: dict[Path, tuple[tuple[float, float, float, float] | None, float | None]] = {}
    started = time.monotonic()
    processed = 0
    stream = iter_bgr_frames(video, width, height)
    try:
        for frame_index, frame in stream:
            if frame_index > maximum_target:
                break
            destinations = targets.get(frame_index)
            if not destinations:
                continue
            raw_boxes = pose_adapter._DETECTOR(frame)
            candidates = [pose_adapter.clamp_bbox(box, width, height) for box in raw_boxes]
            pose_cache: dict[tuple[float, float, float, float], tuple[list[dict[str, Any]], dict[str, Any]]] = {}
            timestamp_ms = frame_index * 1000.0 / fps
            for destination in destinations:
                previous_bbox, previous_detection_ms = trackers.get(destination, (None, None))
                selected, reason, selection_score = pose_adapter.select_subject_bbox(
                    candidates,
                    previous_bbox,
                    width,
                    height,
                )
                detector_observed = selected is not None
                if selected is not None:
                    previous_bbox = selected
                    previous_detection_ms = timestamp_ms
                elif (
                    previous_bbox is not None
                    and previous_detection_ms is not None
                    and timestamp_ms - previous_detection_ms <= MAX_DETECTOR_HOLD_MS
                ):
                    selected = previous_bbox
                    reason = "detector_gap_pose_hold"
                trackers[destination] = (previous_bbox, previous_detection_ms)
                landmarks: list[dict[str, Any]] = []
                quality = {
                    "meanKeypointScore": 0.0,
                    "observedKeypointCount": 0,
                    "cocoPrefixObservedCount": 0,
                }
                if selected is not None:
                    cache_key = tuple(round(float(value), 3) for value in selected)
                    if cache_key not in pose_cache:
                        pose_cache[cache_key] = _frame_landmarks(frame, selected, width, height)
                    landmarks, quality = pose_cache[cache_key]
                written[destination].append(
                    {
                        "frameNumber": frame_index,
                        "timestampMs": round(timestamp_ms, 3),
                        "candidateBboxes": [
                            pose_adapter.normalized_bbox(box, width, height) for box in candidates
                        ],
                        "selectedBbox": (
                            pose_adapter.normalized_bbox(selected, width, height)
                            if selected is not None
                            else None
                        ),
                        "subjectSelection": {
                            "policy": SUBJECT_POLICY_VERSION,
                            "reason": reason,
                            "score": round(selection_score, 6),
                            "detectorObserved": detector_observed,
                        },
                        "landmarks": landmarks,
                        "observationQuality": quality,
                    }
                )
            remaining.remove(frame_index)
            processed += 1
            if processed % 500 == 0 or not remaining:
                elapsed = max(time.monotonic() - started, 0.001)
                print(
                    json.dumps(
                        {
                            "session": session,
                            "processedTargetFrames": processed,
                            "targetFrameCount": len(targets),
                            "progress": round(processed / len(targets), 4),
                            "targetFramesPerSecond": round(processed / elapsed, 2),
                        }
                    ),
                    file=sys.stderr,
                    flush=True,
                )
            if not remaining:
                break
    finally:
        stream.close()
    if remaining:
        raise RuntimeError(f"RGB session {session} ended before {len(remaining)} requested frames")

    entries = []
    for destination, (item, clip) in sorted(
        clips_by_destination.items(), key=lambda pair: pair[1][0]["sourceSequenceId"]
    ):
        frames = written[destination]
        payload = build_clip_payload(
            item=item,
            source_clip=clip,
            frames=frames,
            detector_hash=DETECTOR_SHA256,
            pose_hash=POSE_SHA256,
            sample_fps=task.sample_fps,
            video_provenance=video_provenance,
        )
        write_deterministic_gzip_json(destination, payload)
        entries.append(
            {
                **item,
                "clipFile": destination.name,
                "frameCount": len(frames),
                "poseDomain": POSE_DOMAIN,
                "clipSha256": sha256_file(destination),
            }
        )
    shard_manifest = {
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "complete": True,
        "datasetId": "mm-fit",
        "poseDomain": POSE_DOMAIN,
        "pipeline": PIPELINE,
        "extractorVersion": EXTRACTOR_VERSION,
        "detectorModelSha256": DETECTOR_SHA256,
        "poseModelSha256": POSE_SHA256,
        "sampleFps": task.sample_fps,
        "requestedSplits": ["train"],
        "requestedSessions": [session],
        "requestedSequences": None,
        "sourceVideos": [video_provenance],
        "clips": entries,
    }
    write_json_atomic(shard_manifest_path, shard_manifest)
    return {
        "sessionId": session,
        "status": "extracted",
        "clipCount": len(entries),
        "targetFrameCount": len(targets),
    }


def merge_complete_train(
    normalized_manifest_path: Path,
    output_root: Path,
    sample_fps: float,
) -> dict[str, Any]:
    normalized = json.loads(normalized_manifest_path.read_text(encoding="utf-8"))
    expected = {
        item["sourceSequenceId"]: item
        for item in normalized["clips"]
        if item["split"] == "train"
    }
    expected_sessions = sorted({source_id.split(":", 1)[0] for source_id in expected})
    merged: dict[str, dict[str, Any]] = {}
    source_videos = []
    shard_manifests = []
    for session in expected_sessions:
        manifest_path = output_root / "shards" / session / "manifest.json"
        if not _shard_is_complete(manifest_path, session, sample_fps):
            raise ValueError(f"MM-Fit RTMPose train shard is incomplete: {session}")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        source_videos.extend(manifest["sourceVideos"])
        shard_manifests.append(
            {
                "sessionId": session,
                "manifestFile": manifest_path.relative_to(output_root).as_posix(),
                "manifestSha256": sha256_file(manifest_path),
            }
        )
        for entry in manifest["clips"]:
            source_id = entry["sourceSequenceId"]
            if source_id in merged:
                raise ValueError(f"Duplicate MM-Fit RTMPose clip: {source_id}")
            clip_path = manifest_path.parent / entry["clipFile"]
            merged[source_id] = {
                **entry,
                "clipFile": clip_path.relative_to(output_root).as_posix(),
            }
    missing = sorted(set(expected) - set(merged))
    unexpected = sorted(set(merged) - set(expected))
    if missing or unexpected:
        raise ValueError(
            f"MM-Fit RTMPose train coverage mismatch: "
            f"missing={','.join(missing) or 'none'}; unexpected={','.join(unexpected) or 'none'}"
        )
    manifest = {
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "complete": True,
        "datasetId": "mm-fit",
        "poseDomain": POSE_DOMAIN,
        "pipeline": PIPELINE,
        "extractorVersion": EXTRACTOR_VERSION,
        "detectorModelSha256": DETECTOR_SHA256,
        "poseModelSha256": POSE_SHA256,
        "sampleFps": sample_fps,
        "requestedSplits": ["train"],
        "requestedSessions": None,
        "requestedSequences": None,
        "sourceVideos": sorted(source_videos, key=lambda item: item["sessionId"]),
        "shardManifests": shard_manifests,
        "clips": [merged[source_id] for source_id in sorted(merged)],
    }
    write_json_atomic(output_root / "manifest.json", manifest)
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rgb-root", type=Path, default=Path("data/external/mm-fit/rgb"))
    parser.add_argument(
        "--normalized-root", type=Path, default=Path("data/external/mm-fit/normalized")
    )
    parser.add_argument(
        "--models", type=Path, default=Path("data/workflows/pose-stack/runtime/models")
    )
    parser.add_argument(
        "--output", type=Path, default=Path("data/external/mm-fit/native-rtmpose-halpe26")
    )
    parser.add_argument("--sample-fps", type=float, default=10.0)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--sessions", nargs="+", default=None)
    parser.add_argument("--sequences", nargs="+", default=None)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    normalized_manifest_path = args.normalized_root / "manifest.json"
    normalized = json.loads(normalized_manifest_path.read_text(encoding="utf-8"))
    clips = [item for item in normalized["clips"] if item.get("split") == "train"]
    if args.sessions:
        requested_sessions = set(args.sessions)
        clips = [
            item
            for item in clips
            if item["sourceSequenceId"].split(":", 1)[0] in requested_sessions
        ]
    if args.sequences:
        requested_sequences = set(args.sequences)
        clips = [item for item in clips if item["sourceSequenceId"] in requested_sequences]
    if not clips:
        raise SystemExit("No official MM-Fit train clips match the request")
    detector_path = pose_adapter.discover_model(args.models, "yolox-nano-humanart")
    pose_path = pose_adapter.discover_model(args.models, "rtmpose-m-halpe26")
    if sha256_file(detector_path) != DETECTOR_SHA256:
        raise SystemExit("YOLOX model checksum mismatch")
    if sha256_file(pose_path) != POSE_SHA256:
        raise SystemExit("RTMPose Halpe-26 model checksum mismatch")

    by_session: dict[str, list[dict[str, Any]]] = {}
    for item in clips:
        validate_train_item(item)
        session = item["sourceSequenceId"].split(":", 1)[0]
        by_session.setdefault(session, []).append(item)
    tasks = []
    for session, entries in sorted(by_session.items()):
        video = args.rgb_root / f"{session}_rgb.mp4"
        if not video.is_file():
            raise SystemExit(f"Missing complete MM-Fit train RGB session: {video}")
        tasks.append(
            SessionTask(
                session_id=session,
                video=str(video.resolve()),
                normalized_root=str(args.normalized_root.resolve()),
                output_root=str(args.output.resolve()),
                clip_entries=tuple(entries),
                sample_fps=args.sample_fps,
                force=args.force,
            )
        )

    results = []
    with ProcessPoolExecutor(
        max_workers=max(1, args.workers),
        initializer=pose_adapter._initialize_worker,
        initargs=(str(detector_path), str(pose_path)),
    ) as executor:
        futures = {executor.submit(extract_session, task): task for task in tasks}
        for completed, future in enumerate(as_completed(futures), start=1):
            result = future.result()
            results.append(result)
            print(
                json.dumps(
                    {"progress": f"{completed}/{len(tasks)}", **result},
                    ensure_ascii=False,
                ),
                flush=True,
            )
    merged = None
    if args.sessions is None and args.sequences is None:
        merged = merge_complete_train(normalized_manifest_path, args.output, args.sample_fps)
    print(
        json.dumps(
            {
                "status": "complete" if merged else "partial",
                "sessions": len(results),
                "clips": len(merged["clips"]) if merged else sum(item["clipCount"] for item in results),
                "output": str(args.output / "manifest.json") if merged else str(args.output / "shards"),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
