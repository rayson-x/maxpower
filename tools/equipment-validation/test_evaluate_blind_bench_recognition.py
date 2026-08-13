import json
import tempfile
import unittest
from pathlib import Path

import evaluate_blind_bench_recognition as audit


class BlindBenchPeakTruthTest(unittest.TestCase):
    def test_midpoint_without_human_provenance_cannot_pass_peak_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pack_path = root / "pack.json"
            predictions_path = root / "predictions.json"
            dataset_path = root / "dataset.json"
            pose_path = root / "pose.json"
            report_path = root / "report.json"
            markdown_path = root / "report.md"

            pack = {
                "schemaVersion": audit.PACK_SCHEMA,
                "seed": 1,
                "randomizedCaptureOrder": ["capture-a"],
                "captures": [{"captureId": "capture-a"}],
                "preparationQuality": {
                    "rows": [{
                        "captureId": "capture-a",
                        "strictlyIncreasingTimestamps": True,
                        "uniqueFrameNumbers": True,
                    }],
                },
            }
            pack_path.write_text(json.dumps(pack), encoding="utf-8")
            predictions_path.write_text(json.dumps({
                "inferencePackSha256": audit._sha256(pack_path),
                "randomizedCaptureOrder": ["capture-a"],
                "rows": [{
                    "captureId": "capture-a",
                    "recognizedBenchExecution": True,
                    "rawCausalCandidateCount": 1,
                    "discardedSetupOrPostSetCandidateCount": 0,
                    "predictedSegments": [{"startMs": 100, "peakMs": 500, "endMs": 900}],
                }],
            }), encoding="utf-8")
            dataset_path.write_text(json.dumps({
                "records": [{
                    "sourceCaptureId": "capture-a",
                    "exerciseId": "barbell_bench_press",
                    "capturePosition": "front",
                    # No peakSource: this is a legacy midpoint placeholder, not human truth.
                    "segments": [{"repIndex": 1, "startMs": 100, "peakMs": 500, "endMs": 900}],
                }],
            }), encoding="utf-8")
            pose_path.write_text(json.dumps({
                "usesExpectedCountAtInference": False,
                "usesTruthRangesAtInference": False,
                "evaluationProtocol": {"mode": "test"},
                "leaveOneSourceOut": {"rows": []},
            }), encoding="utf-8")

            report = audit.evaluate(
                dataset_path,
                pack_path,
                predictions_path,
                pose_path,
                report_path,
                markdown_path,
            )

            self.assertEqual(report["summary"]["eligiblePeakTruthCount"], 0)
            self.assertIsNone(report["summary"]["peakWithin500MsRate"])
            self.assertEqual(report["summary"]["peakTruthStatus"], "blocked_no_human_truth")
            self.assertFalse(report["summary"]["acceptance"]["peakTimingAtLeast95PercentWithin500Ms"])


if __name__ == "__main__":
    unittest.main()
