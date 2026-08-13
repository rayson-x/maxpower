from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("build_native_halpe26_v2.py")
SPEC = importlib.util.spec_from_file_location("build_native_halpe26_v2", MODULE_PATH)
assert SPEC and SPEC.loader
builder = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = builder
SPEC.loader.exec_module(builder)


class NativeHalpe26DatabaseTest(unittest.TestCase):
    def runtime_parity(self) -> dict:
        return {
            "schemaVersion": "maxpower-real-halpe26-cross-platform-runtime-parity/v1",
            "status": "passed_available_runtimes",
            "fixture": {
                "sourceType": "personal_real_video",
                "frameCount": 14,
                "multiCandidateFrameCount": 5,
                "maximumCandidateCount": 5,
            },
            "identity": {"wrongSubjectSwitchCount": 0},
            "platforms": {
                "web": {"status": "passed", "matchedPacketCount": 14},
                "android": {"status": "passed", "runtime": "physical_device", "matchedPacketCount": 14},
                "ios": {"status": "passed", "runtime": "simulator", "matchedPacketCount": 14},
            },
            "productionPromotion": False,
        }

    def test_runtime_parity_requires_real_multi_candidate_packets_on_all_available_clients(self) -> None:
        report = self.runtime_parity()
        builder.validate_runtime_parity(report)
        report["platforms"]["android"]["matchedPacketCount"] = 13
        with self.assertRaisesRegex(ValueError, "packet coverage"):
            builder.validate_runtime_parity(report)

    def test_mmfit_requires_train_only_301_clip_isolated_reports(self) -> None:
        clips = [
            {"sourceSequenceId": f"w01:{index}", "subjectId": "01", "expectedCount": 10}
            for index in range(301)
        ]
        canonical_clips = {item["sourceSequenceId"]: {} for item in clips}
        manifest = {"complete": True, "requestedSplits": ["train"], "clips": clips}
        canonical = {"requestedSplits": ["train"], "sourceSequenceCount": 301, "clips": canonical_clips}
        audit = {"integrityStatus": "passed", "summary": {"clipCount": 301}}
        report = {
            "usesExpectedCountAtInference": False,
            "rows": [{}] * 301,
            "actionClassification": {"usesExerciseLabelAtInference": False, "rows": [{}] * 301},
        }
        builder.validate_mmfit(manifest, canonical, audit, report)
        manifest["requestedSplits"] = ["train", "test"]
        with self.assertRaisesRegex(ValueError, "train-only"):
            builder.validate_mmfit(manifest, canonical, audit, report)

    def test_technique_tasks_remain_blocked_without_dual_review_gold(self) -> None:
        records = [
            {
                "captureId": f"capture-{index}",
                "sourceCaptureId": f"source-{index % 50}",
                "expectedCount": 1,
                "segments": ([{"startMs": 0, "endMs": 100}] if index < 464 else []),
            }
            for index in range(464)
        ]
        # Collapse 464 segment-bearing records into the required 54 records.
        records = []
        remaining = 464
        for index in range(54):
            count = min(9, remaining)
            remaining -= count
            records.append({
                "captureId": f"capture-{index}",
                "sourceCaptureId": f"source-{index % 50}",
                "expectedCount": count,
                "segments": [{"startMs": rep * 100, "endMs": rep * 100 + 80} for rep in range(count)],
            })
        self.assertEqual(sum(len(record["segments"]) for record in records), 464)
        clips = [
            {"sourceSequenceId": f"w{index % 10:02d}:{index}", "subjectId": str(index % 10), "expectedCount": 10}
            for index in range(301)
        ]
        value = builder.build_manifest(
            personal_dataset={"records": records},
            personal_canonical={"inputPoseSchema": "halpe26", "sourceCaptureCount": 50},
            mmfit_manifest={"complete": True, "requestedSplits": ["train"], "clips": clips},
            mmfit_canonical={"requestedSplits": ["train"], "sourceSequenceCount": 301, "clips": {item["sourceSequenceId"]: {} for item in clips}},
            mmfit_audit={"integrityStatus": "passed", "summary": {"clipCount": 301}},
            mmfit_report={"usesExpectedCountAtInference": False, "rows": [{}] * 301, "actionClassification": {"usesExerciseLabelAtInference": False, "rows": [{}] * 301}},
            technique_dataset={"examples": []},
            runtime_parity=self.runtime_parity(),
            artifact_refs={},
        )
        self.assertEqual(value["trainingProducts"]["technique"]["status"], "blocked_no_gold_labels")
        self.assertEqual(value["evaluationSnapshot"]["runtimeParity"]["wrongSubjectSwitchCount"], 0)
        self.assertEqual(value["evaluationSnapshot"]["runtimeParity"]["webPacketParity"], 1.0)
        self.assertFalse(value["productionPromotion"])


if __name__ == "__main__":
    unittest.main()
