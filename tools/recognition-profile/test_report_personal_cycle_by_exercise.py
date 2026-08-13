import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("reportPersonalCycleByExercise.py")
SPEC = importlib.util.spec_from_file_location("report_personal_cycle_by_exercise", MODULE_PATH)
assert SPEC and SPEC.loader
reporter = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = reporter
SPEC.loader.exec_module(reporter)


class PersonalCycleByExerciseReportTest(unittest.TestCase):
    def test_aggregates_split_windows_by_source_capture(self) -> None:
        rows = [
            {
                "sourceCaptureId": "source-a",
                "leaveOneSourceOutEligible": True,
                "truthCount": 2,
                "predictedCount": 2,
                "matchedCount": 2,
                "manualRangeAlignedCount": 2,
                "segmentMatches": [
                    {"startOffsetMs": 100, "endOffsetMs": -50, "iou": 0.9},
                    {"startOffsetMs": -200, "endOffsetMs": 100, "iou": 0.8},
                ],
            },
            {
                "sourceCaptureId": "source-a",
                "leaveOneSourceOutEligible": True,
                "truthCount": 1,
                "predictedCount": 1,
                "matchedCount": 1,
                "manualRangeAlignedCount": 1,
                "segmentMatches": [
                    {"startOffsetMs": 0, "endOffsetMs": 0, "iou": 1.0},
                ],
            },
        ]
        summary = reporter.summarize_rows(rows)
        self.assertEqual(summary["sourceCaptureCount"], 1)
        self.assertEqual(summary["truthRepCount"], 3)
        self.assertEqual(summary["exactRepCountSourceRate"], 1.0)
        self.assertEqual(summary["exactRepCountAndAllBoundariesSourceRate"], 1.0)

    def test_one_source_without_holdout_is_not_presented_as_accuracy(self) -> None:
        summary = reporter.summarize_rows([{
            "sourceCaptureId": "only-source",
            "leaveOneSourceOutEligible": False,
            "truthCount": 5,
        }])
        self.assertEqual(summary["evaluationStatus"], "not_evaluable_single_source")
        self.assertNotIn("candidateRecall", summary)


if __name__ == "__main__":
    unittest.main()
