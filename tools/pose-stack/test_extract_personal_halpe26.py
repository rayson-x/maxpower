import unittest

from extract_personal_halpe26 import bbox_iou, select_subject_bbox


class SubjectSelectionTest(unittest.TestCase):
    def test_initial_selection_prefers_dominant_centered_person(self):
        selected, reason, _ = select_subject_bbox(
            [(10, 10, 120, 220), (180, 20, 620, 700)], None, 720, 1280
        )
        self.assertEqual(selected, (180.0, 20.0, 620.0, 700.0))
        self.assertEqual(reason, "initial_dominant_centered")

    def test_continuity_keeps_subject_when_a_larger_mirror_appears(self):
        previous = (100, 100, 350, 700)
        selected, reason, _ = select_subject_bbox(
            [(105, 105, 355, 705), (380, 40, 710, 900)], previous, 720, 1280
        )
        self.assertEqual(selected, (105.0, 105.0, 355.0, 705.0))
        self.assertEqual(reason, "continuous_iou_center")

    def test_iou_is_zero_for_separate_mirror_boxes(self):
        self.assertEqual(bbox_iou((0, 0, 10, 10), (20, 20, 30, 30)), 0.0)

    def test_small_disjoint_bystander_is_rejected_instead_of_replacing_subject(self):
        previous = (250, 200, 650, 700)
        selected, reason, _ = select_subject_bbox(
            [(950, 350, 1040, 700)], previous, 1280, 720
        )
        self.assertIsNone(selected)
        self.assertEqual(reason, "identity_mismatch_rejected")

    def test_partial_overlap_cannot_bridge_identity_to_bystander(self):
        previous = (291, 428, 681, 720)
        selected, reason, _ = select_subject_bbox(
            [(639, 446, 877, 714)], previous, 1280, 720
        )
        self.assertIsNone(selected)
        self.assertEqual(reason, "identity_mismatch_rejected")

    def test_dominant_subject_replaces_tiny_tentative_initial_lock(self):
        previous = (550, 250, 700, 400)
        dominant = (100, 80, 1180, 720)
        selected, reason, _ = select_subject_bbox(
            [(552, 252, 702, 402), dominant], previous, 1280, 720
        )
        self.assertEqual(selected, tuple(float(value) for value in dominant))
        self.assertEqual(reason, "dominant_subject_reacquired")


if __name__ == "__main__":
    unittest.main()
