from __future__ import annotations

import gzip
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("audit_mmfit_rtmpose_halpe26.py")
SPEC = importlib.util.spec_from_file_location("audit_mmfit_rtmpose_halpe26", MODULE_PATH)
assert SPEC and SPEC.loader
audit = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = audit
SPEC.loader.exec_module(audit)


class MmfitRtmposeAuditTest(unittest.TestCase):
    def test_corpus_hash_is_built_from_a_valid_clip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            clip_path = root / "w01-4.json.gz"
            clip = {
                "sourceSequenceId": "w01:4",
                "split": "train",
                "poseSchema": "halpe26",
                "label": {"annotationGranularity": "set_count", "repBounds": []},
                "repBounds": [],
                "techniqueQuality": "unknown",
                "compensation": "unknown",
                "frames": [{
                    "landmarks": [{"x": 0.1, "y": 0.2, "visibility": 0.9} for _ in range(26)],
                    "subjectSelection": {"detectorObserved": True},
                    "selectedBbox": {"x": 0.2, "y": 0.3, "width": 0.4, "height": 0.4},
                    "observationQuality": {"cocoPrefixObservedCount": 17},
                }],
            }
            with gzip.open(clip_path, "wt", encoding="utf-8") as destination:
                json.dump(clip, destination)
            clip_hash = audit.sha256_file(clip_path)
            manifest = {
                "complete": True,
                "requestedSplits": ["train"],
                "clips": [{
                    "sourceSequenceId": "w01:4",
                    "subjectId": "01",
                    "exerciseId": "push_up",
                    "split": "train",
                    "clipFile": clip_path.name,
                    "clipSha256": clip_hash,
                }],
            }
            (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

            report = audit.audit_corpus(root, expected_clip_count=1)

            expected = hashlib.sha256(f"w01:4\0{clip_hash}\n".encode()).hexdigest()
            self.assertEqual(report["corpusSha256"], expected)
            self.assertEqual(report["summary"]["clipCount"], 1)

    def test_stable_held_box_pose_is_flagged_for_review_but_not_fabricated(self) -> None:
        item = {"sourceSequenceId": "w01:4", "subjectId": "01", "exerciseId": "push_up"}
        landmarks = [{"x": 0.1, "y": 0.2, "visibility": 0.9} for _ in range(26)]
        frames = []
        for index in range(10):
            frames.append({
                "landmarks": landmarks,
                "subjectSelection": {"detectorObserved": index < 4},
                "selectedBbox": {"x": 0.2 + index * 0.001, "y": 0.3, "width": 0.4, "height": 0.4},
                "observationQuality": {"cocoPrefixObservedCount": 17},
            })
        clip = {
            "sourceSequenceId": "w01:4",
            "split": "train",
            "poseSchema": "halpe26",
            "label": {"annotationGranularity": "set_count", "repBounds": []},
            "repBounds": [],
            "techniqueQuality": "unknown",
            "compensation": "unknown",
            "frames": frames,
        }
        row = audit.audit_clip(item, clip)
        self.assertEqual(row["detectorObservedRate"], 0.4)
        self.assertEqual(row["emptyFrameRate"], 0.0)
        self.assertIn("detector_hold_dominates", row["flags"])

    def test_technique_truth_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported supervision"):
            audit.audit_clip(
                {"sourceSequenceId": "w01:4", "subjectId": "01", "exerciseId": "push_up"},
                {
                    "sourceSequenceId": "w01:4",
                    "split": "train",
                    "poseSchema": "halpe26",
                    "label": {"annotationGranularity": "set_count", "repBounds": []},
                    "repBounds": [],
                    "techniqueQuality": "standard",
                    "compensation": "unknown",
                    "frames": [{}],
                },
            )


if __name__ == "__main__":
    unittest.main()
