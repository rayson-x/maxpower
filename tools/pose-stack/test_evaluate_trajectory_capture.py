import unittest

from evaluate_trajectory_capture import frame_in_segments, summarize_skeleton_capture


def landmark(x=0.5, y=0.5, score=0.9):
    return {"x": x, "y": y, "z": None, "visibility": score}


class TrajectoryCaptureTest(unittest.TestCase):
    def test_frame_window_is_inclusive(self):
        segments = [{"startMs": 100, "endMs": 200}]
        self.assertTrue(frame_in_segments(100, segments))
        self.assertTrue(frame_in_segments(200, segments))
        self.assertFalse(frame_in_segments(201, segments))

    def test_missing_wrist_fails_complete_upper_body_without_inventing_pck(self):
        visible = [landmark() for _ in range(26)]
        missing_wrist = [dict(item) for item in visible]
        missing_wrist[9]["visibility"] = 0.0
        sidecar = {
            "captureId": "a",
            "frames": [
                {"timestampMs": 100, "landmarks": visible},
                {"timestampMs": 200, "landmarks": missing_wrist},
            ],
            "summary": {"subjectTrackSwitchCount": 0, "inferenceMs": {"p95": 10}},
        }
        result = summarize_skeleton_capture([sidecar], {"a": [{"startMs": 100, "endMs": 200}]})
        self.assertEqual(result["completeUpperBodyFrameRate"], 0.5)
        self.assertEqual(result["jointCaptureRateAtModelScorePoint3"]["wrist"], 0.75)
        self.assertEqual(result["positionAccuracy"]["status"], "blocked")


if __name__ == "__main__":
    unittest.main()
