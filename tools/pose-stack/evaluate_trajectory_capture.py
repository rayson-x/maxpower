#!/usr/bin/env python3
"""Audit skeleton and equipment trajectory capture without rep-rate substitution."""

from __future__ import annotations

import argparse
import gzip
import json
import math
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np


PIPELINES = (
    "yolox-rtmpose",
    "yolox-rtmpose-bytetrack",
    "yolox-movenet-thunder",
)
JOINT_GROUPS = {
    "shoulder": (5, 6),
    "elbow": (7, 8),
    "wrist": (9, 10),
    "hip": (11, 12),
}
REQUIRED_UPPER_BODY = (5, 6, 7, 8, 9, 10)
UPPER_BODY_BONES = ((5, 7), (7, 9), (6, 8), (8, 10))


def ratio(numerator: int | float, denominator: int | float) -> float | None:
    return float(numerator) / float(denominator) if denominator else None


def quantile(values: Sequence[float], value: float) -> float | None:
    return float(np.quantile(values, value)) if values else None


def frame_in_segments(timestamp_ms: float, segments: Iterable[dict[str, Any]]) -> bool:
    return any(
        float(segment["startMs"]) <= timestamp_ms <= float(segment["endMs"])
        for segment in segments
    )


def torso_scale(landmarks: Sequence[dict[str, Any]]) -> float | None:
    if len(landmarks) != 26 or any(
        float(landmarks[index]["visibility"]) < 0.3 for index in (5, 6, 11, 12)
    ):
        return None
    shoulder_x = (float(landmarks[5]["x"]) + float(landmarks[6]["x"])) / 2.0
    shoulder_y = (float(landmarks[5]["y"]) + float(landmarks[6]["y"])) / 2.0
    hip_x = (float(landmarks[11]["x"]) + float(landmarks[12]["x"])) / 2.0
    hip_y = (float(landmarks[11]["y"]) + float(landmarks[12]["y"])) / 2.0
    scale = math.hypot(shoulder_x - hip_x, shoulder_y - hip_y)
    return scale if scale > 1e-6 else None


def summarize_skeleton_capture(
    sidecars: Sequence[dict[str, Any]],
    segments_by_capture: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    point_totals = {name: 0 for name in JOINT_GROUPS}
    point_observed = {name: 0 for name in JOINT_GROUPS}
    rep_frame_count = 0
    complete_upper_body_frames = 0
    pose_frames = 0
    normalized_jumps: list[float] = []
    catastrophic_jumps = 0
    jump_count = 0
    bone_lengths: dict[tuple[int, int], list[float]] = {bone: [] for bone in UPPER_BODY_BONES}
    per_capture = []
    track_switches = 0
    inference_p95 = []
    for sidecar in sidecars:
        capture_id = sidecar["captureId"]
        segments = segments_by_capture[capture_id]
        selected_frames = [
            frame
            for frame in sidecar["frames"]
            if frame_in_segments(float(frame["timestampMs"]), segments)
        ]
        capture_complete = 0
        capture_pose = 0
        previous: list[dict[str, Any]] | None = None
        for frame in selected_frames:
            landmarks = frame["landmarks"]
            rep_frame_count += 1
            if len(landmarks) != 26:
                previous = None
                continue
            pose_frames += 1
            capture_pose += 1
            complete = all(float(landmarks[index]["visibility"]) >= 0.3 for index in REQUIRED_UPPER_BODY)
            complete_upper_body_frames += int(complete)
            capture_complete += int(complete)
            for name, indices in JOINT_GROUPS.items():
                point_totals[name] += len(indices)
                point_observed[name] += sum(
                    float(landmarks[index]["visibility"]) >= 0.3 for index in indices
                )
            scale = torso_scale(landmarks)
            if scale is not None:
                for bone in UPPER_BODY_BONES:
                    left, right = (landmarks[index] for index in bone)
                    if min(float(left["visibility"]), float(right["visibility"])) < 0.3:
                        continue
                    bone_lengths[bone].append(
                        math.hypot(
                            float(left["x"]) - float(right["x"]),
                            float(left["y"]) - float(right["y"]),
                        )
                        / scale
                    )
                if previous is not None:
                    for index in REQUIRED_UPPER_BODY:
                        if min(
                            float(previous[index]["visibility"]),
                            float(landmarks[index]["visibility"]),
                        ) < 0.3:
                            continue
                        jump = math.hypot(
                            float(previous[index]["x"]) - float(landmarks[index]["x"]),
                            float(previous[index]["y"]) - float(landmarks[index]["y"]),
                        ) / scale
                        normalized_jumps.append(jump)
                        jump_count += 1
                        catastrophic_jumps += int(jump > 0.5)
            previous = landmarks
        summary = sidecar["summary"]
        track_switches += int(summary.get("subjectTrackSwitchCount", 0))
        latency = summary.get("inferenceMs", {}).get("p95")
        if isinstance(latency, (int, float)):
            inference_p95.append(float(latency))
        per_capture.append(
            {
                "sourceCaptureId": capture_id,
                "repFrameCount": len(selected_frames),
                "poseFrameRate": ratio(capture_pose, len(selected_frames)),
                "completeUpperBodyFrameRate": ratio(capture_complete, len(selected_frames)),
            }
        )
    bone_cvs = []
    for values in bone_lengths.values():
        if len(values) > 1 and statistics.mean(values) > 1e-9:
            bone_cvs.append(statistics.pstdev(values) / statistics.mean(values))
    point_rates = {
        name: ratio(point_observed[name], point_totals[name]) for name in JOINT_GROUPS
    }
    complete_rate = ratio(complete_upper_body_frames, rep_frame_count)
    catastrophic_rate = ratio(catastrophic_jumps, jump_count)
    return {
        "scope": "human annotated rep intervals only",
        "sourceCaptureCount": len(sidecars),
        "repFrameCount": rep_frame_count,
        "poseFrameRate": ratio(pose_frames, rep_frame_count),
        "jointCaptureRateAtModelScorePoint3": point_rates,
        "completeUpperBodyFrameRate": complete_rate,
        "necessaryJointNormalizedJumpP95": quantile(normalized_jumps, 0.95),
        "catastrophicJumpThresholdTorsoUnits": 0.5,
        "catastrophicJumpRate": catastrophic_rate,
        "upperBodyBoneLengthCvMean": statistics.mean(bone_cvs) if bone_cvs else None,
        "subjectTrackSwitchCount": track_switches,
        "offlineMacCpuInferenceP95MsMean": statistics.mean(inference_p95) if inference_p95 else None,
        "trajectoryObservabilityProxyPass": bool(
            complete_rate is not None
            and catastrophic_rate is not None
            and complete_rate >= 0.95
            and catastrophic_rate <= 0.01
        ),
        "positionAccuracy": {
            "status": "blocked",
            "humanTruthFrames": 0,
            "requiredHumanTruthFrames": 120,
            "reason": "model confidence and temporal smoothness cannot establish skeleton-to-video alignment",
        },
        "perCapture": per_capture,
    }


def read_gzip_json(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as source:
        return json.load(source)


def barbell_capability(report: dict[str, Any], queue: dict[str, Any]) -> dict[str, Any]:
    videos = report["videos"]
    frame_count = sum(len(video["signal"]["positionsPx"]) for video in videos)
    checkpoint_count = int(report["summary"]["checkpointCount"])
    aligned = int(report["summary"]["directionAlignedCheckpoints"])
    return {
        "status": "offline_one_dimensional_proxy_only",
        "method": report["method"],
        "sourceCaptureCount": len(videos),
        "emittedPathSampleCount": frame_count,
        "sampleFps": sorted({int(video["signal"]["fps"]) for video in videos}),
        "verticalDirectionAgreementAtHumanRepCheckpoints": ratio(aligned, checkpoint_count),
        "medianCandidateSeparationRatioByVideo": [
            {"sourceCaptureId": video["videoId"], "ratio": video["confidenceMedianRatio"]}
            for video in videos
        ],
        "humanReviewedFrameCount": int(queue["stats"]["humanReviewedItems"]),
        "frozenReviewFrameCount": int(queue["stats"]["itemCount"]),
        "axisOrCenterAccuracy": "blocked_no_human_reviewed_axis_truth",
        "trackCoverageAccuracy": "blocked_no_human_reviewed_axis_truth",
        "identitySwitchAccuracy": "blocked_no_trained_detector_or_track_ids",
        "causalRealtime": False,
        "causalBlockers": [
            "background is estimated from the complete source video",
            "median filter reads future samples",
            "thresholds were tuned on all six evaluated videos",
        ],
        "geometry": {
            "available": ["horizontal axis y proxy"],
            "unavailable": ["bbox", "center x", "endpoint positions", "axis angle", "equipment identity"],
        },
        "trainedDetectorAvailable": False,
    }


def dumbbell_capability(queue: dict[str, Any]) -> dict[str, Any]:
    stats = queue["stats"]
    return {
        "status": "unavailable",
        "frozenReviewFrameCount": int(stats["itemCount"]),
        "humanReviewedFrameCount": int(stats["humanReviewedItems"]),
        "sourceSequenceCount": int(stats["sourceSequenceCount"]),
        "subjectCount": int(stats["subjectCount"]),
        "trainedDetectorAvailable": False,
        "liveTrackAvailable": False,
        "reason": "wrist ROI proposals are annotation aids, not dumbbell detections or trajectories",
    }


def percent(value: float | None) -> str:
    return "BLOCK" if value is None else f"{value * 100:.1f}%"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-root", required=True, type=Path)
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument(
        "--barbell-report",
        type=Path,
        default=Path("data/workflows/equipment-validation/bar-axis-v1/legacy-evaluation.json"),
    )
    parser.add_argument(
        "--barbell-queue",
        type=Path,
        default=Path("data/equipment-validation/bar-axis-v1/equipment-review-queue-v1.json.gz"),
    )
    parser.add_argument(
        "--dumbbell-queue",
        type=Path,
        default=Path("data/equipment-validation/mmfit-dumbbell-v1/mmfit-dumbbell-review-queue-v1.json.gz"),
    )
    parser.add_argument("--output-json", required=True, type=Path)
    parser.add_argument("--output-md", required=True, type=Path)
    args = parser.parse_args()

    dataset = json.loads(args.dataset.read_text(encoding="utf-8"))
    segments_by_capture = {
        str(record["sourceCaptureId"]): record["segments"]
        for record in dataset["records"]
    }
    skeleton = []
    labels = {
        "yolox-rtmpose": "YOLOX + RTMPose",
        "yolox-rtmpose-bytetrack": "YOLOX + RTMPose + ByteTrack",
        "yolox-movenet-thunder": "YOLOX + MoveNet Thunder",
    }
    for pipeline_id in PIPELINES:
        root = args.run_root / "observations" / pipeline_id
        sidecars = [read_gzip_json(path) for path in sorted(root.glob("*.halpe26.json.gz"))]
        if len(sidecars) != len(segments_by_capture):
            raise RuntimeError(
                f"{pipeline_id} has {len(sidecars)} sidecars, expected {len(segments_by_capture)}"
            )
        skeleton.append(
            {
                "pipelineId": pipeline_id,
                "label": labels[pipeline_id],
                "metrics": summarize_skeleton_capture(sidecars, segments_by_capture),
            }
        )
    barbell = barbell_capability(
        json.loads(args.barbell_report.read_text(encoding="utf-8")),
        read_gzip_json(args.barbell_queue),
    )
    dumbbell = dumbbell_capability(read_gzip_json(args.dumbbell_queue))
    result = {
        "schemaVersion": "maxpower-skeleton-equipment-trajectory-capability-audit/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "scope": {
            "personalBenchSourceVideos": len(segments_by_capture),
            "skeletonSampleFps": 10,
            "skeletonEvaluationWindow": "human annotated rep intervals",
            "primaryQuestion": "can the system capture continuous skeleton and equipment trajectories",
            "repRecognitionRateUsedAsPrimaryMetric": False,
        },
        "skeleton": skeleton,
        "barbell": barbell,
        "dumbbell": dumbbell,
        "decision": {
            "skeletonTrajectoryCapture": "proxy_metrics_available_but_alignment_accuracy_blocked",
            "barbellTrajectoryCapture": "offline_1d_proxy_exists_but_no_causal_live_tracker",
            "dumbbellTrajectoryCapture": "not_implemented",
            "combinedSkeletonEquipmentLiveCapability": False,
            "productionPromotion": False,
        },
        "requiredNext": [
            "submit frozen human pose truth and score per-joint PCK",
            "submit barbell shaft/negative labels and train source-isolated detector",
            "submit dumbbell instance/negative labels and train detector",
            "run detector on every processed camera frame and associate detections with ByteTrack",
            "score equipment path PCK, coverage, identity switches and causal latency before temporal fusion",
        ],
    }
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    lines = [
        "# 骨架与器械轨迹捕捉能力审计",
        "",
        "本报告不使用计次或动作时间轴准确率代替轨迹能力。",
        "",
        "## 骨架轨迹",
        "",
        "| 方案 | 肩覆盖 | 肘覆盖 | 腕覆盖 | 完整上肢帧 | 灾难跳变 | 主体换轨 | PCK |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for row in skeleton:
        metrics = row["metrics"]
        rates = metrics["jointCaptureRateAtModelScorePoint3"]
        lines.append(
            f"| {row['label']} | {percent(rates['shoulder'])} | {percent(rates['elbow'])} | {percent(rates['wrist'])} | {percent(metrics['completeUpperBodyFrameRate'])} | {percent(metrics['catastrophicJumpRate'])} | {metrics['subjectTrackSwitchCount']} | BLOCK |"
        )
    lines.extend(
        [
            "",
            "模型 score≥0.3 只表示模型愿意输出，不表示点位贴合人体。0/120 人工关键点真值导致 PCK 继续阻塞。",
            "",
            "## 器械轨迹",
            "",
            f"- 杠铃：现有原型在 6 条视频输出 {barbell['emittedPathSampleCount']} 个 15 FPS 的 Y 轴样本，人工 rep 检查点方向一致率 {percent(barbell['verticalDirectionAgreementAtHumanRepCheckpoints'])}；但它读取完整视频背景和未来帧，只是一维离线 proxy，不是实时 detector/tracker。554 帧人工轴线标注仍为 0。",
            f"- 哑铃：冻结队列 {dumbbell['frozenReviewFrameCount']} 帧、{dumbbell['sourceSequenceCount']} 段、{dumbbell['subjectCount']} 人，人工实例标注仍为 0；当前没有哑铃 detector 或实时 track。",
            "",
            "## 当前结论",
            "",
            "当前只能证明三套姿态模型都能连续发出骨架观察，以及离线算法能提取与卧推周期相关的一维杠铃信号；不能证明骨架贴合，也不能证明摄像头实时捕捉了杠铃/哑铃真实轨迹。",
            "",
            f"机器可读结果：`{args.output_json.resolve()}`",
        ]
    )
    args.output_md.parent.mkdir(parents=True, exist_ok=True)
    args.output_md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(result["decision"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
