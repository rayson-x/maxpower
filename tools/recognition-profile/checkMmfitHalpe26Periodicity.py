#!/usr/bin/env python3
"""Gate train-subject-isolated MM-Fit Halpe-26 set-count evidence."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def evaluate(
    report: dict[str, Any],
    *,
    minimum: float,
    expected_clips: int,
) -> tuple[dict[str, Any], list[str]]:
    if report.get("usesExpectedCountAtInference") is not False:
        raise ValueError("report must prove expectedCount is not used at inference")
    protocol = str(report.get("evaluationProtocol", ""))
    if "leave-one-official-train-subject-out" not in protocol:
        raise ValueError("report is not official-train-subject-isolated")
    rows = report.get("rows")
    if not isinstance(rows, list):
        raise ValueError("report rows are missing")
    if len(rows) != expected_clips:
        raise ValueError(f"held-out clip coverage mismatch: {len(rows)} != {expected_clips}")
    identities: set[str] = set()
    for row in rows:
        source_id = str(row["sourceSequenceId"])
        if source_id in identities:
            raise ValueError(f"duplicate held-out sequence: {source_id}")
        identities.add(source_id)
        if str(row["subjectId"]) in {str(value) for value in row.get("trainingSubjectIds") or []}:
            raise ValueError(f"held-out subject leaked into training: {source_id}")
    summary = report.get("summary") or {}
    exact = summary.get("exactSetRatio")
    off_by_one = summary.get("offByOneRatio")
    if not isinstance(exact, (int, float)) or not isinstance(off_by_one, (int, float)):
        raise ValueError("report has no measurable exact/off-by-one ratios")
    by_exercise = report.get("byExercise") or {}
    action = report.get("actionClassification") or {}
    if action.get("usesExerciseLabelAtInference") is not False:
        raise ValueError("report must prove exercise label is not used at inference")
    action_summary = action.get("summary") or {}
    macro_f1 = action_summary.get("macroF1")
    if not isinstance(macro_f1, (int, float)):
        raise ValueError("report has no measurable action macro-F1")
    metrics = {
        "mode": "leave-one-official-train-subject-out",
        "clipCount": len(rows),
        "exactSetRatio": float(exact),
        "offByOneRatio": float(off_by_one),
        "meanAbsoluteCountError": summary.get("meanAbsoluteCountError"),
        "minimumRequiredRate": minimum,
        "byExercise": {
            exercise_id: {
                "clipCount": values.get("clipCount"),
                "exactSetRatio": values.get("exactSetRatio"),
                "offByOneRatio": values.get("offByOneRatio"),
            }
            for exercise_id, values in sorted(by_exercise.items())
        },
        "actionClassification": {
            "macroF1": float(macro_f1),
            "accuracy": action_summary.get("accuracy"),
            "byExercise": action_summary.get("byExercise") or {},
        },
    }
    failures = []
    if float(exact) < minimum:
        failures.append(f"exactSetRatio={float(exact):.2%} < {minimum:.2%}")
    if float(macro_f1) < minimum:
        failures.append(f"actionMacroF1={float(macro_f1):.2%} < {minimum:.2%}")
    for exercise_id, values in metrics["byExercise"].items():
        action_exact = values["exactSetRatio"]
        if not isinstance(action_exact, (int, float)) or float(action_exact) < minimum:
            rendered = "n/a" if action_exact is None else f"{float(action_exact):.2%}"
            failures.append(f"{exercise_id}.exactSetRatio={rendered} < {minimum:.2%}")
    for exercise_id, values in sorted((action_summary.get("byExercise") or {}).items()):
        recall = values.get("recall")
        if not isinstance(recall, (int, float)) or float(recall) < minimum:
            rendered = "n/a" if recall is None else f"{float(recall):.2%}"
            failures.append(f"{exercise_id}.actionRecall={rendered} < {minimum:.2%}")
    return metrics, failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    parser.add_argument("--minimum", type=float, default=0.95)
    parser.add_argument("--expected-clips", type=int, default=301)
    args = parser.parse_args()
    try:
        report = json.loads(args.report.read_text(encoding="utf-8"))
        metrics, failures = evaluate(
            report,
            minimum=args.minimum,
            expected_clips=args.expected_clips,
        )
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(f"MM-Fit Halpe-26 periodicity gate: invalid report: {error}", file=sys.stderr)
        return 2
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    if failures:
        print("MM-Fit Halpe-26 periodicity gate: FAIL", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("MM-Fit Halpe-26 periodicity gate: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
