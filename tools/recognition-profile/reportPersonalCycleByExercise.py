#!/usr/bin/env python3
"""Summarize frozen source-held-out personal rep alignment by exact exercise.

This is a reporting pass only. It does not retrain, retune, replay truth, or
write the production recognition-profile artifact.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import date
from pathlib import Path
from statistics import mean
from typing import Any


def _ratio(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def _round(value: float | None, digits: int = 6) -> float | None:
    return round(value, digits) if value is not None else None


def summarize_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    eligible = [row for row in rows if row.get("leaveOneSourceOutEligible") is True]
    if not eligible:
        return {
            "evaluationStatus": "not_evaluable_single_source",
            "sourceCaptureCount": len({row["sourceCaptureId"] for row in rows}),
            "evaluationWindowCount": len(rows),
            "truthRepCount": sum(int(row["truthCount"]) for row in rows),
            "reason": "leave-one-source-out requires at least two independent source videos",
        }

    truth = sum(int(row["truthCount"]) for row in eligible)
    predicted = sum(int(row["predictedCount"]) for row in eligible)
    matched = sum(int(row["matchedCount"]) for row in eligible)
    aligned = sum(int(row["manualRangeAlignedCount"]) for row in eligible)
    offsets = [match for row in eligible for match in row.get("segmentMatches", [])]
    source_totals: dict[str, dict[str, int]] = defaultdict(lambda: {
        "truth": 0, "predicted": 0, "aligned": 0,
    })
    for row in eligible:
        source = source_totals[str(row["sourceCaptureId"])]
        source["truth"] += int(row["truthCount"])
        source["predicted"] += int(row["predictedCount"])
        source["aligned"] += int(row["manualRangeAlignedCount"])
    exact_count = sum(item["truth"] == item["predicted"] for item in source_totals.values())
    exact_count_and_range = sum(
        item["truth"] == item["predicted"] and item["aligned"] == item["truth"]
        for item in source_totals.values()
    )
    starts = [abs(float(match["startOffsetMs"])) for match in offsets]
    ends = [abs(float(match["endOffsetMs"])) for match in offsets]
    ious = [float(match["iou"]) for match in offsets]
    source_count = len(source_totals)
    return {
        "evaluationStatus": "source_held_out",
        "sourceCaptureCount": source_count,
        "evaluationWindowCount": len(eligible),
        "truthRepCount": truth,
        "predictedRepCount": predicted,
        "matchedRepCount": matched,
        "candidatePrecision": _round(_ratio(matched, predicted)),
        "candidateRecall": _round(_ratio(matched, truth)),
        "manualBoundaryAlignedRepCount": aligned,
        "manualBoundaryAlignedRate": _round(_ratio(aligned, truth)),
        "exactRepCountSourceCount": exact_count,
        "exactRepCountSourceRate": _round(_ratio(exact_count, source_count)),
        "exactRepCountAndAllBoundariesSourceCount": exact_count_and_range,
        "exactRepCountAndAllBoundariesSourceRate": _round(
            _ratio(exact_count_and_range, source_count)
        ),
        "matchedStartMaeMs": _round(mean(starts) if starts else None, 3),
        "matchedEndMaeMs": _round(mean(ends) if ends else None, 3),
        "matchedMeanIoU": _round(mean(ious) if ious else None),
        "alignmentDefinition": "start/end each within 500 ms and interval IoU >= 0.60",
    }


def build_report(source: dict[str, Any], source_path: Path) -> dict[str, Any]:
    if source.get("usesExpectedCountAtInference") is not False:
        raise ValueError("source report used expected rep count during inference")
    held_out = source.get("leaveOneSourceOut")
    if not isinstance(held_out, dict) or held_out.get("mode") != "leave_one_source_out":
        raise ValueError("source report is not leave-one-source-out")
    rows = held_out.get("rows")
    if not isinstance(rows, list):
        raise ValueError("source report has no evaluation rows")
    if any(row.get("splitLeakageDetected") is not False for row in rows):
        raise ValueError("source report contains split leakage")

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row["exerciseId"])].append(row)
    per_exercise = {
        exercise_id: summarize_rows(grouped[exercise_id])
        for exercise_id in sorted(grouped)
    }
    return {
        "schemaVersion": "maxpower-personal-rep-alignment-by-exercise/v1",
        "generatedOn": date.today().isoformat(),
        "sourceReport": str(source_path),
        "protocol": {
            "mode": "leave-one-source-out",
            "labelsRevealedAfterInference": True,
            "expectedCountAvailableAtInference": False,
            "productionPromotion": False,
        },
        "overall": summarize_rows(rows),
        "perExercise": per_exercise,
        "limitations": [
            "These are rep/timeline metrics, not skeleton keypoint accuracy or technique-quality accuracy.",
            "Actions with one source video cannot be evaluated by source hold-out.",
            "No parameter is changed by this reporting pass.",
        ],
    }


def _percent(value: float | None) -> str:
    return "—" if value is None else f"{value * 100:.1f}%"


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# 个人标注视频按动作 Rep/时间轴留出评估",
        "",
        "本报告只重排既有 source-held-out 结果；每条被测源视频均未参与该轮训练，",
        "推理时不可见人工次数与时间段。没有修改生产 profile。",
        "",
        "| 动作 | 独立视频 | 人工 rep | 预测 rep | Precision | Recall | 时间段对齐 | 整条视频次数完全正确 | 次数及全部边界完全正确 |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for exercise_id, metrics in report["perExercise"].items():
        if metrics["evaluationStatus"] != "source_held_out":
            lines.append(
                f"| `{exercise_id}` | {metrics['sourceCaptureCount']} | {metrics['truthRepCount']} | — | — | — | 不可评估 | 不可评估 | 不可评估 |"
            )
            continue
        lines.append(
            "| `{}` | {} | {} | {} | {} | {} | {} | {} | {} |".format(
                exercise_id,
                metrics["sourceCaptureCount"],
                metrics["truthRepCount"],
                metrics["predictedRepCount"],
                _percent(metrics["candidatePrecision"]),
                _percent(metrics["candidateRecall"]),
                _percent(metrics["manualBoundaryAlignedRate"]),
                _percent(metrics["exactRepCountSourceRate"]),
                _percent(metrics["exactRepCountAndAllBoundariesSourceRate"]),
            )
        )
    overall = report["overall"]
    lines += [
        "",
        "## 总体（可留出的 48 个源视频）",
        "",
        f"- Precision：{_percent(overall['candidatePrecision'])}",
        f"- Recall：{_percent(overall['candidateRecall'])}",
        f"- 人工起止时间段对齐：{_percent(overall['manualBoundaryAlignedRate'])}",
        f"- 整条视频次数完全正确：{_percent(overall['exactRepCountSourceRate'])}",
        f"- 次数且所有边界完全正确：{_percent(overall['exactRepCountAndAllBoundariesSourceRate'])}",
        f"- 已匹配 rep 起点 MAE：{overall['matchedStartMaeMs']} ms；终点 MAE：{overall['matchedEndMaeMs']} ms",
        "",
        "时间段对齐定义：起点和终点误差都不超过 500 ms，且区间 IoU 不低于 0.60。",
        "该结果不能代表骨架点准确率，也不能代表动作质量判断准确率。",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--json-output", type=Path, required=True)
    parser.add_argument("--markdown-output", type=Path, required=True)
    args = parser.parse_args()
    source = json.loads(args.source.read_text(encoding="utf-8"))
    report = build_report(source, args.source)
    args.json_output.parent.mkdir(parents=True, exist_ok=True)
    args.markdown_output.parent.mkdir(parents=True, exist_ok=True)
    args.json_output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.markdown_output.write_text(render_markdown(report), encoding="utf-8")
    print(json.dumps(report["overall"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
