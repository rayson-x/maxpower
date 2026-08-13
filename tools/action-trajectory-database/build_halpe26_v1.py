#!/usr/bin/env python3
"""Build the versioned Halpe-26 action-trajectory training corpus.

The builder preserves source supervision semantics. Personal captures provide
human rep/phase boundaries and reviewed negative windows. MM-Fit provides only
official set-count labels. It never upgrades either source into form-quality,
compensation, stimulus, or medical truth.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BLAZEPOSE33_TO_COCO17 = (0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28)
HALPE26_NAMES = (
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee",
    "right_knee", "left_ankle", "right_ankle", "head", "neck",
    "hip_center", "left_big_toe", "right_big_toe", "left_small_toe",
    "right_small_toe", "left_heel", "right_heel",
)
DATABASE_SCHEMA = "maxpower-action-trajectory-database/v2"
MMFIT_CLIP_SCHEMA = "maxpower-mmfit-halpe26-prefix-clip/v1"
PERSONAL_SIDECAR_SCHEMA = "maxpower-raw-pose-observation-sidecar/v2"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    os.close(descriptor)
    try:
        Path(temporary).write_text(
            json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def atomic_gzip_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    os.close(descriptor)
    try:
        with gzip.open(temporary, "wt", encoding="utf-8", compresslevel=6) as target:
            json.dump(value, target, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def unknown_landmark() -> dict[str, float]:
    return {"x": 0.0, "y": 0.0, "z": 0.0, "visibility": 0.0}


def mmfit_landmarks_to_halpe26(landmarks: list[dict[str, float]]) -> list[dict[str, float]]:
    prefix = [dict(landmarks[index]) for index in BLAZEPOSE33_TO_COCO17]
    return prefix + [unknown_landmark() for _ in range(9)]


def convert_mmfit_clip(source_path: Path, target_path: Path) -> dict[str, Any]:
    with gzip.open(source_path, "rt", encoding="utf-8") as source:
        clip = json.load(source)
    converted = {
        "schemaVersion": MMFIT_CLIP_SCHEMA,
        "datasetId": "mm-fit",
        "sourceSequenceId": clip["sourceSequenceId"],
        "subjectId": clip["subjectId"],
        "split": clip["split"],
        "sourceAction": clip["sourceAction"],
        "exerciseId": clip["exerciseId"],
        "cameraView": clip.get("cameraView", "unknown"),
        "poseSchema": "halpe26",
        "keypointNames": HALPE26_NAMES,
        "poseDomain": "mmfit-openpose18-via-blazepose33-adapter-halpe26-prefix",
        "observedLandmarkIndices": list(range(17)),
        "unknownLandmarkIndices": list(range(17, 26)),
        "missingPointPolicy": "unknown; additive Halpe points are not synthesized",
        "intendedUse": ["offline_research", "set_count_pretraining", "heldout_benchmarking"],
        "forbiddenUse": ["production_profile_promotion", "form_reference", "technique_quality_truth"],
        "source": {
            **clip["source"],
            "normalizedClip": str(source_path),
            "normalizedClipSha256": sha256_file(source_path),
        },
        "label": {
            **clip["label"],
            "annotationGranularity": "set_count",
            "repBounds": [],
            "techniqueQuality": "unknown",
            "compensation": "unknown",
        },
        "frames": [
            {
                **frame,
                "landmarks": mmfit_landmarks_to_halpe26(frame["landmarks"]),
            }
            for frame in clip["frames"]
        ],
    }
    atomic_gzip_json(target_path, converted)
    return {
        "clipFile": str(target_path),
        "sourceSequenceId": converted["sourceSequenceId"],
        "subjectId": converted["subjectId"],
        "split": converted["split"],
        "exerciseId": converted["exerciseId"],
        "expectedCount": converted["label"]["totalRepetitions"],
        "frameCount": len(converted["frames"]),
        "supervision": "set_count",
    }


def read_personal_sidecar_summary(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as source:
        sidecar = json.load(source)
    if sidecar.get("schemaVersion") != PERSONAL_SIDECAR_SCHEMA:
        raise ValueError(f"Unsupported personal sidecar schema: {path}")
    if sidecar.get("poseSchema") != "halpe26" or len(sidecar.get("keypointNames", [])) != 26:
        raise ValueError(f"Personal sidecar is not Halpe-26: {path}")
    return {
        "sidecar": str(path),
        "sidecarSha256": sha256_file(path),
        "sourceVideoSha256": sidecar["source"]["sha256"],
        "summary": sidecar["summary"],
        "inference": sidecar["inference"],
    }


def personal_example(record: dict[str, Any], sidecar: dict[str, Any]) -> dict[str, Any]:
    return {
        "exampleId": record["captureId"],
        "sourceCaptureId": record["sourceCaptureId"],
        "exerciseContext": {
            "exerciseId": record["exerciseId"],
            "exerciseVariant": record["exerciseId"],
            "capturePosition": record["capturePosition"],
            "analysisView": record["analysisView"],
            "trainingGoal": "unknown",
            "equipment": "unknown_unless_encoded_by_exercise_id",
            "plannedRom": "unknown",
            "tempoIntent": "unknown",
            "load": None,
            "rir": None,
        },
        "observation": sidecar,
        "sourceMedia": {
            "video": f"public/archives/confirmed-captures/{record['source']['video']}",
            "legacyPoseFixture": f"public/archives/confirmed-captures/{record['source']['keypoints']}",
        },
        "labels": {
            "expectedCount": record["expectedCount"],
            "evaluationWindow": record["evaluationWindow"],
            "repPhaseBounds": record["segments"],
            "reviewedNegativeWindows": record["reviewedNegativeWindows"],
            "annotationStatus": record["annotationStatus"],
            "annotationUpdatedAt": record["annotationUpdatedAt"],
            "note": record["note"],
            "techniqueQuality": "unknown",
            "compensation": "unknown",
            "stimulusCompatibility": "unknown",
            "standardFormReference": False,
        },
        "supervision": {
            "observationTruth": "model_observation_not_keypoint_ground_truth",
            "movementTask": "human_rep_and_phase_boundaries",
            "negativeWindows": "human_reviewed",
            "techniqueAdherence": "unlabeled",
            "movementStrategy": "unlabeled",
            "coachInference": "unlabeled",
        },
        "eligibleTasks": [
            "exercise_identity",
            "rep_counting",
            "rep_segmentation",
            "phase_alignment",
            "anti_interference",
            "personal_trajectory_distribution",
        ],
        "forbiddenTasks": [
            "standard_form_reference",
            "muscle_activation_truth",
            "medical_assessment",
        ],
    }


def technique_review_items(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Create an honest review queue; unknown fields are never auto-labeled."""
    output = []
    for record in records:
        for segment in record.get("segments") or []:
            output.append(
                {
                    "reviewItemId": f"{record['captureId']}#rep-{segment['repIndex']}",
                    "captureId": record["captureId"],
                    "sourceCaptureId": record["sourceCaptureId"],
                    "sourceVideo": f"public/archives/confirmed-captures/{record['source']['video']}",
                    "exerciseId": record["exerciseId"],
                    "capturePosition": record["capturePosition"],
                    "repIndex": segment["repIndex"],
                    "startMs": segment["startMs"],
                    "peakMs": segment["peakMs"],
                    "endMs": segment["endMs"],
                    "reviewStatus": "pending",
                    "labels": {
                        "techniqueAdherence": "unknown",
                        "movementStrategies": [],
                        "compensation": "unknown",
                        "stimulusCompatibility": "unknown",
                        "standardFormReference": False,
                    },
                    "requiredEvidence": {
                        "reviewer": None,
                        "independentFeatureGroups": [],
                        "timeRanges": [],
                        "note": "",
                    },
                }
            )
    return output


def build_database(
    project_root: Path,
    personal_dataset_path: Path,
    personal_sidecar_dir: Path,
    mmfit_manifest_path: Path,
    output_dir: Path,
) -> dict[str, Any]:
    personal_dataset = json.loads(personal_dataset_path.read_text(encoding="utf-8"))
    mmfit_manifest = json.loads(mmfit_manifest_path.read_text(encoding="utf-8"))
    sidecars: dict[str, dict[str, Any]] = {}
    unique_source_ids = sorted({record["sourceCaptureId"] for record in personal_dataset["records"]})
    for source_id in unique_source_ids:
        sidecar_path = personal_sidecar_dir / f"{source_id}.halpe26.json.gz"
        if not sidecar_path.is_file():
            raise FileNotFoundError(f"Missing personal Halpe-26 sidecar: {sidecar_path}")
        sidecars[source_id] = read_personal_sidecar_summary(sidecar_path)

    personal_examples = [
        personal_example(record, sidecars[record["sourceCaptureId"]])
        for record in personal_dataset["records"]
    ]
    personal_index_path = output_dir / "personal-examples.json.gz"
    atomic_gzip_json(
        personal_index_path,
        {
            "schemaVersion": "maxpower-personal-trajectory-examples/v1",
            "poseSchema": "halpe26",
            "examples": personal_examples,
        },
    )
    review_queue = technique_review_items(personal_dataset["records"])
    review_queue_path = output_dir / "technique-review-queue.json.gz"
    atomic_gzip_json(
        review_queue_path,
        {
            "schemaVersion": "maxpower-training-execution-review-queue/v1",
            "labelPolicy": (
                "Technique and compensation remain unknown until a reviewer records visible evidence; "
                "confirmed compensation requires at least two independent feature groups."
            ),
            "items": review_queue,
        },
    )

    mmfit_root = mmfit_manifest_path.parent
    mmfit_target_root = output_dir / "mmfit-halpe26"
    mmfit_clips = []
    for index, clip_entry in enumerate(mmfit_manifest["clips"], start=1):
        source_path = mmfit_root / clip_entry["clipFile"]
        target_path = mmfit_target_root / clip_entry["clipFile"]
        mmfit_clips.append(convert_mmfit_clip(source_path, target_path))
        if index % 100 == 0:
            print(json.dumps({"mmfitConversion": f"{index}/{len(mmfit_manifest['clips'])}"}), flush=True)
    mmfit_index_path = mmfit_target_root / "manifest.json"
    split_counts = Counter(clip["split"] for clip in mmfit_clips)
    split_reps = Counter()
    for clip in mmfit_clips:
        split_reps[clip["split"]] += clip["expectedCount"]
    atomic_json(
        mmfit_index_path,
        {
            "schemaVersion": "maxpower-mmfit-halpe26-prefix-manifest/v1",
            "datasetId": "mm-fit",
            "poseSchema": "halpe26",
            "poseDomain": "mmfit-openpose18-via-blazepose33-adapter-halpe26-prefix",
            "supervision": "set_count",
            "splitPolicy": "official subject split; train only for fitting; validation/test/unseen_test held out",
            "clips": mmfit_clips,
        },
    )

    manifest = {
        "schemaVersion": DATABASE_SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "databaseId": "maxpower-halpe26-action-trajectories-v1",
        "status": "research_candidate_not_promoted",
        "purpose": (
            "Train and evaluate observable movement task, phase, ROM, path, bilateral, "
            "and temporal evidence that can support a bounded online-coach assessment."
        ),
        "poseContract": {
            "schema": "halpe26",
            "keypointNames": HALPE26_NAMES,
            "coco17PrefixCount": 17,
            "coco17PrefixIndexCompatible": True,
            "missingPointPolicy": "unknown; never synthesize from another person or reflection",
        },
        "sourceDomains": [
            {
                "id": "personal-rtmpose-halpe26",
                "index": str(personal_index_path.relative_to(project_root)),
                "techniqueReviewQueue": str(review_queue_path.relative_to(project_root)),
                "sourceCaptureCount": len(unique_source_ids),
                "exampleCount": len(personal_examples),
                "expectedRepCount": sum(record["expectedCount"] for record in personal_dataset["records"]),
                "humanRepBoundaryCount": sum(len(record["segments"]) for record in personal_dataset["records"]),
                "pendingTechniqueReviewCount": len(review_queue),
                "supervision": ["set_count", "per_rep_start_peak_end", "reviewed_negative_windows"],
                "limitations": [
                    "single known user; source-grouped evaluation does not prove cross-user generalization",
                    "pose points are model observations, not manually keyed point ground truth",
                    "no reviewed standardness, compensation, stimulus, load, RPE, or RIR labels",
                    "consent forbids treating these captures as standard-form reference",
                ],
            },
            {
                "id": "mmfit-openpose18-halpe26-prefix",
                "index": str(mmfit_index_path.relative_to(project_root)),
                "clipCount": len(mmfit_clips),
                "expectedRepCount": sum(clip["expectedCount"] for clip in mmfit_clips),
                "splitClipCounts": dict(split_counts),
                "splitRepCounts": dict(split_reps),
                "supervision": ["set_count"],
                "limitations": [
                    "only Halpe indices 0..16 are observed; 17..25 are unknown",
                    "no per-rep boundaries or reviewed negative windows",
                    "not standard-form or technique-quality truth",
                ],
            },
        ],
        "trainingProtocol": {
            "taskSeparation": [
                "subject_and_observation_readiness",
                "exercise_and_variant_identity",
                "rep_and_phase_segmentation",
                "kinematic_evidence_estimation",
                "dimension_level_technique_assessment",
                "multi_feature_compensation_classification",
                "set_level_performance_drift",
            ],
            "allowedNow": [
                "exercise identity pretraining from both domains",
                "MM-Fit train-split set-count and periodicity pretraining",
                "personal source-grouped rep/phase and negative-window fitting",
                "personal trajectory distribution modeling without standardness claims",
            ],
            "blockedUntilLabelsExist": [
                "standard vs nonstandard execution classification",
                "compensation or momentum-cheating classification",
                "stimulus compatibility classification",
                "equipment-path assessment without a real equipment detector",
                "muscle activation, force, joint load, abdominal pressure, injury diagnosis",
            ],
            "leakageGuards": [
                "personal splits grouped by sourceCaptureId",
                "MM-Fit official subject splits preserved",
                "MM-Fit validation/test/unseen_test excluded from fitting",
                "same-source replay never reported as generalization accuracy",
            ],
        },
        "assessmentOutputContract": {
            "dimensions": [
                "observation_readiness",
                "movement_task_completion",
                "technique_adherence",
                "observed_movement_strategy",
                "stimulus_compatibility",
                "effort_and_dose_adequacy",
            ],
            "dimensionStates": ["meets_target", "partially_meets_target", "deviates", "cannot_judge"],
            "coachSummaryStates": [
                "standard",
                "mostly_standard",
                "completed_with_strategy_shift",
                "incomplete",
                "cannot_judge",
            ],
            "rule": "LLM explains structured Rust/evidence output and cannot invent a second phase, rep, or physiology truth.",
        },
        "promotion": {
            "allowed": False,
            "reason": (
                "The database establishes pose/trajectory supervision, but current sources do not "
                "contain the reviewed technique and compensation labels needed for coach-quality claims."
            ),
        },
    }
    manifest_path = output_dir / "manifest.json"
    atomic_json(manifest_path, manifest)
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--personal", default="data/training/personal-golden-segmentation-v2.json")
    parser.add_argument(
        "--personal-sidecars",
        default="data/workflows/action-trajectory-database/halpe26-v1/personal-observations",
    )
    parser.add_argument("--mmfit", default="data/external/mm-fit/normalized/manifest.json")
    parser.add_argument("--output", default="data/workflows/action-trajectory-database/halpe26-v1")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_root = Path.cwd().resolve()
    manifest = build_database(
        project_root,
        (project_root / args.personal).resolve(),
        (project_root / args.personal_sidecars).resolve(),
        (project_root / args.mmfit).resolve(),
        (project_root / args.output).resolve(),
    )
    print(
        json.dumps(
            {
                "databaseId": manifest["databaseId"],
                "status": manifest["status"],
                "sourceDomains": [source["id"] for source in manifest["sourceDomains"]],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
