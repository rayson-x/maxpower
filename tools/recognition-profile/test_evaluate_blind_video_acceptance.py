from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("evaluateBlindVideoAcceptance.py")
SPEC = importlib.util.spec_from_file_location("evaluate_blind_video_acceptance", MODULE_PATH)
assert SPEC and SPEC.loader
gate = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = gate
SPEC.loader.exec_module(gate)


def report() -> dict:
    rows = []
    for source_id, truth, predicted, matched, aligned in (
        ("capture-a", 2, 2, 2, 2),
        ("capture-b", 2, 1, 1, 1),
    ):
        rows.append(
            {
                "captureId": source_id,
                "sourceCaptureId": source_id,
                "heldOutSourceId": source_id,
                "trainingSourceIds": [item for item in ("capture-a", "capture-b") if item != source_id],
                "splitLeakageDetected": False,
                "labelsRevealedAfterInference": True,
                "leaveOneSourceOutEligible": True,
                "exerciseId": "barbell_bench_press",
                "expectedCount": truth,
                "truthCount": truth,
                "predictedCount": predicted,
                "matchedCount": matched,
                "manualRangeAlignedCount": aligned,
                "segmentMatches": [
                    {
                        "truthIndex": index,
                        "predictedIndex": index,
                        "startOffsetMs": 100,
                        "peakOffsetMs": 100,
                        "truthPeakSource": "human_adjusted",
                        "endOffsetMs": -100,
                        "iou": 0.9,
                        "aligned": True,
                    }
                    for index in range(matched)
                ],
            }
        )
    return {
        "usesExpectedCountAtInference": False,
        "usesTruthRangesAtInference": False,
        "usesExerciseLabelAtInference": True,
        "usesLegacyPeakLabels": False,
        "executionBackend": "python_offline_reference_only",
        "evaluationProtocol": {
            "mode": "exhaustive_leave_one_source_out",
            "partitionUnit": "sourceCaptureId",
            "inferenceBeforeLabelReveal": True,
            "aggregateAllHeldOutSources": True,
            "randomSingleSourceIsAuditOnly": True,
        },
        "canonicalInputProvenance": {
            "inputPipeline": "yolox-nano-humanart+rtmpose-m-halpe26",
            "inputPoseSchema": "halpe26",
            "rustWasmSha256": "abc",
        },
        "leaveOneSourceOut": {"mode": "leave_one_source_out", "rows": rows},
    }


def standard() -> dict:
    return {
        "schemaVersion": "maxpower-blind-video-evaluation-standard/v1",
        "thresholds": {
            "repAndPhase": {
                "candidatePrecision": 0.95,
                "candidateRecall": 0.95,
                "exactSetSourceRate": 0.95,
                "manualRangeAlignedRate": 0.95,
                "peakWithinToleranceRate": 0.95,
                "minimumEligiblePeakTruthCount": 1,
                "startEndToleranceMs": 500,
                "peakToleranceMs": 250,
                "minimumIntervalIoU": 0.6,
            }
        },
    }


class BlindVideoAcceptanceTest(unittest.TestCase):
    def test_scores_all_held_out_sources_and_keeps_random_pick_audit_only(self) -> None:
        result = gate.evaluate(
            report(),
            standard(),
            {"status": "blocked_no_gold_labels", "stats": {"eligibleRepCount": 0}},
            seed="fixed-seed",
            audit_count=1,
        )

        metrics = result["dimensions"]["repAndPhase"]["metrics"]
        self.assertEqual(metrics["sourceCaptureCount"], 2)
        self.assertEqual(metrics["truthRangeCount"], 4)
        self.assertEqual(metrics["predictedCount"], 3)
        self.assertEqual(metrics["matchedCount"], 3)
        self.assertEqual(metrics["candidatePrecision"], 1.0)
        self.assertEqual(metrics["candidateRecall"], 0.75)
        self.assertEqual(metrics["exactSetSourceRate"], 0.5)
        self.assertEqual(metrics["manualRangeAlignedRate"], 0.75)
        self.assertEqual(result["dimensions"]["repAndPhase"]["status"], "fail")
        self.assertEqual(result["dimensions"]["techniqueQuality"]["status"], "blocked_no_gold_labels")
        self.assertEqual(len(result["protocol"]["randomAuditSources"]), 1)
        self.assertTrue(result["protocol"]["randomAuditIsAcceptanceMetric"] is False)

    def test_legacy_peak_midpoints_are_excluded_and_cannot_pass_peak_gate(self) -> None:
        value = report()
        for row in value["leaveOneSourceOut"]["rows"]:
            for match in row["segmentMatches"]:
                match["truthPeakSource"] = "legacy_unattributed"
                match["peakOffsetMs"] = None

        result = gate.evaluate(
            value,
            standard(),
            {"status": "blocked_no_gold_labels", "stats": {"eligibleRepCount": 0}},
            seed="fixed-seed",
            audit_count=1,
        )

        metrics = result["dimensions"]["repAndPhase"]["metrics"]
        self.assertEqual(metrics["eligiblePeakTruthCount"], 0)
        self.assertIsNone(metrics["peakWithinToleranceRate"])
        self.assertEqual(
            metrics["peakTruthProvenance"], {"legacy_unattributed": 3}
        )
        self.assertIn(
            "eligiblePeakTruthCount=0 < 1",
            result["dimensions"]["repAndPhase"]["failures"],
        )

    def test_rejects_a_held_out_source_that_appears_in_training(self) -> None:
        value = report()
        value["leaveOneSourceOut"]["rows"][0]["trainingSourceIds"].append("capture-a")

        with self.assertRaisesRegex(ValueError, "leakage"):
            gate.evaluate(
                value,
                standard(),
                {"status": "blocked_no_gold_labels", "stats": {"eligibleRepCount": 0}},
                seed="fixed-seed",
                audit_count=1,
            )

    def test_random_audit_order_is_deterministic(self) -> None:
        first = gate.deterministic_audit_order(["c", "a", "b"], "seed")
        second = gate.deterministic_audit_order(["b", "c", "a"], "seed")
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
