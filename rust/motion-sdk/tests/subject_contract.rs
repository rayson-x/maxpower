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
        subject_policy: SubjectPolicy::CentralStable,
    }
}

#[test]
fn central_stable_subject_locks_after_500ms_and_edge_passer_does_not_take_over() {
    let central = candidate(10, NormalizedRect::new(0.3, 0.1, 0.4, 0.8), 0.45);
    let edge = candidate(20, NormalizedRect::new(0.0, 0.2, 0.18, 0.6), 0.85);
    let mut frames = Vec::new();
    for _ in 0..=10 {
        frames.push(vec![edge.clone(), central.clone()]);
    }
    frames.push(vec![edge.clone()]);
    frames.push(vec![edge]);
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::candidate_sequence(frames),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..13_u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packets = output.packets();
    assert_eq!(packets[0].target.state, TargetState::Acquiring);
    assert_eq!(packets[9].target.state, TargetState::Acquiring);
    assert_eq!(packets[10].target.state, TargetState::Locked);
    assert_eq!(packets[10].target.selected_candidate_id, Some(10));
    assert_eq!(packets[10].canonical[0].x, Some(0.45));
    assert_eq!(packets[11].target.state, TargetState::Uncertain);
    assert_eq!(packets[11].target.selected_candidate_id, Some(10));
    assert_eq!(packets[11].canonical[0].x, None);
    assert_eq!(packets[12].target.state, TargetState::Uncertain);
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
fn changed_detector_id_must_match_identity_evidence_before_reacquiring() {
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
fn reused_detector_slot_requires_confirmation_after_an_identity_jump() {
    let original = candidate(0, NormalizedRect::new(0.30, 0.10, 0.40, 0.80), 0.45);
    let mut replacement_in_same_slot = original.clone();
    replacement_in_same_slot.bbox = NormalizedRect::new(0.53, 0.10, 0.40, 0.80);
    replacement_in_same_slot.torso_color = [0.40, 0.30, 0.40];
    let mut frames = vec![vec![original]; 11];
    frames.push(vec![replacement_in_same_slot]);
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::candidate_sequence(frames),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..12_u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    let packet = output.packets().last().unwrap().clone();
    assert_eq!(packet.target.state, TargetState::Reacquiring);
    assert!(packet.canonical.iter().all(|landmark| landmark.x.is_none()));
}

#[test]
fn detector_slot_identity_jump_resets_the_initial_acquisition_timer() {
    let original = candidate(0, NormalizedRect::new(0.30, 0.10, 0.40, 0.80), 0.45);
    let mut replacement = original.clone();
    replacement.bbox = NormalizedRect::new(0.55, 0.10, 0.40, 0.80);
    replacement.torso_color = [0.45, 0.30, 0.40];
    let mut frames = vec![vec![original]; 6];
    frames.extend(vec![vec![replacement]; 6]);
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        config(),
        AdapterCapabilities::fixture(),
        FixtureInferenceAdapter::candidate_sequence(frames),
        output.clone(),
    )
    .unwrap();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame in 0..12_u64 {
        session
            .offer(FrameLease::fixture(
                frame,
                frame * 50,
                Arc::clone(&releases),
            ))
            .unwrap();
    }

    assert_eq!(
        output.packets().last().unwrap().target.state,
        TargetState::Acquiring
    );
}

#[test]
fn acquisition_timer_survives_slot_reordering_when_descriptor_identity_is_stable() {
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

    assert_eq!(
        output.packets().last().unwrap().target.state,
        TargetState::Locked,
    );
}

#[test]
fn uncertain_reacquire_ignores_slot_reordering_and_creates_a_new_epoch() {
    let original = candidate(0, NormalizedRect::new(0.30, 0.10, 0.40, 0.80), 0.45);
    let mut replacement = candidate(1, NormalizedRect::new(0.55, 0.10, 0.40, 0.80), 0.80);
    replacement.torso_color = original.torso_color;
    let mut frames = vec![vec![original]; 11];
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
    assert_eq!(packets[11].target.state, TargetState::Reacquiring);
    assert_eq!(packets[11].subject_epoch, 0);
    assert_eq!(packets[17].target.state, TargetState::Locked);
    assert_eq!(packets[17].subject_epoch, 1);
    assert_eq!(packets[17].canonical[0].x, Some(0.80));
}

#[test]
fn similar_clothes_crossing_keeps_the_locked_identity_and_occlusion_refuses_a_guess() {
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
    // The subject is now occluded; a lookalike is visible near the crossing
    // point. Identity uncertainty must pause canonical output instead of
    // silently adopting the only visible person.
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
    assert_ne!(occluded.target.state, TargetState::Locked);
    assert!(
        occluded
            .canonical
            .iter()
            .all(|landmark| landmark.x.is_none())
    );
}
