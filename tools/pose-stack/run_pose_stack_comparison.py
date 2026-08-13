#!/usr/bin/env python3
"""Reproducible end-to-end runner for personal pose-stack comparison."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PIPELINES = (
    "yolox-rtmpose",
    "yolox-rtmpose-bytetrack",
    "yolox-movenet-thunder",
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run(command: list[str], project_root: Path) -> None:
    subprocess.run(command, cwd=project_root, check=True)


def ratio(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def materialize_dataset(source: Path, target: Path, exercise_id: str) -> dict[str, Any]:
    value = json.loads(source.read_text(encoding="utf-8"))
    records = [record for record in value["records"] if record["exerciseId"] == exercise_id]
    if not records:
        raise RuntimeError(f"No records for exercise: {exercise_id}")
    filtered = {
        **value,
        "schemaVersion": "maxpower-personal-pose-stack-comparison-dataset/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "dataset": str(source),
            "sha256": sha256_file(source),
            "filter": {"exerciseId": exercise_id},
        },
        "records": records,
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(filtered, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return filtered


def extraction_metrics(run_root: Path, pipeline_id: str) -> dict[str, Any]:
    sidecar_root = run_root / "observations" / pipeline_id
    summaries = []
    for path in sorted(sidecar_root.glob("*.halpe26.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as source:
            value = json.load(source)
        summaries.append(value["summary"])
    if not summaries:
        raise RuntimeError(f"No sidecars for {pipeline_id}")

    def mean(path: tuple[str, ...]) -> float | None:
        values = []
        for summary in summaries:
            value: Any = summary
            for key in path:
                value = value.get(key) if isinstance(value, dict) else None
            if isinstance(value, (int, float)):
                values.append(float(value))
        return round(sum(values) / len(values), 6) if values else None

    return {
        "sourceCaptureCount": len(summaries),
        "sampledFrameCount": sum(int(item["sampledFrameCount"]) for item in summaries),
        "poseFrameRateMean": mean(("poseFrameRate",)),
        "detectorObservedFrameRatioMean": mean(("detectorObservedFrameRatio",)),
        "subjectTrackIdCount": sum(int(item["subjectTrackIdCount"]) for item in summaries),
        "subjectTrackSwitchCount": sum(int(item["subjectTrackSwitchCount"]) for item in summaries),
        "inferenceMsMean": mean(("inferenceMs", "mean")),
        "inferenceMsP50Mean": mean(("inferenceMs", "p50")),
        "inferenceMsP95Mean": mean(("inferenceMs", "p95")),
        "necessaryJointModelScoreMean": mean(("poseDiagnostics", "necessaryJointModelScoreMean")),
        "necessaryJointScoreAtLeastPoint3RateMean": mean(("poseDiagnostics", "necessaryJointScoreAtLeastPoint3Rate")),
        "necessaryJointNormalizedJumpP95Mean": mean(("poseDiagnostics", "necessaryJointNormalizedJumpP95")),
        "upperBodyBoneLengthCvMean": mean(("poseDiagnostics", "upperBodyBoneLengthCvMean")),
        "keypointAccuracy": {
            "status": "blocked",
            "reason": "0/120 frozen frames have submitted human keypoint consensus; model score is not PCK",
        },
    }


def temporal_metrics(path: Path) -> dict[str, Any]:
    report = json.loads(path.read_text(encoding="utf-8"))
    summary = report["leaveOneSourceOut"]["summary"]
    truth = int(summary["truthRangeCount"])
    predicted = int(summary["predictedCount"])
    matched = int(summary["matchedCount"])
    aligned = int(summary["manualRangeAlignedCount"])
    sources = int(summary["sourceCaptureCount"])
    return {
        "protocol": report["evaluationProtocol"],
        "truthRangeCount": truth,
        "predictedCount": predicted,
        "matchedCount": matched,
        "candidatePrecision": ratio(matched, predicted),
        "candidateRecall": ratio(matched, truth),
        "manualRangeAlignedCount": aligned,
        "manualRangeAlignedRate": ratio(aligned, truth),
        "sourceCaptureCount": sources,
        "exactSetSourceCaptureCount": int(summary["exactSetSourceCaptureCount"]),
        "exactSetSourceCaptureRate": ratio(int(summary["exactSetSourceCaptureCount"]), sources),
        "exactSetAndManualRangeSourceCaptureCount": int(
            summary["exactSetAndManualRangeSourceCaptureCount"]
        ),
        "exactSetAndManualRangeSourceCaptureRate": ratio(
            int(summary["exactSetAndManualRangeSourceCaptureCount"]), sources
        ),
        "researchOnly": True,
    }


def percent(value: float | None) -> str:
    return "BLOCK" if value is None else f"{value * 100:.1f}%"


def write_report(run_root: Path, rows: list[dict[str, Any]], output_json: Path, output_md: Path) -> None:
    best_timeline = max(
        rows,
        key=lambda item: (
            item["temporal"]["manualRangeAlignedRate"] or 0.0,
            item["temporal"]["candidateRecall"] or 0.0,
            item["temporal"]["candidatePrecision"] or 0.0,
        ),
    )
    report = {
        "schemaVersion": "maxpower-personal-pose-stack-comparison/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "scope": {
            "exerciseId": "barbell_bench_press",
            "completeSourceVideos": rows[0]["temporal"]["sourceCaptureCount"],
            "sampleFps": 10.0,
            "evaluation": "exhaustive leave-one-source-out by sourceCaptureId",
        },
        "runtime": {
            "system": platform.platform(),
            "processor": platform.processor(),
            "python": platform.python_version(),
            "performanceBoundary": "offline macOS CPU; not Android/iOS/Web performance",
        },
        "comparison": rows,
        "decision": {
            "bestObservedTimelinePipeline": best_timeline["pipelineId"],
            "poseAccuracyWinner": None,
            "poseAccuracyStatus": "blocked_pending_120_frame_human_keypoint_truth",
            "promotionEligible": False,
            "warning": "timeline and stability cannot select a pose-accuracy winner without human PCK truth",
        },
        "productionProfileModified": False,
        "runRoot": str(run_root),
    }
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    lines = [
        "# 个人卧推姿态栈三方案冻结对比",
        "",
        f"日期：{report['generatedAt']}",
        "",
        "## 结论边界",
        "",
        "三套方案已经在相同完整视频、相同 10 FPS 采样和相同 Rust canonical + 视频级 LOO 时序训练协议下运行。骨架 PCK 仍被 0/120 人工关键点真值阻塞；下表的模型分数与抖动指标不能冒充骨架准确率。",
        "",
        "| 方案 | 时间区间对齐 | 计次 precision | 计次 recall | 整段精确计次 | 姿态覆盖 | 平均 p95 推理 | 主体换轨 | 骨架 PCK |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for row in rows:
        extraction = row["extraction"]
        temporal = row["temporal"]
        lines.append(
            "| {label} | {aligned} | {precision} | {recall} | {exact} | {coverage} | {latency:.1f} ms | {switches} | BLOCK |".format(
                label=row["label"],
                aligned=percent(temporal["manualRangeAlignedRate"]),
                precision=percent(temporal["candidatePrecision"]),
                recall=percent(temporal["candidateRecall"]),
                exact=percent(temporal["exactSetSourceCaptureRate"]),
                coverage=percent(extraction["poseFrameRateMean"]),
                latency=extraction["inferenceMsP95Mean"] or 0.0,
                switches=extraction["subjectTrackSwitchCount"],
            )
        )
    lines.extend(
        [
            "",
            "## 解释",
            "",
            f"- 当前时序指标最高的是 `{best_timeline['pipelineId']}`，但这只说明它在当前姿态输出上更适合现有时序学习器，不证明其关键点更准确。",
            "- ByteTrack 只改变跨帧人体框关联；RTMPose 单帧 pose head 完全相同。",
            "- MoveNet 只提供 COCO-17，Halpe 17–25 保持 unknown。",
            "- 真正选择姿态主链前，必须完成冻结 120 帧人工关键点并分别报告肩、肘、腕、髋 PCK。",
            "- 本轮不修改生产 recognition profile，不做 promotion。",
            "",
            f"机器可读结果：`{output_json}`",
        ]
    )
    output_md.parent.mkdir(parents=True, exist_ok=True)
    output_md.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--run-root",
        type=Path,
        default=Path("data/workflows/pose-stack-comparison/front-bench-v1/run-2026-08-12"),
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path("data/training/personal-golden-segmentation-v2.json"),
    )
    parser.add_argument("--exercise", default="barbell_bench_press")
    parser.add_argument("--sample-fps", type=float, default=10.0)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--skip-extraction", action="store_true")
    parser.add_argument(
        "--include-temporal",
        action="store_true",
        help="also run the secondary rep/timeline LOO diagnostic",
    )
    parser.add_argument(
        "--trajectory-report-json",
        type=Path,
        default=Path(
            "data/workflows/pose-stack-comparison/front-bench-v1/run-2026-08-12/trajectory-evaluation.json"
        ),
    )
    parser.add_argument(
        "--trajectory-report-md",
        type=Path,
        default=Path(
            "data/workflows/pose-stack-comparison/front-bench-v1/run-2026-08-12/trajectory-evaluation.md"
        ),
    )
    parser.add_argument(
        "--report-json",
        type=Path,
        default=Path(
            "data/workflows/pose-stack-comparison/front-bench-v1/run-2026-08-12/stack-evaluation.json"
        ),
    )
    parser.add_argument(
        "--report-md",
        type=Path,
        default=Path(
            "data/workflows/pose-stack-comparison/front-bench-v1/run-2026-08-12/stack-evaluation.md"
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_root = Path.cwd().resolve()
    run_root = args.run_root.resolve()
    production_profile = project_root / "public/archives/confirmed-captures/recognition-profiles.json"
    production_hash_before = sha256_file(production_profile)
    filtered_dataset = run_root / "dataset" / "personal-golden-front-bench-v1.json"
    dataset = materialize_dataset(args.dataset.resolve(), filtered_dataset, args.exercise)
    source_count = len({record["sourceCaptureId"] for record in dataset["records"]})

    if not args.skip_extraction:
        command = [
            sys.executable,
            "tools/pose-stack/compare_pose_stacks.py",
            "--dataset",
            str(filtered_dataset),
            "--output-root",
            str(run_root),
            "--exercise",
            args.exercise,
            "--sample-fps",
            str(args.sample_fps),
        ]
        if args.force:
            command.append("--force")
        run(command, project_root)

    run(
        [
            sys.executable,
            "tools/pose-stack/evaluate_trajectory_capture.py",
            "--run-root",
            str(run_root),
            "--dataset",
            str(filtered_dataset),
            "--output-json",
            str(args.trajectory_report_json.resolve()),
            "--output-md",
            str(args.trajectory_report_md.resolve()),
        ],
        project_root,
    )
    if not args.include_temporal:
        if sha256_file(production_profile) != production_hash_before:
            raise RuntimeError("Production recognition profile changed during research comparison")
        print(
            json.dumps(
                {
                    "runRoot": str(run_root),
                    "trajectoryReportJson": str(args.trajectory_report_json.resolve()),
                    "trajectoryReportMarkdown": str(args.trajectory_report_md.resolve()),
                    "sourceCaptureCount": source_count,
                    "temporalEvaluation": "not_requested",
                    "productionProfileSha256": production_hash_before,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    run(["npm", "run", "build:motion-wasm"], project_root)
    run([str(project_root / "node_modules/.bin/tsc"), "-p", "tools/recognition-profile/tsconfig.json"], project_root)
    rows = []
    labels = {
        "yolox-rtmpose": "YOLOX + RTMPose",
        "yolox-rtmpose-bytetrack": "YOLOX + RTMPose + ByteTrack",
        "yolox-movenet-thunder": "YOLOX + MoveNet Thunder",
    }
    for pipeline_id in PIPELINES:
        pipeline_root = run_root / "evaluation" / pipeline_id
        canonical = pipeline_root / "rust-canonical.json"
        model = pipeline_root / "cycle-state-model.json"
        diagnostic = pipeline_root / "cycle-state-loo.json"
        run(
            [
                "node",
                ".recognition-profile-build/tools/recognition-profile/exportPersonalHalpe26CanonicalSequences.js",
                "--dataset",
                str(filtered_dataset),
                "--sidecars",
                str(run_root / "observations" / pipeline_id),
                "--wasm",
                "public/motion-sdk/maxpower_motion_sdk.wasm",
                "--output",
                str(canonical),
            ],
            project_root,
        )
        run(
            [
                sys.executable,
                "tools/recognition-profile/trainCycleStateProfiles.py",
                "--dataset",
                str(filtered_dataset),
                "--archive",
                "public/archives/confirmed-captures",
                "--canonical-sequences",
                str(canonical),
                "--model-output",
                str(model),
                "--output",
                str(diagnostic),
            ],
            project_root,
        )
        rows.append(
            {
                "pipelineId": pipeline_id,
                "label": labels[pipeline_id],
                "extraction": extraction_metrics(run_root, pipeline_id),
                "temporal": temporal_metrics(diagnostic),
                "artifacts": {
                    "canonical": str(canonical),
                    "cycleModel": str(model),
                    "diagnostic": str(diagnostic),
                },
            }
        )
    if source_count != rows[0]["temporal"]["sourceCaptureCount"]:
        raise RuntimeError("Comparison source count mismatch")
    if sha256_file(production_profile) != production_hash_before:
        raise RuntimeError("Production recognition profile changed during research comparison")
    write_report(run_root, rows, args.report_json.resolve(), args.report_md.resolve())
    print(
        json.dumps(
            {
                "runRoot": str(run_root),
                "reportJson": str(args.report_json.resolve()),
                "reportMarkdown": str(args.report_md.resolve()),
                "sourceCaptureCount": source_count,
                "productionProfileSha256": production_hash_before,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
