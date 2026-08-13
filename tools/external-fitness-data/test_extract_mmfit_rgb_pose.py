import unittest
import io
import gzip
import hashlib
import json
import tempfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_mmfit_rgb_pose import (
    LANDMARKER_OPTIONS,
    build_clip_payload,
    build_manifest_entry,
    create_session_landmarker,
    parse_frame_rate,
    read_exact,
    write_deterministic_gzip_json,
)
from merge_mmfit_rgb_pose_shards import merge_shards


class MmFitRgbPoseContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.item = {
            "clipFile": "clips/w16-001-squats.json.gz",
            "sourceSequenceId": "w16:1",
            "subjectId": "16",
            "split": "train",
            "sourceAction": "squats",
            "exerciseId": "bodyweight_squat",
            "expectedCount": 10,
            "frameCount": 481,
        }
        self.clip = {
            "label": {
                "startFrame": 100,
                "endFrame": 580,
                "totalRepetitions": 10,
                "annotationGranularity": "set_count",
                "repBounds": [],
            }
        }
        self.video = {
            "sessionId": "w16",
            "sourceVideoSha256": "video-sha",
            "widthPx": 1280,
            "heightPx": 720,
            "fps": 30.0,
            "frameCount": 81_640,
        }

    def test_manifest_entry_preserves_the_trainer_contract(self) -> None:
        entry = build_manifest_entry(self.item, Path("w16-1.json.gz"), 481, "model-sha", "clip-sha")
        self.assertEqual(entry["sourceAction"], "squats")
        self.assertEqual(entry["expectedCount"], 10)
        self.assertEqual(entry["split"], "train")
        self.assertEqual(entry["clipFile"], "w16-1.json.gz")
        self.assertEqual(entry["poseDomain"], "mmfit_mediapipe33_heavy_cpu")
        self.assertEqual(entry["clipSha256"], "clip-sha")

    def test_payload_records_reproducible_observation_provenance_without_rep_truth(self) -> None:
        payload = build_clip_payload(
            item=self.item,
            source_clip=self.clip,
            frames=[{"frameNumber": 100, "timestampMs": 3333, "landmarks": [], "worldLandmarks": []}],
            model_hash="model-sha",
            mediapipe_version="0.10.21",
            video_provenance=self.video,
        )
        self.assertEqual(payload["label"]["annotationGranularity"], "set_count")
        self.assertEqual(payload["repBounds"], [])
        self.assertEqual(payload["observation"]["landmarkerOptions"], LANDMARKER_OPTIONS)
        self.assertEqual(payload["observation"]["delegate"], "CPU")
        self.assertEqual(payload["observation"]["sourceVideo"], self.video)
        self.assertEqual(payload["observation"]["modelAssetSha256"], "model-sha")
        self.assertEqual(payload["observation"]["mediapipeRuntimeVersion"], "0.10.21")

    def test_each_video_session_gets_an_isolated_tracker_lifecycle(self) -> None:
        class FakeContext:
            def __init__(self, instance):
                self.instance = instance

            def __enter__(self):
                self.instance["entered"] = True
                return self.instance

            def __exit__(self, *_args):
                self.instance["exited"] = True

        class FakePoseLandmarker:
            instances = []

            @classmethod
            def create_from_options(cls, options):
                instance = {"options": options, "entered": False, "exited": False}
                cls.instances.append(instance)
                return FakeContext(instance)

        with create_session_landmarker(FakePoseLandmarker, "options") as first:
            self.assertTrue(first["entered"])
        with create_session_landmarker(FakePoseLandmarker, "options") as second:
            self.assertTrue(second["entered"])

        self.assertIsNot(first, second)
        self.assertEqual(len(FakePoseLandmarker.instances), 2)
        self.assertTrue(first["exited"])
        self.assertTrue(second["exited"])

    def test_ffmpeg_helpers_preserve_fractional_fps_and_reject_truncated_frames(self) -> None:
        self.assertAlmostEqual(parse_frame_rate("30000/1001"), 29.97002997)
        self.assertEqual(read_exact(io.BytesIO(b"abcdef"), 6), b"abcdef")
        self.assertEqual(read_exact(io.BytesIO(b""), 6), b"")
        with self.assertRaisesRegex(EOFError, "truncated raw RGB frame"):
            read_exact(io.BytesIO(b"abc"), 6)

    def test_clip_serialization_is_atomic_and_deterministic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "clip.json.gz"
            payload = {"frames": [{"timestampMs": 0, "landmarks": []}]}
            write_deterministic_gzip_json(destination, payload)
            first = destination.read_bytes()
            write_deterministic_gzip_json(destination, payload)
            second = destination.read_bytes()
            self.assertEqual(hashlib.sha256(first).hexdigest(), hashlib.sha256(second).hexdigest())
            self.assertEqual(json.loads(gzip.decompress(second)), payload)
            self.assertFalse(destination.with_name(f"{destination.name}.tmp").exists())

    def test_subject_shards_merge_only_into_a_complete_train_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            normalized_root = root / "normalized"
            output_root = root / "native"
            shards_root = output_root / "shards"
            normalized_root.mkdir()
            model_hash = "a" * 64
            train_items = []
            for session in ("w16", "w17"):
                item = {
                    **self.item,
                    "clipFile": f"clips/{session}-001-squats.json.gz",
                    "sourceSequenceId": f"{session}:1",
                    "subjectId": session[1:],
                    "frameCount": 1,
                }
                train_items.append(item)
                shard = shards_root / session
                shard.mkdir(parents=True)
                destination = shard / f"{session}-1.json.gz"
                write_deterministic_gzip_json(destination, {"sourceSequenceId": item["sourceSequenceId"], "frames": [{}]})
                entry = build_manifest_entry(
                    item,
                    destination,
                    1,
                    model_hash,
                    hashlib.sha256(destination.read_bytes()).hexdigest(),
                )
                (shard / "manifest.json").write_text(json.dumps({
                    "schemaVersion": "maxpower-mmfit-native-pose-manifest/v2",
                    "complete": True,
                    "poseDomain": "mmfit_mediapipe33_heavy_cpu",
                    "modelAssetSha256": model_hash,
                    "mediapipeRuntimeVersion": "0.10.21",
                    "delegate": "CPU",
                    "landmarkerOptions": LANDMARKER_OPTIONS,
                    "extractorVersion": "mmfit-native-mediapipe33/v2",
                    "requestedSplits": ["train"],
                    "requestedSessions": [session],
                    "requestedSequences": None,
                    "sourceVideos": [{
                        "sessionId": session,
                        "sourceVideoSha256": hashlib.sha256(session.encode()).hexdigest(),
                        "widthPx": 1280,
                        "heightPx": 720,
                        "fps": 30.0,
                        "frameCount": 100,
                        "mirrored": False,
                    }],
                    "clips": [entry],
                }))
            validation_item = {
                **train_items[0],
                "sourceSequenceId": "w14:1",
                "subjectId": "14",
                "split": "validation",
            }
            (normalized_root / "manifest.json").write_text(json.dumps({"clips": [*train_items, validation_item]}))

            merged = merge_shards(shards_root, normalized_root / "manifest.json", output_root)
            self.assertTrue(merged["complete"])
            self.assertIsNone(merged["requestedSessions"])
            self.assertEqual(len(merged["clips"]), 2)
            self.assertEqual(
                [entry["clipFile"] for entry in merged["clips"]],
                ["shards/w16/w16-1.json.gz", "shards/w17/w17-1.json.gz"],
            )

            broken = json.loads((shards_root / "w17/manifest.json").read_text())
            broken["requestedSequences"] = ["w17:1"]
            (shards_root / "w17/manifest.json").write_text(json.dumps(broken))
            with self.assertRaisesRegex(ValueError, "requestedSequences"):
                merge_shards(shards_root, normalized_root / "manifest.json", output_root)


if __name__ == "__main__":
    unittest.main()
