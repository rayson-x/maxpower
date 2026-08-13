from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

import numpy as np


MODULE_PATH = Path(__file__).with_name("trainTemporalTemplates.py")
SPEC = importlib.util.spec_from_file_location("train_temporal_templates", MODULE_PATH)
assert SPEC and SPEC.loader
temporal = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = temporal
SPEC.loader.exec_module(temporal)


class TemporalTemplateTrainingTest(unittest.TestCase):
    def test_halpe_feature_contract_uses_the_unchanged_coco17_prefix(self) -> None:
        landmarks = [
            {"x": float(index), "y": float(index) / 2, "z": 0, "visibility": 1}
            for index in range(26)
        ]

        values = temporal.frame_features(
            {"landmarks": landmarks}, temporal.HALPE26_LANDMARKS
        )

        # Each selected point contributes x/y/z/visibility/presence/normalized x/y.
        self.assertEqual(values[7], 5.0)
        self.assertEqual(values[14], 6.0)
        self.assertEqual(values[49], 11.0)
        self.assertEqual(values[56], 12.0)

    def sequence(self) -> object:
        timestamps = np.arange(0, 2_000, 100, dtype=np.float32)
        phase = np.asarray([
            0.0, 0.0, 0.1, 0.5, 1.0, 0.5, 0.1, 0.0, 0.0, 0.0,
            0.0, 0.1, 0.5, 1.0, 0.5, 0.1, 0.0, 0.0, 0.0, 0.0,
        ], dtype=np.float32)
        features = np.stack((phase, np.roll(phase, 1)), axis=1)
        return temporal.Sequence(
            record={
                "captureId": "capture-a",
                "sourceCaptureId": "capture-a",
                "exerciseId": "barbell_bench_press",
                "capturePosition": "front",
                "expectedCount": 2,
                "segments": [
                    {"startMs": 200, "peakMs": 400, "endMs": 700},
                    {"startMs": 1_100, "peakMs": 1_300, "endMs": 1_600},
                ],
            },
            timestamps=timestamps,
            features=features,
        )

    def test_same_record_replay_preserves_full_human_phase_boundaries(self) -> None:
        sequence = self.sequence()
        templates = temporal.build_templates([sequence])
        temporal.standardize([sequence], templates)

        replay = temporal.evaluate([sequence], templates, leave_one_source_out=False)

        self.assertEqual(replay["summary"]["predictedCount"], 2)
        self.assertEqual(replay["summary"]["alignedCount"], 2)
        self.assertEqual(replay["summary"]["exactSetAndAvailableBoundarySourceCaptureCount"], 1)
        self.assertTrue(replay["rows"][0]["exact"])
        self.assertEqual(replay["rows"][0]["alignmentErrorMs"], 0)

    def test_leave_one_source_out_cannot_reuse_the_current_video_template(self) -> None:
        sequence = self.sequence()
        templates = temporal.build_templates([sequence])
        temporal.standardize([sequence], templates)

        replay = temporal.evaluate([sequence], templates, leave_one_source_out=True)

        self.assertEqual(replay["summary"]["predictedCount"], 0)
        self.assertEqual(replay["summary"]["exactSetSourceCaptureCount"], 0)

    def test_timeline_alignment_rejects_a_count_exact_but_truncated_cycle(self) -> None:
        truth = [{"startMs": 1_000, "peakMs": 2_000, "endMs": 3_000}]
        predicted = [{"startMs": 1_700, "peakMs": 2_000, "endMs": 2_300}]

        matched, aligned, details = temporal.match_segments(truth, predicted)

        self.assertEqual(matched, 1)
        self.assertEqual(aligned, 0)
        self.assertFalse(details[0]["aligned"])
        self.assertEqual(details[0]["startOffsetMs"], 700)
        self.assertEqual(details[0]["endOffsetMs"], -700)


if __name__ == "__main__":
    unittest.main()
