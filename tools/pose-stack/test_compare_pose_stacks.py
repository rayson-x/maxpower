import unittest

import numpy as np

from compare_pose_stacks import (
    ByteTrackSubjectSelector,
    Detection,
    map_movenet_keypoints,
)


class ByteTrackSubjectSelectorTest(unittest.TestCase):
    def test_low_score_detection_can_continue_but_not_initialize_track(self):
        selector = ByteTrackSubjectSelector(sample_fps=10.0)
        selected, first = selector.select(
            [Detection((100, 100, 500, 700), 0.9)], 0.0, 720, 1280
        )
        self.assertIsNotNone(selected)
        self.assertTrue(first["detectorObserved"])
        track_id = first["trackId"]

        selected, second = selector.select(
            [Detection((105, 102, 505, 702), 0.25)], 100.0, 720, 1280
        )
        self.assertIsNotNone(selected)
        self.assertTrue(second["detectorObserved"])
        self.assertEqual(second["trackId"], track_id)

        fresh = ByteTrackSubjectSelector(sample_fps=10.0)
        selected, detail = fresh.select(
            [Detection((100, 100, 500, 700), 0.25)], 0.0, 720, 1280
        )
        self.assertIsNone(selected)
        self.assertEqual(detail["reason"], "no_active_track")

    def test_short_detector_gap_uses_motion_hold_without_switch(self):
        selector = ByteTrackSubjectSelector(sample_fps=10.0)
        selector.select([Detection((100, 100, 500, 700), 0.9)], 0.0, 720, 1280)
        selected, detail = selector.select([], 100.0, 720, 1280)
        self.assertIsNotNone(selected)
        self.assertFalse(detail["detectorObserved"])
        self.assertEqual(detail["reason"], "bytetrack_motion_hold")
        self.assertEqual(selector.switch_count, 0)


class MoveNetMappingTest(unittest.TestCase):
    def test_coco_prefix_is_mapped_and_extra_halpe_slots_stay_unknown(self):
        values = np.zeros((17, 3), dtype=np.float32)
        values[:, 0] = 0.25
        values[:, 1] = 0.75
        values[:, 2] = 0.8
        landmarks = map_movenet_keypoints(values, (100.0, 200.0, 400.0), 1000, 1000)
        self.assertEqual(len(landmarks), 26)
        self.assertAlmostEqual(landmarks[0]["x"], 0.4)
        self.assertAlmostEqual(landmarks[0]["y"], 0.3)
        self.assertAlmostEqual(landmarks[16]["visibility"], 0.8)
        self.assertTrue(all(item["visibility"] == 0 for item in landmarks[17:]))


if __name__ == "__main__":
    unittest.main()
