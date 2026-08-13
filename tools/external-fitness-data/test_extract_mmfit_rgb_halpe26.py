from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("extract_mmfit_rgb_halpe26.py")
SPEC = importlib.util.spec_from_file_location("extract_mmfit_rgb_halpe26", MODULE_PATH)
assert SPEC and SPEC.loader
extractor = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = extractor
SPEC.loader.exec_module(extractor)


class MmFitRgbHalpe26ContractTest(unittest.TestCase):
    def test_sampling_preserves_clip_edges_without_upsampling(self) -> None:
        frames = list(range(100, 131))
        self.assertEqual(
            extractor.sample_frame_numbers(frames, source_fps=30.0, sample_fps=10.0),
            [100, 103, 106, 109, 112, 115, 118, 121, 124, 127, 130],
        )
        self.assertEqual(
            extractor.sample_frame_numbers([100, 101], source_fps=30.0, sample_fps=60.0),
            [100, 101],
        )

    def test_payload_preserves_set_count_and_raw_halpe26_only(self) -> None:
        item = {
            "sourceSequenceId": "w01:4",
            "subjectId": "01",
            "split": "train",
            "sourceAction": "pushups",
            "exerciseId": "push_up",
            "expectedCount": 10,
        }
        source_clip = {
            "label": {
                "startFrame": 100,
                "endFrame": 130,
                "totalRepetitions": 10,
                "annotationGranularity": "set_count",
                "repBounds": [],
            }
        }
        landmarks = [
            {"x": 0.1, "y": 0.2, "z": None, "visibility": 0.9}
            for _ in range(26)
        ]
        payload = extractor.build_clip_payload(
            item=item,
            source_clip=source_clip,
            frames=[{"frameNumber": 100, "timestampMs": 3333.333, "landmarks": landmarks}],
            detector_hash="d" * 64,
            pose_hash="p" * 64,
            sample_fps=10.0,
            video_provenance={"sessionId": "w01", "mirrored": False},
        )

        self.assertEqual(payload["poseSchema"], "halpe26")
        self.assertEqual(len(payload["frames"][0]["landmarks"]), 26)
        self.assertEqual(payload["label"]["annotationGranularity"], "set_count")
        self.assertEqual(payload["label"]["repBounds"], [])
        self.assertEqual(payload["repBounds"], [])
        self.assertEqual(payload["missingPointPolicy"], "unknown; never synthesize")
        self.assertEqual(payload["observation"]["pipeline"], "yolox-nano-humanart+rtmpose-m-halpe26")

    def test_non_train_clip_is_rejected_before_extraction(self) -> None:
        with self.assertRaisesRegex(ValueError, "train split"):
            extractor.validate_train_item(
                {"sourceSequenceId": "w14:4", "split": "validation"}
            )


if __name__ == "__main__":
    unittest.main()
