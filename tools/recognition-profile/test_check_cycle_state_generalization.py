from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("checkCycleStateGeneralization.py")
SPEC = importlib.util.spec_from_file_location("check_cycle_state_generalization", MODULE_PATH)
assert SPEC and SPEC.loader
gate = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = gate
SPEC.loader.exec_module(gate)


class CycleStateGeneralizationGateTest(unittest.TestCase):
    def test_requires_range_precision_recall_alignment_and_source_exactness(self) -> None:
        report = {
            "usesExpectedCountAtInference": False,
            "usesLegacyPeakLabels": False,
            "leaveOneSourceOut": {
                "mode": "leave_one_source_out",
                "summary": {
                    "truthRangeCount": 100,
                    "eligibleTruthRangeCount": 90,
                    "rawCandidateCount": 110,
                    "rawMatchedCount": 98,
                    "eligibleRawMatchedCount": 89,
                    "predictedCount": 105,
                    "matchedCount": 95,
                    "manualRangeAlignedCount": 94,
                    "sourceCaptureCount": 20,
                    "exactSetSourceCaptureCount": 19,
                    "exactSetAndManualRangeSourceCaptureCount": 18,
                },
            },
        }

        metrics, failures = gate.evaluate(report, 0.95)

        self.assertAlmostEqual(metrics["candidatePrecision"], 95 / 105)
        self.assertEqual(metrics["candidateRecall"], 0.95)
        self.assertAlmostEqual(metrics["rawCandidateRecall"], 0.98)
        self.assertAlmostEqual(metrics["eligibleRawCandidateRecall"], 89 / 90)
        self.assertIn("candidatePrecision=90.48% < 95.00%", failures)
        self.assertIn("manualRangeAlignedRate=94.00% < 95.00%", failures)
        self.assertIn("exactSetAndManualRangeSourceCaptureRate=90.00% < 95.00%", failures)


if __name__ == "__main__":
    unittest.main()
