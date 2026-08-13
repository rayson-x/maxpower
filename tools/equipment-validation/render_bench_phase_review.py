#!/usr/bin/env python3
"""Render native-FPS bench videos with honest phase-evidence overlays.

Human truth contributes rep start/end ranges only. The yellow turnaround marker
is an algorithmic bar-axis maximum and is never presented as a human label.
"""

from __future__ import annotations

import argparse
import bisect
import gzip
import json
import subprocess
from pathlib import Path
from typing import Any, Sequence

import cv2


COLORS = {
    "human": (80, 240, 120),
    "eccentric": (255, 150, 40),
    "concentric": (20, 145, 255),
    "turnaround": (0, 245, 255),
    "white": (245, 245, 245),
    "muted": (165, 175, 180),
}


def read_json(path: Path) -> dict[str, Any]:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as source:
            return json.load(source)
    return json.loads(path.read_text(encoding="utf-8"))


def segment_at(segments: Sequence[dict[str, Any]], timestamp_ms: float) -> tuple[int, dict[str, Any]] | None:
    for index, segment in enumerate(segments):
        if float(segment["startMs"]) <= timestamp_ms <= float(segment["endMs"]):
            return index, segment
    return None


def nearest_frame(frames: Sequence[dict[str, Any]], timestamps: Sequence[float], timestamp_ms: float) -> dict[str, Any] | None:
    if not frames:
        return None
    index = bisect.bisect_left(timestamps, timestamp_ms)
    candidates = [candidate for candidate in (index - 1, index) if 0 <= candidate < len(frames)]
    if not candidates:
        return None
    selected = min(candidates, key=lambda candidate: abs(timestamps[candidate] - timestamp_ms))
    return frames[selected]


def draw_text(frame: Any, text: str, origin: tuple[int, int], color: tuple[int, int, int], scale: float = 0.68) -> None:
    cv2.putText(frame, text, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), 4, cv2.LINE_AA)
    cv2.putText(frame, text, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, color, 2, cv2.LINE_AA)


def draw_timeline(
    frame: Any,
    duration_ms: float,
    timestamp_ms: float,
    human: Sequence[dict[str, Any]],
    predicted: Sequence[dict[str, Any]],
) -> None:
    height, width = frame.shape[:2]
    left, right = 24, width - 24
    top, bottom = height - 74, height - 32
    overlay = frame.copy()
    cv2.rectangle(overlay, (left - 8, top - 12), (right + 8, bottom + 12), (8, 12, 16), -1)
    cv2.addWeighted(overlay, 0.72, frame, 0.28, 0, frame)
    cv2.line(frame, (left, top), (right, top), (75, 82, 86), 2)
    cv2.line(frame, (left, bottom), (right, bottom), (75, 82, 86), 2)

    def x_at(value: float) -> int:
        return round(left + max(0.0, min(1.0, value / max(1.0, duration_ms))) * (right - left))

    for segment in human:
        cv2.line(
            frame,
            (x_at(float(segment["startMs"])), top),
            (x_at(float(segment["endMs"])), top),
            COLORS["human"],
            7,
        )
    for segment in predicted:
        peak_x = x_at(float(segment["peakMs"]))
        cv2.line(frame, (peak_x, bottom - 8), (peak_x, bottom + 8), COLORS["turnaround"], 3)
    cursor = x_at(timestamp_ms)
    cv2.line(frame, (cursor, top - 9), (cursor, bottom + 9), COLORS["white"], 2)


def render_capture(
    project_root: Path,
    output_root: Path,
    record: dict[str, Any],
    prediction: dict[str, Any],
    sidecar_path: Path,
) -> dict[str, Any]:
    capture_id = str(record["sourceCaptureId"])
    source_video = project_root / "public/archives/confirmed-captures" / str(record["source"]["video"])
    sidecar = read_json(sidecar_path)
    frames = sidecar["frames"]
    timestamps = [float(frame["timestampMs"]) for frame in frames]
    human_ranges = record["segments"]
    predicted = prediction["predictedSegments"]

    capture = cv2.VideoCapture(str(source_video))
    if not capture.isOpened():
        raise RuntimeError(f"unable to open {source_video}")
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    duration_ms = frame_count / max(fps, 1.0) * 1000.0

    output_root.mkdir(parents=True, exist_ok=True)
    temporary = output_root / f"{capture_id}.bench-phase-review.avi"
    output = output_root / f"{capture_id}.bench-phase-review.mp4"
    writer = cv2.VideoWriter(
        str(temporary),
        cv2.VideoWriter_fourcc(*"MJPG"),
        fps,
        (width, height),
    )
    if not writer.isOpened():
        capture.release()
        raise RuntimeError(f"unable to create {temporary}")

    index = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            timestamp_ms = index / max(fps, 1.0) * 1000.0
            observed = nearest_frame(frames, timestamps, timestamp_ms)
            axis = observed.get("axis") if observed else None
            if axis is not None:
                start = (round(float(axis["x1"]) * width), round(float(axis["y1"]) * height))
                end = (round(float(axis["x2"]) * width), round(float(axis["y2"]) * height))
                center = (
                    round((start[0] + end[0]) / 2),
                    round((start[1] + end[1]) / 2),
                )
                cv2.line(frame, start, end, COLORS["turnaround"], 4, cv2.LINE_AA)
                cv2.circle(frame, center, 7, COLORS["turnaround"], -1, cv2.LINE_AA)

            panel = frame.copy()
            cv2.rectangle(panel, (0, 0), (width, 166), (5, 9, 13), -1)
            cv2.addWeighted(panel, 0.72, frame, 0.28, 0, frame)
            draw_text(frame, "GREEN = HUMAN START/END RANGE (NO HUMAN PEAK)", (22, 34), COLORS["human"], 0.62)
            draw_text(frame, "YELLOW = ALGORITHM BAR AXIS / BOTTOM TURNAROUND", (22, 66), COLORS["turnaround"], 0.58)

            human_match = segment_at(human_ranges, timestamp_ms)
            if human_match:
                human_index, human_segment = human_match
                draw_text(
                    frame,
                    f"HUMAN RANGE REP {human_index + 1}: {human_segment['startMs']/1000:.2f}s - {human_segment['endMs']/1000:.2f}s",
                    (22, 101),
                    COLORS["human"],
                    0.62,
                )
            else:
                draw_text(frame, "OUTSIDE HUMAN REP RANGE", (22, 101), COLORS["muted"], 0.62)

            predicted_match = segment_at(predicted, timestamp_ms)
            if predicted_match:
                predicted_index, segment = predicted_match
                peak_ms = float(segment["peakMs"])
                if abs(timestamp_ms - peak_ms) <= max(100.0, 1000.0 / max(fps, 1.0) * 2):
                    phase = "ALGORITHM BOTTOM TURNAROUND"
                    color = COLORS["turnaround"]
                elif timestamp_ms < peak_ms:
                    phase = "ECCENTRIC / DESCENT CANDIDATE"
                    color = COLORS["eccentric"]
                else:
                    phase = "CONCENTRIC / ASCENT CANDIDATE"
                    color = COLORS["concentric"]
                draw_text(
                    frame,
                    f"ALGO REP {predicted_index + 1}: {phase} | bottom={peak_ms/1000:.2f}s",
                    (22, 137),
                    color,
                    0.62,
                )
            else:
                draw_text(frame, "NO ALGORITHM REP PHASE", (22, 137), COLORS["muted"], 0.62)

            draw_timeline(frame, duration_ms, timestamp_ms, human_ranges, predicted)
            draw_text(frame, f"t={timestamp_ms/1000:.2f}s | video={fps:.1f}fps | detector=10fps", (22, height - 91), COLORS["white"], 0.55)
            writer.write(frame)
            index += 1
    finally:
        writer.release()
        capture.release()

    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", str(temporary), "-an",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output),
        ],
        check=True,
    )
    temporary.unlink(missing_ok=True)
    return {
        "captureId": capture_id,
        "capturePosition": record.get("capturePosition"),
        "humanRangeCount": len(human_ranges),
        "algorithmTurnaroundCount": len(predicted),
        "sourceVideoFps": fps,
        "detectorFps": float(sidecar["inferenceContract"]["sampleFps"]),
        "output": str(output),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path("data/workflows/pose-stack-comparison/front-bench-v1/run-2026-08-12/dataset/personal-golden-front-bench-v1.json"),
    )
    parser.add_argument(
        "--predictions",
        type=Path,
        default=Path("data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/blind-bench-recognition/predictions-before-label-reveal.json"),
    )
    parser.add_argument(
        "--sidecar-root",
        type=Path,
        default=Path("data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/observations"),
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/phase-review-overlays"),
    )
    args = parser.parse_args()
    project_root = args.project_root.resolve()
    dataset = read_json(project_root / args.dataset)
    predictions = read_json(project_root / args.predictions)
    prediction_by_id = {str(row["captureId"]): row for row in predictions["rows"]}
    rows = []
    for record in dataset["records"]:
        capture_id = str(record["sourceCaptureId"])
        rows.append(render_capture(
            project_root,
            project_root / args.output_root,
            record,
            prediction_by_id[capture_id],
            project_root / args.sidecar_root / f"{capture_id}.barbell-pose-alignment.json.gz",
        ))
        print(json.dumps(rows[-1], ensure_ascii=False), flush=True)
    manifest = {
        "schemaVersion": "maxpower-bench-phase-review-overlay/v1",
        "humanTruthContract": "start_and_end_ranges_only",
        "algorithmicEvidence": "bar_axis_and_bottom_turnaround",
        "humanPeakTruthAvailable": False,
        "productionPromotionAllowed": False,
        "rows": rows,
    }
    manifest_path = project_root / args.output_root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
