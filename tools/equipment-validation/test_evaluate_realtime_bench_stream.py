import json
import tempfile
import unittest
from pathlib import Path

import evaluate_realtime_bench_stream as realtime


def frame(index: int, position_px: float, confidence: float = 0.9) -> dict:
    return {
        "frameNumber": index,
        "timestampMs": index * 100,
        "axis": {
            "source": "measured",
            "confidence": confidence,
            "centerY": position_px / realtime.REFERENCE_HEIGHT,
            "x1": 0.2,
            "y1": position_px / realtime.REFERENCE_HEIGHT,
            "x2": 0.8,
            "y2": position_px / realtime.REFERENCE_HEIGHT,
            "slope": 0.0,
        },
        "landmarks": [],
    }


class RealtimeBenchStreamTest(unittest.TestCase):
    def test_turnaround_is_confirmed_causally_after_reversal(self) -> None:
        positions = [100] * 10 + [112, 134, 151, 158, 154, 144, 128, 114, 105, 100]
        result = realtime.replay_capture_stream(
            capture_id="capture-a",
            frames=[frame(index, value) for index, value in enumerate(positions)],
            sample_fps=10.0,
        )

        turnarounds = [
            event for event in result["events"] if event["type"] == "turnaround_confirmed"
        ]
        self.assertEqual(len(turnarounds), 1)
        self.assertEqual(turnarounds[0]["turnaroundMs"], 1300)
        self.assertGreater(turnarounds[0]["confirmedAtMs"], turnarounds[0]["turnaroundMs"])
        self.assertLessEqual(turnarounds[0]["confirmationDelayMs"], 300)
        self.assertEqual(turnarounds[0]["futureFrameReadCount"], 0)

    def test_prefix_events_do_not_change_when_future_frames_change(self) -> None:
        prefix = [100] * 10 + [112, 134, 151, 158, 154, 144]
        suffix_a = [128, 114, 105, 100]
        suffix_b = [147, 139, 125, 110, 100]
        cutoff_ms = (len(prefix) - 1) * 100

        left = realtime.replay_capture_stream(
            capture_id="capture-a",
            frames=[frame(index, value) for index, value in enumerate(prefix + suffix_a)],
            sample_fps=10.0,
        )
        right = realtime.replay_capture_stream(
            capture_id="capture-a",
            frames=[frame(index, value) for index, value in enumerate(prefix + suffix_b)],
            sample_fps=10.0,
        )

        left_prefix = [event for event in left["events"] if event["emittedAtMs"] <= cutoff_ms]
        right_prefix = [event for event in right["events"] if event["emittedAtMs"] <= cutoff_ms]
        self.assertEqual(left_prefix, right_prefix)

    def test_inference_pack_cannot_contain_review_truth(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pack_path = Path(directory) / "pack.json"
            pack_path.write_text(
                json.dumps(
                    {
                        "schemaVersion": realtime.PACK_SCHEMA,
                        "captures": [
                            {
                                "captureId": "capture-a",
                                "sampleFps": 10,
                                "frames": [frame(0, 100)],
                                "humanPeakTruth": True,
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "truth"):
                realtime.infer_pack(pack_path)


if __name__ == "__main__":
    unittest.main()
