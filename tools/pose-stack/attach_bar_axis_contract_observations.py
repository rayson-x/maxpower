#!/usr/bin/env python3
"""Attach research-only bar-axis observations to a real pose bridge fixture.

The resulting fixture tests the platform Adapter -> Rust equipment seam. The
bar observations come from the existing static-background geometry prototype,
not a trained detector, and are explicitly ineligible for accuracy claims.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "maxpower-real-halpe26-pose-equipment-contract-fixture/v1"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def attach_observations(
    fixture: dict[str, Any],
    equipment_report: dict[str, Any],
    equipment_report_path: str,
    equipment_report_sha256: str,
) -> dict[str, Any]:
    capture_id = fixture.get("source", {}).get("captureId")
    video = next(
        (item for item in equipment_report.get("videos", []) if item.get("videoId") == capture_id),
        None,
    )
    if video is None:
        raise ValueError(f"equipment report has no video {capture_id}")
    signal = video.get("signal", {})
    fps = float(signal.get("fps", 0))
    signal_height = float(signal.get("height", 0))
    positions = signal.get("positionsPx")
    if fps <= 0 or signal_height <= 0 or not isinstance(positions, list) or not positions:
        raise ValueError("equipment report has no usable bar-axis signal")

    output = json.loads(json.dumps(fixture))
    original_schema = output.get("equipmentObservationContract", {}).get(
        "poseFixtureSchemaVersion",
        output.get("schemaVersion"),
    )
    output["schemaVersion"] = SCHEMA_VERSION
    output["purpose"] = (
        "byte-exact Web/Android/iOS Rust bridge replay on real mirror-gym pose "
        "observations plus research-only geometry bar-axis observations"
    )
    output["equipmentObservationContract"] = {
        "poseFixtureSchemaVersion": original_schema,
        "source": "static_background_horizontal_axis_geometry_prototype",
        "sourceReport": equipment_report_path,
        "sourceReportSha256": equipment_report_sha256,
        "class": "barbell_shaft",
        "scoreSemantics": "contract_acceptance_sentinel_not_detector_confidence",
        "acceptanceEligible": False,
        "productionPromotion": False,
        "limitations": [
            "not_a_trained_detector",
            "bbox_horizontal_extent_is_contract_geometry",
            "same_development_video_as_prototype",
        ],
    }

    shaft_height = max(1.0 / signal_height, 0.004)
    for frame in output.get("frames", []):
        timestamp_ms = int(frame["timestampMs"])
        signal_index = int(round(timestamp_ms * fps / 1000.0))
        if signal_index < 0 or signal_index >= len(positions):
            raise ValueError(f"bar-axis signal does not cover {timestamp_ms}ms")
        center_y = float(positions[signal_index]) / signal_height
        y = min(max(center_y - shaft_height / 2.0, 0.0), 1.0 - shaft_height)
        frame["equipmentObservations"] = [
            {
                "proposalId": int(frame["sourceFrameNumber"]),
                "kind": "barbell_shaft",
                "bbox": [0.15, round(y, 7), 0.70, round(shaft_height, 7)],
                "score": 1.0,
                "uncertaintyPx": None,
                "source": "geometry",
                "attributes": {
                    "reflectionCandidate": False,
                    "staticRackCandidate": False,
                    "occlusion": "none",
                    "truncated": False,
                },
            }
        ]
    return output


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    os.close(descriptor)
    try:
        with open(temp_name, "w", encoding="utf-8") as target:
            json.dump(value, target, ensure_ascii=False, indent=2, allow_nan=False)
            target.write("\n")
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--equipment-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    report = json.loads(args.equipment_report.read_text(encoding="utf-8"))
    output = attach_observations(
        fixture,
        report,
        str(args.equipment_report),
        sha256_file(args.equipment_report),
    )
    write_json(args.output, output)
    print(
        json.dumps(
            {
                "output": str(args.output),
                "frames": len(output["frames"]),
                "equipmentObservationCount": sum(
                    len(frame["equipmentObservations"]) for frame in output["frames"]
                ),
                "acceptanceEligible": False,
                "sha256": sha256_file(args.output),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
