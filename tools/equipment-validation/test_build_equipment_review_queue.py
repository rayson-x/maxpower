import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("build_equipment_review_queue.py")
SPEC = importlib.util.spec_from_file_location("build_equipment_review_queue", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class BuildEquipmentReviewQueueTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / "images").mkdir()
        (self.root / "previews").mkdir()
        self.samples = []
        self.records = []
        for index, (capture_id, tuning, challenge) in enumerate(
            (("tuning-a", True, False), ("tuning-b", True, False), ("challenge", False, True))
        ):
            image = Path("images") / f"{capture_id}.jpg"
            preview = Path("previews") / f"{capture_id}.jpg"
            (self.root / image).write_bytes(f"image-{capture_id}".encode())
            (self.root / preview).write_bytes(f"preview-{capture_id}".encode())
            video = self.root / f"{capture_id}.mp4"
            video.write_bytes(f"video-{capture_id}".encode())
            self.samples.append(
                {
                    "videoId": capture_id,
                    "frameIndex": index,
                    "timestampMs": index * 100,
                    "sampleKind": "rep-phase",
                    "repIndex": 1,
                    "phase": "extreme",
                    "image": str(image),
                    "preview": str(preview),
                    "pseudoLabel": {
                        "axisYNormalized": 0.5,
                        "confidenceRatio": 1.2,
                        "source": "geometry/v1",
                        "reviewPriority": "normal",
                        "reviewReason": None,
                    },
                }
            )
            self.records.append(
                {
                    "captureId": capture_id,
                    "capturePosition": "front",
                    "analysisView": "front",
                    "source": {"video": str(video)},
                    "eligibility": {"tuning": tuning, "challenge": challenge},
                }
            )

    def tearDown(self):
        self.temporary.cleanup()

    def build(self):
        return MODULE.build_queue(
            {"schemaVersion": "bar-axis-pseudo-label-dataset/v1", "samples": self.samples},
            {"records": self.records},
            self.root,
            "a" * 64,
        )

    def test_preserves_capture_groups_and_never_promotes_pseudo_labels(self):
        queue = self.build()
        splits_by_source = {
            item["sourceCaptureId"]: item["split"] for item in queue["items"]
        }
        self.assertEqual(splits_by_source["challenge"], "test")
        self.assertEqual(
            {splits_by_source["tuning-a"], splits_by_source["tuning-b"]},
            {"train", "validation"},
        )
        self.assertFalse(queue["promotionAllowed"])
        self.assertEqual(queue["stats"]["humanReviewedItems"], 0)
        self.assertTrue(all(not item["proposal"]["humanTruth"] for item in queue["items"]))
        self.assertTrue(all(len(item["imageSha256"]) == 64 for item in queue["items"]))

    def test_queue_serialization_is_deterministic(self):
        first = MODULE.canonical_json_bytes(self.build())
        second = MODULE.canonical_json_bytes(self.build())
        self.assertEqual(first, second)

    def test_refuses_a_sample_whose_source_group_is_missing(self):
        self.records.pop()
        with self.assertRaisesRegex(ValueError, "missing equipment sources"):
            self.build()


if __name__ == "__main__":
    unittest.main()
