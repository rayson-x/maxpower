#!/usr/bin/env python3
"""PROTOTYPE: validate whether a moving bar axis can count labelled bench reps.

This deliberately avoids a learned detector. It estimates a static background,
finds the strongest moving horizontal paired edge in every frame, and feeds that
one-dimensional observation through a small hysteresis counter. The purpose is
to establish whether equipment motion is observable before training a mobile
detector, not to become production recognition code.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import numpy as np


@dataclass(frozen=True)
class VideoCase:
    video: Path
    metadata: dict
    labels: dict


def run_bytes(command: list[str]) -> bytes:
    return subprocess.check_output(command)


def iter_gray_frames(video: Path, fps: int, width: int, height: int) -> Iterator[np.ndarray]:
    command = [
        "ffmpeg",
        "-v",
        "error",
        "-i",
        str(video),
        "-vf",
        f"fps={fps},scale={width}:{height},format=gray",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "-",
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE)
    assert process.stdout is not None
    frame_bytes = width * height
    try:
        while True:
            raw = process.stdout.read(frame_bytes)
            if len(raw) < frame_bytes:
                break
            yield np.frombuffer(raw, dtype=np.uint8).reshape(height, width)
    finally:
        process.stdout.close()
        return_code = process.wait()
        if return_code != 0:
            raise RuntimeError(f"ffmpeg failed for {video} with exit code {return_code}")


def estimate_background(video: Path, width: int, height: int) -> np.ndarray:
    raw = run_bytes(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(video),
            "-vf",
            f"fps=3,scale={width}:{height},format=gray",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "gray",
            "-",
        ]
    )
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, height, width)
    return np.median(frames, axis=0).astype(np.float32)


def moving_horizontal_axis_signal(
    video: Path,
    fps: int,
    width: int,
    height: int,
) -> tuple[np.ndarray, np.ndarray]:
    background = estimate_background(video, width, height)
    y_min = round(height * 0.125)
    y_max = round(height * 0.594)
    positions: list[int] = []
    confidences: list[float] = []

    for source in iter_gray_frames(video, fps, width, height):
        frame = source.astype(np.float32)
        foreground = np.clip(np.abs(frame - background) - 10.0, 0.0, 80.0) / 80.0
        vertical_gradient = np.abs(np.diff(frame, axis=0, prepend=frame[:1]))
        row_score = np.mean((vertical_gradient * foreground)[:, 4:-4], axis=1)

        # A bar has two long horizontal edges. Pair rows separated by 3..9 px
        # at the validation resolution rather than trusting a single bright row.
        paired_score = np.zeros(height, dtype=np.float32)
        for separation in range(3, 10):
            paired_score = np.maximum(
                paired_score,
                np.roll(row_score, separation) + np.roll(row_score, -separation),
            )

        search = paired_score[y_min:y_max]
        relative_y = int(np.argmax(search))
        y = relative_y + y_min
        best = float(search[relative_y])
        suppressed = search.copy()
        suppressed[max(0, relative_y - 8) : relative_y + 9] = 0.0
        second = float(np.max(suppressed))
        positions.append(y)
        confidences.append(best / max(second, 1e-6))

    return median_filter(np.asarray(positions, dtype=np.float32), radius=3), np.asarray(
        confidences, dtype=np.float32
    )


def median_filter(values: np.ndarray, radius: int) -> np.ndarray:
    result = np.empty_like(values)
    for index in range(len(values)):
        result[index] = np.median(values[max(0, index - radius) : index + radius + 1])
    return result


def dominant_top_position(signal: np.ndarray) -> float:
    # Four-pixel bins are wide enough to merge the two physical rod edges while
    # retaining separation from the bottom position.
    bins = np.round(signal / 4.0).astype(np.int32)
    values, counts = np.unique(bins, return_counts=True)
    return float(values[int(np.argmax(counts))] * 4)


def count_cycles(signal: np.ndarray, fps: int, frame_height: int) -> tuple[list[dict], dict]:
    top = dominant_top_position(signal)
    # Tuned once across all six known videos. The problematic oblique clip only
    # exposes the rod cleanly for a short window around the bottom, so a long
    # minimum-duration gate drops real reps even though their peaks are clear.
    # These are development-corpus parameters, not a promoted product profile.
    resolution_scale = frame_height / 640.0
    enter_delta = 32.0 * resolution_scale
    return_delta = 14.0 * resolution_scale
    minimum_amplitude = 32.0 * resolution_scale
    minimum_frames = round(0.25 * fps)
    maximum_frames = round(6.0 * fps)

    state = "ready"
    start_index = 0
    peak_index = 0
    peak_y = -math.inf
    cycles: list[dict] = []

    for index, y in enumerate(signal):
        if state == "ready":
            if y >= top + enter_delta:
                state = "effort"
                start_index = index
                peak_index = index
                peak_y = float(y)
        else:
            if y > peak_y:
                peak_y = float(y)
                peak_index = index
            if y <= top + return_delta:
                duration_frames = index - start_index
                amplitude = peak_y - top
                if minimum_frames <= duration_frames <= maximum_frames and amplitude >= minimum_amplitude:
                    cycles.append(
                        {
                            "startMs": round(start_index * 1000 / fps),
                            "extremeMs": round(peak_index * 1000 / fps),
                            "endMs": round(index * 1000 / fps),
                            "amplitudePx": round(amplitude, 2),
                        }
                    )
                state = "ready"

    return cycles, {
        "topPx": round(top, 2),
        "enterDeltaPx": round(enter_delta, 2),
        "returnDeltaPx": round(return_delta, 2),
        "minimumAmplitudePx": round(minimum_amplitude, 2),
    }


def phase_checkpoint_evidence(labels: list[dict], signal: np.ndarray, fps: int) -> list[dict]:
    evidence: list[dict] = []
    for label in labels:
        positions: dict[str, float] = {}
        for field in ("startMs", "extremeMs", "endMs"):
            frame_index = min(len(signal) - 1, round(label[field] * fps / 1000))
            positions[field] = round(float(signal[frame_index]), 2)
        amplitude = positions["extremeMs"] - (positions["startMs"] + positions["endMs"]) / 2
        evidence.append(
            {
                "repIndex": label["repIndex"],
                "positionsPx": positions,
                "amplitudePx": round(amplitude, 2),
                "directionAligned": amplitude > 0,
            }
        )
    return evidence


def overlaps_label(cycle: dict, label: dict) -> bool:
    return label["startMs"] <= cycle["extremeMs"] <= label["endMs"]


def evaluate_case(case: VideoCase, fps: int, width: int, height: int) -> dict:
    signal, confidence = moving_horizontal_axis_signal(case.video, fps, width, height)
    cycles, thresholds = count_cycles(signal, fps, height)
    labels = case.labels["labels"]
    matched_labels = {
        label["repIndex"]
        for label in labels
        if any(overlaps_label(cycle, label) for cycle in cycles)
    }
    matched_cycles = sum(any(overlaps_label(cycle, label) for label in labels) for cycle in cycles)
    checkpoint = phase_checkpoint_evidence(labels, signal, fps)
    return {
        "videoId": case.video.stem,
        "cameraView": case.metadata.get("cameraView"),
        "expectedCount": len(labels),
        "predictedCount": len(cycles),
        "matchedLabelCount": len(matched_labels),
        "falseCycleCount": len(cycles) - matched_cycles,
        "exactSet": len(cycles) == len(labels) and len(matched_labels) == len(labels),
        "directionAlignedCheckpoints": sum(item["directionAligned"] for item in checkpoint),
        "checkpointCount": len(checkpoint),
        "confidenceMedianRatio": round(float(np.median(confidence)), 3),
        "thresholds": thresholds,
        "cycles": cycles,
        "checkpointEvidence": checkpoint,
        "signal": {
            "fps": fps,
            "width": width,
            "height": height,
            "positionsPx": [round(float(value), 2) for value in signal],
            "confidenceRatios": [round(float(value), 3) for value in confidence],
        },
    }


def discover_cases(root: Path) -> list[VideoCase]:
    cases: list[VideoCase] = []
    for video in sorted(root.glob("*.mp4")):
        metadata_path = video.with_suffix(".metadata.json")
        labels_path = video.with_suffix(".labels.json")
        if not metadata_path.exists() or not labels_path.exists():
            continue
        metadata = json.loads(metadata_path.read_text())
        if metadata.get("exerciseId") != "barbell_bench_press":
            continue
        cases.append(VideoCase(video, metadata, json.loads(labels_path.read_text())))
    return cases


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--captures",
        type=Path,
        default=Path("public/archives/confirmed-captures/chest"),
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fps", type=int, default=15)
    parser.add_argument("--width", type=int, default=360)
    parser.add_argument("--height", type=int, default=640)
    args = parser.parse_args()

    cases = discover_cases(args.captures)
    results = [evaluate_case(case, args.fps, args.width, args.height) for case in cases]
    expected = sum(result["expectedCount"] for result in results)
    predicted = sum(result["predictedCount"] for result in results)
    matched = sum(result["matchedLabelCount"] for result in results)
    output = {
        "schemaVersion": "bar-axis-equipment-validation/v1",
        "prototype": True,
        "method": "static-background moving horizontal paired-edge",
        "summary": {
            "videoCount": len(results),
            "expectedRepCount": expected,
            "predictedRepCount": predicted,
            "matchedRepCount": matched,
            "exactSetCount": sum(result["exactSet"] for result in results),
            "directionAlignedCheckpoints": sum(
                result["directionAlignedCheckpoints"] for result in results
            ),
            "checkpointCount": sum(result["checkpointCount"] for result in results),
        },
        "videos": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(output["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
