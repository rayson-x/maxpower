import unittest

from tools.pose_stack_import import load_pose_stack_module


queue_builder = load_pose_stack_module("build_personal_pose_keypoint_review_queue.py")


class PoseReviewSelectionTest(unittest.TestCase):
    def frames(self):
        result = []
        for index in range(60):
            score = 0.1 if index in (22, 24, 26) else 0.8
            landmarks = [{"x": 0.5, "y": 0.5, "visibility": 0.9} for _ in range(26)]
            for joint in range(5, 13):
                landmarks[joint]["visibility"] = score
            result.append({"frameNumber": index, "timestampMs": index * 100.0, "landmarks": landmarks})
        return result

    def test_selection_is_deterministic_and_keeps_phase_hard_and_rest_strata(self):
        segments = [
            {"repIndex": 1, "startMs": 1000, "peakMs": 2000, "endMs": 3000},
            {"repIndex": 2, "startMs": 3200, "peakMs": 4000, "endMs": 5000},
        ]
        first = queue_builder.select_review_frames(self.frames(), segments, 20)
        second = queue_builder.select_review_frames(self.frames(), segments, 20)
        self.assertEqual(first, second)
        self.assertEqual(len(first), 20)
        numbers = {entry["frame"]["frameNumber"] for entry in first}
        self.assertTrue({10, 20, 30, 32, 40, 50}.issubset(numbers))
        reasons = {entry["selectionReason"] for entry in first}
        self.assertIn("lowest_required_joint_score", reasons)
        self.assertIn("setup_or_rest_quantile", reasons)

    def test_selection_rejects_impossible_target(self):
        with self.assertRaisesRegex(ValueError, "exceeds available"):
            queue_builder.select_review_frames(self.frames(), [], 61)

    def test_compact_landmarks_never_marks_model_points_as_human_truth(self):
        frame = self.frames()[0]
        points = queue_builder.compact_landmarks(frame, canonical=False)
        self.assertEqual([point["index"] for point in points], list(range(5, 13)))
        self.assertTrue(all(point["humanTruth"] is False for point in points))


if __name__ == "__main__":
    unittest.main()
