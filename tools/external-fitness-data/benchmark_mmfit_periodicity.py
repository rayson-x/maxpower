#!/usr/bin/env python3
"""Research-only MM-Fit periodicity observability benchmark.

This deliberately does not emit a production profile.  It measures whether a
complete, already-trimmed set contains a recoverable repetition frequency when
multiple body-frame joint signals are combined.  Per-clip PCA and access to the
whole set make this an offline upper bound, not a causal mobile implementation.
"""

from __future__ import annotations

import argparse
import gzip
import json
from collections import defaultdict
from pathlib import Path

import numpy as np


OBSERVED_JOINTS = (0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28)
HIP_LEFT = OBSERVED_JOINTS.index(23)
HIP_RIGHT = OBSERVED_JOINTS.index(24)
SHOULDER_LEFT = OBSERVED_JOINTS.index(11)
SHOULDER_RIGHT = OBSERVED_JOINTS.index(12)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/external/mm-fit/normalized")
    parser.add_argument(
        "--output",
        default="docs/reports/mmfit-periodicity-observability-2026-08-09.json",
    )
    return parser.parse_args()


def smooth(values: np.ndarray, width: int) -> np.ndarray:
    if width <= 1:
        return values
    kernel = np.ones(width, dtype=np.float64) / width
    return np.stack(
        [np.convolve(values[:, index], kernel, mode="same") for index in range(values.shape[1])],
        axis=1,
    )


def body_frame_features(frames: list[dict]) -> np.ndarray:
    points = np.asarray(
        [
            [[landmark["x"], landmark["y"]] for landmark in frame["landmarks"]]
            for frame in frames
        ],
        dtype=np.float64,
    )[:, OBSERVED_JOINTS]
    hips = (points[:, HIP_LEFT] + points[:, HIP_RIGHT]) * 0.5
    shoulders = (points[:, SHOULDER_LEFT] + points[:, SHOULDER_RIGHT]) * 0.5
    torso = np.linalg.norm(shoulders - hips, axis=1)
    positive = torso[torso > 1e-6]
    fallback = float(np.median(positive)) if positive.size else 1.0
    torso = np.maximum(torso, fallback * 0.30)
    normalized = (points - hips[:, None, :]) / torso[:, None, None]
    return normalized.reshape(normalized.shape[0], -1)


def periodic_counts(
    features: np.ndarray,
    smoothing_width: int,
    penalties: tuple[float, ...],
) -> dict[float, tuple[int, float]]:
    values = smooth(features, smoothing_width)
    trim = max(1, smoothing_width // 2 + 1)
    if values.shape[0] > trim * 2 + 12:
        values = values[trim:-trim]
    values = values - values.mean(axis=0, keepdims=True)
    deviations = values.std(axis=0)
    useful = deviations > 1e-5
    values = values[:, useful]
    if values.shape[1] == 0:
        return {penalty: (0, 0.0) for penalty in penalties}
    values = values / (values.std(axis=0, keepdims=True) + 1e-6)
    left, singular, _right = np.linalg.svd(values, full_matrices=False)
    component_count = min(8, singular.size)
    components = left[:, :component_count] * singular[:component_count]
    sample_count = components.shape[0]
    phase = np.arange(sample_count, dtype=np.float64) / sample_count
    max_count = min(25, max(4, sample_count // 12))
    raw_scores: list[tuple[float, int]] = []
    for count in range(3, max_count + 1):
        score = 0.0
        for harmonic, weight in ((1, 1.0), (2, 0.35), (3, 0.15)):
            cycles = count * harmonic
            if cycles >= sample_count / 4:
                continue
            cosine = np.cos(2 * np.pi * cycles * phase)
            sine = np.sin(2 * np.pi * cycles * phase)
            power = (
                (components.T @ cosine) ** 2 + (components.T @ sine) ** 2
            ) / (np.sum(components * components, axis=0) + 1e-6)
            score += weight * float(np.sort(power)[-min(4, power.size) :].sum())
        raw_scores.append((score, count))
    results = {}
    for penalty in penalties:
        scored = sorted(
            ((score / (count**penalty), count) for score, count in raw_scores),
            reverse=True,
        )
        best_score, best_count = scored[0]
        confidence = best_score / max(best_score + scored[1][0], 1e-6) if len(scored) > 1 else 1.0
        results[penalty] = (best_count, confidence)
    return results


def summarize(rows: list[dict]) -> dict:
    if not rows:
        return {
            "clipCount": 0,
            "exactCountRatio": None,
            "offByOneRatio": None,
            "meanAbsoluteCountError": None,
        }
    errors = [abs(row["predictedCount"] - row["expectedCount"]) for row in rows]
    return {
        "clipCount": len(rows),
        "truthRepCount": sum(row["expectedCount"] for row in rows),
        "predictedRepCount": sum(row["predictedCount"] for row in rows),
        "exactCountRatio": round(sum(error == 0 for error in errors) / len(rows), 4),
        "offByOneRatio": round(sum(error <= 1 for error in errors) / len(rows), 4),
        "meanAbsoluteCountError": round(sum(errors) / len(rows), 4),
    }


def main() -> None:
    args = parse_args()
    input_root = Path(args.input)
    manifest = json.loads((input_root / "manifest.json").read_text())
    configs = [
        {"smoothingWidth": width, "frequencyPenalty": penalty}
        for width in (3, 5, 9)
        for penalty in (0.0, 0.15, 0.30)
    ]
    clips: list[dict] = []
    for item in manifest["clips"]:
        with gzip.open(input_root / item["clipFile"], "rt") as handle:
            clip = json.load(handle)
        clips.append({"item": item, "features": body_frame_features(clip["frames"])})

    candidates: dict[tuple[str, int, float], list[dict]] = defaultdict(list)
    for index, clip in enumerate(clips, start=1):
        item = clip["item"]
        for width in (3, 5, 9):
            counts = periodic_counts(clip["features"], width, (0.0, 0.15, 0.30))
            for penalty, (predicted, confidence) in counts.items():
                candidates[(item["exerciseId"], width, penalty)].append(
                    {
                        **item,
                        "predictedCount": predicted,
                        "confidence": round(confidence, 4),
                    }
                )
        if index % 50 == 0:
            print(f"processed {index}/{len(clips)}", flush=True)

    selected: dict[str, dict] = {}
    for exercise_id in sorted({clip["item"]["exerciseId"] for clip in clips}):
        ranked = []
        for config in configs:
            rows = candidates[(exercise_id, config["smoothingWidth"], config["frequencyPenalty"])]
            train = summarize([row for row in rows if row["split"] == "train"])
            validation = summarize([row for row in rows if row["split"] == "validation"])
            ranked.append((
                -float(validation["exactCountRatio"] or 0),
                float(validation["meanAbsoluteCountError"] or 999),
                -float(train["exactCountRatio"] or 0),
                config,
                rows,
            ))
        ranked.sort(key=lambda value: value[:3])
        _exact, _mae, _train, config, rows = ranked[0]
        selected[exercise_id] = {"config": config, "rows": rows}

    rows = [row for result in selected.values() for row in result["rows"]]
    splits = ("train", "validation", "test", "unseen_test")
    report = {
        "schemaVersion": "maxpower-mmfit-periodicity-observability/v1",
        "datasetId": "mm-fit",
        "evidenceBoundary": {
            "mode": "offline_upper_bound",
            "notRuntimeEligible": True,
            "reason": "Per-clip PCA sees the complete pre-trimmed set and MM-Fit exposes only set totals. This measures periodic observability; it is not a causal phase model or a production counter.",
            "cameraView": "unknown",
            "bodyOrientationProxyUsed": False,
        },
        "selectionProtocol": "Per exercise: select smoothing and frequency penalty by validation exact-set, with train exact-set as tie-breaker; report official test and unseen_test untouched.",
        "selectedConfigs": {key: value["config"] for key, value in selected.items()},
        "summary": summarize(rows),
        "bySplit": {split: summarize([row for row in rows if row["split"] == split]) for split in splits},
        "byExercise": {
            exercise_id: {
                "summary": summarize(result["rows"]),
                "bySplit": {
                    split: summarize([row for row in result["rows"] if row["split"] == split])
                    for split in splits
                },
            }
            for exercise_id, result in selected.items()
        },
        "rows": rows,
    }
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"outputPath": str(output_path), "summary": report["summary"], "bySplit": report["bySplit"]}, indent=2))


if __name__ == "__main__":
    main()
