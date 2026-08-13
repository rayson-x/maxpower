import unittest

from build_halpe26_v1 import (
    BLAZEPOSE33_TO_COCO17,
    HALPE26_NAMES,
    mmfit_landmarks_to_halpe26,
    technique_review_items,
)


class MmFitHalpeMappingTest(unittest.TestCase):
    def test_coco_prefix_is_exact_and_added_points_are_unknown(self):
        blaze = [
            {"x": index / 100, "y": index / 200, "z": 0.0, "visibility": 1.0}
            for index in range(33)
        ]
        halpe = mmfit_landmarks_to_halpe26(blaze)
        self.assertEqual(len(HALPE26_NAMES), 26)
        self.assertEqual(len(halpe), 26)
        for target, source in enumerate(BLAZEPOSE33_TO_COCO17):
            self.assertEqual(halpe[target], blaze[source])
        self.assertTrue(all(point["visibility"] == 0 for point in halpe[17:]))

    def test_technique_queue_preserves_timeline_and_never_invents_quality(self):
        records = [{
            "captureId": "capture",
            "sourceCaptureId": "source",
            "source": {"video": "capture.mp4"},
            "exerciseId": "barbell_bench_press",
            "capturePosition": "front",
            "segments": [{"repIndex": 1, "startMs": 100, "peakMs": 500, "endMs": 900}],
        }]
        items = technique_review_items(records)
        self.assertEqual(items[0]["peakMs"], 500)
        self.assertEqual(items[0]["labels"]["techniqueAdherence"], "unknown")
        self.assertFalse(items[0]["labels"]["standardFormReference"])


if __name__ == "__main__":
    unittest.main()
