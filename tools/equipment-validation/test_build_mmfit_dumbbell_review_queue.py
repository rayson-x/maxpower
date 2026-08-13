from __future__ import annotations

import gzip
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "tools/equipment-validation/build_mmfit_dumbbell_review_queue.py"
SPEC = importlib.util.spec_from_file_location("build_mmfit_dumbbell_review_queue", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class MmfitDumbbellQueueTest(unittest.TestCase):
    def test_queue_uses_only_official_train_and_holds_out_whole_subjects(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            normalized = root / "normalized"
            rgb = root / "rgb"
            normalized.mkdir()
            rgb.mkdir()
            clips = []
            md5_rows = []
            for subject_index, subject in enumerate(MODULE.EQUIPMENT_SPLIT_BY_SUBJECT):
                session = f"w{subject}"
                video_name = f"{session}_rgb.mp4"
                (rgb / video_name).write_bytes(b"video")
                md5_rows.append(f"{'a' * 32}  {video_name}")
                action = "dumbbell_shoulder_press" if subject_index % 2 == 0 else "squats"
                sequence_number = subject_index + 1
                source_sequence_id = f"{session}:{sequence_number}"
                clip_file = f"clips/{session}-{sequence_number:03d}-{action}.json.gz"
                clip_path = normalized / clip_file
                clip_path.parent.mkdir(parents=True, exist_ok=True)
                frames = [self.frame(frame_number) for frame_number in range(70, 231)]
                with gzip.open(clip_path, "wt", encoding="utf-8") as output:
                    json.dump(
                        {
                            "split": "train",
                            "sourceSequenceId": source_sequence_id,
                            "source": {"framesPerSecond": 30.0},
                            "label": {
                                "startFrame": 100,
                                "endFrame": 200,
                                "totalRepetitions": 10,
                                "annotationGranularity": "set_count",
                                "repBounds": [],
                            },
                            "frames": frames,
                        },
                        output,
                    )
                clips.append(
                    {
                        "clipFile": clip_file,
                        "sourceSequenceId": source_sequence_id,
                        "subjectId": subject,
                        "split": "train",
                        "sourceAction": action,
                        "exerciseId": "dumbbell_shoulder_press" if action.startswith("dumbbell") else "bodyweight_squat",
                        "expectedCount": 10,
                        "frameCount": len(frames),
                    }
                )
            clips.append(
                {
                    "clipFile": "not-present.json.gz",
                    "sourceSequenceId": "w05:1",
                    "subjectId": "05",
                    "split": "validation",
                    "sourceAction": "dumbbell_shoulder_press",
                    "exerciseId": "dumbbell_shoulder_press",
                    "expectedCount": 10,
                    "frameCount": 1,
                }
            )
            (rgb / "MD5SUMS.official").write_text("\n".join(md5_rows) + "\n", encoding="utf-8")
            queue = MODULE.plan_queue(
                {"schemaVersion": "maxpower-external-fitness-manifest/v1", "clips": clips},
                normalized,
                rgb,
            )

            self.assertEqual(queue["officialSourceSplit"], "train")
            self.assertEqual(queue["excludedOfficialSplits"], ["validation", "test", "unseen_test"])
            self.assertEqual(queue["stats"]["subjectCount"], 10)
            self.assertEqual(queue["stats"]["sourceSequenceCount"], 10)
            self.assertEqual(queue["stats"]["itemCount"], 35)
            self.assertEqual(queue["stats"]["dumbbellActionItems"], 30)
            self.assertEqual(queue["stats"]["backgroundActionItems"], 5)
            split_by_subject = {
                item["subjectId"]: item["split"] for item in queue["items"]
            }
            self.assertEqual(split_by_subject, MODULE.EQUIPMENT_SPLIT_BY_SUBJECT)
            self.assertTrue(all(item["officialSplit"] == "train" for item in queue["items"]))
            self.assertTrue(all(item["repBounds"] == [] for item in queue["items"]))
            self.assertTrue(all(item["proposal"]["humanTruth"] is False for item in queue["items"]))
            self.assertNotIn("05", split_by_subject)

    def test_wrist_roi_is_only_an_unreviewed_annotation_aid(self) -> None:
        frame = self.frame(100)
        proposals = MODULE.wrist_proposals(frame)
        self.assertEqual([proposal["hand"] for proposal in proposals], ["left", "right"])
        self.assertTrue(all(proposal["kind"] == "dumbbell" for proposal in proposals))
        self.assertTrue(all(proposal["humanTruth"] is False for proposal in proposals))
        self.assertTrue(all(proposal["source"].endswith("wrist_roi/v1") for proposal in proposals))

    @staticmethod
    def frame(frame_number: int) -> dict[str, object]:
        landmarks = [{"x": 0.0, "y": 0.0, "visibility": 0.0} for _ in range(33)]
        landmarks[15] = {"x": 0.35, "y": 0.45, "visibility": 1.0}
        landmarks[16] = {"x": 0.65, "y": 0.45, "visibility": 1.0}
        return {"frameNumber": frame_number, "landmarks": landmarks}


if __name__ == "__main__":
    unittest.main()
