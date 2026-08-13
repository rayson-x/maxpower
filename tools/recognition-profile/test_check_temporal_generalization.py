from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("checkTemporalGeneralization.py")
SPEC = importlib.util.spec_from_file_location("check_temporal_generalization", MODULE_PATH)
assert SPEC and SPEC.loader
gate = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = gate
SPEC.loader.exec_module(gate)


class TemporalGeneralizationGateTest(unittest.TestCase):
    def test_separates_manual_ranges_from_provenance_bearing_peaks(self) -> None:
        report = {
            "leaveOneSourceOut": {
                "mode": "leave_one_source_out",
                "summary": {
                    "truthBoundaryCount": 2,
                    "sourceCaptureCount": 1,
                    "alignedCount": 1,
                    "exactSetSourceCaptureCount": 1,
                    "exactSetAndAvailableBoundarySourceCaptureCount": 0,
                },
                "rows": [{
                    "captureId": "capture-a",
                    "sourceCaptureId": "capture-a",
                    "expectedCount": 2,
                    "predictedCount": 2,
                    "truthCount": 2,
                    "segmentMatches": [
                        {"truthIndex": 0, "startOffsetMs": 10, "peakOffsetMs": 20, "endOffsetMs": 30, "iou": 0.9},
                        {"truthIndex": 1, "startOffsetMs": 10, "peakOffsetMs": 900, "endOffsetMs": 30, "iou": 0.9},
                    ],
                }],
            },
        }
        dataset = {"records": [{
            "captureId": "capture-a",
            "segments": [
                {"startMs": 0, "peakMs": 500, "endMs": 1000, "peakSource": "human_adjusted"},
                {"startMs": 1000, "peakMs": 1500, "endMs": 2000},
            ],
        }]}

        metrics, failures = gate.evaluate(report, dataset, 0.95)

        self.assertEqual(metrics["manualRangeAlignedRate"], 1.0)
        self.assertEqual(metrics["exactManualRangeSourceCaptureRate"], 1.0)
        self.assertEqual(metrics["humanPeakAlignedRate"], 1.0)
        self.assertEqual(metrics["humanPeakTruthCoverageRate"], 0.5)
        self.assertEqual(metrics["peakProvenance"]["legacy_unattributed"], 1)
        self.assertEqual(failures, ["humanPeakTruthCoverageRate=50.00% < 95.00%"])


if __name__ == "__main__":
    unittest.main()
