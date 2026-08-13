#!/usr/bin/env python3
"""Extract native BlazePose33 observations for MM-Fit RGB clips.

The normalized OpenPose clips already carry the official global video frame
numbers and set-count labels. This extractor uses those frame numbers to
sample the matching RGB session, so the output remains aligned to the
official split and never manufactures rep boundaries.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from fractions import Fraction
import gzip
import hashlib
import importlib.metadata
import io
import json
from pathlib import Path
import subprocess
import sys
import time
import types
from typing import Any, Iterator


EXTRACTOR_VERSION = "mmfit-native-mediapipe33/v2"
POSE_DOMAIN = "mmfit_mediapipe33_heavy_cpu"
LANDMARKER_OPTIONS = {
    "runningMode": "VIDEO",
    "numPoses": 1,
    "minPoseDetectionConfidence": 0.5,
    "minPosePresenceConfidence": 0.5,
    "minTrackingConfidence": 0.5,
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rgb-root", type=Path, default=Path("data/external/mm-fit/rgb"))
    parser.add_argument("--normalized-root", type=Path, default=Path("data/external/mm-fit/normalized"))
    parser.add_argument("--output", type=Path, default=Path("data/external/mm-fit/native-mediapipe33-heavy"))
    parser.add_argument("--model", type=Path, default=Path("public/models/pose_landmarker_heavy.task"))
    parser.add_argument("--splits", nargs="+", default=["train"])
    parser.add_argument("--sessions", nargs="+", default=None)
    parser.add_argument("--sequences", nargs="+", default=None)
    return parser.parse_args()


def load_clip(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        return json.load(stream)


def write_deterministic_gzip_json(destination: Path, payload: dict[str, Any]) -> None:
    temporary = destination.with_name(f"{destination.name}.tmp")
    try:
        with temporary.open("wb") as raw_stream:
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw_stream, compresslevel=6, mtime=0) as compressed:
                with io.TextIOWrapper(compressed, encoding="utf-8") as text_stream:
                    json.dump(
                        payload,
                        text_stream,
                        ensure_ascii=False,
                        allow_nan=False,
                        separators=(",", ":"),
                        sort_keys=True,
                    )
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def write_json_atomic(destination: Path, payload: dict[str, Any]) -> None:
    temporary = destination.with_name(f"{destination.name}.tmp")
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def landmark_dict(landmark: Any) -> dict[str, float]:
    return {
        "x": float(landmark.x),
        "y": float(landmark.y),
        "z": float(landmark.z),
        "visibility": float(getattr(landmark, "visibility", 0.0)),
        "presence": float(getattr(landmark, "presence", 0.0)),
    }


@contextmanager
def create_session_landmarker(pose_landmarker_type: Any, options: Any) -> Iterator[Any]:
    """Reset VIDEO timestamps and tracking state at every source-video boundary."""
    with pose_landmarker_type.create_from_options(options) as landmarker:
        yield landmarker


def load_mediapipe_tasks_runtime() -> Any:
    """Load Tasks Vision without importing unused legacy drawing/model-maker APIs."""
    distribution = importlib.metadata.distribution("mediapipe")
    package_root = distribution.locate_file("mediapipe")
    if "mediapipe" not in sys.modules:
        package = types.ModuleType("mediapipe")
        package.__path__ = [str(package_root)]
        package.__package__ = "mediapipe"
        sys.modules["mediapipe"] = package
    from mediapipe.python._framework_bindings.image import Image
    from mediapipe.python._framework_bindings.image_frame import ImageFormat
    from mediapipe.tasks.python.core.base_options import BaseOptions
    from mediapipe.tasks.python.vision.core.vision_task_running_mode import VisionTaskRunningMode
    from mediapipe.tasks.python.vision.pose_landmarker import PoseLandmarker, PoseLandmarkerOptions

    return types.SimpleNamespace(
        version=distribution.version,
        Image=Image,
        ImageFormat=ImageFormat,
        BaseOptions=BaseOptions,
        PoseLandmarker=PoseLandmarker,
        PoseLandmarkerOptions=PoseLandmarkerOptions,
        VisionRunningMode=VisionTaskRunningMode,
    )


def parse_frame_rate(value: str) -> float:
    rate = float(Fraction(value))
    if rate <= 0:
        raise ValueError(f"invalid video frame rate: {value}")
    return rate


def probe_video(video: Path) -> dict[str, Any]:
    command = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,avg_frame_rate,nb_frames,duration",
        "-of", "json", str(video),
    ]
    try:
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
    except (FileNotFoundError, subprocess.CalledProcessError) as error:
        raise RuntimeError(f"ffprobe failed for {video}: {error}") from error
    streams = json.loads(completed.stdout).get("streams", [])
    if len(streams) != 1:
        raise RuntimeError(f"Expected exactly one video stream in {video}")
    stream = streams[0]
    fps = parse_frame_rate(stream["avg_frame_rate"])
    frame_count_value = stream.get("nb_frames")
    if isinstance(frame_count_value, str) and frame_count_value.isdigit():
        frame_count = int(frame_count_value)
    else:
        duration = float(stream.get("duration", 0.0))
        frame_count = int(round(duration * fps))
    return {
        "widthPx": int(stream["width"]),
        "heightPx": int(stream["height"]),
        "fps": fps,
        "frameCount": frame_count,
    }


def read_exact(stream: Any, byte_count: int) -> bytes:
    chunks: list[bytes] = []
    remaining = byte_count
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            if not chunks:
                return b""
            raise EOFError(f"truncated raw RGB frame: expected {byte_count} bytes")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def iter_rgb_frames(video: Path, width_px: int, height_px: int, numpy: Any) -> Iterator[tuple[int, Any]]:
    command = [
        "ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(video),
        "-map", "0:v:0", "-fps_mode", "passthrough",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
    ]
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError as error:
        raise RuntimeError("ffmpeg is required for MM-Fit RGB extraction") from error
    if process.stdout is None or process.stderr is None:
        process.kill()
        raise RuntimeError("ffmpeg pipes could not be created")
    frame_byte_count = width_px * height_px * 3
    natural_eof = False
    try:
        frame_index = 0
        while True:
            payload = read_exact(process.stdout, frame_byte_count)
            if not payload:
                natural_eof = True
                break
            yield frame_index, numpy.frombuffer(payload, dtype=numpy.uint8).reshape((height_px, width_px, 3))
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
            raise RuntimeError(f"ffmpeg failed for {video}: {error_output or process.returncode}")


def build_manifest_entry(
    item: dict[str, Any],
    destination: Path,
    frame_count: int,
    model_hash: str,
    clip_hash: str,
) -> dict[str, Any]:
    return {
        **item,
        "clipFile": destination.name,
        "frameCount": frame_count,
        "poseDomain": POSE_DOMAIN,
        "modelAssetSha256": model_hash,
        "clipSha256": clip_hash,
    }


def build_clip_payload(
    *,
    item: dict[str, Any],
    source_clip: dict[str, Any],
    frames: list[dict[str, Any]],
    model_hash: str,
    mediapipe_version: str,
    video_provenance: dict[str, Any],
) -> dict[str, Any]:
    label = source_clip["label"]
    if label.get("annotationGranularity") != "set_count" or label.get("repBounds") != []:
        raise ValueError(f"MM-Fit RGB extraction cannot manufacture per-rep truth: {item['sourceSequenceId']}")
    return {
        "schemaVersion": "maxpower-mmfit-native-pose/v2",
        "sourceSequenceId": item["sourceSequenceId"],
        "subjectId": item["subjectId"],
        "split": item["split"],
        "sourceAction": item["sourceAction"],
        "exerciseId": item["exerciseId"],
        "poseDomain": POSE_DOMAIN,
        "observation": {
            "modelAssetSha256": model_hash,
            "mediapipeRuntimeVersion": mediapipe_version,
            "delegate": "CPU",
            "landmarkerOptions": dict(LANDMARKER_OPTIONS),
            "sourceVideo": video_provenance,
            "extractorVersion": EXTRACTOR_VERSION,
        },
        "label": label,
        "repBounds": [],
        "frames": frames,
    }


def main() -> None:
    args = parse_args()
    manifest = json.loads((args.normalized_root / "manifest.json").read_text(encoding="utf-8"))
    clips = [item for item in manifest["clips"] if item["split"] in args.splits]
    if args.sessions:
        requested_sessions = set(args.sessions)
        clips = [item for item in clips if item["sourceSequenceId"].split(":", 1)[0] in requested_sessions]
    if args.sequences:
        requested_sequences = set(args.sequences)
        clips = [item for item in clips if item["sourceSequenceId"] in requested_sequences]
    if not clips:
        raise SystemExit("No normalized clips match the requested splits")
    if not args.model.is_file():
        raise SystemExit(f"Missing MediaPipe model asset: {args.model}")
    try:
        import numpy as np
        mp_runtime = load_mediapipe_tasks_runtime()
    except (ModuleNotFoundError, importlib.metadata.PackageNotFoundError) as error:
        raise SystemExit(
            "Missing RGB extraction dependency. Use the pinned MM-Fit MediaPipe runtime before extraction: "
            f"{getattr(error, 'name', None) or error}"
        ) from error

    args.output.mkdir(parents=True, exist_ok=True)
    model_hash = sha256_file(args.model)
    by_session: dict[str, list[dict[str, Any]]] = {}
    for item in clips:
        clip = load_clip(args.normalized_root / item["clipFile"])
        session = item["sourceSequenceId"].split(":", 1)[0]
        by_session.setdefault(session, []).append({"manifest": item, "clip": clip})

    BaseOptions = mp_runtime.BaseOptions
    PoseLandmarker = mp_runtime.PoseLandmarker
    PoseLandmarkerOptions = mp_runtime.PoseLandmarkerOptions
    VisionRunningMode = mp_runtime.VisionRunningMode
    options = PoseLandmarkerOptions(
        base_options=BaseOptions(
            model_asset_path=str(args.model),
            delegate=BaseOptions.Delegate.CPU,
        ),
        running_mode=VisionRunningMode.VIDEO,
        num_poses=LANDMARKER_OPTIONS["numPoses"],
        min_pose_detection_confidence=LANDMARKER_OPTIONS["minPoseDetectionConfidence"],
        min_pose_presence_confidence=LANDMARKER_OPTIONS["minPosePresenceConfidence"],
        min_tracking_confidence=LANDMARKER_OPTIONS["minTrackingConfidence"],
    )

    output_manifest: list[dict[str, Any]] = []
    source_videos: list[dict[str, Any]] = []
    for session, session_clips in sorted(by_session.items()):
        video = args.rgb_root / f"{session}_rgb.mp4"
        if not video.is_file():
            raise SystemExit(f"Missing complete RGB session for {session}: {video}")
        video_info = probe_video(video)
        fps = video_info["fps"]
        width_px = video_info["widthPx"]
        height_px = video_info["heightPx"]
        video_provenance = {
            "sessionId": session,
            "sourceVideoSha256": sha256_file(video),
            **video_info,
            "mirrored": False,
        }
        source_videos.append(video_provenance)
        targets: dict[int, list[tuple[dict[str, Any], Path]]] = {}
        for entry in session_clips:
            clip = entry["clip"]
            destination = args.output / f"{entry['manifest']['sourceSequenceId'].replace(':', '-')}.json.gz"
            for frame in clip["frames"]:
                targets.setdefault(int(frame["frameNumber"]), []).append((frame, destination))
        remaining = set(targets)
        target_frame_count = len(remaining)
        processed_target_frames = 0
        extraction_started = time.monotonic()
        written: dict[Path, list[dict[str, Any]]] = {}
        frame_stream = iter_rgb_frames(video, width_px, height_px, np)
        try:
            # MediaPipe VIDEO mode requires monotonically increasing timestamps.
            # A fresh tracker per source video also prevents cross-subject state.
            with create_session_landmarker(PoseLandmarker, options) as landmarker:
                while remaining:
                    try:
                        frame_index, rgb = next(frame_stream)
                    except StopIteration:
                        break
                    if frame_index not in remaining:
                        continue
                    timestamp_ms = int(round(frame_index * 1000.0 / fps))
                    image = mp_runtime.Image(image_format=mp_runtime.ImageFormat.SRGB, data=rgb)
                    result = landmarker.detect_for_video(image, timestamp_ms)
                    pose = result.pose_landmarks[0] if result.pose_landmarks else []
                    world = result.pose_world_landmarks[0] if result.pose_world_landmarks else []
                    row = {
                        "frameNumber": frame_index,
                        "timestampMs": timestamp_ms,
                        "landmarks": [landmark_dict(point) for point in pose],
                        "worldLandmarks": [landmark_dict(point) for point in world],
                        "image": {"widthPx": width_px, "heightPx": height_px, "mirrored": False},
                    }
                    for _, destination in targets[frame_index]:
                        written.setdefault(destination, []).append(row)
                    remaining.remove(frame_index)
                    processed_target_frames += 1
                    if processed_target_frames % 500 == 0 or not remaining:
                        elapsed_seconds = max(time.monotonic() - extraction_started, 0.001)
                        print(json.dumps({
                            "session": session,
                            "processedTargetFrames": processed_target_frames,
                            "targetFrameCount": target_frame_count,
                            "progress": round(processed_target_frames / target_frame_count, 4),
                            "targetFramesPerSecond": round(processed_target_frames / elapsed_seconds, 2),
                        }), file=sys.stderr, flush=True)
        finally:
            frame_stream.close()
        if remaining:
            raise SystemExit(f"RGB session {session} ended before {len(remaining)} requested frames")
        for entry in session_clips:
            item = entry["manifest"]
            destination = args.output / f"{item['sourceSequenceId'].replace(':', '-')}.json.gz"
            payload = build_clip_payload(
                item=item,
                source_clip=entry["clip"],
                frames=written[destination],
                model_hash=model_hash,
                mediapipe_version=mp_runtime.version,
                video_provenance=video_provenance,
            )
            write_deterministic_gzip_json(destination, payload)
            output_manifest.append(build_manifest_entry(
                item,
                destination,
                len(payload["frames"]),
                model_hash,
                sha256_file(destination),
            ))

    output = {
        "schemaVersion": "maxpower-mmfit-native-pose-manifest/v2",
        "complete": True,
        "poseDomain": POSE_DOMAIN,
        "modelAssetSha256": model_hash,
        "mediapipeRuntimeVersion": mp_runtime.version,
        "delegate": "CPU",
        "landmarkerOptions": LANDMARKER_OPTIONS,
        "extractorVersion": EXTRACTOR_VERSION,
        "requestedSplits": args.splits,
        "requestedSessions": args.sessions,
        "requestedSequences": args.sequences,
        "sourceVideos": source_videos,
        "clips": sorted(output_manifest, key=lambda item: item["sourceSequenceId"]),
    }
    write_json_atomic(args.output / "manifest.json", output)
    print(json.dumps({"output": str(args.output), "clipCount": len(output_manifest), "poseDomain": POSE_DOMAIN, "modelAssetSha256": model_hash}, ensure_ascii=False))


if __name__ == "__main__":
    main()
