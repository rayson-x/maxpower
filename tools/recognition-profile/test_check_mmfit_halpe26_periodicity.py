from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("checkMmfitHalpe26Periodicity.py")
SPEC = importlib.util.spec_from_file_location("checkMmfitHalpe26Periodicity", MODULE_PATH)
assert SPEC and SPEC.loader
gate = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = gate
SPEC.loader.exec_module(gate)


def report(exact: float = 1.0) -> dict:
    return {
        "usesExpectedCountAtInference": False,
        "evaluationProtocol": "leave-one-official-train-subject-out; config selected on other train subjects only",
        "summary": {
            "exactSetRatio": exact,
            "offByOneRatio": 1.0,
            "meanAbsoluteCountError": 0.0,
        },
        "byExercise": {
            "push_up": {"clipCount": 1, "exactSetRatio": exact, "offByOneRatio": 1.0}
        },
        "actionClassification": {
            "usesExerciseLabelAtInference": False,
            "summary": {
                "macroF1": exact,
                "accuracy": exact,
                "byExercise": {"push_up": {"recall": exact, "precision": exact, "f1": exact}},
            },
        },
        "rows": [{
            "sourceSequenceId": "w01:4",
            "subjectId": "01",
            "trainingSubjectIds": ["02", "03"],
        }],
    }


class MmfitHalpe26PeriodicityGateTest(unittest.TestCase):
    def test_gate_accepts_source_isolated_95_percent_evidence(self) -> None:
        metrics, failures = gate.evaluate(report(0.96), minimum=0.95, expected_clips=1)
        self.assertEqual(metrics["exactSetRatio"], 0.96)
        self.assertEqual(failures, [])

    def test_gate_rejects_holdout_subject_leakage(self) -> None:
        value = report()
        value["rows"][0]["trainingSubjectIds"] = ["01", "02"]
        with self.assertRaisesRegex(ValueError, "leaked"):
            gate.evaluate(value, minimum=0.95, expected_clips=1)

    def test_gate_fails_when_any_action_is_below_target(self) -> None:
        _metrics, failures = gate.evaluate(report(0.94), minimum=0.95, expected_clips=1)
        self.assertTrue(any("push_up" in failure for failure in failures))


if __name__ == "__main__":
    unittest.main()
