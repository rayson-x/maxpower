from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

import numpy as np


MODULE_PATH = Path(__file__).with_name("trainCycleStateProfiles.py")
SPEC = importlib.util.spec_from_file_location("train_cycle_state_profiles", MODULE_PATH)
assert SPEC and SPEC.loader
cycle = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = cycle
SPEC.loader.exec_module(cycle)


class CycleStateProfileTest(unittest.TestCase):
    def test_manual_range_match_reports_start_peak_and_end_offsets(self) -> None:
        matched, aligned, matches = cycle.match_manual_ranges(
            [
                {
                    "startMs": 1_000,
                    "peakMs": 1_500,
                    "endMs": 2_000,
                    "peakSource": "human_adjusted",
                }
            ],
            [{"startMs": 1_100, "peakMs": 1_700, "endMs": 1_900}],
        )

        self.assertEqual((matched, aligned), (1, 1))
        self.assertEqual(matches[0]["startOffsetMs"], 100)
        self.assertEqual(matches[0]["peakOffsetMs"], 200)
        self.assertEqual(matches[0]["truthPeakSource"], "human_adjusted")
        self.assertEqual(matches[0]["endOffsetMs"], -100)

    def test_legacy_unattributed_peak_is_not_scored_as_phase_truth(self) -> None:
        _, _, matches = cycle.match_manual_ranges(
            [{"startMs": 1_000, "peakMs": 1_500, "endMs": 2_000}],
            [{"startMs": 1_100, "peakMs": 1_700, "endMs": 1_900}],
        )

        self.assertIsNone(matches[0]["peakOffsetMs"])
        self.assertEqual(matches[0]["truthPeakSource"], "legacy_unattributed")

    def test_detects_complete_closed_cycles_without_expected_count(self) -> None:
        timestamps = np.arange(0, 5_000, 100, dtype=np.float32)
        signal = np.zeros(len(timestamps), dtype=np.float32)
        signal[0:11] = np.linspace(0, 1, 11)
        signal[10:21] = np.linspace(1, 0, 11)
        signal[20:31] = np.linspace(0, 1, 11)
        signal[30:41] = np.linspace(1, 0, 11)

        detected = cycle.detect_cycles(
            timestamps,
            signal,
            minimum_duration_ms=1_500,
            maximum_duration_ms=2_500,
            search_half_window_ms=1_200,
            minimum_prominence=0.5,
        )

        self.assertEqual(len(detected), 2)
        self.assertEqual(
            [(item.start_index, item.peak_index, item.end_index) for item in detected],
            [(0, 10, 20), (20, 30, 40)],
        )

    def test_static_signal_never_fabricates_a_cycle(self) -> None:
        timestamps = np.arange(0, 3_000, 100, dtype=np.float32)
        detected = cycle.detect_cycles(
            timestamps,
            np.zeros(len(timestamps), dtype=np.float32),
            minimum_duration_ms=500,
            maximum_duration_ms=2_000,
            search_half_window_ms=1_000,
            minimum_prominence=0.1,
        )
        self.assertEqual(detected, [])

    def test_candidate_evidence_distinguishes_a_closed_cycle_from_an_open_motion(self) -> None:
        timestamps = np.arange(0, 500, 100, dtype=np.float32)
        closed_channels = np.asarray(
            [
                [0.0, 0.0, 0.0],
                [0.5, 0.4, 0.6],
                [1.0, 0.9, 1.1],
                [0.5, 0.4, 0.6],
                [0.0, 0.0, 0.0],
            ],
            dtype=np.float64,
        )
        open_channels = closed_channels.copy()
        open_channels[-1] = [0.8, 0.7, 0.9]
        candidate = cycle.CycleCandidate(0, 2, 4, 0.9)

        closed = cycle.compute_candidate_evidence(
            timestamps,
            closed_channels.mean(axis=1),
            closed_channels,
            [candidate],
            0,
            median_duration_ms=400.0,
        )
        open_motion = cycle.compute_candidate_evidence(
            timestamps,
            open_channels.mean(axis=1),
            open_channels,
            [candidate],
            0,
            median_duration_ms=400.0,
        )

        self.assertEqual(closed.channel_direction_agreement, 1.0)
        self.assertAlmostEqual(closed.endpoint_closure_ratio, 0.0)
        self.assertGreater(open_motion.endpoint_closure_ratio, 0.5)

    def test_candidate_classifier_rejects_high_prominence_open_motion(self) -> None:
        positives = [
            cycle.CandidateEvidence(0.55, 0.45, 0.35, 1.0, 0.03, 0.05, 0.0, 0.02, 0.05, 0.05, 0.1, 0.3, 0.05),
            cycle.CandidateEvidence(0.65, 0.50, 0.40, 1.0, 0.05, 0.08, 0.0, 0.03, 0.02, 0.08, 0.2, 0.4, 0.08),
            cycle.CandidateEvidence(0.60, 0.48, 0.38, 1.0, 0.04, 0.06, 0.0, 0.02, 0.03, 0.06, 0.1, 0.2, 0.06),
        ]
        negatives = [
            cycle.CandidateEvidence(1.20, 0.20, -0.10, 0.6, 0.60, 0.75, 0.2, 0.70, 0.4, 0.5, 2.5, 4.0, 0.8),
            cycle.CandidateEvidence(1.00, 0.15, -0.20, 0.6, 0.50, 0.70, 0.1, 0.60, 0.5, 0.4, 2.0, 3.0, 0.7),
            cycle.CandidateEvidence(0.90, 0.10, -0.15, 0.4, 0.70, 0.85, 0.2, 0.80, 0.6, 0.6, 3.0, 5.0, 0.9),
        ]

        classifier = cycle.fit_candidate_classifier(
            [(item, True) for item in positives]
            + [(item, False) for item in negatives]
        )

        self.assertIsNotNone(classifier)
        assert classifier is not None
        self.assertTrue(cycle.classify_candidate(classifier, positives[0]))
        self.assertFalse(cycle.classify_candidate(classifier, negatives[0]))


if __name__ == "__main__":
    unittest.main()
