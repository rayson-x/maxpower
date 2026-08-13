import unittest

from evaluate_personal_halpe26_alignment import audit_record, frame_readiness


def landmarks(score: float = 0.9):
    return [
        {"x": index / 26, "y": index / 52, "z": None, "visibility": score}
        for index in range(26)
    ]


class PersonalHalpeAlignmentTest(unittest.TestCase):
    def test_requires_real_halpe_points(self):
        self.assertFalse(frame_readiness({"landmarks": []})["movementTask"])
        self.assertTrue(frame_readiness({"landmarks": landmarks()})["bilateral"])

    def test_audits_human_boundaries_without_calling_them_predictions(self):
        frames = [
            {"timestampMs": timestamp, "landmarks": landmarks()}
            for timestamp in range(0, 1100, 100)
        ]
        record = {
            "captureId": "capture",
            "sourceCaptureId": "source",
            "exerciseId": "barbell_bench_press",
            "capturePosition": "front",
            "expectedCount": 1,
            "evaluationWindow": None,
            "segments": [
                {"repIndex": 1, "startMs": 100, "peakMs": 500, "endMs": 900}
            ],
        }
        row = audit_record(record, {"frames": frames})
        self.assertEqual(row["trackableRepCount"], 1)
        self.assertTrue(row["reps"][0]["trackableFromObservations"])
        self.assertNotIn("predicted", row["reps"][0])


if __name__ == "__main__":
    unittest.main()
