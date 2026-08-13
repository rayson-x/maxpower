from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "tools/equipment-validation/evaluate_pose_equipment_fusion.py"
SPEC = importlib.util.spec_from_file_location("evaluate_pose_equipment_fusion", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FullCycleBoundaryTest(unittest.TestCase):
    def test_neighboring_equipment_extrema_define_complete_cycle_boundaries(self) -> None:
        cycles = [
            {"startMs": 900, "extremeMs": 1_000, "endMs": 1_100},
            {"startMs": 1_900, "extremeMs": 2_000, "endMs": 2_100},
            {"startMs": 3_100, "extremeMs": 3_200, "endMs": 3_300},
        ]

        reconstructed = MODULE.reconstruct_full_cycles(cycles)

        self.assertEqual(
            reconstructed,
            [
                {
                    "startMs": 500,
                    "equipmentExtremeMs": 1_000,
                    "endMs": 1_500,
                    "boundarySource": "neighboring_equipment_extrema_midpoint",
                },
                {
                    "startMs": 1_500,
                    "equipmentExtremeMs": 2_000,
                    "endMs": 2_600,
                    "boundarySource": "neighboring_equipment_extrema_midpoint",
                },
                {
                    "startMs": 2_600,
                    "equipmentExtremeMs": 3_200,
                    "endMs": 3_800,
                    "boundarySource": "neighboring_equipment_extrema_midpoint",
                },
            ],
        )


class RealBenchFixtureTest(unittest.TestCase):
    def test_equipment_observation_recovers_pose_missed_reps_but_not_95_percent_timeline(self) -> None:
        result = MODULE.evaluate_files(
            dataset_path=ROOT / "data/training/personal-golden-segmentation-v2.json",
            canonical_path=ROOT
            / "data/workflows/motion-profile/personal-halpe26-v1/run-2026-08-11/corpus/personal-rust-canonical-v2.json",
            pose_report_path=ROOT
            / "data/workflows/motion-profile/personal-halpe26-v1/run-2026-08-11/diagnostics/personal-cycle-state-halpe26-v1-loo.json",
            equipment_report_path=ROOT
            / "data/workflows/equipment-validation/bar-axis-v1/legacy-evaluation.json",
        )

        pose = result["comparison"]["poseOnlyHeldOut"]
        assisted = result["comparison"]["equipmentAssistedPrototype"]
        self.assertEqual((pose["predictedRepCount"], pose["truthRepCount"]), (42, 46))
        self.assertEqual(pose["exactSetSourceCount"], 3)
        self.assertEqual(assisted["matchedRepCount"], 46)
        self.assertEqual(assisted["exactSetSourceCount"], 6)
        self.assertEqual(assisted["manualRangeAlignedCount"], 39)
        self.assertAlmostEqual(assisted["manualRangeAlignedRate"], 39 / 46)
        self.assertEqual(assisted["status"], "fail_below_95_percent_timeline")
        self.assertFalse(result["productionPromotion"])

        front = result["skeletonObservability"]["byView"]["front"]
        oblique = result["skeletonObservability"]["byView"]["oblique45"]
        self.assertLess(front["wristMeasuredRate"], oblique["wristMeasuredRate"])
        front_comparison = result["comparisonByView"]["front"]
        self.assertEqual(front_comparison["poseOnlyHeldOut"]["manualRangeAlignedCount"], 5)
        self.assertEqual(
            front_comparison["equipmentAssistedPrototype"]["manualRangeAlignedCount"],
            14,
        )
        self.assertAlmostEqual(front_comparison["timelineAlignmentDelta"], 9 / 16)
        oblique_comparison = result["comparisonByView"]["oblique45"]
        self.assertEqual(oblique_comparison["timelineAlignmentDelta"], 0.0)
        self.assertEqual(
            result["conclusion"]["primaryFinding"],
            "both_pose_observability_and_temporal_boundary_semantics_contribute",
        )


if __name__ == "__main__":
    unittest.main()
