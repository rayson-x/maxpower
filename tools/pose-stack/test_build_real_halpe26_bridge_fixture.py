import importlib.util
import sys
import unittest
from pathlib import Path

import numpy as np


MODULE_PATH = Path(__file__).with_name("build_real_halpe26_bridge_fixture.py")
SPEC = importlib.util.spec_from_file_location("build_real_halpe26_bridge_fixture", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class RealHalpe26BridgeFixtureTest(unittest.TestCase):
    def test_assign_candidate_ids_preserves_iou_identity_across_order_changes(self):
        previous = [
            MODULE.TrackedBox(7, (0.05, 0.10, 0.75, 0.95)),
            MODULE.TrackedBox(8, (0.80, 0.10, 0.95, 0.35)),
        ]
        current = [
            (0.79, 0.10, 0.95, 0.36),
            (0.04, 0.09, 0.76, 0.96),
            (0.20, 0.20, 0.27, 0.34),
        ]

        tracked, next_id = MODULE.assign_candidate_ids(current, previous, 9)

        self.assertEqual([item.candidate_id for item in tracked], [8, 7, 9])
        self.assertEqual(next_id, 10)

    def test_torso_color_uses_only_visible_measured_torso_region(self):
        frame = np.zeros((10, 10, 3), dtype=np.uint8)
        # OpenCV is BGR. The torso rectangle is filled with RGB (30, 20, 10).
        frame[2:7, 2:7] = [10, 20, 30]
        landmarks = [[0.0, 0.0, 0.0, 0.0] for _ in range(26)]
        for index, point in zip(
            (5, 6, 11, 12),
            ((0.2, 0.2), (0.6, 0.2), (0.2, 0.6), (0.6, 0.6)),
        ):
            landmarks[index] = [point[0], point[1], 0.0, 0.9]

        color = MODULE.sample_torso_color(frame, landmarks)

        self.assertAlmostEqual(color[0], 30 / 255, places=7)
        self.assertAlmostEqual(color[1], 20 / 255, places=7)
        self.assertAlmostEqual(color[2], 10 / 255, places=7)

    def test_torso_color_is_unknown_when_any_torso_anchor_is_weak(self):
        frame = np.full((10, 10, 3), 255, dtype=np.uint8)
        landmarks = [[0.5, 0.5, 0.0, 0.9] for _ in range(26)]
        landmarks[11][3] = 0.19

        self.assertEqual(MODULE.sample_torso_color(frame, landmarks), [0.0, 0.0, 0.0])


if __name__ == "__main__":
    unittest.main()
