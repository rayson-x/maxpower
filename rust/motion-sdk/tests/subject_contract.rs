use std::sync::{Arc, atomic::AtomicUsize};

use form_coach_motion_sdk::{
    AdapterCapabilities, ContinuityMode, ContractVersion, DiagnosticLevel, FixtureInferenceAdapter,
    FrameLease, MotionSession, NormalizedRect, PoseCandidate, PoseObservation,
    RecordingOutputAdapter, SessionConfig, SubjectPolicy, TargetState,
};

fn candidate(id: u64, bbox: NormalizedRect, wrist_x: f32) -> PoseCandidate {
    PoseCandidate {
        id,
        bbox,
        observations: vec![PoseObservation::new(wrist_x, 0.5, 0.0, 0.95)],
        torso_color: [0.2 + id as f32 * 0.01, 0.3, 0.4],
    }
}

fn config() -> SessionConfig {
    SessionConfig {
        sequence_id: "subject:contract".into(),
        contract: ContractVersion { major: 1, minor: 0 },
        diagnostics: DiagnosticLevel::Full,
        image_width_px: 1_000,
        image_height_px: 1_000,
        continuity: ContinuityMode::Fusion,
        subject_policy: SubjectPolicy::DominantVisible,
    }
}

#[test]
fn dominant_off_center_subject_locks_immediately_and_smaller_central_passer_does_not_take_over() {
    let subject = candidate(10, NormalizedRect::new(0.02, 0.08, 0.46, 0.86), 0.24);
    let passer = candidate(20, NormalizedRect::new(0.42, 0.28, 0.16, 0.42), 0.52);
    let frames = vec![
        vec![passer.clone(), subject.clone()],
        vec![subject.clone(), passer.clone()],
        vec![passer, subject],
    ];
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::candidate_sequence(frames),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..3_u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packets = output.packets();
    assert!(packets.iter().all(|packet| {
        packet.target.state == TargetState::Locked
            && packet.target.selected_candidate_id == Some(10)
            && packet.canonical[0].x == Some(0.24)
    }));
}

#[test]
fn manual_selection_creates_a_new_subject_epoch_and_rejects_empty_space() {
    let first = candidate(1, NormalizedRect::new(0.25, 0.1, 0.3, 0.8), 0.4);
    let second = candidate(2, NormalizedRect::new(0.65, 0.1, 0.3, 0.8), 0.8);
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::candidate_sequence(vec![vec![first, second]]),
        output,
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    session
        .offer(FrameLease::fixture(0, 0, Arc::clone(&releases)))
        .unwrap();

    let selected = session.select_subject_at(0.8, 0.5).unwrap();
    assert_eq!(selected.candidate_id, 2);
    assert_eq!(selected.subject_epoch, 1);
    assert!(session.select_subject_at(0.5, 0.98).is_err());
}

#[test]
fn manual_selection_prefers_the_foreground_box_when_people_overlap() {
    let background = candidate(1, NormalizedRect::new(0.10, 0.05, 0.80, 0.90), 0.4);
    let foreground = candidate(2, NormalizedRect::new(0.40, 0.20, 0.22, 0.65), 0.6);
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::candidate_sequence(vec![vec![background, foreground]]),
        output,
    )
    .unwrap();
    session
        .offer(FrameLease::fixture(0, 0, Arc::new(AtomicUsize::new(0))))
        .unwrap();

    assert_eq!(session.select_subject_at(0.5, 0.5).unwrap().candidate_id, 2);
}

#[test]
fn detector_slot_changes_do_not_interrupt_the_same_visible_subject() {
    let original = candidate(10, NormalizedRect::new(0.30, 0.10, 0.40, 0.80), 0.45);
    let mut same_person_new_id = original.clone();
    same_person_new_id.id = 77;
    same_person_new_id.bbox = NormalizedRect::new(0.31, 0.10, 0.40, 0.80);
    let mut frames = vec![vec![original]; 11];
    frames.extend(vec![vec![same_person_new_id]; 7]);
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::candidate_sequence(frames),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..18_u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }
    let packets = output.packets();
    assert_eq!(packets[11].target.state, TargetState::Locked);
    assert_eq!(packets[11].canonical[0].x, Some(0.45));
    assert_eq!(packets[17].target.state, TargetState::Locked);
    assert_eq!(packets[17].target.selected_candidate_id, Some(77));
}

#[test]
fn per_frame_slot_reordering_does_not_change_the_locked_person() {
    let mut subject_slot_zero = candidate(0, NormalizedRect::new(0.30, 0.10, 0.40, 0.80), 0.45);
    let mut passer_slot_one = candidate(1, NormalizedRect::new(0.72, 0.15, 0.20, 0.70), 0.82);
    subject_slot_zero.torso_color = [0.25, 0.25, 0.25];
    passer_slot_one.torso_color = subject_slot_zero.torso_color;
    let mut frames = vec![vec![subject_slot_zero.clone(), passer_slot_one.clone()]; 11];

    // MediaPipe candidate IDs are array slots. When result order swaps, the
    // same physical subject is now slot 1 and the passer is slot 0.
    let mut passer_slot_zero = passer_slot_one;
    passer_slot_zero.id = 0;
    let mut subject_slot_one = subject_slot_zero;
    subject_slot_one.id = 1;
    frames.push(vec![passer_slot_zero, subject_slot_one]);

    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::candidate_sequence(frames.clone()),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..frames.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packets = output.packets();
    let packet = packets.last().unwrap();
    assert_eq!(packet.target.state, TargetState::Locked);
    assert_eq!(packet.target.selected_candidate_id, Some(1));
    assert_eq!(packet.canonical[0].x, Some(0.45));
}

#[test]
fn multiple_people_keep_the_temporally_continuous_subject_despite_pose_and_box_changes() {
    let subject = candidate(0, NormalizedRect::new(0.02, 0.08, 0.46, 0.86), 0.24);
    let mut moving_subject = subject.clone();
    moving_subject.id = 1;
    moving_subject.bbox = NormalizedRect::new(0.16, 0.34, 0.70, 0.40);
    let passer = candidate(0, NormalizedRect::new(0.34, 0.08, 0.58, 0.88), 0.72);
    let frames = vec![vec![subject], vec![passer, moving_subject]];
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::candidate_sequence(frames),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..2_u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packet = output.packets().last().unwrap().clone();
    assert_eq!(packet.target.state, TargetState::Locked);
    assert_eq!(packet.target.selected_candidate_id, Some(1));
    assert_eq!(packet.canonical[0].x, Some(0.24));
}

#[test]
fn a_replacement_after_loss_requires_confirmation_before_creating_an_identity_boundary() {
    let original = candidate(0, NormalizedRect::new(0.30, 0.10, 0.40, 0.80), 0.45);
    let mut replacement_in_same_slot = original.clone();
    replacement_in_same_slot.bbox = NormalizedRect::new(0.53, 0.10, 0.40, 0.80);
    replacement_in_same_slot.torso_color = [0.40, 0.30, 0.40];
    replacement_in_same_slot.observations[0].x = 0.85;
    let mut frames = vec![vec![original]; 3];
    frames.push(vec![]);
    frames.extend(vec![vec![replacement_in_same_slot]; 7]);
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::candidate_sequence(frames),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..11_u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packets = output.packets();
    assert_eq!(packets[4].target.state, TargetState::Uncertain);
    assert_eq!(packets[4].canonical[0].x, Some(0.85));
    let confirmed = packets.last().unwrap();
    assert_eq!(confirmed.target.state, TargetState::Locked);
    assert_eq!(confirmed.canonical[0].x, Some(0.85));
    assert_eq!(confirmed.subject_epoch, 1);
}

#[test]
fn the_only_visible_subject_remains_renderable_across_a_large_pose_change() {
    let standing = candidate(0, NormalizedRect::new(0.05, 0.05, 0.38, 0.88), 0.24);
    let mut bent_over = standing.clone();
    bent_over.bbox = NormalizedRect::new(0.18, 0.35, 0.70, 0.38);
    bent_over.torso_color = [0.45, 0.20, 0.12];
    bent_over.observations[0].x = 0.82;
    let frames = vec![vec![standing], vec![bent_over]];
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::candidate_sequence(frames),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..2_u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packets = output.packets();
    assert_eq!(packets[0].target.state, TargetState::Locked);
    assert_eq!(packets[1].target.state, TargetState::Uncertain);
    assert_eq!(packets[1].canonical[0].x, Some(0.82));
    assert_eq!(packets[1].subject_epoch, 0);
}

#[test]
fn large_pose_change_stays_renderable_while_a_background_person_is_visible() {
    let subject = candidate(10, NormalizedRect::new(0.05, 0.05, 0.38, 0.88), 0.24);
    let background = candidate(20, NormalizedRect::new(0.78, 0.18, 0.16, 0.65), 0.94);
    let mut moved_subject = subject.clone();
    moved_subject.id = 11;
    moved_subject.bbox = NormalizedRect::new(0.18, 0.35, 0.70, 0.38);
    moved_subject.observations[0].x = 0.82;
    let frames = vec![
        vec![background.clone(), subject],
        vec![moved_subject, background],
    ];
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::candidate_sequence(frames),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..2_u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packets = output.packets();
    let packet = packets.last().unwrap();
    assert_eq!(packet.target.state, TargetState::Uncertain);
    assert_eq!(packet.canonical[0].x, Some(0.82));
    assert_eq!(packet.subject_epoch, 0);
}

#[test]
fn direct_single_candidate_replacement_is_not_adopted_without_confirmation() {
    let subject = candidate(0, NormalizedRect::new(0.05, 0.05, 0.38, 0.88), 0.24);
    let replacement = candidate(0, NormalizedRect::new(0.58, 0.10, 0.36, 0.82), 0.86);
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::candidate_sequence(vec![vec![subject], vec![replacement]]),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..2_u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packets = output.packets();
    let packet = packets.last().unwrap();
    assert_eq!(packet.target.state, TargetState::Uncertain);
    assert_eq!(packet.canonical[0].x, Some(0.86));
    assert_eq!(packet.subject_epoch, 0);
}

#[test]
fn initial_subject_selection_is_stable_across_detector_slot_reordering() {
    let mut frames = Vec::new();
    for frame in 0..=10 {
        let subject_id = frame % 2;
        let passer_id = 1 - subject_id;
        let mut subject = candidate(
            subject_id,
            NormalizedRect::new(0.30, 0.10, 0.40, 0.80),
            0.45,
        );
        let mut passer = candidate(passer_id, NormalizedRect::new(0.75, 0.15, 0.18, 0.70), 0.82);
        subject.torso_color = [0.25, 0.25, 0.25];
        passer.torso_color = subject.torso_color;
        frames.push(if frame % 2 == 0 {
            vec![subject, passer]
        } else {
            vec![passer, subject]
        });
    }
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::candidate_sequence(frames.clone()),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..frames.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    assert!(output.packets().iter().all(|packet| {
        packet.target.state == TargetState::Locked && packet.canonical[0].x == Some(0.45)
    }));
}

#[test]
fn replacement_subject_is_confirmed_after_recent_multi_person_competition() {
    let original = candidate(0, NormalizedRect::new(0.30, 0.10, 0.40, 0.80), 0.45);
    let mut replacement = candidate(1, NormalizedRect::new(0.55, 0.10, 0.40, 0.80), 0.80);
    replacement.torso_color = original.torso_color;
    let bystander = candidate(9, NormalizedRect::new(0.82, 0.12, 0.15, 0.68), 0.92);
    let mut frames = vec![vec![original.clone(), bystander]; 3];
    frames.extend((0..7).map(|step| {
        let mut current_slot = replacement.clone();
        current_slot.id = if step % 2 == 0 { 1 } else { 2 };
        vec![current_slot]
    }));
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::candidate_sequence(frames.clone()),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..frames.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packets = output.packets();
    assert_eq!(packets[3].target.state, TargetState::Uncertain);
    assert_eq!(packets[3].canonical[0].x, Some(0.80));
    assert_eq!(packets[9].target.state, TargetState::Locked);
    assert_eq!(packets[9].subject_epoch, 1);
    assert_eq!(packets[9].canonical[0].x, Some(0.80));
}

#[test]
fn similar_clothes_crossing_does_not_adopt_a_passer_during_brief_occlusion() {
    let mut subject = candidate(10, NormalizedRect::new(0.30, 0.10, 0.32, 0.80), 0.45);
    let mut passer = candidate(20, NormalizedRect::new(0.72, 0.12, 0.24, 0.72), 0.80);
    subject.torso_color = [0.25, 0.25, 0.25];
    passer.torso_color = subject.torso_color;
    let mut frames = vec![vec![subject.clone(), passer.clone()]; 11];
    for step in 1..=5 {
        let mut moving_subject = subject.clone();
        moving_subject.bbox.x += step as f32 * 0.025;
        let mut moving_passer = passer.clone();
        moving_passer.bbox.x -= step as f32 * 0.06;
        frames.push(vec![moving_passer, moving_subject]);
    }
    // The subject is now occluded and only the other visible person remains.
    // Do not publish the passer as the coached subject without confirmation.
    let mut lookalike = passer;
    lookalike.bbox = NormalizedRect::new(0.54, 0.12, 0.24, 0.72);
    frames.push(vec![lookalike]);

    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::candidate_sequence(frames.clone()),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..frames.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packets = output.packets();
    assert!(packets[11..16].iter().all(|packet| {
        packet.target.state == TargetState::Locked
            && packet.target.selected_candidate_id == Some(10)
    }));
    let occluded = packets.last().unwrap();
    assert_eq!(occluded.target.state, TargetState::Uncertain);
    assert_eq!(occluded.canonical[0].x, Some(0.80));
    assert_eq!(occluded.subject_epoch, 0);
}
