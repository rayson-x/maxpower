#!/usr/bin/env python3
"""PROTOTYPE: materialize a reviewable bar-axis pseudo-label dataset.

The output belongs under ignored `data/`. Pseudo labels are never promoted to
training truth until a human reviews the generated overlays.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from validate_bar_axis import iter_gray_frames


def phase_samples(label: dict) -> list[tuple[str, int]]:
    start = label["startMs"]
    extreme = label["extremeMs"]
    end = label["endMs"]
    samples: list[tuple[str, int]] = []
    for name, fraction in (("start", 0.0), ("descent25", 0.25), ("descent50", 0.5), ("descent75", 0.75)):
        samples.append((name, round(start + (extreme - start) * fraction)))
    samples.append(("extreme", extreme))
    for name, fraction in (("return25", 0.25), ("return50", 0.5), ("return75", 0.75), ("end", 1.0)):
        samples.append((name, round(extreme + (end - extreme) * fraction)))
    return samples


def evenly_spaced(start_ms: int, end_ms: int, count: int) -> list[int]:
    if end_ms <= start_ms or count <= 0:
        return []
    return [round(value) for value in np.linspace(start_ms, end_ms, count)]


def sample_plan(video_result: dict, labels: list[dict]) -> list[dict]:
    plan: list[dict] = []
    for label in labels:
        for phase, timestamp_ms in phase_samples(label):
            plan.append(
                {
                    "timestampMs": timestamp_ms,
                    "sampleKind": "rep-phase",
                    "repIndex": label["repIndex"],
                    "phase": phase,
                }
            )

    duration_ms = round(len(video_result["signal"]["positionsPx"]) * 1000 / video_result["signal"]["fps"])
    first_start = labels[0]["startMs"]
    last_end = labels[-1]["endMs"]
    for timestamp_ms in evenly_spaced(500, max(500, first_start - 500), 12):
        plan.append({"timestampMs": timestamp_ms, "sampleKind": "negative-pre-set"})
    for timestamp_ms in evenly_spaced(last_end + 500, max(last_end + 500, duration_ms - 500), 12):
        plan.append({"timestampMs": timestamp_ms, "sampleKind": "negative-post-set"})

    # Deduplicate timestamps that round onto the same validation frame.
    fps = video_result["signal"]["fps"]
    by_frame: dict[int, dict] = {}
    for item in plan:
        by_frame[round(item["timestampMs"] * fps / 1000)] = item
    return [by_frame[index] | {"frameIndex": index} for index in sorted(by_frame)]


def write_video_samples(
    video: Path,
    video_result: dict,
    labels: list[dict],
    output_root: Path,
) -> list[dict]:
    fps = video_result["signal"]["fps"]
    width = video_result["signal"]["width"]
    height = video_result["signal"]["height"]
    positions = video_result["signal"]["positionsPx"]
    confidence = video_result["signal"]["confidenceRatios"]
    weak_rep_reasons: dict[int, str] = {}
    minimum_amplitude = float(video_result["thresholds"]["minimumAmplitudePx"])
    for checkpoint in video_result["checkpointEvidence"]:
        if not checkpoint["directionAligned"]:
            weak_rep_reasons[checkpoint["repIndex"]] = "extreme direction disagrees with bar-axis cycle"
        elif checkpoint["amplitudePx"] < minimum_amplitude:
            weak_rep_reasons[checkpoint["repIndex"]] = "labelled extreme has insufficient bar-axis amplitude"
    plan = sample_plan(video_result, labels)
    requested = {item["frameIndex"]: item for item in plan}
    image_dir = output_root / "images" / video.stem
    preview_dir = output_root / "previews" / video.stem
    image_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    records: list[dict] = []

    for frame_index, frame in enumerate(iter_gray_frames(video, fps, width, height)):
        item = requested.get(frame_index)
        if item is None:
            continue
        image = Image.fromarray(frame, mode="L").convert("RGB")
        filename = f"frame-{frame_index:06d}.jpg"
        image_path = image_dir / filename
        preview_path = preview_dir / filename
        image.save(image_path, quality=92)

        y = float(positions[min(frame_index, len(positions) - 1)])
        review_reason = weak_rep_reasons.get(item.get("repIndex"))
        confidence_ratio = confidence[min(frame_index, len(confidence) - 1)]
        if review_reason is None and confidence_ratio < 1.15:
            review_reason = "axis candidate is not clearly separated from the second candidate"
        preview = image.copy()
        draw = ImageDraw.Draw(preview)
        draw.line((0, y, width, y), fill=(0, 255, 255), width=2)
        draw.text((6, max(2, y - 16)), f"axis y={y:.0f} unreviewed", fill=(0, 255, 255))
        preview.save(preview_path, quality=90)

        records.append(
            {
                "videoId": video.stem,
                "frameIndex": frame_index,
                "timestampMs": item["timestampMs"],
                "sampleKind": item["sampleKind"],
                "repIndex": item.get("repIndex"),
                "phase": item.get("phase"),
                "image": str(image_path.relative_to(output_root)),
                "preview": str(preview_path.relative_to(output_root)),
                "pseudoLabel": {
                    "kind": "bar-axis-y",
                    "axisYNormalized": round(y / height, 6),
                    "confidenceRatio": confidence_ratio,
                    "source": "static-background-moving-horizontal-paired-edge/v1",
                    "reviewStatus": "unreviewed",
                    "reviewPriority": "high" if review_reason else "normal",
                    "reviewReason": review_reason,
                },
            }
        )
    return records


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--captures", type=Path, default=Path("public/archives/confirmed-captures/chest"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    validation = json.loads(args.validation.read_text())
    args.output.mkdir(parents=True, exist_ok=True)
    records: list[dict] = []
    for video_result in validation["videos"]:
        video_id = video_result["videoId"]
        video = args.captures / f"{video_id}.mp4"
        labels = json.loads((args.captures / f"{video_id}.labels.json").read_text())["labels"]
        records.extend(write_video_samples(video, video_result, labels, args.output))

    manifest = {
        "schemaVersion": "bar-axis-pseudo-label-dataset/v1",
        "prototype": True,
        "promotionAllowed": False,
        "reason": "All equipment labels are unreviewed pseudo labels.",
        "sampleCount": len(records),
        "repPhaseSampleCount": sum(record["sampleKind"] == "rep-phase" for record in records),
        "negativeSampleCount": sum(record["sampleKind"].startswith("negative-") for record in records),
        "highPriorityReviewCount": sum(
            record["pseudoLabel"]["reviewPriority"] == "high" for record in records
        ),
        "samples": records,
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {
                key: manifest[key]
                for key in (
                    "sampleCount",
                    "repPhaseSampleCount",
                    "negativeSampleCount",
                    "highPriorityReviewCount",
                )
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
