#!/usr/bin/env python3
"""Run one randomized bench video through the models exactly once.

The run has two hard stages:

1. choose from a truth-free pack and consume the video chronologically with
   YOLOX + RTMPose + the causal bar-axis prototype;
2. persist the prediction, then (and only then) open human review truth and
   write the comparison report.

The file source is paced like a 10 FPS camera stream. Frames that miss their
start deadline are dropped instead of being inferred later. Playback review is
therefore an audit of the frozen first pass, never a second recognition pass.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

import cv2
import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
POSE_STACK_DIR = SCRIPT_DIR.parent / "pose-stack"
for module_dir in (SCRIPT_DIR, POSE_STACK_DIR):
    if str(module_dir) not in sys.path:
        sys.path.insert(0, str(module_dir))

import evaluate_realtime_bench_stream as realtime  # noqa: E402
import extract_personal_halpe26 as pose_extract  # noqa: E402
import prototype_barbell_pose_alignment as bar_axis  # noqa: E402


SCHEMA_VERSION = "maxpower-single-pass-bench-acceptance/v1"
PREDICTION_SCHEMA = "maxpower-single-pass-bench-prediction/v1"
DEFAULT_SEED = "maxpower-single-pass-bench-2026-08-12-v1"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def select_capture(pack: dict[str, Any], seed: str) -> dict[str, Any]:
    if pack.get("schemaVersion") != realtime.PACK_SCHEMA:
        raise ValueError("unsupported truth-free stream pack")
    leaked = realtime.truth_paths(pack)
    if leaked:
        raise ValueError(f"truth leaked before random selection: {leaked[:5]}")
    capture_ids = list(pack["captureOrder"])
    random.Random(seed).shuffle(capture_ids)
    selected_id = capture_ids[0]
    return next(capture for capture in pack["captures"] if capture["captureId"] == selected_id)


def _normalized_landmarks(
    points: np.ndarray,
    scores: np.ndarray,
    width: int,
    height: int,
) -> list[dict[str, Any]]:
    if len(points) != 26 or len(scores) != 26:
        raise RuntimeError(f"expected Halpe-26, got {points.shape} and {scores.shape}")
    return [
        {
            "x": round(float(point[0]) / width, 7),
            "y": round(float(point[1]) / height, 7),
            "z": None,
            "visibility": round(max(0.0, min(1.0, float(score))), 7),
        }
        for point, score in zip(points, scores)
    ]


def _percent(value: int, total: int) -> float:
    return round(value / total, 6) if total else 0.0


def _finalize_recognizer(
    recognizer: realtime.CausalBenchStreamRecognizer,
    frames: Sequence[dict[str, Any]],
) -> dict[str, Any]:
    recognizer.finish()
    confirmed = recognizer.cadence.confirmed
    return {
        "rawCandidateCount": len(recognizer.raw_candidates),
        "confirmedRepCount": len(confirmed),
        "rejectedIsolatedCandidateCount": len(recognizer.cadence.rejected),
        "events": recognizer.events,
        "trajectory": recognizer.trajectory,
        "predictedSegments": [
            {**segment, "bilateral": realtime.bilateral_metrics(frames, segment)}
            for segment in confirmed
        ],
        "futureFrameReadCount": 0,
    }


def infer_video_once(
    *,
    project_root: Path,
    capture: dict[str, Any],
    detector_path: Path,
    pose_path: Path,
    sample_fps: float,
    maximum_start_lag_ms: float,
    pace_realtime: bool,
) -> dict[str, Any]:
    source_path = (project_root / str(capture["sourceVideo"])).resolve()
    if not source_path.is_file():
        raise FileNotFoundError(source_path)

    from rtmlib import RTMPose, YOLOX

    cv2.setNumThreads(1)
    detector = YOLOX(
        str(detector_path),
        model_input_size=(416, 416),
        score_thr=0.3,
        backend="onnxruntime",
        device="cpu",
    )
    pose = RTMPose(
        str(pose_path),
        model_input_size=(192, 256),
        backend="onnxruntime",
        device="cpu",
    )
    video = cv2.VideoCapture(str(source_path))
    if not video.isOpened():
        raise RuntimeError(f"unable to open {source_path}")

    source_fps = float(video.get(cv2.CAP_PROP_FPS))
    if not math.isfinite(source_fps) or source_fps <= 0:
        source_fps = 30.0
    width = int(video.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(video.get(cv2.CAP_PROP_FRAME_HEIGHT))
    sample_period_ms = 1000.0 / sample_fps
    next_sample_ms = 0.0
    previous_timestamp_ms = -1.0
    previous_bbox: tuple[float, float, float, float] | None = None
    previous_detection_ms: float | None = None
    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    tracker = bar_axis.TrackedAxis()
    background: np.ndarray | None = None
    recognizer = realtime.CausalBenchStreamRecognizer(sample_fps=sample_fps)
    observations: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []
    inference_durations: list[float] = []
    end_to_end_latencies: list[float] = []
    decoded_frame_count = 0
    source_frame_number = -1
    wall_started = time.perf_counter()

    try:
        while True:
            ok, frame = video.read()
            if not ok:
                break
            source_frame_number += 1
            decoded_frame_count += 1
            container_ms = float(video.get(cv2.CAP_PROP_POS_MSEC))
            fallback_ms = source_frame_number / source_fps * 1000.0
            timestamp_ms = (
                container_ms
                if math.isfinite(container_ms) and container_ms >= previous_timestamp_ms
                else fallback_ms
            )
            previous_timestamp_ms = timestamp_ms
            if timestamp_ms + 0.5 < next_sample_ms:
                continue
            while next_sample_ms <= timestamp_ms + 0.5:
                next_sample_ms += sample_period_ms

            scheduled_wall = wall_started + timestamp_ms / 1000.0
            now = time.perf_counter()
            if pace_realtime and now < scheduled_wall:
                time.sleep(scheduled_wall - now)
                now = time.perf_counter()
            start_lag_ms = max(0.0, (now - scheduled_wall) * 1000.0)
            if pace_realtime and start_lag_ms > maximum_start_lag_ms:
                dropped.append(
                    {
                        "frameNumber": source_frame_number,
                        "timestampMs": round(timestamp_ms, 3),
                        "reason": "inference_backpressure_start_deadline_missed",
                        "startLagMs": round(start_lag_ms, 3),
                    }
                )
                continue

            inference_started = time.perf_counter()
            raw_boxes = detector(frame)
            candidates = [pose_extract.clamp_bbox(box, width, height) for box in raw_boxes]
            selected, selection_reason, selection_score = pose_extract.select_subject_bbox(
                candidates, previous_bbox, width, height
            )
            detector_observed = selected is not None
            if selected is not None:
                previous_bbox = selected
                previous_detection_ms = timestamp_ms
            elif (
                previous_bbox is not None
                and previous_detection_ms is not None
                and timestamp_ms - previous_detection_ms <= pose_extract.MAX_DETECTOR_HOLD_MS
            ):
                selected = previous_bbox
                selection_reason = "detector_gap_pose_hold"

            landmarks: list[dict[str, Any]] = []
            if selected is not None:
                keypoints, scores = pose(frame, bboxes=[selected])
                landmarks = _normalized_landmarks(keypoints[0], scores[0], width, height)

            render_width = min(720, width)
            render_height = max(1, round(height * render_width / width))
            resized = cv2.resize(frame, (render_width, render_height), interpolation=cv2.INTER_AREA)
            gray = cv2.GaussianBlur(cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY), (3, 3), 0)
            if background is None:
                background = gray.astype(np.float32)
            axis_candidates = bar_axis.detect_axis_candidates(gray, background, landmarks, lsd)
            axis = tracker.update(axis_candidates, render_width, render_height)
            background = 0.99 * background + 0.01 * gray.astype(np.float32)
            inference_finished = time.perf_counter()
            inference_ms = (inference_finished - inference_started) * 1000.0
            end_to_end_ms = (inference_finished - scheduled_wall) * 1000.0
            inference_durations.append(inference_ms)
            end_to_end_latencies.append(end_to_end_ms)

            observation = {
                "frameNumber": source_frame_number,
                "timestampMs": round(timestamp_ms, 3),
                "axis": axis,
                "landmarks": landmarks,
                "subjectSelection": {
                    "reason": selection_reason,
                    "score": round(float(selection_score), 6),
                    "detectorObserved": detector_observed,
                },
                "candidatePersonCount": len(candidates),
                "barAxisCandidateCount": len(axis_candidates),
                "runtime": {
                    "startLagMs": round(start_lag_ms, 3),
                    "modelAndAxisInferenceMs": round(inference_ms, 3),
                    "captureToResultMs": round(end_to_end_ms, 3),
                    "inferenceOrdinal": len(observations) + 1,
                },
            }
            observations.append(observation)
            recognizer.update(observation)
    finally:
        video.release()

    recognition = _finalize_recognizer(recognizer, observations)
    wall_elapsed_ms = (time.perf_counter() - wall_started) * 1000.0
    scheduled_samples = len(observations) + len(dropped)
    return {
        "schemaVersion": PREDICTION_SCHEMA,
        "generatedAt": utc_now(),
        "captureId": str(capture["captureId"]),
        "sourceVideo": str(capture["sourceVideo"]),
        "sourceVideoSha256": realtime.sha256(source_path),
        "onePassContract": {
            "chronologicalOnly": True,
            "seekCount": 0,
            "modelInferenceAtMostOncePerFrame": True,
            "secondRecognitionPass": False,
            "labelsAvailableDuringInference": False,
            "futureFramesRead": False,
            "lateFramePolicy": "drop_not_recompute",
            "sourceMode": "prerecorded_video_paced_as_camera_stream",
            "actualCameraCapture": False,
        },
        "runtimePipeline": {
            "person": "YOLOX-nano HumanArt",
            "pose": "RTMPose-m Halpe-26",
            "equipment": "causal LSD horizontal-shaft prototype; not trained YOLOX equipment",
            "repTimeline": "Python causal state machine; not Rust SDK production runtime",
            "device": "local macOS CPU / ONNX Runtime",
            "sampleFpsTarget": sample_fps,
            "maximumStartLagMs": maximum_start_lag_ms,
        },
        "runtimeSummary": {
            "sourceFps": round(source_fps, 6),
            "decodedFrameCount": decoded_frame_count,
            "scheduledSampleCount": scheduled_samples,
            "inferredSampleCount": len(observations),
            "droppedBackpressureFrameCount": len(dropped),
            "inferenceCoverage": _percent(len(observations), scheduled_samples),
            "wallElapsedMs": round(wall_elapsed_ms, 3),
            "modelAndAxisInferenceMs": {
                "median": realtime.percentile(inference_durations, 0.50),
                "p95": realtime.percentile(inference_durations, 0.95),
                "max": round(max(inference_durations), 3) if inference_durations else None,
            },
            "captureToResultMs": {
                "median": realtime.percentile(end_to_end_latencies, 0.50),
                "p95": realtime.percentile(end_to_end_latencies, 0.95),
                "max": round(max(end_to_end_latencies), 3) if end_to_end_latencies else None,
            },
        },
        "droppedFrames": dropped,
        "observations": observations,
        **recognition,
    }


def _trajectory_summary(prediction: dict[str, Any]) -> dict[str, Any]:
    segments = prediction["predictedSegments"]
    provisional = [item["bilateral"] for item in segments if item["bilateral"]["status"] == "provisional_model_evidence"]
    bar_tilt = [
        float(item["barEndpointHeightDifferenceImageRatioP95"])
        for item in provisional
        if item.get("barEndpointHeightDifferenceImageRatioP95") is not None
    ]
    endpoint_gaps = [
        float(item["barEndpointTurnaroundGapMs"])
        for item in provisional
        if item.get("barEndpointTurnaroundGapMs") is not None
    ]
    return {
        "status": "measured_not_graded" if provisional else "cannot_judge",
        "provisionalRepCount": len(provisional),
        "barEndpointHeightDifferenceImageRatioP95Median": realtime.percentile(bar_tilt, 0.50),
        "barEndpointTurnaroundGapMsMedian": realtime.percentile(endpoint_gaps, 0.50),
        "interpretation": "visible bar coordination only; not left/right force and not yet compared with a coach-reviewed standard envelope",
    }


def compare_after_prediction_frozen(
    *,
    prediction_path: Path,
    selection_path: Path,
    reviews_path: Path,
    report_path: Path,
) -> dict[str, Any]:
    prediction = realtime.read_json(prediction_path)
    selection = realtime.read_json(selection_path)
    if prediction["captureId"] != selection["selectedCaptureId"]:
        raise ValueError("selection/prediction capture mismatch")
    truth_by_capture = realtime.latest_review_truth(reviews_path)
    capture_id = str(prediction["captureId"])
    if capture_id not in truth_by_capture:
        raise ValueError("submitted human truth not found after prediction freeze")
    truth_event = truth_by_capture[capture_id]
    truths = truth_event["reps"]
    predictions = prediction["predictedSegments"]
    matches = realtime.match_segments(predictions, truths)
    rep_rows: list[dict[str, Any]] = []
    for match in matches:
        predicted = predictions[int(match["predictionIndex"])]
        truth = truths[int(match["truthIndex"])]
        rep_rows.append(
            {
                "repIndex": int(truth["repIndex"]),
                "truth": {
                    "startMs": float(truth["startMs"]),
                    "turnaroundMs": float(truth["turnaroundMs"]),
                    "endMs": float(truth["endMs"]),
                    "turnaroundSource": truth.get("turnaroundSource"),
                },
                "prediction": {
                    "startMs": float(predicted["startMs"]),
                    "turnaroundMs": float(predicted["turnaroundMs"]),
                    "turnaroundConfirmedAtMs": float(predicted["turnaroundConfirmedAtMs"]),
                    "endMs": float(predicted["endMs"]),
                    "amplitudePxAtReferenceHeight": float(predicted["amplitudePxAtReferenceHeight"]),
                    "axisFrameCoverage": float(predicted["axisFrameCoverage"]),
                    "meanAxisConfidence": float(predicted["meanAxisConfidence"]),
                },
                "error": {
                    "startMs": match["startOffsetMs"],
                    "turnaroundMs": match["turnaroundOffsetMs"],
                    "endMs": match["endOffsetMs"],
                    "turnaroundConfirmationDelayMs": match["turnaroundConfirmationDelayMs"],
                    "intervalIoU": match["intervalIoU"],
                },
            }
        )

    exact_count = len(predictions) == len(truths) and len(matches) == len(truths)
    turnaround_rate = _percent(sum(row["error"]["turnaroundMs"] <= 250 and row["error"]["turnaroundMs"] >= -250 for row in rep_rows), len(truths))
    start_mae = realtime.mean_absolute(row["error"]["startMs"] for row in rep_rows)
    end_mae = realtime.mean_absolute(row["error"]["endMs"] for row in rep_rows)
    mean_iou = round(statistics.mean(row["error"]["intervalIoU"] for row in rep_rows), 6) if rep_rows else 0.0
    phase_pass = (
        exact_count
        and start_mae is not None
        and end_mae is not None
        and start_mae <= 500.0
        and end_mae <= 500.0
        and mean_iou >= 0.60
    )
    runtime = prediction["runtimeSummary"]
    realtime_runtime_pass = (
        runtime["inferenceCoverage"] >= 0.95
        and runtime["captureToResultMs"]["p95"] is not None
        and runtime["captureToResultMs"]["p95"] <= 250.0
    )
    completion = {
        "repCompletion": {
            "status": "pass" if exact_count else "fail",
            "truthCount": len(truths),
            "predictedCount": len(predictions),
            "matchedCount": len(matches),
        },
        "lowestPointTiming": {
            "status": "pass" if exact_count and turnaround_rate >= 0.95 else "fail",
            "within250MsRate": turnaround_rate,
            "truthLimitation": "turnarounds were human-confirmed from visible algorithm candidates, not independently placed blind points",
        },
        "phaseBoundaries": {
            "status": "pass" if phase_pass else "needs_improvement",
            "startAbsoluteErrorMsMean": start_mae,
            "endAbsoluteErrorMsMean": end_mae,
            "meanIntervalIoU": mean_iou,
        },
        "singlePassRuntime": {
            "status": "pass" if realtime_runtime_pass else "fail",
            "inferenceCoverage": runtime["inferenceCoverage"],
            "captureToResultP95Ms": runtime["captureToResultMs"]["p95"],
            "droppedBackpressureFrameCount": runtime["droppedBackpressureFrameCount"],
        },
        "trajectoryAndBilateral": _trajectory_summary(prediction),
        "standardTechnique": {
            "status": "cannot_judge",
            "reason": "no coach-reviewed acceptable/deviation envelope has been independently validated for this exact bench variant, view, body geometry and training intent",
        },
    }
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": utc_now(),
        "protocol": {
            "selectionSeed": selection["selectionSeed"],
            "randomizedBeforeTruthReveal": True,
            "predictionSha256": realtime.sha256(prediction_path),
            "predictionPersistedBeforeTruthLoaded": True,
            **prediction["onePassContract"],
        },
        "capture": {
            "captureId": capture_id,
            "capturePosition": truth_event.get("capturePosition"),
            "sourceVideo": prediction["sourceVideo"],
        },
        "runtime": runtime,
        "completion": completion,
        "repComparison": rep_rows,
        "truth": {
            "reviewEventId": truth_event.get("eventId"),
            "recordedAt": truth_event.get("recordedAt"),
            "humanPeakTruth": truth_event.get("humanPeakTruth"),
            "reps": truths,
        },
        "prediction": {
            "predictedSegments": predictions,
            "rawCandidateCount": prediction["rawCandidateCount"],
            "rejectedIsolatedCandidateCount": prediction["rejectedIsolatedCandidateCount"],
        },
        "decision": {
            "onePassVideoAcceptance": exact_count and turnaround_rate >= 0.95 and phase_pass and realtime_runtime_pass,
            "movementTaskUnderstood": exact_count and turnaround_rate >= 0.95,
            "standardTechniqueUnderstood": False,
            "actualLiveCameraProven": False,
            "productionRustSdkProven": False,
            "productionPromotion": False,
        },
    }
    realtime.write_json(report_path, report)
    return report


def write_markdown(path: Path, report: dict[str, Any]) -> None:
    completion = report["completion"]
    runtime = report["runtime"]
    rows = report["repComparison"]
    lines = [
        "# 随机单视频：严格一次识别验收",
        "",
        f"- Capture：`{report['capture']['captureId']}`（{report['capture']['capturePosition']}）",
        f"- 计次：{completion['repCompletion']['predictedCount']} / {completion['repCompletion']['truthCount']}，{completion['repCompletion']['status']}。",
        f"- 最低点 ≤250 ms：{completion['lowestPointTiming']['within250MsRate']:.1%}，{completion['lowestPointTiming']['status']}。",
        f"- 起止边界：start MAE {completion['phaseBoundaries']['startAbsoluteErrorMsMean']} ms，end MAE {completion['phaseBoundaries']['endAbsoluteErrorMsMean']} ms，IoU {completion['phaseBoundaries']['meanIntervalIoU']:.3f}。",
        f"- 实时节奏：输入覆盖 {runtime['inferenceCoverage']:.1%}，丢帧 {runtime['droppedBackpressureFrameCount']}，capture→result P95 {runtime['captureToResultMs']['p95']} ms。",
        "- 标准动作：暂不可判断；当前没有经教练审核且独立验证的标准/偏差 envelope。",
        "- 这是本地视频按摄像头节奏的一次性模型推理，不是实际摄像头，也不是 Rust SDK 生产运行时。",
        "",
        "| Rep | truth start/bottom/end | predicted start/bottom/end | error start/bottom/end | IoU |",
        "| ---: | --- | --- | --- | ---: |",
    ]
    for row in rows:
        truth = row["truth"]
        pred = row["prediction"]
        error = row["error"]
        lines.append(
            f"| {row['repIndex']} | {truth['startMs']:.0f}/{truth['turnaroundMs']:.0f}/{truth['endMs']:.0f} | "
            f"{pred['startMs']:.0f}/{pred['turnaroundMs']:.0f}/{pred['endMs']:.0f} | "
            f"{error['startMs']:+.0f}/{error['turnaroundMs']:+.0f}/{error['endMs']:+.0f} | {error['intervalIoU']:.3f} |"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", default=DEFAULT_SEED)
    parser.add_argument("--sample-fps", type=float, default=10.0)
    parser.add_argument("--maximum-start-lag-ms", type=float, default=100.0)
    parser.add_argument("--no-pace", action="store_true")
    parser.add_argument(
        "--pack",
        type=Path,
        default=Path("data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/realtime-causal-replay-v1/stream-pack-without-truth.json.gz"),
    )
    parser.add_argument(
        "--reviews",
        type=Path,
        default=Path("data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/bench-phase-review-events-v1.jsonl"),
    )
    parser.add_argument(
        "--models",
        type=Path,
        default=Path("data/workflows/pose-stack/runtime/models"),
    )
    parser.add_argument(
        "--run-root",
        type=Path,
        default=Path("data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/single-pass-random-v1"),
    )
    parser.add_argument(
        "--report-json",
        type=Path,
        default=Path(
            "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/single-pass-random-v1/evaluation-after-truth.json"
        ),
    )
    parser.add_argument(
        "--report-md",
        type=Path,
        default=Path(
            "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/single-pass-random-v1/evaluation-after-truth.md"
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_root = Path.cwd().resolve()
    pack_path = (project_root / args.pack).resolve()
    pack = realtime.read_json(pack_path)
    selected = select_capture(pack, args.seed)
    args.run_root.mkdir(parents=True, exist_ok=True)
    selection_path = args.run_root / "selection-before-truth.json"
    prediction_path = args.run_root / "prediction-before-truth.json"
    selection = {
        "schemaVersion": "maxpower-single-pass-random-selection/v1",
        "selectedAt": utc_now(),
        "selectionSeed": args.seed,
        "candidateCaptureCount": len(pack["captureOrder"]),
        "selectedCaptureId": selected["captureId"],
        "truthAvailableAtSelection": False,
        "packSha256": realtime.sha256(pack_path),
    }
    realtime.write_json(selection_path, selection)
    print(json.dumps({"stage": "selected", **selection}, ensure_ascii=False), flush=True)

    detector_path = pose_extract.discover_model((project_root / args.models).resolve(), "yolox-nano-humanart")
    pose_path = pose_extract.discover_model((project_root / args.models).resolve(), "rtmpose-m-halpe26")
    if pose_extract.sha256_file(detector_path) != pose_extract.DETECTOR_SHA256:
        raise RuntimeError("YOLOX model checksum mismatch")
    if pose_extract.sha256_file(pose_path) != pose_extract.POSE_SHA256:
        raise RuntimeError("RTMPose model checksum mismatch")
    prediction = infer_video_once(
        project_root=project_root,
        capture=selected,
        detector_path=detector_path,
        pose_path=pose_path,
        sample_fps=args.sample_fps,
        maximum_start_lag_ms=args.maximum_start_lag_ms,
        pace_realtime=not args.no_pace,
    )
    realtime.write_json(prediction_path, prediction)
    print(
        json.dumps(
            {
                "stage": "prediction_frozen_before_truth",
                "captureId": prediction["captureId"],
                "predictedReps": prediction["confirmedRepCount"],
                "inferredSamples": prediction["runtimeSummary"]["inferredSampleCount"],
                "droppedSamples": prediction["runtimeSummary"]["droppedBackpressureFrameCount"],
                "output": str(prediction_path),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    report = compare_after_prediction_frozen(
        prediction_path=prediction_path,
        selection_path=selection_path,
        reviews_path=(project_root / args.reviews).resolve(),
        report_path=(project_root / args.report_json).resolve(),
    )
    write_markdown((project_root / args.report_md).resolve(), report)
    print(json.dumps({"stage": "truth_revealed_and_compared", "completion": report["completion"], "decision": report["decision"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
