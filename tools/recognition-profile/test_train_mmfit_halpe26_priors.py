from __future__ import annotations

import unittest
import importlib.util
import sys
from pathlib import Path

import numpy as np

MODULE_PATH = Path(__file__).with_name("trainMmfitHalpe26Priors.py")
SPEC = importlib.util.spec_from_file_location("trainMmfitHalpe26Priors", MODULE_PATH)
assert SPEC and SPEC.loader
trainer = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = trainer
SPEC.loader.exec_module(trainer)


class MmfitHalpe26PriorTest(unittest.TestCase):
    def test_temporal_bins_distinguish_reversed_trajectory_order(self) -> None:
        forward = np.stack([
            np.linspace(0.0, 1.0, 40),
            np.linspace(1.0, -1.0, 40),
        ], axis=1)
        reversed_order = forward[::-1]

        np.testing.assert_allclose(
            trainer.trajectory_descriptor(forward),
            trainer.trajectory_descriptor(reversed_order),
        )
        with self.assertRaises(AssertionError):
            np.testing.assert_allclose(
                trainer.trajectory_descriptor(forward, temporal_bins=4),
                trainer.trajectory_descriptor(reversed_order, temporal_bins=4),
            )

    def test_harmonic_calibration_doubles_only_the_training_learned_low_count_band(self) -> None:
        calibration = trainer.fit_harmonic_count_calibration([
            {"expectedCount": 10, "rawPredictedCount": 5},
            {"expectedCount": 10, "rawPredictedCount": 5},
            {"expectedCount": 10, "rawPredictedCount": 10},
        ])

        self.assertEqual(calibration.double_below_or_equal, 5)
        self.assertEqual(trainer.apply_count_calibration(5, calibration), 10)
        self.assertEqual(trainer.apply_count_calibration(10, calibration), 10)

    def test_periodicity_inference_has_no_expected_count_input(self) -> None:
        timestamps = np.linspace(0.0, 10_000.0, 201)
        phase = timestamps / 10_000.0
        features = np.stack(
            [np.sin(2 * np.pi * 10 * phase), np.cos(2 * np.pi * 10 * phase)],
            axis=1,
        )
        predicted, confidence = trainer.infer_periodic_count(
            features,
            timestamps,
            trainer.PeriodicityConfig(3, 0.1),
        )
        self.assertEqual(predicted, 10)
        self.assertGreater(confidence, 0.45)

    def test_leave_one_subject_out_never_trains_on_holdout(self) -> None:
        timestamps = np.linspace(0.0, 6_000.0, 121)
        clips = []
        for subject in ("01", "02", "03"):
            phase = timestamps / timestamps[-1]
            features = np.stack(
                [np.sin(2 * np.pi * 6 * phase), np.cos(2 * np.pi * 6 * phase)],
                axis=1,
            )
            clips.append(trainer.ClipEvidence(
                source_sequence_id=f"w{subject}:1",
                subject_id=subject,
                exercise_id="bodyweight_squat",
                expected_count=6,
                timestamps=timestamps,
                features=features,
            ))
        rows = trainer.leave_one_subject_out(
            clips,
            [trainer.PeriodicityConfig(3, 0.0), trainer.PeriodicityConfig(5, 0.1)],
        )
        self.assertEqual(len(rows), 3)
        for row in rows:
            self.assertNotIn(row["subjectId"], row["trainingSubjectIds"])

    def test_official_set_bounds_remove_context_without_creating_rep_bounds(self) -> None:
        landmarks = [
            {
                "x": 0.2 + index * 0.01,
                "y": 0.3 + index * 0.01,
                "trainingObservationEligible": True,
            }
            for index in range(26)
        ]
        canonical = {
            "requestedSplits": ["train"],
            "clips": {
                "w01:4": {
                    "split": "train",
                    "subjectId": "01",
                    "exerciseId": "push_up",
                    "expectedCount": 10,
                    "setBounds": {"startFrame": 100, "endFrame": 106},
                    "poses": [
                        {
                            "frameNumber": frame,
                            "timestampMs": frame * 10,
                            "landmarks": landmarks,
                        }
                        for frame in (97, 100, 103, 106, 109)
                    ],
                }
            },
        }
        clips = trainer.load_clips(canonical)
        self.assertEqual(clips[0].timestamps.tolist(), [1000.0, 1030.0, 1060.0])
        self.assertEqual(clips[0].expected_count, 10)

    def test_action_classifier_is_subject_isolated_and_does_not_receive_label_at_inference(self) -> None:
        timestamps = np.linspace(0.0, 1_000.0, 40)
        clips = []
        for subject_index, subject in enumerate(("01", "02", "03")):
            for action_index, action in enumerate(("squat", "push_up", "row")):
                base = action_index * 5.0
                features = np.stack([
                    np.full(40, base + subject_index * 0.01),
                    np.sin(np.linspace(0, 2 * np.pi * (action_index + 1), 40)),
                ], axis=1)
                clips.append(trainer.ClipEvidence(
                    source_sequence_id=f"w{subject}:{action_index}",
                    subject_id=subject,
                    exercise_id=action,
                    expected_count=10,
                    timestamps=timestamps,
                    features=features,
                ))
        rows = trainer.leave_one_subject_out_action_classification(clips)
        metrics = trainer.action_classification_metrics(rows)
        self.assertEqual(metrics["accuracy"], 1.0)
        for row in rows:
            self.assertNotIn(row["subjectId"], row["trainingSubjectIds"])


if __name__ == "__main__":
    unittest.main()
