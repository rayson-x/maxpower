import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("attach_bar_axis_contract_observations.py")
SPEC = importlib.util.spec_from_file_location("attach_bar_axis_contract_observations", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class AttachBarAxisContractObservationsTest(unittest.TestCase):
    def test_attaches_geometry_without_claiming_detector_accuracy(self):
        fixture = {
            "schemaVersion": "pose/v1",
            "source": {"captureId": "capture-1"},
            "frames": [
                {"sourceFrameNumber": 10, "timestampMs": 1_000, "candidates": []},
                {"sourceFrameNumber": 11, "timestampMs": 1_100, "candidates": []},
            ],
        }
        report = {
            "videos": [
                {
                    "videoId": "capture-1",
                    "signal": {
                        "fps": 10,
                        "height": 100,
                        "positionsPx": [40.0] * 11 + [60.0],
                    },
                }
            ]
        }

        output = MODULE.attach_observations(fixture, report, "report.json", "a" * 64)

        self.assertEqual(output["schemaVersion"], MODULE.SCHEMA_VERSION)
        self.assertFalse(output["equipmentObservationContract"]["acceptanceEligible"])
        self.assertIn("not_a_trained_detector", output["equipmentObservationContract"]["limitations"])
        first = output["frames"][0]["equipmentObservations"][0]
        second = output["frames"][1]["equipmentObservations"][0]
        self.assertEqual(first["source"], "geometry")
        self.assertEqual(first["kind"], "barbell_shaft")
        self.assertEqual(first["score"], 1.0)
        self.assertIsNone(first["uncertaintyPx"])
        self.assertAlmostEqual(first["bbox"][1] + first["bbox"][3] / 2, 0.4)
        self.assertAlmostEqual(second["bbox"][1] + second["bbox"][3] / 2, 0.6)

    def test_refuses_a_report_without_the_fixture_capture(self):
        fixture = {"source": {"captureId": "missing"}, "frames": []}
        with self.assertRaisesRegex(ValueError, "no video missing"):
            MODULE.attach_observations(fixture, {"videos": []}, "report.json", "b" * 64)

    def test_reattaching_preserves_the_original_pose_fixture_schema(self):
        fixture = {
            "schemaVersion": "pose/v1",
            "source": {"captureId": "capture-1"},
            "frames": [{"sourceFrameNumber": 10, "timestampMs": 0, "candidates": []}],
        }
        report = {
            "videos": [
                {
                    "videoId": "capture-1",
                    "signal": {"fps": 10, "height": 100, "positionsPx": [50.0]},
                }
            ]
        }

        first = MODULE.attach_observations(fixture, report, "report.json", "c" * 64)
        second = MODULE.attach_observations(first, report, "report.json", "c" * 64)

        self.assertEqual(
            second["equipmentObservationContract"]["poseFixtureSchemaVersion"],
            "pose/v1",
        )


if __name__ == "__main__":
    unittest.main()
