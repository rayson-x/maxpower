#!/usr/bin/env python3
"""Extract one immutable Halpe-26 observation stream for each new-video source.

Exercise assignments are provisional routing metadata only. They are never
used by YOLOX or RTMPose and are not treated as ground truth.
"""

from __future__ import annotations

import argparse
import json
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import cv2

from extract_personal_halpe26 import (
    DETECTOR_SHA256,
    POSE_SHA256,
    ExtractionTask,
    _initialize_worker,
    discover_model,
    extract_video,
    sha256_file,
)


def video_metadata(path: Path) -> tuple[float, int]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"Unable to open video: {path}")
    fps = float(capture.get(cv2.CAP_PROP_FPS)) or 30.0
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    capture.release()
    duration_ms = frame_count / fps * 1000.0
    return duration_ms, frame_count


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--assignments", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--models", type=Path, default=Path("data/workflows/pose-stack/runtime/models"))
    parser.add_argument("--sample-fps", type=float, default=10.0)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    project_root = Path.cwd().resolve()
    input_dir = args.input.resolve()
    output_dir = args.output.resolve()
    assignment_document = json.loads(args.assignments.read_text(encoding="utf-8"))
    assignments = assignment_document["assignments"]
    videos = sorted(input_dir.glob("*.mp4"))
    if not videos:
        raise RuntimeError(f"No MP4 files found in {input_dir}")
    unknown = [video.stem for video in videos if video.stem not in assignments]
    if unknown:
        raise RuntimeError(f"Missing provisional assignments: {unknown}")

    detector_path = discover_model((project_root / args.models).resolve(), "yolox-nano-humanart")
    pose_path = discover_model((project_root / args.models).resolve(), "rtmpose-m-halpe26")
    if sha256_file(detector_path) != DETECTOR_SHA256:
        raise RuntimeError("YOLOX model checksum mismatch")
    if sha256_file(pose_path) != POSE_SHA256:
        raise RuntimeError("RTMPose Halpe-26 model checksum mismatch")

    tasks: list[ExtractionTask] = []
    sources = []
    for video in videos:
        duration_ms, frame_count = video_metadata(video)
        assignment = assignments[video.stem]
        tasks.append(ExtractionTask(
            capture_id=video.stem,
            source_video=str(video),
            source_relpath=str(video),
            output_file=str(output_dir / "halpe26" / f"{video.stem}.halpe26.json.gz"),
            declared_duration_ms=duration_ms,
            declared_frame_count=frame_count,
            sample_fps=args.sample_fps,
            force=args.force,
        ))
        sources.append({
            "captureId": video.stem,
            "video": str(video),
            "videoSha256": sha256_file(video),
            "durationMs": round(duration_ms, 3),
            "frameCount": frame_count,
            "exerciseId": assignment["exerciseId"],
            "capturePosition": assignment["capturePosition"],
            "selectedEquipment": assignment.get("selectedEquipment", "none"),
            "assignmentSource": "visual_provisional",
            "groundTruthStatus": "unlabeled",
            "notes": assignment.get("notes", ""),
        })

    results = []
    with ProcessPoolExecutor(
        max_workers=max(1, args.workers),
        initializer=_initialize_worker,
        initargs=(str(detector_path), str(pose_path)),
    ) as executor:
        future_to_task = {executor.submit(extract_video, task): task for task in tasks}
        for completed, future in enumerate(as_completed(future_to_task), start=1):
            result = future.result()
            results.append(result)
            print(json.dumps({"progress": f"{completed}/{len(tasks)}", **result}, ensure_ascii=False), flush=True)

    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schemaVersion": "maxpower-new-video-provisional-recognition-source/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "truthPolicy": "unlabeled: candidate inference only; no accuracy claim",
        "inferencePassPolicy": "each video is extracted once in chronological order at 10 fps",
        "sources": sources,
        "extractionResults": sorted(results, key=lambda result: result["captureId"]),
    }
    manifest_path = output_dir / "source-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"manifest": str(manifest_path), "sourceCount": len(sources)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
