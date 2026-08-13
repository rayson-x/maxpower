import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import evaluate_realtime_bench_stream as realtime
import run_single_pass_bench_acceptance as single_pass


class SinglePassAcceptanceTest(unittest.TestCase):
    def test_selection_is_deterministic_and_rejects_truth(self) -> None:
        pack = {
            "schemaVersion": realtime.PACK_SCHEMA,
            "captureOrder": ["a", "b", "c"],
            "captures": [
                {"captureId": "a", "sourceVideo": "a.mp4"},
                {"captureId": "b", "sourceVideo": "b.mp4"},
                {"captureId": "c", "sourceVideo": "c.mp4"},
            ],
        }
        first = single_pass.select_capture(pack, "seed")
        second = single_pass.select_capture(pack, "seed")
        self.assertEqual(first["captureId"], second["captureId"])
        pack["captures"][0]["expectedCount"] = 3
        with self.assertRaisesRegex(ValueError, "truth leaked"):
            single_pass.select_capture(pack, "seed")

    def test_truth_is_joined_only_after_frozen_prediction(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            prediction_path = root / "prediction.json"
            selection_path = root / "selection.json"
            reviews_path = root / "reviews.jsonl"
            report_path = root / "report.json"
            prediction = {
                "captureId": "capture-a",
                "sourceVideo": "capture-a.mp4",
                "onePassContract": {
                    "chronologicalOnly": True,
                    "seekCount": 0,
                    "modelInferenceAtMostOncePerFrame": True,
                    "secondRecognitionPass": False,
                    "labelsAvailableDuringInference": False,
                    "futureFramesRead": False,
                    "lateFramePolicy": "drop_not_recompute",
                    "sourceMode": "test",
                    "actualCameraCapture": False,
                },
                "runtimeSummary": {
                    "inferenceCoverage": 1.0,
                    "droppedBackpressureFrameCount": 0,
                    "captureToResultMs": {"p95": 100.0},
                },
                "predictedSegments": [
                    {
                        "startMs": 1_000.0,
                        "turnaroundMs": 1_500.0,
                        "turnaroundConfirmedAtMs": 1_600.0,
                        "endMs": 2_000.0,
                        "amplitudePxAtReferenceHeight": 40.0,
                        "axisFrameCoverage": 1.0,
                        "meanAxisConfidence": 0.8,
                        "bilateral": {"status": "cannot_judge"},
                    }
                ],
                "rawCandidateCount": 1,
                "rejectedIsolatedCandidateCount": 0,
            }
            selection = {"selectedCaptureId": "capture-a", "selectionSeed": "seed"}
            truth = {
                "captureId": "capture-a",
                "capturePosition": "front",
                "recordedAt": "2026-08-12T00:00:00Z",
                "reviewStatus": "submitted",
                "humanPeakTruth": True,
                "reps": [
                    {
                        "repIndex": 1,
                        "startMs": 1_000.0,
                        "turnaroundMs": 1_500.0,
                        "endMs": 2_000.0,
                        "turnaroundSource": "human_adjusted",
                    }
                ],
            }
            realtime.write_json(prediction_path, prediction)
            realtime.write_json(selection_path, selection)
            reviews_path.write_text(json.dumps(truth) + "\n", encoding="utf-8")
            report = single_pass.compare_after_prediction_frozen(
                prediction_path=prediction_path,
                selection_path=selection_path,
                reviews_path=reviews_path,
                report_path=report_path,
            )
            self.assertEqual(report["completion"]["repCompletion"]["status"], "pass")
            self.assertEqual(report["completion"]["lowestPointTiming"]["status"], "pass")
            self.assertEqual(report["completion"]["standardTechnique"]["status"], "cannot_judge")
            self.assertTrue(report["protocol"]["predictionPersistedBeforeTruthLoaded"])


if __name__ == "__main__":
    unittest.main()
