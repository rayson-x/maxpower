#!/usr/bin/env python3
"""Build the native RTMPose → Rust canonical trajectory database manifest.

The manifest references immutable artifacts instead of copying observations.
Personal phase ranges and MM-Fit set totals remain separate supervision types.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
from typing import Any


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def artifact(path: Path) -> dict[str, Any]:
    return {"path": str(path.resolve()), "sha256": sha256_file(path)}


def validate_mmfit(
    manifest: dict[str, Any],
    canonical: dict[str, Any],
    audit: dict[str, Any],
    report: dict[str, Any],
) -> None:
    if manifest.get("complete") is not True or manifest.get("requestedSplits") != ["train"]:
        raise ValueError("MM-Fit native manifest must be complete and train-only")
    if len(manifest.get("clips") or []) != 301:
        raise ValueError("MM-Fit native manifest must contain 301 train clips")
    if canonical.get("requestedSplits") != ["train"] or canonical.get("sourceSequenceCount") != 301:
        raise ValueError("MM-Fit Rust canonical corpus must contain 301 train clips")
    if len(canonical.get("clips") or {}) != 301:
        raise ValueError("MM-Fit Rust canonical clip map coverage mismatch")
    if audit.get("integrityStatus") != "passed" or int((audit.get("summary") or {}).get("clipCount", 0)) != 301:
        raise ValueError("MM-Fit native corpus audit has not passed 301-clip integrity")
    if report.get("usesExpectedCountAtInference") is not False:
        raise ValueError("MM-Fit periodicity report must not use expectedCount at inference")
    if len(report.get("rows") or []) != 301:
        raise ValueError("MM-Fit periodicity report must evaluate 301 held-out clips")
    action = report.get("actionClassification") or {}
    if action.get("usesExerciseLabelAtInference") is not False or len(action.get("rows") or []) != 301:
        raise ValueError("MM-Fit action report must evaluate 301 clips without label input")


def validate_runtime_parity(report: dict[str, Any]) -> None:
    if report.get("schemaVersion") != "maxpower-real-halpe26-cross-platform-runtime-parity/v1":
        raise ValueError("runtime parity schema mismatch")
    if report.get("productionPromotion") is not False:
        raise ValueError("runtime parity evidence must remain research-only")
    fixture = report.get("fixture") or {}
    frame_count = int(fixture.get("frameCount", 0))
    if (
        fixture.get("sourceType") != "personal_real_video"
        or frame_count < 2
        or int(fixture.get("multiCandidateFrameCount", 0)) < 1
        or int(fixture.get("maximumCandidateCount", 0)) < 2
    ):
        raise ValueError("runtime parity must use a real multi-candidate personal video fixture")
    if int((report.get("identity") or {}).get("wrongSubjectSwitchCount", -1)) != 0:
        raise ValueError("runtime parity contains a mirror/bystander subject switch")
    platforms = report.get("platforms") or {}
    for platform in ("web", "android", "ios"):
        evidence = platforms.get(platform) or {}
        if evidence.get("status") != "passed" or int(evidence.get("matchedPacketCount", 0)) != frame_count:
            raise ValueError(f"runtime parity packet coverage failed for {platform}")
    if (platforms.get("android") or {}).get("runtime") != "physical_device":
        raise ValueError("Android runtime parity must come from a physical device")
    if (platforms.get("ios") or {}).get("runtime") not in {"simulator", "physical_device"}:
        raise ValueError("iOS runtime parity must name the validated runtime")


def build_manifest(
    *,
    personal_dataset: dict[str, Any],
    personal_canonical: dict[str, Any],
    mmfit_manifest: dict[str, Any],
    mmfit_canonical: dict[str, Any],
    mmfit_audit: dict[str, Any],
    mmfit_report: dict[str, Any],
    technique_dataset: dict[str, Any],
    runtime_parity: dict[str, Any],
    artifact_refs: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    validate_mmfit(mmfit_manifest, mmfit_canonical, mmfit_audit, mmfit_report)
    validate_runtime_parity(runtime_parity)
    records = personal_dataset.get("records") or []
    source_ids = {
        str(record.get("sourceCaptureId") or record["captureId"])
        for record in records
    }
    segments = [segment for record in records for segment in (record.get("segments") or [])]
    if len(source_ids) != 50 or len(records) != 54 or len(segments) != 464:
        raise ValueError("personal trajectory corpus coverage is not 50 sources / 54 records / 464 ranges")
    if personal_canonical.get("inputPoseSchema") != "halpe26" or int(personal_canonical.get("sourceCaptureCount", 0)) != 50:
        raise ValueError("personal Rust canonical corpus is not the 50-source Halpe-26 snapshot")
    technique_examples = technique_dataset.get("examples") or []
    eligible_technique = [
        example for example in technique_examples
        if (example.get("trainingEligibility") or {}).get("eligible") is True
    ]
    mmfit_count = sum(int(item["expectedCount"]) for item in mmfit_manifest["clips"])
    parity_fixture = runtime_parity["fixture"]
    parity_identity = runtime_parity["identity"]
    parity_platforms = runtime_parity["platforms"]
    parity_frame_count = int(parity_fixture["frameCount"])
    return {
        "schemaVersion": "maxpower-native-halpe26-action-trajectory-database/v1",
        "databaseId": "maxpower-native-halpe26-trajectories-v2",
        "status": "research_candidate_not_promoted",
        "productionPromotion": False,
        "observationContract": {
            "pipeline": "yolox-nano-humanart+rtmpose-m-halpe26 -> rust-canonical",
            "poseSchema": "halpe26",
            "coco17PrefixIndexCompatible": True,
            "canonicalOwner": "rust-motion-sdk",
            "missingPointPolicy": "unknown; never synthesize training truth",
            "subjectPolicy": "dominant-continuous-person/v5; mirror and bystander never substitute",
        },
        "sourceDomains": {
            "personal": {
                "sourceCaptureCount": len(source_ids),
                "recordCount": len(records),
                "expectedRepCount": sum(int(record["expectedCount"]) for record in records),
                "humanRangeCount": len(segments),
                "peakTruthPolicy": "legacy_unattributed excluded until human_adjusted",
                "supervision": ["exercise", "capture_position", "set_count", "human_start_end_range", "reviewed_negative_windows"],
                "evaluation": "leave-one-source-capture-out",
            },
            "mmfitTrain": {
                "subjectIds": sorted({str(item["subjectId"]) for item in mmfit_manifest["clips"]}),
                "clipCount": len(mmfit_manifest["clips"]),
                "expectedRepCount": mmfit_count,
                "supervision": ["exercise", "set_count", "official_set_bounds"],
                "forbiddenSupervision": ["per_rep_phase", "technique_quality", "compensation", "standard_reference"],
                "evaluation": "leave-one-official-train-subject-out",
            },
        },
        "trainingProducts": {
            "personalCycleState": {
                "purpose": ["rep_candidate", "start_end_range", "negative_window_rejection"],
                "runtimeStatus": "python_offline_research_only_noncausal",
            },
            "mmfitPriors": {
                "purpose": ["set_level_action_identity", "periodicity", "weak_cycle_duration"],
                "runtimeStatus": "python_offline_research_only_noncausal",
            },
            "technique": {
                "eligibleGoldRepCount": len(eligible_technique),
                "status": "trainable" if eligible_technique else "blocked_no_gold_labels",
                "blockedTasks": [] if eligible_technique else ["standardness", "compensation", "stimulus_compatibility"],
            },
        },
        "evaluationSnapshot": {
            "personalCycle": (artifact_refs.get("personalCycleReport") or {}),
            "runtimeParity": {
                "status": runtime_parity["status"],
                "sourceType": parity_fixture["sourceType"],
                "frameCount": parity_frame_count,
                "multiCandidateFrameCount": int(parity_fixture["multiCandidateFrameCount"]),
                "maximumCandidateCount": int(parity_fixture["maximumCandidateCount"]),
                "wrongSubjectSwitchCount": int(parity_identity["wrongSubjectSwitchCount"]),
                "webPacketParity": parity_platforms["web"]["matchedPacketCount"] / parity_frame_count,
                "androidPacketParity": parity_platforms["android"]["matchedPacketCount"] / parity_frame_count,
                "iosPacketParity": parity_platforms["ios"]["matchedPacketCount"] / parity_frame_count,
                "androidRuntime": parity_platforms["android"]["runtime"],
                "iosRuntime": parity_platforms["ios"]["runtime"],
                "remainingGaps": runtime_parity.get("remainingGaps") or [],
            },
            "mmfit": {
                "setCount": mmfit_report.get("summary"),
                "actionClassification": (mmfit_report.get("actionClassification") or {}).get("summary"),
                "corpusAudit": mmfit_audit.get("summary"),
            },
            "minimumRequiredRate": 0.95,
            "promotionPassed": False,
        },
        "clientAgentEvidence": {
            "available": [
                "rust canonical landmarks with source/confidence",
                "action candidate evidence",
                "rep and phase candidate evidence",
                "trajectory/ROM/tempo/asymmetry observations when judgeable",
                "measurement limits and cannot_judge reasons",
                "cross-platform validated Rust packet semantics for real Halpe-26 multi-candidate observations",
            ],
            "blockedUntilReviewedTruth": [
                "standard vs nonstandard classification",
                "momentum or compensation classification",
                "claim that a personal capture is a standard-form reference",
            ],
            "contract": "maxpower-training-execution-assessment/v1",
        },
        "artifacts": artifact_refs,
    }


def atomic_write(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    os.close(descriptor)
    try:
        Path(temporary).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--personal-dataset", type=Path, required=True)
    parser.add_argument("--personal-canonical", type=Path, required=True)
    parser.add_argument("--personal-cycle-model", type=Path, required=True)
    parser.add_argument("--personal-cycle-report", type=Path, required=True)
    parser.add_argument("--mmfit-manifest", type=Path, required=True)
    parser.add_argument("--mmfit-canonical", type=Path, required=True)
    parser.add_argument("--mmfit-audit", type=Path, required=True)
    parser.add_argument("--mmfit-prior-model", type=Path, required=True)
    parser.add_argument("--mmfit-report", type=Path, required=True)
    parser.add_argument("--technique-dataset", type=Path, required=True)
    parser.add_argument("--runtime-parity", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    paths = {
        "personalDataset": args.personal_dataset,
        "personalCanonical": args.personal_canonical,
        "personalCycleModel": args.personal_cycle_model,
        "personalCycleReport": args.personal_cycle_report,
        "mmfitNativeManifest": args.mmfit_manifest,
        "mmfitCanonical": args.mmfit_canonical,
        "mmfitCorpusAudit": args.mmfit_audit,
        "mmfitPriorModel": args.mmfit_prior_model,
        "mmfitReport": args.mmfit_report,
        "techniqueDataset": args.technique_dataset,
        "runtimeParity": args.runtime_parity,
    }
    refs = {name: artifact(path) for name, path in paths.items()}
    value = build_manifest(
        personal_dataset=load(args.personal_dataset),
        personal_canonical=load(args.personal_canonical),
        mmfit_manifest=load(args.mmfit_manifest),
        mmfit_canonical=load(args.mmfit_canonical),
        mmfit_audit=load(args.mmfit_audit),
        mmfit_report=load(args.mmfit_report),
        technique_dataset=load(args.technique_dataset),
        runtime_parity=load(args.runtime_parity),
        artifact_refs=refs,
    )
    atomic_write(args.output, value)
    print(json.dumps({"output": str(args.output), "sha256": sha256_file(args.output), "status": value["status"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
