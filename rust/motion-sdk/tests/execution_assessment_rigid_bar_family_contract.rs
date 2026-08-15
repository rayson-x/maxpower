use std::{
    collections::{BTreeMap, HashSet, VecDeque},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, atomic::AtomicUsize},
};

use maxpower_motion_sdk::{
    ActionMotionBundleBinding, ActionMotionCatalog, ActionMotionCompiler, ActionViewBinding,
    AdapterCapabilities, AssessmentAssetKind, AssessmentBundleCapability, AssessmentCaptureView,
    AssessmentConclusionState, AssessmentDimension, AssessmentEmission,
    AssessmentEquipmentRecognitionMode, AssessmentEvent, AssessmentRuntimeError, BarbellAxisSource,
    BarbellAxisVisualTracker, ContractVersion, DeclaredLoad, DeclaredLoadProvenance,
    DiagnosticLevel, EquipmentAttributes, EquipmentAxis2d, EquipmentKind, EquipmentObservation,
    EquipmentSource, ExecutionAssessmentEngine, FrameLease, FrameObservations, FrameRotation,
    InferenceAdapter, LocalActionAxisDirection, LocalEquipmentMode, MotionError, MotionSession,
    NormalizedRect, OperatorRegistry, PoseCandidate, PoseObservation, PoseObservationContract,
    PoseSchemaId, RecordingOutputAdapter, ReferenceComparisonKind, SessionConfig,
    SetExecutionContext, SetIntent, SubjectPolicy, TimestampUnit, TraceNodeKind,
    VideoFrameContract, VideoRecognitionContext, WorkoutAssessmentContext,
    bind_runtime_profile_to_action_plan, current_action_motion_assessment_profiles_v12,
    current_bodyweight_assessment_profiles_v1, current_cable_assessment_profiles_v1,
    current_dual_dumbbell_assessment_profiles_v1, current_machine_assessment_profiles_v1,
    current_motion_assessment_catalog_v3, current_motion_assessment_catalog_v7,
    current_motion_assessment_catalog_v8, current_motion_assessment_catalog_v9,
    current_motion_assessment_catalog_v10, current_motion_assessment_catalog_v11,
    current_motion_assessment_catalog_v12, current_rigid_bar_assessment_profiles_v1,
    equipment_fused_rigid_bar_assessment_profiles_v2, install_action_motion_runtime_profile,
    install_compiled_action_motion_semantics, rigid_bar_track_supports_turnaround,
    wrist_constrained_rigid_bar_assessment_profiles_v3,
};
use serde::Serialize;

const RIGID_BAR_CONTEXTS: &[(&str, &str, AssessmentCaptureView)] = &[
    ("barbell_bench_press", "front", AssessmentCaptureView::Front),
    (
        "barbell_bench_press",
        "frontLeft45",
        AssessmentCaptureView::FrontObliqueLeft,
    ),
    (
        "barbell_bench_press",
        "frontRight45",
        AssessmentCaptureView::FrontObliqueRight,
    ),
    ("barbell_row", "front", AssessmentCaptureView::Front),
    (
        "barbell_row",
        "frontLeft45",
        AssessmentCaptureView::FrontObliqueLeft,
    ),
    (
        "barbell_row",
        "frontRight45",
        AssessmentCaptureView::FrontObliqueRight,
    ),
    (
        "barbell_row",
        "rearLeft45",
        AssessmentCaptureView::RearObliqueLeft,
    ),
    (
        "barbell_row",
        "rearRight45",
        AssessmentCaptureView::RearObliqueRight,
    ),
    (
        "seated_shoulder_press",
        "front",
        AssessmentCaptureView::Front,
    ),
];

const ALL_ACTION_CONTEXTS: &[(&str, &str, AssessmentCaptureView)] = &[
    ("barbell_bench_press", "front", AssessmentCaptureView::Front),
    (
        "barbell_bench_press",
        "frontLeft45",
        AssessmentCaptureView::FrontObliqueLeft,
    ),
    (
        "barbell_bench_press",
        "frontRight45",
        AssessmentCaptureView::FrontObliqueRight,
    ),
    ("barbell_row", "front", AssessmentCaptureView::Front),
    (
        "barbell_row",
        "frontLeft45",
        AssessmentCaptureView::FrontObliqueLeft,
    ),
    (
        "barbell_row",
        "frontRight45",
        AssessmentCaptureView::FrontObliqueRight,
    ),
    (
        "barbell_row",
        "rearLeft45",
        AssessmentCaptureView::RearObliqueLeft,
    ),
    (
        "barbell_row",
        "rearRight45",
        AssessmentCaptureView::RearObliqueRight,
    ),
    (
        "seated_shoulder_press",
        "front",
        AssessmentCaptureView::Front,
    ),
    ("lat_pulldown", "rear", AssessmentCaptureView::Rear),
    (
        "lat_pulldown",
        "rearLeft45",
        AssessmentCaptureView::RearObliqueLeft,
    ),
    (
        "seated_row",
        "frontLeft45",
        AssessmentCaptureView::FrontObliqueLeft,
    ),
    (
        "seated_row",
        "rearLeft45",
        AssessmentCaptureView::RearObliqueLeft,
    ),
    ("seated_row", "right", AssessmentCaptureView::RightSide),
    (
        "straight_arm_pulldown",
        "frontLeft45",
        AssessmentCaptureView::FrontObliqueLeft,
    ),
    (
        "straight_arm_pulldown",
        "frontRight45",
        AssessmentCaptureView::FrontObliqueRight,
    ),
    (
        "single_arm_cable_lateral_raise",
        "frontLeft45",
        AssessmentCaptureView::FrontObliqueLeft,
    ),
    (
        "single_arm_cable_lateral_raise",
        "rearRight45",
        AssessmentCaptureView::RearObliqueRight,
    ),
    ("machine_chest_press", "front", AssessmentCaptureView::Front),
    (
        "machine_chest_press",
        "frontRight45",
        AssessmentCaptureView::FrontObliqueRight,
    ),
    ("rear_delt_fly", "front", AssessmentCaptureView::Front),
    ("lateral_raise", "front", AssessmentCaptureView::Front),
    (
        "push_up",
        "rearRight45",
        AssessmentCaptureView::RearObliqueRight,
    ),
    (
        "pull_up",
        "rearLeft45",
        AssessmentCaptureView::RearObliqueLeft,
    ),
];

fn current_profile(
    action_id: &str,
    view: AssessmentCaptureView,
) -> (
    maxpower_motion_sdk::ExerciseProfile,
    maxpower_motion_sdk::LocalMotionCoordinateStrategy,
) {
    let rigid = current_rigid_bar_assessment_profiles_v1()
        .into_iter()
        .map(|binding| {
            (
                binding.action_id,
                binding.capture_view,
                binding.profile,
                binding.local_coordinate_strategy,
            )
        });
    let family = current_cable_assessment_profiles_v1()
        .into_iter()
        .chain(current_machine_assessment_profiles_v1())
        .chain(current_dual_dumbbell_assessment_profiles_v1())
        .chain(current_bodyweight_assessment_profiles_v1())
        .map(|binding| {
            (
                binding.action_id,
                binding.capture_view,
                binding.profile,
                binding.local_coordinate_strategy,
            )
        });
    rigid
        .chain(family)
        .find(|(action, capture_view, _, _)| action == action_id && *capture_view == view)
        .map(|(_, _, profile, strategy)| (profile, strategy))
        .expect("exact current profile")
}

fn wrist_constrained_profile(
    action_id: &str,
    view: AssessmentCaptureView,
) -> (
    maxpower_motion_sdk::ExerciseProfile,
    maxpower_motion_sdk::LocalMotionCoordinateStrategy,
) {
    wrist_constrained_rigid_bar_assessment_profiles_v3()
        .into_iter()
        .find(|binding| binding.action_id == action_id && binding.capture_view == view)
        .map(|binding| (binding.profile, binding.local_coordinate_strategy))
        .unwrap_or_else(|| current_profile(action_id, view))
}

fn video_context(action_id: &str, capture_position: &str) -> VideoRecognitionContext {
    VideoRecognitionContext {
        source_capture_id: format!("fixture:{action_id}:{capture_position}"),
        exercise_id: action_id.into(),
        variation_id: None,
        capture_position: capture_position.into(),
        frame_contract: VideoFrameContract {
            width: 720,
            height: 1_280,
            rotation: FrameRotation::Degrees0,
            mirrored: false,
            timestamp_unit: TimestampUnit::Milliseconds,
        },
        pose_contract: PoseObservationContract {
            runtime_id: "rtmpose-m".into(),
            landmark_schema: "halpe26".into(),
            schema_version: "v1".into(),
        },
    }
}

#[test]
fn same_workout_reference_accepts_progressive_load_but_never_crosses_load_units() {
    let binding = current_rigid_bar_assessment_profiles_v1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("bench front profile");
    let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure_for_subject(
        current_motion_assessment_catalog_v3(),
        WorkoutAssessmentContext {
            workout_session_id: "load-compatible-reference".into(),
        },
        "athlete:test-owner",
    )
    .expect("v3 catalog");
    let mut kinds = Vec::new();
    for (ordinal, value_milli, unit) in [(1, 20_000, "kg"), (2, 45_000, "lb"), (3, 60_000, "kg")] {
        let source_capture_id = format!("fixture:load-reference:{ordinal}");
        let (packets, closure) =
            canonical_packets_for_channels(&binding, &source_capture_id, false);
        let mut context = video_context("barbell_bench_press", "front");
        context.source_capture_id = source_capture_id;
        engine
            .advance(AssessmentEvent::SetStarted(SetExecutionContext {
                set_id: format!("load-set-{ordinal}"),
                set_ordinal: ordinal,
                video_context: context,
                intent: SetIntent::Working,
                planned_load: None,
                performed_load: Some(DeclaredLoad {
                    value_milli,
                    unit: unit.into(),
                    provenance: DeclaredLoadProvenance::UserModified,
                }),
            }))
            .expect("start set");
        for packet in packets {
            engine
                .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
                .expect("packet");
        }
        engine
            .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
                closure,
            )))
            .expect("closure");
        let AssessmentEmission::SealedSetAssessment(report) = engine
            .advance(AssessmentEvent::SetFinished)
            .expect("report")
        else {
            panic!("sealed report")
        };
        kinds.push(
            report.rep_assessments[0]
                .comparisons
                .iter()
                .find(|comparison| comparison.feature_id == "local_primary_excursion")
                .expect("range comparison")
                .kind,
        );
    }
    assert_eq!(
        kinds,
        [
            ReferenceComparisonKind::NoReference,
            ReferenceComparisonKind::NoReference,
            ReferenceComparisonKind::SameWorkoutPriorSet,
        ],
        "load value may progress within one unit, but a different unit is not a compatible reference"
    );
}

#[test]
fn same_workout_reference_requires_an_explicit_stable_subject_identity() {
    let binding = current_rigid_bar_assessment_profiles_v1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("bench front profile");
    let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
        current_motion_assessment_catalog_v3(),
        WorkoutAssessmentContext {
            workout_session_id: "reference-without-stable-subject".into(),
        },
    )
    .expect("v3 catalog");

    for ordinal in 1..=2 {
        let source_capture_id = format!("fixture:no-subject-reference:{ordinal}");
        let (packets, closure) =
            canonical_packets_for_channels(&binding, &source_capture_id, false);
        let mut context = video_context("barbell_bench_press", "front");
        context.source_capture_id = source_capture_id;
        engine
            .advance(AssessmentEvent::SetStarted(SetExecutionContext {
                set_id: format!("no-subject-set-{ordinal}"),
                set_ordinal: ordinal,
                video_context: context,
                intent: SetIntent::Working,
                planned_load: None,
                performed_load: Some(DeclaredLoad {
                    value_milli: ordinal as u64 * 20_000,
                    unit: "kg".into(),
                    provenance: DeclaredLoadProvenance::UserModified,
                }),
            }))
            .expect("start set");
        for packet in packets {
            engine
                .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
                .expect("packet");
        }
        engine
            .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
                closure,
            )))
            .expect("closure");
        let AssessmentEmission::SealedSetAssessment(report) = engine
            .advance(AssessmentEvent::SetFinished)
            .expect("report")
        else {
            panic!("sealed report")
        };
        let comparison = report.rep_assessments[0]
            .comparisons
            .iter()
            .find(|comparison| comparison.feature_id == "local_primary_excursion")
            .expect("range comparison");
        assert_eq!(comparison.kind, ReferenceComparisonKind::NoReference);
    }
}

#[test]
fn packet_local_coordinate_strategy_must_match_the_frozen_exact_context() {
    let binding = current_rigid_bar_assessment_profiles_v1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("bench front profile");
    let mut wrong_binding = binding.clone();
    wrong_binding.local_coordinate_strategy.equipment_mode = LocalEquipmentMode::PoseOnly;
    let (packets, _) = canonical_packets_for(&wrong_binding, "fixture:wrong-local-strategy");
    let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
        current_motion_assessment_catalog_v3(),
        WorkoutAssessmentContext {
            workout_session_id: "wrong-local-strategy".into(),
        },
    )
    .expect("v3 catalog");
    let mut context = video_context("barbell_bench_press", "front");
    context.source_capture_id = "fixture:wrong-local-strategy".into();
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "wrong-local-strategy-set".into(),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start exact context");

    let error = engine
        .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(
            packets.into_iter().next().expect("canonical packet"),
        )))
        .expect_err("a packet normalized with another equipment primitive must be refused");
    assert_eq!(
        error,
        AssessmentRuntimeError::PacketLocalCoordinateStrategyMismatch
    );
}

#[test]
fn canonical_set_closure_without_any_packet_is_refused() {
    let binding = current_rigid_bar_assessment_profiles_v1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("bench front profile");
    let (_, closure) = canonical_packets_for(&binding, "fixture:empty-assessment-stream");
    let mut engine = ExecutionAssessmentEngine::configure(
        current_motion_assessment_catalog_v3(),
        WorkoutAssessmentContext {
            workout_session_id: "empty-assessment-stream".into(),
        },
    )
    .expect("v3 catalog");
    let mut context = video_context("barbell_bench_press", "front");
    context.source_capture_id = "fixture:empty-assessment-stream".into();
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "empty-assessment-stream-set".into(),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start exact context");

    assert_eq!(
        engine
            .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
                closure,
            )))
            .expect_err("an empty canonical stream cannot produce user conclusions"),
        AssessmentRuntimeError::CanonicalPacketRequired
    );
}

#[test]
fn visible_return_deviation_does_not_require_a_prior_range_reference() {
    let binding = current_rigid_bar_assessment_profiles_v1()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_row"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("row front profile");
    let source_capture_id = "fixture:visible-return-without-reference";
    let (packets, closure) =
        canonical_packets_with_visible_return_error(&binding, source_capture_id);

    let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
        current_motion_assessment_catalog_v3(),
        WorkoutAssessmentContext {
            workout_session_id: "visible-return-without-reference".into(),
        },
    )
    .expect("v3 catalog");
    let mut context = video_context("barbell_row", "front");
    context.source_capture_id = source_capture_id.into();
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "visible-return-set".into(),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start set");
    for packet in packets {
        engine
            .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
            .expect("packet");
    }
    engine
        .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
            closure,
        )))
        .expect("closure");
    let AssessmentEmission::SealedSetAssessment(report) = engine
        .advance(AssessmentEvent::SetFinished)
        .expect("report")
    else {
        panic!("sealed report")
    };
    let rep = report.rep_assessments.first().expect("assessed Rep");
    let range_comparison = rep
        .comparisons
        .iter()
        .find(|comparison| comparison.feature_id == "local_primary_excursion")
        .expect("range comparison");
    assert_eq!(range_comparison.kind, ReferenceComparisonKind::NoReference);
    let range_finding = rep
        .dimension_findings
        .iter()
        .find(|finding| finding.dimension == AssessmentDimension::RangeOfMotion)
        .expect("range and return finding");
    assert_eq!(
        range_finding.state,
        AssessmentConclusionState::ObservedDeviation,
        "{}; features={:?}",
        range_finding.summary,
        rep.features
    );
    assert!(range_finding.summary.contains("Visible return error"));
}

#[derive(Clone)]
struct RigidBarFixture {
    frames: VecDeque<FrameObservations>,
}

impl InferenceAdapter for RigidBarFixture {
    fn infer(&mut self, _frame: &FrameLease) -> Result<FrameObservations, MotionError> {
        Ok(self.frames.pop_front().expect("fixture frame"))
    }
}

fn rigid_bar_frame(
    angle_degrees: f32,
    progress: f32,
    include_equipment: bool,
) -> FrameObservations {
    let mut observations = vec![PoseObservation::new(0.5, 0.5, 0.0, 0.99); 26];
    for (shoulder, elbow, wrist, x) in [(5, 7, 9, 0.35), (6, 8, 10, 0.65)] {
        let elbow_point = [x, 0.42 + progress * 0.30];
        observations[shoulder] =
            PoseObservation::new(elbow_point[0], elbow_point[1] - 0.12, 0.0, 0.99);
        observations[elbow] = PoseObservation::new(elbow_point[0], elbow_point[1], 0.0, 0.99);
        let theta = (-90.0 + angle_degrees).to_radians();
        observations[wrist] = PoseObservation::new(
            elbow_point[0] + theta.cos() * 0.12,
            elbow_point[1] + theta.sin() * 0.12,
            0.0,
            0.99,
        );
    }
    observations[11] = PoseObservation::new(0.42, 0.62, 0.0, 0.99);
    observations[12] = PoseObservation::new(0.58, 0.62, 0.0, 0.99);
    observations[13] = PoseObservation::new(0.43, 0.78, 0.0, 0.99);
    observations[14] = PoseObservation::new(0.57, 0.78, 0.0, 0.99);
    observations[15] = PoseObservation::new(0.43, 0.94, 0.0, 0.99);
    observations[16] = PoseObservation::new(0.57, 0.94, 0.0, 0.99);

    let bar_center_y = 0.34 + progress * 0.30;
    let axis = EquipmentAxis2d {
        x1: 0.20,
        y1: bar_center_y,
        x2: 0.80,
        y2: bar_center_y,
    };
    FrameObservations {
        pose_candidates: vec![PoseCandidate {
            id: 7,
            bbox: NormalizedRect::new(0.05, 0.02, 0.90, 0.96),
            observations,
            torso_color: [0.2, 0.3, 0.4],
        }],
        equipment: include_equipment
            .then(|| EquipmentObservation {
                proposal_id: 11,
                kind: EquipmentKind::BarbellShaft,
                bbox: NormalizedRect::new(0.20, bar_center_y - 0.005, 0.60, 0.01),
                axis: Some(axis),
                score: 0.98,
                uncertainty_px: Some(1.0),
                source: EquipmentSource::Geometry,
                attributes: EquipmentAttributes::default(),
            })
            .into_iter()
            .collect(),
    }
}

fn aligned_rigid_bar_frame(angle_degrees: f32, progress: f32) -> FrameObservations {
    let mut frame = rigid_bar_frame(angle_degrees, progress, true);
    let bar_center_y = 0.34 + progress * 0.30;
    let observations = &mut frame.pose_candidates[0].observations;
    for (shoulder, elbow, wrist, x) in [(5, 7, 9, 0.35), (6, 8, 10, 0.65)] {
        let theta = (-90.0 + angle_degrees).to_radians();
        let elbow_y = bar_center_y - theta.sin() * 0.12;
        observations[shoulder] = PoseObservation::new(x, elbow_y - 0.12, 0.0, 0.99);
        observations[elbow] = PoseObservation::new(x, elbow_y, 0.0, 0.99);
        observations[wrist] = PoseObservation::new(x + theta.cos() * 0.12, bar_center_y, 0.0, 0.99);
    }
    frame
}

fn canonical_packets_for(
    binding: &maxpower_motion_sdk::RigidBarAssessmentProfileBinding,
    sequence_id: &str,
) -> (
    Vec<maxpower_motion_sdk::MotionPacket>,
    maxpower_motion_sdk::MotionSetClosure,
) {
    canonical_packets_for_channels(binding, sequence_id, true)
}

fn canonical_packets_for_channels(
    binding: &maxpower_motion_sdk::RigidBarAssessmentProfileBinding,
    sequence_id: &str,
    include_equipment: bool,
) -> (
    Vec<maxpower_motion_sdk::MotionPacket>,
    maxpower_motion_sdk::MotionSetClosure,
) {
    let decreasing_angles = [160.0; 10]
        .into_iter()
        .chain([150.0, 135.0, 115.0, 95.0, 80.0, 82.0])
        .chain([95.0, 115.0, 135.0, 150.0, 160.0])
        .chain([160.0; 8])
        .collect::<Vec<_>>();
    let angles = if binding.action_id == "seated_shoulder_press" {
        decreasing_angles
            .iter()
            .map(|angle| 240.0 - angle)
            .collect::<Vec<_>>()
    } else {
        decreasing_angles
    };
    let progress = angles
        .iter()
        .map(|angle| {
            if binding.action_id == "seated_shoulder_press" {
                (angle - 80.0) / 80.0
            } else {
                (160.0 - angle) / 80.0
            }
        })
        .collect::<Vec<_>>();
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: sequence_id.into(),
            contract: ContractVersion {
                major: 1,
                minor: 10,
            },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: 720,
            image_height_px: 1_280,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        RigidBarFixture {
            frames: angles
                .iter()
                .zip(&progress)
                .enumerate()
                .map(|(index, (angle, progress))| {
                    // A sub-threshold setup dither proves common hand/bar
                    // motion before the working cycle without becoming a Rep.
                    let setup_progress = if index == 1 { 0.04 } else { *progress };
                    let mut frame = aligned_rigid_bar_frame(*angle, setup_progress);
                    if !include_equipment && index >= 12 {
                        frame.equipment.clear();
                    }
                    frame
                })
                .collect(),
        },
        output.clone(),
    )
    .expect("motion session");
    session
        .install_exercise_profile_with_local_strategy(
            binding.profile.clone(),
            binding.local_coordinate_strategy,
        )
        .expect("exact-context profile");
    session.begin_set();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame_id in 0..angles.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .expect("canonical frame");
    }
    let packets = output.packets();
    let closure = session.finish_set_for_assessment();
    (packets, closure)
}

fn canonical_packets_with_visible_return_error(
    binding: &maxpower_motion_sdk::RigidBarAssessmentProfileBinding,
    sequence_id: &str,
) -> (
    Vec<maxpower_motion_sdk::MotionPacket>,
    maxpower_motion_sdk::MotionSetClosure,
) {
    let angles = [160.0; 10]
        .into_iter()
        .chain([150.0, 135.0, 115.0, 95.0, 80.0, 82.0])
        .chain([95.0, 115.0, 135.0, 150.0, 160.0])
        .chain([160.0; 8])
        .collect::<Vec<_>>();
    let frames = angles
        .iter()
        .enumerate()
        .map(|(index, angle)| {
            let complete_progress: f32 = (160.0_f32 - angle) / 80.0_f32;
            let progress = if index >= 16 {
                complete_progress.max(0.40)
            } else {
                complete_progress
            };
            aligned_rigid_bar_frame(*angle, if index == 1 { 0.04 } else { progress })
        })
        .collect();
    let output = RecordingOutputAdapter::default();
    let mut session = MotionSession::open(
        SessionConfig {
            sequence_id: sequence_id.into(),
            contract: ContractVersion {
                major: 1,
                minor: 10,
            },
            diagnostics: DiagnosticLevel::Full,
            image_width_px: 720,
            image_height_px: 1_280,
            continuity: maxpower_motion_sdk::ContinuityMode::Raw,
            subject_policy: SubjectPolicy::AssumeSingle,
        },
        AdapterCapabilities::fixture(),
        RigidBarFixture { frames },
        output.clone(),
    )
    .expect("motion session");
    session
        .install_exercise_profile_with_local_strategy(
            binding.profile.clone(),
            binding.local_coordinate_strategy,
        )
        .expect("exact-context profile");
    session.begin_set();
    let releases = Arc::new(AtomicUsize::new(0));
    for frame_id in 0..angles.len() as u64 {
        session
            .offer(FrameLease::fixture(
                frame_id,
                frame_id * 100,
                Arc::clone(&releases),
            ))
            .expect("canonical frame");
    }
    let packets = output.packets();
    let closure = session.finish_set_for_assessment();
    (packets, closure)
}

fn read_governed_gzip_json(path: &Path) -> serde_json::Value {
    let output = Command::new("gzip")
        .args(["-dc", path.to_str().expect("UTF-8 fixture path")])
        .output()
        .expect("gzip is available for governed replay");
    assert!(output.status.success(), "failed to read {}", path.display());
    serde_json::from_slice(&output.stdout).expect("governed JSON sidecar")
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut child = Command::new("shasum")
        .args(["-a", "256"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("SHA-256 verifier is available");
    child
        .stdin
        .take()
        .expect("hash stdin")
        .write_all(bytes)
        .expect("hash input");
    let output = child.wait_with_output().expect("hash output");
    assert!(output.status.success());
    String::from_utf8(output.stdout)
        .expect("UTF-8 hash")
        .split_whitespace()
        .next()
        .expect("hash digest")
        .to_owned()
}

fn stable_fnv_hash<T: serde::Serialize>(value: &T) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in serde_json::to_vec(value).expect("trace is JSON serializable") {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[test]
fn frozen_rust_evaluation_metrics_resolve_to_governed_immutable_evidence() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("MaxPower root")
        .to_path_buf();
    let governance_root = root
        .parent()
        .expect("power workspace")
        .join("maxpower-training-data-governance");
    let governance: serde_json::Value = serde_json::from_slice(
        &std::fs::read(governance_root.join("catalog/assets.json")).expect("governance catalog"),
    )
    .expect("governance JSON");
    let manifest: serde_json::Value = serde_json::from_slice(include_bytes!(
        "fixtures/current_rust_evaluation_evidence_manifest_v1.json"
    ))
    .expect("evaluation evidence manifest");
    let assembled = &manifest["assembledInput"];
    assert_eq!(
        sha256_bytes(&serde_json::to_vec(assembled).expect("stable manifest input")),
        manifest["assembledInputSha256"]
    );
    let catalog_assets = governance["assets"].as_array().expect("assets");
    for expected in assembled["sourceAssets"].as_array().expect("source assets") {
        let governed = catalog_assets
            .iter()
            .find(|asset| asset["id"] == expected["assetId"])
            .expect("manifest asset resolves in governance catalog");
        assert_eq!(governed["admission"], expected["admission"]);
        assert_eq!(governed["authority"], expected["authority"]);
        assert_eq!(governed["groupKey"], expected["groupKey"]);
        let allowed_tasks = governed["allowedTasks"].as_array().expect("allowed tasks");
        let target_tasks = assembled["targetTasks"].as_array().expect("target tasks");
        assert!(
            expected["consumedForTasks"]
                .as_array()
                .expect("consumed tasks")
                .iter()
                .all(|task| allowed_tasks.contains(task) && target_tasks.contains(task)),
            "every consumed task must be admitted by governance"
        );
        assert!(
            !expected["selectedFields"]
                .as_array()
                .expect("selected fields")
                .is_empty(),
            "every source must declare the exact consumed fields"
        );
        if expected["assetId"] == "personal-human-rep-ranges-v2" {
            let allowed_fields = governed["allowedSupervision"]
                .as_array()
                .expect("allowed label fields");
            assert!(
                expected["selectedFields"]
                    .as_array()
                    .expect("selected label fields")
                    .iter()
                    .all(|field| field == "sourceCaptureId" || allowed_fields.contains(field)),
                "evaluation must not consume undeclared label supervision"
            );
        }
    }
    let evaluation_asset = catalog_assets
        .iter()
        .find(|asset| asset["id"] == "client-single-pass-predictions-and-agent-output")
        .expect("evaluation asset");
    assert!(
        evaluation_asset["allowedTasks"]
            .as_array()
            .is_some_and(|tasks| tasks.iter().any(|task| task == "model_evaluation"))
    );
    let label_asset = catalog_assets
        .iter()
        .find(|asset| asset["id"] == "personal-human-rep-ranges-v2")
        .expect("label asset");
    let manifest_label = assembled["sourceAssets"]
        .as_array()
        .expect("source assets")
        .iter()
        .find(|asset| asset["assetId"] == "personal-human-rep-ranges-v2")
        .expect("manifest label asset");
    assert_eq!(
        label_asset["location"]["sha256"],
        manifest_label["immutableSha256"]
    );
    let label_bytes = std::fs::read(
        root.join(
            label_asset["location"]["path"]
                .as_str()
                .expect("label asset path"),
        ),
    )
    .expect("immutable label file");
    assert_eq!(
        sha256_bytes(&label_bytes),
        manifest_label["immutableSha256"]
    );
    let output_path = assembled["evaluationOutput"]["path"]
        .as_str()
        .expect("evaluation output path");
    assert!(
        output_path.starts_with(
            evaluation_asset["location"]["path"]
                .as_str()
                .expect("evaluation asset directory")
        )
    );
    let output_bytes = std::fs::read(root.join(output_path)).expect("frozen evaluation output");
    assert_eq!(
        sha256_bytes(&output_bytes),
        assembled["evaluationOutput"]["sha256"]
    );
    let output: serde_json::Value =
        serde_json::from_slice(&output_bytes).expect("frozen evaluation JSON");
    assert_eq!(
        output["schemaVersion"],
        assembled["evaluationOutput"]["schemaVersion"]
    );
    assert_eq!(
        output["generatedAt"],
        assembled["evaluationOutput"]["generatedAt"]
    );
    for key in [
        "visualRuntime",
        "motionRuntime",
        "pass",
        "truthReveal",
        "predictionSha256",
        "datasetSha256",
    ] {
        assert_eq!(output["protocol"][key], assembled["protocol"][key]);
    }
    for key in [
        "visualRuntime",
        "motionRuntime",
        "pass",
        "truthReveal",
        "predictionSha256",
    ] {
        assert_eq!(
            assembled["modelConfiguration"][key],
            assembled["protocol"][key]
        );
    }
    let exclusion_bytes = std::fs::read(
        governance_root.join(
            assembled["exclusions"]["path"]
                .as_str()
                .expect("exclusions path"),
        ),
    )
    .expect("governance exclusions");
    assert_eq!(
        sha256_bytes(&exclusion_bytes),
        assembled["exclusions"]["sha256"]
    );
    let exclusions: serde_json::Value =
        serde_json::from_slice(&exclusion_bytes).expect("exclusions JSON");
    let source_groups = assembled["sourceGroups"].as_array().expect("source groups");
    assert_eq!(
        source_groups.len(),
        output["rows"].as_array().expect("rows").len()
    );
    for row in output["rows"].as_array().expect("rows") {
        let capture_id = &row["captureId"];
        assert!(source_groups.iter().any(|group| {
            group["sourceCaptureId"] == *capture_id
                && group["splitId"] == "frozen-client-observation-debug-evaluation"
        }));
        assert!(
            !exclusions["recordExclusions"]
                .as_array()
                .expect("record exclusions")
                .iter()
                .any(|excluded| {
                    excluded["sourceCaptureId"] == *capture_id && excluded["repIndex"].is_null()
                })
        );
    }
    for key in [
        "sourceCount",
        "truthRepCount",
        "confirmedPredictedRepCount",
        "matchedRepCount",
        "candidatePrecision",
        "candidateRecall",
        "exactSetSourceRate",
    ] {
        assert_eq!(
            output["aggregate"][key].as_f64(),
            assembled["frozenResult"][key].as_f64()
        );
    }
    let matches = output["rows"]
        .as_array()
        .expect("evaluation rows")
        .iter()
        .flat_map(|row| {
            row["confirmedEvaluation"]["matches"]
                .as_array()
                .expect("confirmed matches")
        })
        .collect::<Vec<_>>();
    let mean_absolute = |field: &str| {
        matches
            .iter()
            .map(|entry| entry[field].as_f64().expect("boundary offset").abs())
            .sum::<f64>()
            / matches.len() as f64
    };
    assert!(
        (mean_absolute("startOffsetMs")
            - assembled["frozenResult"]["startBoundaryMaeMs"]
                .as_f64()
                .expect("start MAE"))
        .abs()
            < 1e-9
    );
    assert!(
        (mean_absolute("endOffsetMs")
            - assembled["frozenResult"]["endBoundaryMaeMs"]
                .as_f64()
                .expect("end MAE"))
        .abs()
            < 1e-9
    );
    assert!(assembled["frozenResult"]["reviewedNegativeWindowFalseTriggerRate"].is_null());
}

#[test]
fn frozen_v8_equipment_fusion_report_resolves_to_governed_immutable_evidence() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("MaxPower root")
        .to_path_buf();
    let governance_root = root
        .parent()
        .expect("power workspace")
        .join("maxpower-training-data-governance");
    let governance: serde_json::Value = serde_json::from_slice(
        &std::fs::read(governance_root.join("catalog/assets.json")).expect("governance catalog"),
    )
    .expect("governance JSON");
    let asset = governance["assets"]
        .as_array()
        .expect("governance assets")
        .iter()
        .find(|asset| asset["id"] == "current-rust-v8-equipment-fused-known-video-alignment-report")
        .expect("v8 report asset is governed");
    assert_eq!(asset["admission"], "evaluation_only");
    assert_eq!(asset["authority"], "frozen_prediction_or_report");
    assert!(asset["forbiddenUses"].as_array().is_some_and(|uses| {
        uses.iter()
            .any(|use_id| use_id == "held_out_accuracy_claim")
    }));

    let report_bytes =
        std::fs::read(root.join(asset["location"]["path"].as_str().expect("v8 report path")))
            .expect("frozen v8 report");
    assert_eq!(
        sha256_bytes(&report_bytes),
        asset["location"]["sha256"]
            .as_str()
            .expect("report SHA-256")
    );
    let report: serde_json::Value =
        serde_json::from_slice(&report_bytes).expect("frozen v8 report JSON");
    assert_eq!(
        report["schemaVersion"],
        "maxpower-current-rust-equipment-fused-known-video-alignment/v1"
    );
    assert_eq!(
        report["protocol"]["modelConfiguration"]["assessmentCatalogId"],
        current_motion_assessment_catalog_v8().catalog_id
    );
    for key in [
        "truthRepCount",
        "predictedRepCount",
        "matchedRepCount",
        "candidatePrecision",
        "candidateRecall",
    ] {
        assert_eq!(report["aggregate"][key], asset["snapshot"][key]);
    }
    let sources = report["rows"]
        .as_array()
        .expect("v8 rows")
        .iter()
        .flat_map(|row| row["predictedReps"].as_array().expect("predicted reps"))
        .fold(BTreeMap::<&str, usize>::new(), |mut counts, rep| {
            *counts
                .entry(
                    rep["turnaroundSource"]
                        .as_str()
                        .expect("typed turnaround source"),
                )
                .or_default() += 1;
            counts
        });
    assert_eq!(sources.get("equipment_fused"), Some(&56));
    assert_eq!(sources.get("pose_primary"), Some(&379));
    assert_eq!(
        sources.get("equipment_fused").copied(),
        asset["snapshot"]["equipmentFusedTurnaroundCount"]
            .as_u64()
            .map(|count| count as usize)
    );
}

#[test]
fn frozen_v9_wrist_constrained_report_resolves_to_governed_immutable_evidence() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("MaxPower root")
        .to_path_buf();
    let governance_root = root
        .parent()
        .expect("power workspace")
        .join("maxpower-training-data-governance");
    let governance: serde_json::Value = serde_json::from_slice(
        &std::fs::read(governance_root.join("catalog/assets.json")).expect("governance catalog"),
    )
    .expect("governance JSON");
    let asset = governance["assets"]
        .as_array()
        .expect("governance assets")
        .iter()
        .find(|asset| asset["id"] == "current-rust-v9-wrist-constrained-equipment-alignment-report")
        .expect("v9 report asset is governed");
    assert_eq!(asset["admission"], "evaluation_only");
    assert_eq!(asset["authority"], "frozen_prediction_or_report");
    assert!(asset["forbiddenUses"].as_array().is_some_and(|uses| {
        uses.iter()
            .any(|use_id| use_id == "held_out_accuracy_claim")
    }));

    let report_bytes =
        std::fs::read(root.join(asset["location"]["path"].as_str().expect("v9 report path")))
            .expect("frozen v9 report");
    assert_eq!(
        sha256_bytes(&report_bytes),
        asset["location"]["sha256"]
            .as_str()
            .expect("report SHA-256")
    );
    let report: serde_json::Value =
        serde_json::from_slice(&report_bytes).expect("frozen v9 report JSON");
    assert_eq!(
        report["schemaVersion"],
        "maxpower-current-rust-wrist-constrained-equipment-alignment/v1"
    );
    assert_eq!(
        report["protocol"]["modelConfiguration"]["assessmentCatalogId"],
        current_motion_assessment_catalog_v9().catalog_id
    );
    for key in [
        "truthRepCount",
        "predictedRepCount",
        "matchedRepCount",
        "candidatePrecision",
        "candidateRecall",
        "strictBoundaryAlignedRate",
    ] {
        assert_eq!(report["aggregate"][key], asset["snapshot"][key]);
    }
    assert_eq!(
        report["turnaroundEvaluation"]["rigidBarPredictedRepCount"],
        asset["snapshot"]["rigidBarPredictedRepCount"]
    );
    assert_eq!(
        report["turnaroundEvaluation"]["equipmentFusedTurnaroundCount"],
        asset["snapshot"]["equipmentFusedTurnaroundCount"]
    );
    assert_eq!(
        report["equipmentProvider"]["trackerOutputFrameCount"],
        asset["snapshot"]["equipmentTrackerOutputFrameCount"]
    );
    assert_eq!(
        report["equipmentProvider"]["canonicalObservationFrameCount"],
        asset["snapshot"]["equipmentCanonicalObservationFrameCount"]
    );

    let screenshot_row = report["rows"]
        .as_array()
        .expect("v9 rows")
        .iter()
        .find(|row| row["sourceCaptureId"] == "field-capture-2026-08-02T18-34-19-006Z")
        .expect("reported screenshot capture");
    let screenshot_frame = screenshot_row["equipmentProvider"]["frames"]
        .as_array()
        .expect("equipment frames")
        .iter()
        .find(|frame| frame["frameNumber"] == 313)
        .expect("reported screenshot frame");
    assert_eq!(screenshot_frame["canonicalAccepted"], true);
    assert_eq!(screenshot_frame["fusionEligible"], false);
}

#[test]
fn frozen_v10_grip_validated_report_resolves_to_governed_immutable_evidence() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("MaxPower root")
        .to_path_buf();
    let governance_root = root
        .parent()
        .expect("power workspace")
        .join("maxpower-training-data-governance");
    let governance: serde_json::Value = serde_json::from_slice(
        &std::fs::read(governance_root.join("catalog/assets.json")).expect("governance catalog"),
    )
    .expect("governance JSON");
    let asset = governance["assets"]
        .as_array()
        .expect("governance assets")
        .iter()
        .find(|asset| asset["id"] == "current-rust-v10-grip-validated-equipment-alignment-report")
        .expect("v10 report asset is governed");
    assert_eq!(asset["admission"], "evaluation_only");
    assert_eq!(asset["authority"], "frozen_prediction_or_report");

    let report_bytes =
        std::fs::read(root.join(asset["location"]["path"].as_str().expect("v10 report path")))
            .expect("frozen v10 report");
    assert_eq!(
        sha256_bytes(&report_bytes),
        asset["location"]["sha256"]
            .as_str()
            .expect("report SHA-256")
    );
    let report: serde_json::Value =
        serde_json::from_slice(&report_bytes).expect("frozen v10 report JSON");
    assert_eq!(
        report["schemaVersion"],
        "maxpower-current-rust-grip-validated-equipment-alignment/v1"
    );
    assert_eq!(
        report["protocol"]["modelConfiguration"]["assessmentCatalogId"],
        current_motion_assessment_catalog_v10().catalog_id
    );
    for key in [
        "truthRepCount",
        "predictedRepCount",
        "matchedRepCount",
        "candidatePrecision",
        "candidateRecall",
        "strictBoundaryAlignedRate",
    ] {
        assert_eq!(report["aggregate"][key], asset["snapshot"][key]);
    }
    assert_eq!(
        report["turnaroundEvaluation"]["equipmentFusedTurnaroundCount"],
        asset["snapshot"]["equipmentFusedTurnaroundCount"]
    );

    let row = report["rows"]
        .as_array()
        .expect("v10 rows")
        .iter()
        .find(|row| row["sourceCaptureId"] == "field-capture-2026-08-02T18-26-54-722Z")
        .expect("reported barbell-row screenshot capture");
    assert_eq!(row["truthCount"], 10);
    assert_eq!(row["predictedCount"], 10);
    assert_eq!(row["matchedCount"], 10);
    let frames = row["equipmentProvider"]["frames"]
        .as_array()
        .expect("equipment frames");
    for frame_number in [201, 396] {
        let frame = frames
            .iter()
            .find(|frame| frame["frameNumber"] == frame_number)
            .expect("reported screenshot frame");
        assert_eq!(frame["canonicalAccepted"], true);
        assert_eq!(frame["fusionEligible"], true);
        let span = frame["x2"].as_f64().expect("axis x2") - frame["x1"].as_f64().expect("axis x1");
        assert!(
            span < 0.5,
            "grip-supported axis must not expose a global-frame edge extent"
        );
    }
}

#[test]
#[ignore = "requires the local-private governed v11 per-capture report"]
fn frozen_v11_multirate_report_resolves_to_governed_immutable_evidence() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("MaxPower root")
        .to_path_buf();
    let governance: serde_json::Value = serde_json::from_slice(
        &std::fs::read(
            root.parent()
                .expect("power workspace")
                .join("maxpower-training-data-governance/catalog/assets.json"),
        )
        .expect("governance catalog"),
    )
    .expect("governance JSON");
    let asset = governance["assets"]
        .as_array()
        .expect("governance assets")
        .iter()
        .find(|asset| asset["id"] == "current-rust-v11-multirate-equipment-alignment-report")
        .expect("v11 report asset is governed");
    assert_eq!(asset["admission"], "evaluation_only");
    let report_bytes =
        std::fs::read(root.join(asset["location"]["path"].as_str().expect("v11 report path")))
            .expect("frozen v11 report");
    assert_eq!(
        sha256_bytes(&report_bytes),
        asset["location"]["sha256"]
            .as_str()
            .expect("report SHA-256")
    );
    let report: serde_json::Value =
        serde_json::from_slice(&report_bytes).expect("frozen v11 report JSON");
    assert_eq!(
        report["schemaVersion"],
        "maxpower-current-rust-multirate-equipment-alignment/v1"
    );
    assert_eq!(
        report["protocol"]["modelConfiguration"]["assessmentCatalogId"],
        current_motion_assessment_catalog_v11().catalog_id
    );
    for key in [
        "truthRepCount",
        "predictedRepCount",
        "matchedRepCount",
        "candidatePrecision",
        "candidateRecall",
        "strictBoundaryAlignedRate",
    ] {
        assert_eq!(report["aggregate"][key], asset["snapshot"][key]);
    }
    let row = report["rows"]
        .as_array()
        .expect("v11 rows")
        .iter()
        .find(|row| row["sourceCaptureId"] == "field-capture-2026-08-02T18-26-54-722Z")
        .expect("target barbell-row capture");
    assert_eq!(row["truthCount"], 10);
    assert_eq!(row["predictedCount"], 10);
    assert_eq!(row["matchedCount"], 10);
    assert_eq!(
        row["equipmentProvider"]["poseInputRateHz"],
        asset["snapshot"]["targetPoseInputRateHz"]
    );
    assert_eq!(
        row["equipmentProvider"]["visualProcessingRateHz"],
        asset["snapshot"]["targetVisualProcessingRateHz"]
    );
    assert_eq!(
        row["equipmentProvider"]["trackerOutputRateHz"],
        asset["snapshot"]["targetTrackerOutputRateHz"]
    );
    assert!(
        row["equipmentProvider"]["trackerOutputRateHz"]
            .as_f64()
            .is_some_and(|rate| rate >= 29.0)
    );
    let frames = row["equipmentProvider"]["frames"]
        .as_array()
        .expect("equipment frames");
    for frame_number in [201, 396] {
        let frame = frames
            .iter()
            .find(|frame| frame["frameNumber"] == frame_number)
            .expect("reported screenshot frame");
        assert_eq!(frame["providerAccepted"], true);
        assert_eq!(frame["canonicalAccepted"], true);
        assert_eq!(frame["fusionEligible"], true);
        let span = frame["x2"].as_f64().expect("axis x2") - frame["x1"].as_f64().expect("axis x1");
        assert!(span < 0.5);
    }
}

#[test]
fn action_specific_baseline_freezes_every_action_view_without_claiming_missing_truth() {
    let baseline: serde_json::Value = serde_json::from_slice(include_bytes!(
        "fixtures/action_specific_motion_regression_baseline_v1.json"
    ))
    .expect("frozen action-specific baseline");
    assert_eq!(
        baseline["source"]["immutableSha256"],
        "39c4f0adbb6577e91318bfba944b066e93240a35ffa528daedfe8d64d3346928"
    );
    assert_eq!(baseline["source"]["admission"], "evaluation_only");
    assert_eq!(baseline["source"]["groupKey"], "sourceCaptureId");
    assert_eq!(baseline["aggregate"]["recordCount"], 53);
    assert_eq!(baseline["aggregate"]["truthRepCount"], 455);
    assert_eq!(
        baseline["aggregate"]["candidatePrecision"],
        0.871264367816092
    );
    assert_eq!(baseline["aggregate"]["candidateRecall"], 0.832967032967033);
    assert_eq!(
        baseline["exactAction"]
            .as_object()
            .expect("action matrix")
            .len(),
        12
    );
    assert_eq!(
        baseline["exactActionView"]
            .as_object()
            .expect("action-view matrix")
            .len(),
        24
    );
    for task in [
        "phaseAndTurnaround",
        "rawEquipmentGeometry",
        "subjectAssociation",
        "gripEstablishmentAndRelease",
        "qualityVerdicts",
        "traceConclusions",
    ] {
        assert_eq!(baseline["accuracyStatus"][task], "not_evaluable");
    }
}

const EVALUATION_CANDIDATE_MINIMUM_INTERVAL_IOU: f64 = 0.10;
const EVALUATION_CANDIDATE_BOUNDARY_TOLERANCE_MS: i64 = 1_500;
const EVALUATION_STRICT_MINIMUM_INTERVAL_IOU: f64 = 0.60;
const EVALUATION_STRICT_BOUNDARY_TOLERANCE_MS: i64 = 500;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EvaluationRange {
    start_ms: u64,
    end_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EvaluationPredictionRep {
    rep_id: u64,
    disposition: String,
    start_ms: u64,
    turnaround_ms: u64,
    turnaround_source: String,
    end_ms: u64,
    canonical_slice_hash: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GovernedPredictionRow {
    source_capture_id: String,
    context_id: String,
    exercise_id: String,
    capture_position: String,
    bundle_id: String,
    bundle_hash: String,
    trace_content_hash: String,
    trace_root_count: usize,
    equipment_provider: EquipmentProviderEvaluation,
    reps: Vec<EvaluationPredictionRep>,
    quality_finding_states: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EvaluationMatch {
    truth_index: usize,
    predicted_index: usize,
    start_error_ms: i64,
    end_error_ms: i64,
    interval_iou: f64,
    strict_boundary_aligned: bool,
}

#[derive(Clone, Debug)]
struct AlignmentSolution {
    matches: Vec<EvaluationMatch>,
    total_iou: f64,
    total_boundary_error_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EvaluatedReplayRow {
    source_capture_id: String,
    context_id: String,
    exercise_id: String,
    capture_position: String,
    bundle_id: String,
    bundle_hash: String,
    trace_content_hash: String,
    trace_root_count: usize,
    equipment_provider: EquipmentProviderEvaluation,
    truth_ranges: Vec<EvaluationRange>,
    predicted_reps: Vec<EvaluationPredictionRep>,
    truth_count: usize,
    predicted_count: usize,
    matched_count: usize,
    false_positive_count: usize,
    missed_count: usize,
    exact_set: bool,
    strict_boundary_aligned_count: usize,
    exact_set_and_all_boundaries_aligned: bool,
    reviewed_negative_window_false_trigger_count: usize,
    matches: Vec<EvaluationMatch>,
    quality_finding_states: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct EquipmentProviderEvaluation {
    recognition_mode: String,
    source_asset_id: Option<String>,
    pose_input_frame_count: usize,
    pose_input_rate_hz: f64,
    decoded_frame_count: usize,
    visual_processed_frame_count: usize,
    visual_processing_rate_hz: f64,
    tracker_output_frame_count: usize,
    tracker_output_rate_hz: f64,
    canonical_observation_frame_count: usize,
    measured_frame_count: usize,
    predicted_frame_count: usize,
    pose_fused_frame_count: usize,
    frames: Vec<EquipmentFramePrediction>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EquipmentFramePrediction {
    frame_number: u64,
    timestamp_ms: u64,
    source: String,
    confidence: f32,
    uncertainty_px: f32,
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    center_y: f32,
    provider_accepted: bool,
    canonical_accepted: bool,
    fusion_eligible: bool,
}

fn governed_pose_candidates(frame: &serde_json::Value) -> Vec<PoseCandidate> {
    let Some(landmarks) = frame["landmarks"]
        .as_array()
        .filter(|landmarks| landmarks.len() == 26)
    else {
        return Vec::new();
    };
    let bbox = &frame["selectedBbox"];
    let Some((((x, y), width), height)) = bbox["x"]
        .as_f64()
        .zip(bbox["y"].as_f64())
        .zip(bbox["width"].as_f64())
        .zip(bbox["height"].as_f64())
    else {
        return Vec::new();
    };
    let observations = landmarks
        .iter()
        .map(|landmark| {
            Some(PoseObservation::new(
                landmark["x"].as_f64()? as f32,
                landmark["y"].as_f64()? as f32,
                landmark["z"].as_f64().unwrap_or(0.0) as f32,
                landmark["visibility"].as_f64()? as f32,
            ))
        })
        .collect::<Option<Vec<_>>>();
    observations.map_or_else(Vec::new, |observations| {
        vec![PoseCandidate {
            id: 7,
            bbox: NormalizedRect::new(x as f32, y as f32, width as f32, height as f32),
            observations,
            torso_color: [0.2, 0.3, 0.4],
        }]
    })
}

fn governed_frames_with_equipment_provider(
    raw: &serde_json::Value,
    recognition_mode: AssessmentEquipmentRecognitionMode,
    video_path: Option<&Path>,
) -> (
    VecDeque<FrameObservations>,
    Vec<u64>,
    Vec<u64>,
    EquipmentProviderEvaluation,
) {
    let raw_frames = raw["frames"].as_array().expect("pose frames");
    let duration_seconds = raw["source"]["durationMs"]
        .as_f64()
        .expect("source duration")
        / 1_000.0;
    let mut evaluation = EquipmentProviderEvaluation {
        recognition_mode: format!("{recognition_mode:?}"),
        source_asset_id: video_path.map(|_| "personal-raw-capture-archive".into()),
        pose_input_frame_count: raw_frames.len(),
        pose_input_rate_hz: raw_frames.len() as f64 / duration_seconds,
        ..EquipmentProviderEvaluation::default()
    };
    if !recognition_mode.requires_visual_frame() {
        let mut frame_ids = Vec::with_capacity(raw_frames.len());
        let mut timestamps = Vec::with_capacity(raw_frames.len());
        let mut frames = VecDeque::with_capacity(raw_frames.len());
        for frame in raw_frames {
            frame_ids.push(frame["frameNumber"].as_u64().expect("frame number"));
            timestamps.push(frame["timestampMs"].as_f64().expect("timestamp").round() as u64);
            frames.push_back(FrameObservations {
                pose_candidates: governed_pose_candidates(frame),
                equipment: Vec::new(),
            });
        }
        return (frames, frame_ids, timestamps, evaluation);
    }

    let video_path = video_path.expect("the frozen rigid-bar source video");
    let source_width = raw["source"]["widthPx"].as_u64().expect("pose width") as usize;
    let source_height = raw["source"]["heightPx"].as_u64().expect("pose height") as usize;
    let width = 360_usize.min(source_width);
    let height = ((source_height * width / source_width + 1) / 2) * 2;
    let last_frame_id = raw_frames
        .last()
        .and_then(|frame| frame["frameNumber"].as_u64())
        .expect("last governed frame");
    let video_timestamps = governed_video_frame_timestamps_ms(video_path);
    assert!(
        video_timestamps.len() > last_frame_id as usize,
        "video timestamps end before governed pose frames"
    );
    let frame_limit = last_frame_id.saturating_add(1).to_string();
    let mut child = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(video_path)
        .args([
            "-an",
            "-vf",
            &format!("scale={width}:{height}"),
            "-pix_fmt",
            "gray",
            "-frames:v",
            &frame_limit,
            "-f",
            "rawvideo",
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .spawn()
        .unwrap_or_else(|error| panic!("decode {}: {error}", video_path.display()));
    let mut stdout = child.stdout.take().expect("ffmpeg stdout");
    let mut pixels = vec![0_u8; width * height];
    let mut tracker = BarbellAxisVisualTracker::default();
    let mut pose_index = 0_usize;
    let mut latest_pose = Vec::<PoseCandidate>::new();
    let mut latest_pose_timestamp_ms = 0_u64;
    let mut previous_published_timestamp_ms = None::<u64>;
    let mut latest_axis = None;
    let mut latest_axis_timestamp_ms = 0_u64;
    let mut frame_ids = Vec::with_capacity(raw_frames.len());
    let mut timestamps = Vec::with_capacity(raw_frames.len());
    let mut frames = VecDeque::with_capacity(raw_frames.len());
    for frame_id in 0..=last_frame_id {
        stdout
            .read_exact(&mut pixels)
            .unwrap_or_else(|error| panic!("video ended before frame {frame_id}: {error}"));
        evaluation.decoded_frame_count += 1;
        let video_timestamp_ms = video_timestamps[frame_id as usize];
        let pose_frame = raw_frames
            .get(pose_index)
            .filter(|frame| frame["frameNumber"].as_u64().expect("pose frame number") == frame_id);
        let pose_candidates = pose_frame.map_or_else(Vec::new, governed_pose_candidates);
        if pose_frame.is_some() {
            latest_pose.clone_from(&pose_candidates);
            latest_pose_timestamp_ms = pose_frame
                .and_then(|frame| frame["timestampMs"].as_f64())
                .expect("pose timestamp")
                .round() as u64;
            pose_index += 1;
        }
        let axis = if previous_published_timestamp_ms
            .is_some_and(|previous| video_timestamp_ms <= previous)
        {
            None
        } else {
            previous_published_timestamp_ms = Some(video_timestamp_ms);
            evaluation.visual_processed_frame_count += 1;
            let tracker_pose = if video_timestamp_ms.saturating_sub(latest_pose_timestamp_ms) <= 180
            {
                latest_pose.as_slice()
            } else {
                &[]
            };
            tracker
                .process(
                    PoseSchemaId::Halpe26,
                    &pixels,
                    width,
                    height,
                    video_timestamp_ms,
                    tracker_pose,
                )
                .expect("Halpe26 multi-rate visual equipment provider")
        };
        if let Some(axis) = axis {
            latest_axis = Some(axis);
            latest_axis_timestamp_ms = video_timestamp_ms;
            evaluation.tracker_output_frame_count += 1;
            match axis.source {
                BarbellAxisSource::Measured => {
                    evaluation.measured_frame_count += 1;
                    evaluation.canonical_observation_frame_count += 1;
                }
                BarbellAxisSource::Predicted => {
                    evaluation.predicted_frame_count += 1;
                    evaluation.canonical_observation_frame_count += 1;
                }
                BarbellAxisSource::Fused => evaluation.pose_fused_frame_count += 1,
            }
            evaluation.frames.push(EquipmentFramePrediction {
                frame_number: frame_id,
                timestamp_ms: video_timestamp_ms,
                source: format!("{:?}", axis.source),
                confidence: axis.confidence,
                uncertainty_px: axis.uncertainty_px,
                x1: axis.x1,
                y1: axis.y1,
                x2: axis.x2,
                y2: axis.y2,
                center_y: axis.center_y,
                provider_accepted: true,
                canonical_accepted: false,
                fusion_eligible: false,
            });
        }
        if let Some(pose_frame) = pose_frame {
            let pose_timestamp_ms = pose_frame["timestampMs"]
                .as_f64()
                .expect("pose timestamp")
                .round() as u64;
            let equipment = axis
                .or_else(|| {
                    (pose_timestamp_ms.saturating_sub(latest_axis_timestamp_ms) <= 180)
                        .then_some(latest_axis)
                        .flatten()
                })
                .and_then(|axis| axis.equipment_observation())
                .into_iter()
                .collect();
            frame_ids.push(frame_id);
            timestamps.push(pose_timestamp_ms);
            frames.push_back(FrameObservations {
                pose_candidates,
                equipment,
            });
        }
    }
    drop(stdout);
    let status = child.wait().expect("wait for video decoder");
    assert!(status.success(), "video decoder failed: {status}");
    assert_eq!(
        pose_index,
        raw_frames.len(),
        "every pose frame must be consumed"
    );
    evaluation.visual_processing_rate_hz =
        evaluation.visual_processed_frame_count as f64 / duration_seconds;
    evaluation.tracker_output_rate_hz =
        evaluation.tracker_output_frame_count as f64 / duration_seconds;
    (frames, frame_ids, timestamps, evaluation)
}

fn governed_video_frame_timestamps_ms(video_path: &Path) -> Vec<u64> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "frame=best_effort_timestamp_time",
            "-of",
            "csv=p=0",
        ])
        .arg(video_path)
        .output()
        .unwrap_or_else(|error| panic!("inspect {} timestamps: {error}", video_path.display()));
    assert!(output.status.success(), "video timestamp inspection failed");
    let timestamps = String::from_utf8(output.stdout)
        .expect("UTF-8 video timestamps")
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            (line.trim().parse::<f64>().expect("finite video timestamp") * 1_000.0).round() as u64
        })
        .collect::<Vec<_>>();
    timestamps
}

#[test]
#[ignore = "requires governed local-private Halpe26 observation and raw video assets"]
fn governed_barbell_row_multirate_provider_processes_video_cadence_without_pose_duplication() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("MaxPower root")
        .to_path_buf();
    let capture_id = "field-capture-2026-08-02T18-26-54-722Z";
    let raw = read_governed_gzip_json(&root.join(format!(
        "data/workflows/action-trajectory-database/halpe26-v1/personal-observations/{capture_id}.halpe26.json.gz"
    )));
    let video = root.join(format!(
        "public/archives/confirmed-captures/{capture_id}.webm"
    ));
    let (frames, frame_ids, timestamps, evaluation) = governed_frames_with_equipment_provider(
        &raw,
        AssessmentEquipmentRecognitionMode::RustVisualRigidBarAxis,
        Some(&video),
    );
    assert!(timestamps.windows(2).all(|pair| pair[1] > pair[0]));
    assert!(frame_ids.windows(2).all(|pair| pair[1] > pair[0]));
    let published_pose_frames = frames
        .iter()
        .filter(|frame| !frame.pose_candidates.is_empty())
        .count();
    assert!(
        published_pose_frames <= evaluation.pose_input_frame_count,
        "intermediate equipment frames must not duplicate pose observations"
    );
    assert!(evaluation.visual_processing_rate_hz >= 20.0);
    assert!(evaluation.tracker_output_rate_hz >= 15.0);
    eprintln!(
        "target multi-rate provider: pose={:.1}Hz visual={:.1}Hz tracker={:.1}Hz decoded={} processed={} outputs={}",
        evaluation.pose_input_rate_hz,
        evaluation.visual_processing_rate_hz,
        evaluation.tracker_output_rate_hz,
        evaluation.decoded_frame_count,
        evaluation.visual_processed_frame_count,
        evaluation.tracker_output_frame_count,
    );
}

fn evaluation_interval_iou(left: &EvaluationRange, right: &EvaluationRange) -> f64 {
    let intersection = left
        .end_ms
        .min(right.end_ms)
        .saturating_sub(left.start_ms.max(right.start_ms));
    let union = left.end_ms.max(right.end_ms) - left.start_ms.min(right.start_ms);
    if union == 0 {
        0.0
    } else {
        intersection as f64 / union as f64
    }
}

fn better_alignment(left: AlignmentSolution, right: AlignmentSolution) -> AlignmentSolution {
    if left.matches.len() != right.matches.len() {
        return if left.matches.len() > right.matches.len() {
            left
        } else {
            right
        };
    }
    if (left.total_iou - right.total_iou).abs() > 1e-12 {
        return if left.total_iou > right.total_iou {
            left
        } else {
            right
        };
    }
    if left.total_boundary_error_ms <= right.total_boundary_error_ms {
        left
    } else {
        right
    }
}

fn monotonic_evaluation_matches(
    truth: &[EvaluationRange],
    predicted: &[EvaluationRange],
) -> Vec<EvaluationMatch> {
    fn solve(
        truth: &[EvaluationRange],
        predicted: &[EvaluationRange],
        truth_index: usize,
        predicted_index: usize,
        memo: &mut BTreeMap<(usize, usize), AlignmentSolution>,
    ) -> AlignmentSolution {
        if let Some(cached) = memo.get(&(truth_index, predicted_index)) {
            return cached.clone();
        }
        if truth_index >= truth.len() || predicted_index >= predicted.len() {
            return AlignmentSolution {
                matches: Vec::new(),
                total_iou: 0.0,
                total_boundary_error_ms: 0,
            };
        }
        let mut best = better_alignment(
            solve(truth, predicted, truth_index + 1, predicted_index, memo),
            solve(truth, predicted, truth_index, predicted_index + 1, memo),
        );
        let expected = &truth[truth_index];
        let actual = &predicted[predicted_index];
        let interval_iou = evaluation_interval_iou(expected, actual);
        let start_error_ms = actual.start_ms as i64 - expected.start_ms as i64;
        let end_error_ms = actual.end_ms as i64 - expected.end_ms as i64;
        let within_candidate_boundary_tolerance = start_error_ms.abs()
            <= EVALUATION_CANDIDATE_BOUNDARY_TOLERANCE_MS
            && end_error_ms.abs() <= EVALUATION_CANDIDATE_BOUNDARY_TOLERANCE_MS;
        if interval_iou >= EVALUATION_CANDIDATE_MINIMUM_INTERVAL_IOU
            || within_candidate_boundary_tolerance
        {
            let remainder = solve(truth, predicted, truth_index + 1, predicted_index + 1, memo);
            let strict_boundary_aligned = interval_iou >= EVALUATION_STRICT_MINIMUM_INTERVAL_IOU
                && start_error_ms.abs() <= EVALUATION_STRICT_BOUNDARY_TOLERANCE_MS
                && end_error_ms.abs() <= EVALUATION_STRICT_BOUNDARY_TOLERANCE_MS;
            let boundary_error = start_error_ms.unsigned_abs() + end_error_ms.unsigned_abs();
            let mut matches = Vec::with_capacity(remainder.matches.len() + 1);
            matches.push(EvaluationMatch {
                truth_index,
                predicted_index,
                start_error_ms,
                end_error_ms,
                interval_iou,
                strict_boundary_aligned,
            });
            matches.extend(remainder.matches);
            best = better_alignment(
                best,
                AlignmentSolution {
                    matches,
                    total_iou: interval_iou + remainder.total_iou,
                    total_boundary_error_ms: boundary_error + remainder.total_boundary_error_ms,
                },
            );
        }
        memo.insert((truth_index, predicted_index), best.clone());
        best
    }

    solve(truth, predicted, 0, 0, &mut BTreeMap::new()).matches
}

fn evaluation_summary(rows: &[EvaluatedReplayRow]) -> serde_json::Value {
    let truth_count = rows.iter().map(|row| row.truth_count).sum::<usize>();
    let predicted_count = rows.iter().map(|row| row.predicted_count).sum::<usize>();
    let matched_count = rows.iter().map(|row| row.matched_count).sum::<usize>();
    let strict_boundary_aligned_count = rows
        .iter()
        .map(|row| row.strict_boundary_aligned_count)
        .sum::<usize>();
    let negative_false_triggers = rows
        .iter()
        .map(|row| row.reviewed_negative_window_false_trigger_count)
        .sum::<usize>();
    let matches = rows
        .iter()
        .flat_map(|row| row.matches.iter())
        .collect::<Vec<_>>();
    let mean = |values: Vec<f64>| {
        if values.is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::json!(values.iter().sum::<f64>() / values.len() as f64)
        }
    };
    let ratio = |numerator: usize, denominator: usize| {
        if denominator == 0 {
            serde_json::Value::Null
        } else {
            serde_json::json!(numerator as f64 / denominator as f64)
        }
    };
    serde_json::json!({
        "recordCount": rows.len(),
        "truthRepCount": truth_count,
        "predictedRepCount": predicted_count,
        "matchedRepCount": matched_count,
        "falsePositiveCount": predicted_count.saturating_sub(matched_count),
        "missedCount": truth_count.saturating_sub(matched_count),
        "candidatePrecision": ratio(matched_count, predicted_count),
        "candidateRecall": ratio(matched_count, truth_count),
        "exactSetRecordCount": rows.iter().filter(|row| row.exact_set).count(),
        "exactSetRate": ratio(rows.iter().filter(|row| row.exact_set).count(), rows.len()),
        "strictBoundaryAlignedRepCount": strict_boundary_aligned_count,
        "strictBoundaryAlignedRate": ratio(strict_boundary_aligned_count, truth_count),
        "exactSetAndAllBoundariesAlignedRecordCount": rows.iter().filter(|row| row.exact_set_and_all_boundaries_aligned).count(),
        "exactSetAndAllBoundariesAlignedRate": ratio(rows.iter().filter(|row| row.exact_set_and_all_boundaries_aligned).count(), rows.len()),
        "matchedStartMaeMs": mean(matches.iter().map(|entry| entry.start_error_ms.unsigned_abs() as f64).collect()),
        "matchedEndMaeMs": mean(matches.iter().map(|entry| entry.end_error_ms.unsigned_abs() as f64).collect()),
        "matchedMeanIntervalIoU": mean(matches.iter().map(|entry| entry.interval_iou).collect()),
        "reviewedNegativeWindowFalseTriggerCount": negative_false_triggers,
    })
}

fn evaluation_buckets(
    rows: &[EvaluatedReplayRow],
    key_for: impl Fn(&EvaluatedReplayRow) -> String,
) -> serde_json::Value {
    let mut grouped = BTreeMap::<String, Vec<EvaluatedReplayRow>>::new();
    for row in rows {
        grouped.entry(key_for(row)).or_default().push(row.clone());
    }
    serde_json::Value::Object(
        grouped
            .into_iter()
            .map(|(key, bucket_rows)| (key, evaluation_summary(&bucket_rows)))
            .collect(),
    )
}

#[test]
fn known_video_alignment_keeps_candidate_and_strict_boundary_metrics_distinct() {
    let truth = vec![EvaluationRange {
        start_ms: 1_000,
        end_ms: 3_000,
    }];
    let candidate_only = vec![EvaluationRange {
        start_ms: 1_700,
        end_ms: 3_700,
    }];
    let matches = monotonic_evaluation_matches(&truth, &candidate_only);
    assert_eq!(matches.len(), 1);
    assert!(!matches[0].strict_boundary_aligned);

    let strictly_aligned = vec![EvaluationRange {
        start_ms: 1_200,
        end_ms: 3_200,
    }];
    let matches = monotonic_evaluation_matches(&truth, &strictly_aligned);
    assert_eq!(matches.len(), 1);
    assert!(matches[0].strict_boundary_aligned);
}

#[test]
#[ignore = "requires governed local-private Halpe26 observation assets"]
fn governed_real_replays_cover_every_current_action_view() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("MaxPower root")
        .to_path_buf();
    let governance_root = root
        .parent()
        .expect("power workspace")
        .join("maxpower-training-data-governance");
    let governance: serde_json::Value = serde_json::from_slice(
        &std::fs::read(governance_root.join("catalog/assets.json")).expect("governance catalog"),
    )
    .expect("governance JSON");
    let replay_manifest_bytes =
        include_bytes!("fixtures/all_action_governed_replay_manifest_v1.json");
    let replay_manifest: serde_json::Value =
        serde_json::from_slice(replay_manifest_bytes).expect("versioned governed replay manifest");
    let mut evaluation_protocol: serde_json::Value = serde_json::from_slice(include_bytes!(
        "fixtures/current_v7_known_video_alignment_protocol_v1.json"
    ))
    .expect("versioned known-video alignment protocol");
    evaluation_protocol["evaluationId"] =
        serde_json::json!("current-rust-v11-multirate-equipment-alignment-2026-08-15");
    evaluation_protocol["protocol"]["modelConfiguration"]["assessmentCatalogId"] =
        serde_json::json!(current_motion_assessment_catalog_v11().catalog_id);
    evaluation_protocol["protocol"]["modelConfiguration"]["repBoundaryAuthority"] =
        serde_json::json!("pose_cycle_wrist_constrained_equipment_turnaround_fused");
    evaluation_protocol["protocol"]["output"]["path"] = serde_json::json!(
        "docs/reports/current-rust-v11-multirate-equipment-alignment-2026-08-15.json"
    );
    evaluation_protocol["protocol"]["output"]["schemaVersion"] =
        serde_json::json!("maxpower-current-rust-multirate-equipment-alignment/v1");
    evaluation_protocol["protocolSha256"] = serde_json::json!(sha256_bytes(
        &serde_json::to_vec(&evaluation_protocol["protocol"])
            .expect("stable equipment-fused evaluation protocol"),
    ));
    let rigid_bar_video_manifest_bytes = include_bytes!("fixtures/rigid_bar_video_sources_v1.json");
    let rigid_bar_video_manifest: serde_json::Value =
        serde_json::from_slice(rigid_bar_video_manifest_bytes)
            .expect("versioned rigid-bar source manifest");
    assert_eq!(
        replay_manifest["schemaVersion"],
        "maxpower-governed-replay-manifest/v1"
    );
    let assembled_input = &replay_manifest["assembledInput"];
    assert_eq!(
        sha256_bytes(&serde_json::to_vec(assembled_input).expect("stable replay input")),
        replay_manifest["assembledInputSha256"]
            .as_str()
            .expect("assembled input hash")
    );
    assert_eq!(
        assembled_input["modelConfiguration"]["assessmentCatalogId"],
        current_motion_assessment_catalog_v7().catalog_id
    );
    assert_eq!(
        rigid_bar_video_manifest["schemaVersion"],
        "maxpower-rigid-bar-video-source-manifest/v1"
    );
    assert_eq!(
        sha256_bytes(rigid_bar_video_manifest_bytes),
        assembled_input["equipmentVideoSourceManifest"]["sha256"]
            .as_str()
            .expect("rigid-bar source manifest hash")
    );
    assert_eq!(
        evaluation_protocol["schemaVersion"],
        "maxpower-known-video-alignment-protocol/v1"
    );
    let evaluation_rules = &evaluation_protocol["protocol"];
    assert_eq!(
        sha256_bytes(&serde_json::to_vec(evaluation_rules).expect("stable evaluation protocol")),
        evaluation_protocol["protocolSha256"]
            .as_str()
            .expect("evaluation protocol hash")
    );
    assert_eq!(
        sha256_bytes(replay_manifest_bytes),
        evaluation_rules["replayManifest"]["sha256"]
            .as_str()
            .expect("replay manifest hash")
    );
    assert_eq!(
        evaluation_rules["replayManifest"]["assembledInputSha256"],
        replay_manifest["assembledInputSha256"]
    );
    assert_eq!(
        evaluation_rules["modelConfiguration"]["assessmentCatalogId"],
        current_motion_assessment_catalog_v11().catalog_id
    );
    assert_eq!(
        evaluation_rules["matchingPolicy"]["minimumIntervalIoU"],
        EVALUATION_CANDIDATE_MINIMUM_INTERVAL_IOU
    );
    assert_eq!(
        evaluation_rules["matchingPolicy"]["candidateBoundaryToleranceMs"],
        EVALUATION_CANDIDATE_BOUNDARY_TOLERANCE_MS
    );
    assert_eq!(
        evaluation_rules["matchingPolicy"]["strictMinimumIntervalIoU"],
        EVALUATION_STRICT_MINIMUM_INTERVAL_IOU
    );
    assert_eq!(
        evaluation_rules["matchingPolicy"]["strictStartEndToleranceMs"],
        EVALUATION_STRICT_BOUNDARY_TOLERANCE_MS
    );
    let assets = governance["assets"].as_array().expect("assets");
    let governed_asset = |asset_id: &str| {
        assets
            .iter()
            .find(|asset| asset["id"] == asset_id)
            .expect("governed asset resolves by ID")
    };
    let label_asset = governed_asset("personal-human-rep-ranges-v2");
    let manifest_label_asset = assembled_input["sourceAssets"]
        .as_array()
        .expect("manifest assets")
        .iter()
        .find(|asset| asset["assetId"] == "personal-human-rep-ranges-v2")
        .expect("manifest label asset");
    assert_eq!(label_asset["admission"], "label_allowed");
    assert_eq!(label_asset["authority"], "user_reviewed");
    assert_eq!(label_asset["groupKey"], "sourceCaptureId");
    let allowed_label_tasks = label_asset["allowedTasks"]
        .as_array()
        .expect("allowed label tasks");
    assert!(
        manifest_label_asset["consumedForTasks"]
            .as_array()
            .expect("consumed label tasks")
            .iter()
            .all(|task| allowed_label_tasks.contains(task))
    );
    for field in manifest_label_asset["selectedFields"]
        .as_array()
        .expect("selected label fields")
    {
        let field = field.as_str().expect("field name");
        assert!(
            field == "sourceCaptureId"
                || label_asset["allowedSupervision"]
                    .as_array()
                    .is_some_and(|fields| fields.iter().any(|value| value == field)),
            "manifest selected an unauthorized label field: {field}"
        );
    }
    assert!(
        label_asset["allowedTasks"]
            .as_array()
            .is_some_and(|tasks| tasks.iter().any(|value| value == "rep_counting"))
    );
    for field in ["exerciseId", "capturePosition"] {
        assert!(
            label_asset["allowedSupervision"]
                .as_array()
                .is_some_and(|fields| fields.iter().any(|value| value == field))
        );
    }
    let evaluation_supervision = &evaluation_rules["humanSupervision"];
    assert_eq!(evaluation_supervision["assetId"], label_asset["id"]);
    assert!(
        evaluation_supervision["consumedForTasks"]
            .as_array()
            .expect("evaluation tasks")
            .iter()
            .all(|task| allowed_label_tasks.contains(task))
    );
    for field in evaluation_supervision["selectedFields"]
        .as_array()
        .expect("evaluation selected fields")
    {
        let field = field.as_str().expect("evaluation field name");
        assert!(
            field == "sourceCaptureId"
                || label_asset["allowedSupervision"]
                    .as_array()
                    .is_some_and(|fields| fields.iter().any(|value| value == field)),
            "evaluation selected an unauthorized label field: {field}"
        );
    }
    let pose_asset = governed_asset("personal-native-rtmpose-halpe26-observations");
    let manifest_pose_asset = assembled_input["sourceAssets"]
        .as_array()
        .expect("manifest assets")
        .iter()
        .find(|asset| asset["assetId"] == "personal-native-rtmpose-halpe26-observations")
        .expect("manifest pose asset");
    assert_eq!(pose_asset["admission"], "feature_only");
    assert_eq!(pose_asset["authority"], "model_generated");
    assert_eq!(pose_asset["groupKey"], "sourceCaptureId");
    let allowed_pose_tasks = pose_asset["allowedTasks"]
        .as_array()
        .expect("allowed pose tasks");
    assert!(
        manifest_pose_asset["consumedForTasks"]
            .as_array()
            .expect("consumed pose tasks")
            .iter()
            .all(|task| allowed_pose_tasks.contains(task))
    );
    assert!(
        pose_asset["allowedTasks"]
            .as_array()
            .is_some_and(|tasks| tasks.iter().any(|value| value == "runtime_parity"))
    );
    let raw_video_asset = governed_asset("personal-raw-capture-archive");
    let manifest_raw_video_asset = assembled_input["sourceAssets"]
        .as_array()
        .expect("manifest assets")
        .iter()
        .find(|asset| asset["assetId"] == "personal-raw-capture-archive")
        .expect("manifest raw video asset");
    assert_eq!(raw_video_asset["admission"], "immutable_source");
    assert_eq!(raw_video_asset["authority"], "user_source");
    assert_eq!(raw_video_asset["groupKey"], "sourceCaptureId");
    assert_eq!(rigid_bar_video_manifest["assetId"], raw_video_asset["id"]);
    assert_eq!(
        rigid_bar_video_manifest["admission"],
        raw_video_asset["admission"]
    );
    assert_eq!(
        rigid_bar_video_manifest["authority"],
        raw_video_asset["authority"]
    );
    assert_eq!(
        rigid_bar_video_manifest["groupKey"],
        raw_video_asset["groupKey"]
    );
    assert!(
        manifest_raw_video_asset["consumedForTasks"]
            .as_array()
            .expect("raw video tasks")
            .iter()
            .all(|task| raw_video_asset["allowedTasks"]
                .as_array()
                .expect("allowed raw video tasks")
                .contains(task))
    );
    assert_eq!(
        manifest_raw_video_asset["consumedForTasks"],
        serde_json::json!([rigid_bar_video_manifest["allowedTask"]])
    );

    let label_path = root.join(
        label_asset["location"]["path"]
            .as_str()
            .expect("label asset location"),
    );
    let hash_output = Command::new("shasum")
        .args(["-a", "256"])
        .arg(&label_path)
        .output()
        .expect("SHA-256 verifier is available");
    assert!(hash_output.status.success());
    let actual_label_hash = String::from_utf8(hash_output.stdout)
        .expect("hash output")
        .split_whitespace()
        .next()
        .expect("hash digest")
        .to_owned();
    assert_eq!(
        actual_label_hash,
        label_asset["location"]["sha256"]
            .as_str()
            .expect("immutable label hash")
    );
    let pose_root = root.join(
        pose_asset["location"]["path"]
            .as_str()
            .expect("pose asset location"),
    );
    assert_eq!(pose_asset["location"]["selector"], "*.halpe26.json.gz");
    assert_eq!(
        manifest_pose_asset["selector"],
        pose_asset["location"]["selector"]
    );
    let raw_video_root = root.join(
        raw_video_asset["location"]["path"]
            .as_str()
            .expect("raw video asset location"),
    );
    let rigid_bar_video_sources = rigid_bar_video_manifest["sources"]
        .as_array()
        .expect("frozen rigid-bar sources");
    assert_eq!(rigid_bar_video_sources.len(), 19);
    for source in rigid_bar_video_sources {
        let relative_path = Path::new(source["path"].as_str().expect("source video path"));
        assert!(!relative_path.is_absolute());
        assert!(
            !relative_path
                .components()
                .any(|component| matches!(component, std::path::Component::ParentDir))
        );
        let video_path = raw_video_root.join(relative_path);
        let hash_output = Command::new("shasum")
            .args(["-a", "256"])
            .arg(&video_path)
            .output()
            .unwrap_or_else(|error| panic!("hash {}: {error}", video_path.display()));
        assert!(hash_output.status.success());
        let actual_hash = String::from_utf8(hash_output.stdout)
            .expect("video hash output")
            .split_whitespace()
            .next()
            .expect("video digest")
            .to_owned();
        assert_eq!(actual_hash, source["sha256"]);
    }

    let exclusions_path = governance_root.join(
        assembled_input["exclusions"]["path"]
            .as_str()
            .expect("exclusions path"),
    );
    let exclusion_bytes = std::fs::read(&exclusions_path).expect("governance exclusions");
    assert_eq!(
        sha256_bytes(&exclusion_bytes),
        assembled_input["exclusions"]["sha256"]
            .as_str()
            .expect("exclusions hash")
    );
    let exclusions: serde_json::Value =
        serde_json::from_slice(&exclusion_bytes).expect("exclusions JSON");
    let applied_tasks = assembled_input["exclusions"]["appliedTasks"]
        .as_array()
        .expect("applied exclusion tasks");
    let declared_excluded_groups = assembled_input["exclusions"]["excludedSourceGroups"]
        .as_array()
        .expect("declared excluded groups");
    let replays = assembled_input["sourceGroups"]
        .as_array()
        .expect("frozen source groups");
    assert_eq!(replays.len(), 54, "every governed label record is frozen");
    assert_eq!(
        replays
            .iter()
            .map(|source| {
                (
                    source["exerciseId"].as_str().expect("exercise"),
                    source["capturePosition"].as_str().expect("view"),
                )
            })
            .collect::<HashSet<_>>()
            .len(),
        ALL_ACTION_CONTEXTS.len(),
        "54 records must cover the complete 24-context matrix",
    );
    for source_group in replays {
        assert_eq!(
            source_group["splitId"],
            "known-participant-known-video-regression"
        );
        let source_capture_id = source_group["sourceCaptureId"]
            .as_str()
            .expect("source group identity");
        let excluded_by_policy = exclusions["recordExclusions"]
            .as_array()
            .expect("record exclusions")
            .iter()
            .any(|exclusion| {
                exclusion["sourceCaptureId"] == source_capture_id
                    && exclusion["repIndex"].is_null()
                    && exclusion["tasks"]
                        .as_array()
                        .is_some_and(|tasks| tasks.iter().any(|task| applied_tasks.contains(task)))
            });
        let declared_excluded = declared_excluded_groups
            .iter()
            .any(|value| value == source_capture_id);
        assert_eq!(excluded_by_policy, declared_excluded);
    }

    let mut replayed_records = 0_usize;
    let mut records_with_non_rejected_rep = 0_usize;
    let mut records_with_boundary_alignment = 0_usize;
    let mut structural_gaps = Vec::new();
    let mut packet_count = 0_usize;
    let mut local_states = BTreeMap::<String, usize>::new();
    let mut pose_channel_frames = 0_usize;
    let mut equipment_channel_frames = 0_usize;
    let mut fusion_states = BTreeMap::<String, usize>::new();
    let mut dimension_states = BTreeMap::<String, usize>::new();
    let mut reference_kinds = BTreeMap::<String, usize>::new();
    let mut trace_complete_reports = 0_usize;
    let mut equipment_provider_requested_records = 0_usize;
    let mut equipment_provider_available_records = 0_usize;
    let mut equipment_provider_duration_ms = 0_f64;
    let mut equipment_provider_pose_input_frames = 0_usize;
    let mut equipment_provider_decoded_frames = 0_usize;
    let mut equipment_provider_visual_processed_frames = 0_usize;
    let mut equipment_provider_tracker_output_frames = 0_usize;
    let mut equipment_provider_canonical_observation_frames = 0_usize;
    let mut equipment_provider_measured_frames = 0_usize;
    let mut equipment_provider_predicted_frames = 0_usize;
    let mut equipment_provider_pose_fused_frames = 0_usize;
    let mut frozen_prediction_rows = Vec::<GovernedPredictionRow>::new();
    for (ordinal, source_group) in replays.iter().enumerate() {
        let action_id = source_group["exerciseId"].as_str().expect("exercise ID");
        let capture_position = source_group["capturePosition"]
            .as_str()
            .expect("capture position");
        let capture_id = source_group["sourceCaptureId"]
            .as_str()
            .expect("source capture ID");
        let capture_view = ALL_ACTION_CONTEXTS
            .iter()
            .find(|(expected_action, expected_position, _)| {
                *expected_action == action_id && *expected_position == capture_position
            })
            .map(|(_, _, view)| *view)
            .expect("manifest source group belongs to the supported matrix");
        if declared_excluded_groups
            .iter()
            .any(|value| value == capture_id)
        {
            let mut resolver = ExecutionAssessmentEngine::configure(
                current_motion_assessment_catalog_v11(),
                WorkoutAssessmentContext {
                    workout_session_id: format!("excluded-context-{ordinal}"),
                },
            )
            .expect("v7 catalog");
            let AssessmentEmission::LiveMotionFacts(facts) = resolver
                .advance(AssessmentEvent::SetStarted(SetExecutionContext {
                    set_id: format!("excluded-set-{ordinal}"),
                    set_ordinal: ordinal as u32 + 1,
                    video_context: video_context(action_id, capture_position),
                    intent: SetIntent::Working,
                    planned_load: None,
                    performed_load: None,
                }))
                .expect("excluded record still resolves its exact context")
            else {
                panic!("context resolution facts")
            };
            assert_eq!(
                facts
                    .resolved_context
                    .expect("resolved excluded context")
                    .bundle_capability,
                AssessmentBundleCapability::Executable
            );
            continue;
        }
        replayed_records += 1;
        let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
            current_motion_assessment_catalog_v11(),
            WorkoutAssessmentContext {
                workout_session_id: format!("governed-rigid-bar-{ordinal}"),
            },
        )
        .expect("v7 catalog");
        let mut context = video_context(action_id, capture_position);
        context.source_capture_id = capture_id.into();
        let AssessmentEmission::LiveMotionFacts(start_facts) = engine
            .advance(AssessmentEvent::SetStarted(SetExecutionContext {
                set_id: format!("governed-set-{ordinal}"),
                set_ordinal: 1,
                video_context: context,
                intent: SetIntent::Working,
                planned_load: None,
                performed_load: None,
            }))
            .expect("start replay")
        else {
            panic!("set start must publish the resolved provider context")
        };
        let recognition_mode = start_facts
            .resolved_context
            .expect("resolved equipment provider context")
            .equipment_recognition_mode;
        let video_source = if recognition_mode.requires_visual_frame() {
            equipment_provider_requested_records += 1;
            let source = rigid_bar_video_sources
                .iter()
                .find(|source| {
                    source["sourceCaptureId"] == capture_id
                        && source["exerciseId"] == action_id
                        && source["capturePosition"] == capture_position
                })
                .unwrap_or_else(|| {
                    panic!("missing frozen rigid-bar video for {capture_id}:{action_id}/{capture_position}")
                });
            equipment_provider_available_records += 1;
            Some(raw_video_root.join(source["path"].as_str().expect("source video path")))
        } else {
            None
        };
        let raw = read_governed_gzip_json(&pose_root.join(format!("{capture_id}.halpe26.json.gz")));
        let (frames, frame_ids, timestamps, mut equipment_provider) =
            governed_frames_with_equipment_provider(
                &raw,
                recognition_mode,
                video_source.as_deref(),
            );
        if recognition_mode.requires_visual_frame() {
            equipment_provider_duration_ms += raw["source"]["durationMs"]
                .as_f64()
                .expect("equipment source duration");
            equipment_provider_pose_input_frames += equipment_provider.pose_input_frame_count;
            equipment_provider_visual_processed_frames +=
                equipment_provider.visual_processed_frame_count;
        }
        equipment_provider_decoded_frames += equipment_provider.decoded_frame_count;
        equipment_provider_tracker_output_frames += equipment_provider.tracker_output_frame_count;
        equipment_provider_canonical_observation_frames +=
            equipment_provider.canonical_observation_frame_count;
        equipment_provider_measured_frames += equipment_provider.measured_frame_count;
        equipment_provider_predicted_frames += equipment_provider.predicted_frame_count;
        equipment_provider_pose_fused_frames += equipment_provider.pose_fused_frame_count;
        if recognition_mode.requires_visual_frame() {
            assert!(
                equipment_provider.canonical_observation_frame_count > 0,
                "Rust equipment provider emitted no independent observation for {capture_id}"
            );
        }
        let (profile, local_coordinate_strategy) =
            wrist_constrained_profile(action_id, capture_view);
        assert!(
            !profile.identity.is_empty(),
            "empty profile binding for {action_id}/{capture_position}"
        );
        let output = RecordingOutputAdapter::default();
        let mut session = MotionSession::open(
            SessionConfig {
                sequence_id: capture_id.into(),
                contract: ContractVersion {
                    major: 1,
                    minor: 10,
                },
                diagnostics: DiagnosticLevel::Full,
                image_width_px: raw["source"]["widthPx"].as_u64().expect("width") as u32,
                image_height_px: raw["source"]["heightPx"].as_u64().expect("height") as u32,
                continuity: maxpower_motion_sdk::ContinuityMode::Fusion,
                subject_policy: SubjectPolicy::AssumeSingle,
            },
            AdapterCapabilities::fixture(),
            RigidBarFixture { frames },
            output.clone(),
        )
        .expect("real replay session");
        session
            .install_exercise_profile_with_local_strategy(profile, local_coordinate_strategy)
            .unwrap_or_else(|error| panic!("profile {action_id}/{capture_position}: {error:?}"));
        session.begin_set();
        let releases = Arc::new(AtomicUsize::new(0));
        for (frame_id, timestamp_ms) in frame_ids.into_iter().zip(timestamps) {
            session
                .offer(FrameLease::fixture(
                    frame_id,
                    timestamp_ms,
                    Arc::clone(&releases),
                ))
                .expect("real frame");
        }
        let closure = session.finish_set_for_assessment();
        let packets = output.packets();
        for packet in &packets {
            let canonical_accepted = packet.equipment.tracks.iter().any(|track| {
                track.kind == EquipmentKind::BarbellShaft
                    && track.judgeable_path
                    && track.source != EquipmentSource::Predicted
            });
            let fusion_eligible = packet
                .equipment
                .tracks
                .iter()
                .any(|track| rigid_bar_track_supports_turnaround(track));
            if let Some(frame) = equipment_provider
                .frames
                .iter_mut()
                .find(|frame| frame.frame_number == packet.frame_id)
            {
                frame.canonical_accepted = canonical_accepted;
                frame.fusion_eligible = fusion_eligible;
            }
        }
        for packet in &packets {
            packet_count += 1;
            *local_states
                .entry(format!("{:?}", packet.local_motion_coordinate.state))
                .or_default() += 1;
            pose_channel_frames += usize::from(packet.local_motion_coordinate.pose.is_some());
            equipment_channel_frames +=
                usize::from(packet.local_motion_coordinate.equipment.is_some());
            *fusion_states
                .entry(format!(
                    "{:?}",
                    packet.local_motion_coordinate.channel_agreement
                ))
                .or_default() += 1;
        }
        for packet in packets {
            engine
                .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
                .expect("packet");
        }
        engine
            .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
                closure,
            )))
            .unwrap_or_else(|error| panic!("closure {action_id}/{capture_position}: {error:?}"));
        let AssessmentEmission::SealedSetAssessment(report) = engine
            .advance(AssessmentEvent::SetFinished)
            .expect("report")
        else {
            panic!("sealed report")
        };
        let recognized = report
            .reps
            .iter()
            .filter(|rep| rep.disposition != "rejected")
            .collect::<Vec<_>>();
        if !recognized.is_empty() {
            records_with_non_rejected_rep += 1;
        }
        assert_eq!(
            report.dimension_findings.len(),
            AssessmentDimension::ALL.len()
        );
        assert!(!report.trace.conclusion_root_ids.is_empty());
        for finding in &report.dimension_findings {
            *dimension_states
                .entry(format!("{:?}/{:?}", finding.dimension, finding.state))
                .or_default() += 1;
        }
        for comparison in report
            .rep_assessments
            .iter()
            .flat_map(|assessment| &assessment.comparisons)
        {
            *reference_kinds
                .entry(format!("{:?}", comparison.kind))
                .or_default() += 1;
        }
        let node_ids = report
            .trace
            .nodes
            .iter()
            .map(|node| node.node_id.as_str())
            .collect::<HashSet<_>>();
        let trace_complete = report.trace.conclusion_root_ids.len()
            == AssessmentDimension::ALL.len()
            && report
                .trace
                .conclusion_root_ids
                .iter()
                .all(|root| node_ids.contains(root.as_str()));
        assert!(
            trace_complete,
            "every set dimension needs a resolvable trace root"
        );
        let mut unhashed_trace = report.trace.clone();
        unhashed_trace.content_hash.clear();
        assert_eq!(
            stable_fnv_hash(&unhashed_trace),
            report.trace.content_hash,
            "sealed trace hash must reproduce from its immutable graph"
        );
        for root in &report.trace.conclusion_root_ids {
            let mut pending = vec![root.as_str()];
            let mut visited = HashSet::new();
            let mut kinds = Vec::new();
            while let Some(node_id) = pending.pop() {
                if !visited.insert(node_id) {
                    continue;
                }
                let node = report
                    .trace
                    .nodes
                    .iter()
                    .find(|node| node.node_id == node_id)
                    .expect("every trace input resolves");
                if !kinds.contains(&node.kind) {
                    kinds.push(node.kind);
                }
                pending.extend(node.input_node_ids.iter().map(String::as_str));
            }
            for required in [
                TraceNodeKind::SourceObservation,
                TraceNodeKind::LocalCoordinate,
                TraceNodeKind::PoseEquipmentFusion,
                TraceNodeKind::RepBoundary,
                TraceNodeKind::FeatureFact,
                TraceNodeKind::ReferenceComparison,
                TraceNodeKind::RuleConclusion,
                TraceNodeKind::SetPattern,
                TraceNodeKind::SetConclusion,
            ] {
                assert!(
                    kinds.contains(&required),
                    "root {root} is missing required {required:?} ancestry"
                );
            }
        }
        trace_complete_reports += 1;
        frozen_prediction_rows.push(GovernedPredictionRow {
            source_capture_id: capture_id.into(),
            context_id: format!("{capture_id}:{action_id}:{capture_position}"),
            exercise_id: action_id.into(),
            capture_position: capture_position.into(),
            bundle_id: report.bundle_id.clone(),
            bundle_hash: report.bundle_hash.clone(),
            trace_content_hash: report.trace.content_hash.clone(),
            trace_root_count: report.trace.conclusion_root_ids.len(),
            equipment_provider,
            reps: report
                .reps
                .iter()
                .map(|rep| EvaluationPredictionRep {
                    rep_id: rep.rep_id,
                    disposition: rep.disposition.clone(),
                    start_ms: rep.start_timestamp_ms,
                    turnaround_ms: rep.turnaround_timestamp_ms,
                    turnaround_source: rep.turnaround_source.clone(),
                    end_ms: rep.end_timestamp_ms,
                    canonical_slice_hash: rep.canonical_slice_hash.clone(),
                })
                .collect(),
            quality_finding_states: report
                .dimension_findings
                .iter()
                .map(|finding| format!("{:?}/{:?}", finding.dimension, finding.state))
                .collect(),
        });
    }

    // Freeze every runtime prediction before the human Rep ranges are loaded.
    // This prevents expectedCount or boundary truth from influencing inference,
    // while the protocol still classifies this corpus as known-video regression.
    let frozen_prediction_semantic = serde_json::json!({
        "schemaVersion": "maxpower-current-rust-known-video-predictions/v1",
        "state": "frozen_before_truth",
        "evaluationId": evaluation_protocol["evaluationId"],
        "protocolSha256": evaluation_protocol["protocolSha256"],
        "rows": &frozen_prediction_rows,
    });
    let prediction_sha256 = sha256_bytes(
        &serde_json::to_vec(&frozen_prediction_semantic).expect("frozen prediction bytes"),
    );

    let labels: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&label_path).expect("admitted label asset"))
            .expect("label JSON");
    let label_records = labels["records"].as_array().expect("label records");
    assert_eq!(replays.len(), label_records.len());
    let mut exact_context_keys = HashSet::new();
    for record in label_records {
        assert!(exact_context_keys.insert(format!(
            "{}:{}:{}",
            record["sourceCaptureId"].as_str().expect("label source"),
            record["exerciseId"].as_str().expect("label action"),
            record["capturePosition"].as_str().expect("label view")
        )));
    }

    let mut evaluated_rows = Vec::<EvaluatedReplayRow>::new();
    let mut evaluated_expected_rep_count = 0_usize;
    let mut reviewed_negative_window_count = 0_usize;
    for prediction in &frozen_prediction_rows {
        let label_record = label_records
            .iter()
            .find(|record| {
                record["sourceCaptureId"] == prediction.source_capture_id
                    && record["exerciseId"] == prediction.exercise_id
                    && record["capturePosition"] == prediction.capture_position
            })
            .expect("governed exact-context label");
        let truth_ranges = label_record["segments"]
            .as_array()
            .expect("human Rep ranges")
            .iter()
            .map(|segment| EvaluationRange {
                start_ms: segment["startMs"].as_u64().expect("truth start"),
                end_ms: segment["endMs"].as_u64().expect("truth end"),
            })
            .collect::<Vec<_>>();
        assert!(
            truth_ranges
                .windows(2)
                .all(|pair| pair[0].start_ms < pair[1].start_ms)
                && truth_ranges
                    .iter()
                    .all(|range| range.start_ms < range.end_ms),
            "invalid truth ranges for {}",
            prediction.context_id
        );
        let expected_count = label_record["expectedCount"]
            .as_u64()
            .expect("expected count") as usize;
        assert_eq!(
            expected_count,
            truth_ranges.len(),
            "admitted evaluation records must have complete Rep ranges"
        );
        evaluated_expected_rep_count += expected_count;
        let counted_reps = prediction
            .reps
            .iter()
            .filter(|rep| rep.disposition != "rejected")
            .cloned()
            .collect::<Vec<_>>();
        let predicted_ranges = counted_reps
            .iter()
            .map(|rep| EvaluationRange {
                start_ms: rep.start_ms,
                end_ms: rep.end_ms,
            })
            .collect::<Vec<_>>();
        let matches = monotonic_evaluation_matches(&truth_ranges, &predicted_ranges);
        let strict_boundary_aligned_count = matches
            .iter()
            .filter(|entry| entry.strict_boundary_aligned)
            .count();
        let negative_windows = label_record["reviewedNegativeWindows"]
            .as_array()
            .expect("reviewed negative windows");
        reviewed_negative_window_count += negative_windows.len();
        let negative_false_triggers = predicted_ranges
            .iter()
            .filter(|range| {
                let midpoint = range.start_ms + (range.end_ms - range.start_ms) / 2;
                negative_windows.iter().any(|window| {
                    let start = window["startMs"].as_u64().expect("negative start");
                    let end = window["endMs"].as_u64().expect("negative end");
                    assert!(start < end, "invalid reviewed negative window");
                    midpoint >= start && midpoint < end
                })
            })
            .count();

        let mut used_predictions = HashSet::new();
        let broad_boundary_aligned = truth_ranges
            .iter()
            .filter(|truth| {
                predicted_ranges
                    .iter()
                    .enumerate()
                    .any(|(index, predicted)| {
                        if used_predictions.contains(&index) {
                            return false;
                        }
                        let aligned = truth.start_ms.abs_diff(predicted.start_ms) <= 3_000
                            && truth.end_ms.abs_diff(predicted.end_ms) <= 1_500;
                        if aligned {
                            used_predictions.insert(index);
                        }
                        aligned
                    })
            })
            .count();
        if broad_boundary_aligned > 0 {
            records_with_boundary_alignment += 1;
        } else {
            structural_gaps.push(format!(
                "{}:{}/{}: non_rejected={}; expected={expected_count}",
                prediction.source_capture_id,
                prediction.exercise_id,
                prediction.capture_position,
                counted_reps.len()
            ));
        }

        let matched_count = matches.len();
        let exact_set = truth_ranges.len() == predicted_ranges.len();
        evaluated_rows.push(EvaluatedReplayRow {
            source_capture_id: prediction.source_capture_id.clone(),
            context_id: prediction.context_id.clone(),
            exercise_id: prediction.exercise_id.clone(),
            capture_position: prediction.capture_position.clone(),
            bundle_id: prediction.bundle_id.clone(),
            bundle_hash: prediction.bundle_hash.clone(),
            trace_content_hash: prediction.trace_content_hash.clone(),
            trace_root_count: prediction.trace_root_count,
            equipment_provider: prediction.equipment_provider.clone(),
            truth_count: truth_ranges.len(),
            predicted_count: predicted_ranges.len(),
            matched_count,
            false_positive_count: predicted_ranges.len().saturating_sub(matched_count),
            missed_count: truth_ranges.len().saturating_sub(matched_count),
            exact_set,
            strict_boundary_aligned_count,
            exact_set_and_all_boundaries_aligned: exact_set
                && strict_boundary_aligned_count == truth_ranges.len(),
            reviewed_negative_window_false_trigger_count: negative_false_triggers,
            truth_ranges,
            predicted_reps: counted_reps,
            matches,
            quality_finding_states: prediction.quality_finding_states.clone(),
        });
    }

    let evaluated_unique_source_count = evaluated_rows
        .iter()
        .map(|row| row.source_capture_id.as_str())
        .collect::<HashSet<_>>()
        .len();
    let rigid_bar_actions = [
        "barbell_bench_press",
        "barbell_row",
        "seated_shoulder_press",
    ];
    let predicted_rep_count = evaluated_rows
        .iter()
        .map(|row| row.predicted_reps.len())
        .sum::<usize>();
    let rigid_bar_predicted_rep_count = evaluated_rows
        .iter()
        .filter(|row| rigid_bar_actions.contains(&row.exercise_id.as_str()))
        .map(|row| row.predicted_reps.len())
        .sum::<usize>();
    let equipment_fused_turnaround_count = evaluated_rows
        .iter()
        .flat_map(|row| &row.predicted_reps)
        .filter(|rep| rep.turnaround_source == "equipment_fused")
        .count();
    let pose_primary_turnaround_count = predicted_rep_count - equipment_fused_turnaround_count;
    let turnaround_by_rigid_bar_action = rigid_bar_actions
        .into_iter()
        .map(|action_id| {
            let reps = evaluated_rows
                .iter()
                .filter(|row| row.exercise_id == action_id)
                .flat_map(|row| &row.predicted_reps)
                .collect::<Vec<_>>();
            let fused = reps
                .iter()
                .filter(|rep| rep.turnaround_source == "equipment_fused")
                .count();
            (
                action_id,
                serde_json::json!({
                    "predictedRepCount": reps.len(),
                    "equipmentFusedTurnaroundCount": fused,
                    "posePrimaryTurnaroundCount": reps.len() - fused,
                }),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let report_semantic = serde_json::json!({
        "schemaVersion": evaluation_rules["output"]["schemaVersion"],
        "generatedOn": "2026-08-15",
        "evaluationId": evaluation_protocol["evaluationId"],
        "evaluationStatus": "known_participant_known_video_regression",
        "generalizationClaimAllowed": false,
        "protocolSha256": evaluation_protocol["protocolSha256"],
        "predictionSha256": prediction_sha256,
        "protocol": evaluation_rules,
        "dataQuality": {
            "assetContractChecks": "passed",
            "labelRecordCount": label_records.len(),
            "resolvedRecordCount": replays.len(),
            "governanceExcludedRecordCount": declared_excluded_groups.len(),
            "evaluatedRecordCount": evaluated_rows.len(),
            "evaluatedUniqueSourceCaptureCount": evaluated_unique_source_count,
            "duplicateExactContextKeyCount": 0,
            "poseSidecarJoinCoverage": 1.0,
            "expectedRepCount": evaluated_expected_rep_count,
            "humanRangeCount": evaluated_rows.iter().map(|row| row.truth_count).sum::<usize>(),
            "reviewedNegativeWindowCount": reviewed_negative_window_count,
        },
        "aggregate": evaluation_summary(&evaluated_rows),
        "buckets": {
            "byAction": evaluation_buckets(&evaluated_rows, |row| row.exercise_id.clone()),
            "byView": evaluation_buckets(&evaluated_rows, |row| row.capture_position.clone()),
            "byActionView": evaluation_buckets(&evaluated_rows, |row| format!("{}|{}", row.exercise_id, row.capture_position)),
        },
        "structuralRuntime": {
            "packetCount": packet_count,
            "localStates": local_states,
            "poseChannelFrames": pose_channel_frames,
            "equipmentChannelFrames": equipment_channel_frames,
            "fusionStates": fusion_states,
            "dimensionStates": dimension_states,
            "referenceKinds": reference_kinds,
            "traceCompleteReportCount": trace_complete_reports,
        },
        "equipmentProvider": {
            "decisionAuthority": "ExecutionContract",
            "runtime": "maxpower_motion_sdk::BarbellAxisVisualTracker",
            "requestedRecordCount": equipment_provider_requested_records,
            "availableRecordCount": equipment_provider_available_records,
            "poseInputFrameCount": equipment_provider_pose_input_frames,
            "poseInputRateHz": equipment_provider_pose_input_frames as f64 / (equipment_provider_duration_ms / 1_000.0),
            "decodedFrameCount": equipment_provider_decoded_frames,
            "visualProcessedFrameCount": equipment_provider_visual_processed_frames,
            "visualProcessingRateHz": equipment_provider_visual_processed_frames as f64 / (equipment_provider_duration_ms / 1_000.0),
            "trackerOutputFrameCount": equipment_provider_tracker_output_frames,
            "trackerOutputRateHz": equipment_provider_tracker_output_frames as f64 / (equipment_provider_duration_ms / 1_000.0),
            "canonicalObservationFrameCount": equipment_provider_canonical_observation_frames,
            "measuredFrameCount": equipment_provider_measured_frames,
            "predictedFrameCount": equipment_provider_predicted_frames,
            "poseFusedFrameCount": equipment_provider_pose_fused_frames,
            "accuracyStatus": "not_evaluable_no_human_equipment_track_truth",
        },
        "turnaroundEvaluation": {
            "boundaryAuthority": "pose_cycle_wrist_constrained_equipment_turnaround_fused",
            "humanTurnaroundTruthCount": 0,
            "accuracyStatus": "not_evaluable_no_human_turnaround_truth",
            "predictedRepCount": predicted_rep_count,
            "rigidBarPredictedRepCount": rigid_bar_predicted_rep_count,
            "equipmentFusedTurnaroundCount": equipment_fused_turnaround_count,
            "posePrimaryTurnaroundCount": pose_primary_turnaround_count,
            "byRigidBarAction": turnaround_by_rigid_bar_action,
        },
        "unsupportedAccuracyClaims": {
            "equipmentTrackAccuracy": "not_evaluable_no_human_equipment_track_truth",
            "turnaroundAccuracy": "not_evaluable_no_human_turnaround_truth",
            "techniqueQualityAccuracy": "not_evaluable_no_human_quality_truth",
        },
        "rows": evaluated_rows,
    });
    let report_digest = sha256_bytes(
        &serde_json::to_vec(&report_semantic).expect("stable known-video evaluation report"),
    );
    let mut report_output = report_semantic;
    report_output
        .as_object_mut()
        .expect("evaluation report object")
        .insert("reportDigest".into(), serde_json::json!(report_digest));
    if let Ok(output_path) = std::env::var("MAXPOWER_GOVERNED_EVALUATION_OUTPUT") {
        let output_path = PathBuf::from(output_path);
        let output_path = if output_path.is_absolute() {
            output_path
        } else {
            root.join(output_path)
        };
        std::fs::write(
            &output_path,
            serde_json::to_vec_pretty(&report_output).expect("pretty evaluation JSON"),
        )
        .expect("write governed evaluation output");
    }
    eprintln!(
        "known-video alignment: {}",
        serde_json::to_string(&report_output["aggregate"]).expect("aggregate JSON")
    );
    eprintln!(
        "governed replay: resolved=54 replayed={replayed_records} non_rejected={} boundary_aligned={} gaps={:?}",
        records_with_non_rejected_rep, records_with_boundary_alignment, structural_gaps
    );
    eprintln!(
        "structural metrics: packets={packet_count} local_states={local_states:?} pose_channel_frames={pose_channel_frames} equipment_channel_frames={equipment_channel_frames} fusion_states={fusion_states:?} dimension_states={dimension_states:?} reference_kinds={reference_kinds:?} trace_complete_reports={trace_complete_reports} typed_refusals=0"
    );
    let expected: serde_json::Value = serde_json::from_slice(include_bytes!(
        "fixtures/multirate_v11_expected_structural_result_v1.json"
    ))
    .expect("frozen wrist-constrained v9 structural result");
    assert_eq!(replays.len() as u64, expected["resolvedRecordCount"]);
    assert_eq!(
        declared_excluded_groups.len() as u64,
        expected["governanceExcludedRecordCount"]
    );
    assert_eq!(replayed_records as u64, expected["replayedRecordCount"]);
    assert_eq!(
        records_with_non_rejected_rep as u64,
        expected["recordsWithNonRejectedRep"]
    );
    assert_eq!(
        records_with_boundary_alignment as u64,
        expected["recordsWithBoundaryAlignment"]
    );
    assert_eq!(packet_count as u64, expected["packetCount"]);
    assert_eq!(
        serde_json::to_value(&local_states).expect("local state metrics"),
        expected["localStates"]
    );
    assert_eq!(pose_channel_frames as u64, expected["poseChannelFrames"]);
    assert_eq!(
        equipment_channel_frames as u64,
        expected["equipmentChannelFrames"]
    );
    assert_eq!(
        serde_json::to_value(&fusion_states).expect("fusion state metrics"),
        expected["fusionStates"]
    );
    assert_eq!(
        serde_json::to_value(&dimension_states).expect("dimension state metrics"),
        expected["dimensionStates"]
    );
    assert_eq!(
        serde_json::to_value(&reference_kinds).expect("reference metrics"),
        expected["referenceKinds"]
    );
    assert_eq!(
        trace_complete_reports as u64,
        expected["traceCompleteReportCount"]
    );
    let expected_equipment = &expected["equipmentProvider"];
    assert_eq!(
        equipment_provider_requested_records as u64,
        expected_equipment["requestedRecordCount"]
    );
    assert_eq!(
        equipment_provider_available_records as u64,
        expected_equipment["availableRecordCount"]
    );
    assert_eq!(
        equipment_provider_decoded_frames as u64,
        expected_equipment["decodedFrameCount"]
    );
    assert_eq!(
        equipment_provider_tracker_output_frames as u64,
        expected_equipment["trackerOutputFrameCount"]
    );
    assert_eq!(
        equipment_provider_canonical_observation_frames as u64,
        expected_equipment["canonicalObservationFrameCount"]
    );
    assert_eq!(
        equipment_provider_measured_frames as u64,
        expected_equipment["measuredFrameCount"]
    );
    assert_eq!(
        equipment_provider_predicted_frames as u64,
        expected_equipment["predictedFrameCount"]
    );
    assert_eq!(
        equipment_provider_pose_fused_frames as u64,
        expected_equipment["poseFusedFrameCount"]
    );
    assert_eq!(expected["typedRefusalCount"], 0);
}

#[test]
fn every_current_rigid_bar_context_resolves_an_executable_action_specific_bundle() {
    let catalog = current_motion_assessment_catalog_v3();
    let profiles = current_rigid_bar_assessment_profiles_v1();
    assert_eq!(profiles.len(), RIGID_BAR_CONTEXTS.len());
    let mut bundle_ids = HashSet::new();
    let mut profile_ids = HashSet::new();

    for (ordinal, (action_id, capture_position, capture_view)) in
        RIGID_BAR_CONTEXTS.iter().enumerate()
    {
        let binding = profiles
            .iter()
            .find(|binding| {
                binding.action_id == *action_id && binding.capture_view == *capture_view
            })
            .expect("exact rigid-bar RecognitionProfile binding");
        assert!(profile_ids.insert(binding.profile.identity.clone()));

        let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
            catalog.clone(),
            WorkoutAssessmentContext {
                workout_session_id: format!("rigid-bar-{ordinal}"),
            },
        )
        .expect("v3 catalog");
        let AssessmentEmission::LiveMotionFacts(facts) = engine
            .advance(AssessmentEvent::SetStarted(SetExecutionContext {
                set_id: format!("set-{ordinal}"),
                set_ordinal: 1,
                video_context: video_context(action_id, capture_position),
                intent: SetIntent::Working,
                planned_load: None,
                performed_load: None,
            }))
            .expect("exact context starts")
        else {
            panic!("rigid-bar exact context must be executable");
        };
        let resolved = facts.resolved_context.expect("resolved context");
        assert_eq!(
            resolved.bundle_capability,
            AssessmentBundleCapability::Executable
        );
        assert!(bundle_ids.insert(resolved.bundle_id.clone()));

        let bundle = catalog
            .bundles
            .iter()
            .find(|bundle| bundle.bundle_id == resolved.bundle_id)
            .expect("resolved bundle");
        let recognition = catalog
            .installed_assets
            .iter()
            .find(|asset| asset.id == bundle.lineage.recognition_profile.id)
            .expect("RecognitionProfile asset");
        assert_eq!(
            recognition.content["runtimeProfileIdentity"],
            binding.profile.identity
        );
        assert_eq!(
            recognition.content["runtimeProfileHash"],
            format!("{:016x}", binding.profile.content_hash)
        );

        let execution = catalog
            .installed_assets
            .iter()
            .find(|asset| asset.id == bundle.lineage.execution_contract.id)
            .expect("ExecutionContract asset");
        let phase_order = execution.content["phaseOrder"]
            .as_array()
            .expect("phase order");
        let task_endpoints = execution.content["taskEndpoints"]
            .as_array()
            .expect("task endpoints");
        let (expected_phases, expected_endpoints) = match *action_id {
            "barbell_bench_press" => (
                ["lowering", "pressing"],
                [
                    "locked_out_start",
                    "visible_bottom_turnaround",
                    "returned_lockout",
                ],
            ),
            "barbell_row" => (
                ["pulling", "return_to_reach"],
                [
                    "arms_extended_start",
                    "bar_to_torso_turnaround",
                    "returned_reach",
                ],
            ),
            "seated_shoulder_press" => (
                ["lowering", "pressing"],
                [
                    "overhead_start",
                    "visible_bottom_turnaround",
                    "returned_overhead",
                ],
            ),
            _ => unreachable!("rigid-bar matrix is closed"),
        };
        assert_eq!(
            phase_order
                .iter()
                .map(|phase| phase.as_str().expect("phase name"))
                .collect::<Vec<_>>(),
            expected_phases
        );
        assert_eq!(
            task_endpoints
                .iter()
                .map(|endpoint| endpoint.as_str().expect("endpoint name"))
                .collect::<Vec<_>>(),
            expected_endpoints
        );
    }
}

#[test]
fn v8_rigid_bar_contracts_fuse_equipment_turnaround_in_the_action_direction() {
    let catalog = current_motion_assessment_catalog_v8();
    let profiles = equipment_fused_rigid_bar_assessment_profiles_v2();
    assert_eq!(profiles.len(), RIGID_BAR_CONTEXTS.len());
    for binding in profiles {
        assert!(
            binding
                .profile
                .state_machine_id
                .starts_with("cycle-aligned-equipment-turnaround-")
        );
        let expected_direction = if binding.action_id == "barbell_bench_press" {
            LocalActionAxisDirection::PreparationToEffortDown
        } else {
            LocalActionAxisDirection::PreparationToEffortUp
        };
        assert_eq!(
            binding.local_coordinate_strategy.preparation_to_effort,
            expected_direction
        );
        let bundle = catalog
            .bundles
            .iter()
            .find(|bundle| {
                bundle.exact_context.action_id == binding.action_id
                    && bundle.exact_context.capture_view == binding.capture_view
            })
            .expect("v8 exact rigid-bar bundle");
        let execution = catalog
            .installed_assets
            .iter()
            .find(|asset| asset.id == bundle.lineage.execution_contract.id)
            .expect("v8 ExecutionContract");
        assert_eq!(
            execution.content["repBoundaryAuthority"],
            "pose_cycle_equipment_turnaround_fused"
        );
        let recognition = catalog
            .installed_assets
            .iter()
            .find(|asset| asset.id == bundle.lineage.recognition_profile.id)
            .expect("v8 RecognitionProfile");
        assert_eq!(
            recognition.content["runtimeProfileHash"],
            format!("{:016x}", binding.profile.content_hash)
        );
    }
    ExecutionAssessmentEngine::configure(
        catalog,
        WorkoutAssessmentContext {
            workout_session_id: "v8-equipment-turnaround-fusion".into(),
        },
    )
    .expect("v8 catalog is executable");
}

#[test]
fn v9_rigid_bar_contracts_require_wrist_constrained_visual_equipment() {
    let catalog = current_motion_assessment_catalog_v9();
    for binding in wrist_constrained_rigid_bar_assessment_profiles_v3() {
        let bundle = catalog
            .bundles
            .iter()
            .find(|bundle| {
                bundle.exact_context.action_id == binding.action_id
                    && bundle.exact_context.capture_view == binding.capture_view
            })
            .expect("v9 exact rigid-bar bundle");
        let execution = catalog
            .installed_assets
            .iter()
            .find(|asset| asset.id == bundle.lineage.execution_contract.id)
            .expect("v9 ExecutionContract");
        assert_eq!(
            execution.content["equipmentConstraintPolicy"],
            "pose_guided_visual_axis_bilateral_wrist_required"
        );
    }
    ExecutionAssessmentEngine::configure(
        catalog,
        WorkoutAssessmentContext {
            workout_session_id: "v9-wrist-constrained-fusion".into(),
        },
    )
    .expect("v9 catalog is executable");
}

#[test]
fn v10_rigid_bar_contracts_pin_grip_validated_extent_and_one_eligibility_rule() {
    let catalog = current_motion_assessment_catalog_v10();
    for binding in wrist_constrained_rigid_bar_assessment_profiles_v3() {
        let bundle = catalog
            .bundles
            .iter()
            .find(|bundle| {
                bundle.exact_context.action_id == binding.action_id
                    && bundle.exact_context.capture_view == binding.capture_view
            })
            .expect("v10 exact rigid-bar bundle");
        let execution = catalog
            .installed_assets
            .iter()
            .find(|asset| asset.id == bundle.lineage.execution_contract.id)
            .expect("v10 ExecutionContract");
        assert_eq!(
            execution.content["axisExtentSemantics"],
            "validated_grip_supported_axis_not_physical_bar_length"
        );
        let adapter = catalog
            .installed_assets
            .iter()
            .find(|asset| asset.id == bundle.lineage.equipment_adapter.id)
            .expect("v10 EquipmentAdapter");
        assert_eq!(
            adapter.content["turnaroundEligibility"],
            "rigid_bar_track_supports_turnaround"
        );
    }
    ExecutionAssessmentEngine::configure(
        catalog,
        WorkoutAssessmentContext {
            workout_session_id: "v10-grip-validated-fusion".into(),
        },
    )
    .expect("v10 catalog is executable");
}

#[test]
fn v11_rigid_bar_contracts_process_video_at_camera_cadence_without_synthetic_pose() {
    let catalog = current_motion_assessment_catalog_v11();
    for binding in wrist_constrained_rigid_bar_assessment_profiles_v3() {
        let bundle = catalog
            .bundles
            .iter()
            .find(|bundle| {
                bundle.exact_context.action_id == binding.action_id
                    && bundle.exact_context.capture_view == binding.capture_view
            })
            .expect("v11 exact rigid-bar bundle");
        let adapter = catalog
            .installed_assets
            .iter()
            .find(|asset| asset.id == bundle.lineage.equipment_adapter.id)
            .expect("v11 EquipmentAdapter");
        assert_eq!(
            adapter.content["inputCadence"],
            "every_timestamped_video_frame"
        );
        assert_eq!(
            adapter.content["poseConstraintCadence"],
            "latest_causal_pose_max_age_180ms"
        );
        assert_eq!(
            adapter.content["intermediatePosePolicy"],
            "equipment_only_no_synthetic_pose_observation"
        );
    }
    ExecutionAssessmentEngine::configure(
        catalog,
        WorkoutAssessmentContext {
            workout_session_id: "v11-multirate-rigid-bar".into(),
        },
    )
    .expect("v11 catalog is executable");
}

#[test]
fn every_current_rigid_bar_context_produces_rep_quality_and_a_causal_trace() {
    for (ordinal, (action_id, capture_position, capture_view)) in
        RIGID_BAR_CONTEXTS.iter().enumerate()
    {
        let binding = current_rigid_bar_assessment_profiles_v1()
            .into_iter()
            .find(|binding| {
                binding.action_id == *action_id && binding.capture_view == *capture_view
            })
            .expect("profile binding");
        let source_capture_id = format!("fixture:rigid-bar:{ordinal}");
        let (packets, closure) = canonical_packets_for(&binding, &source_capture_id);
        assert!(
            packets
                .iter()
                .map(|packet| packet.completed_reps.len())
                .sum::<usize>()
                + closure.completed_rep_count()
                > 0,
            "{action_id}/{capture_position} must seal a Rep"
        );

        let mut engine = maxpower_motion_sdk::ExecutionAssessmentEngine::configure(
            current_motion_assessment_catalog_v3(),
            WorkoutAssessmentContext {
                workout_session_id: format!("rigid-bar-report-{ordinal}"),
            },
        )
        .expect("v3 catalog");
        let mut context = video_context(action_id, capture_position);
        context.source_capture_id = source_capture_id;
        engine
            .advance(AssessmentEvent::SetStarted(SetExecutionContext {
                set_id: format!("set-{ordinal}"),
                set_ordinal: 1,
                video_context: context,
                intent: SetIntent::Working,
                planned_load: None,
                performed_load: None,
            }))
            .expect("start exact context");
        for packet in packets {
            engine
                .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
                .expect("canonical packet");
        }
        engine
            .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
                closure,
            )))
            .expect("canonical closure");
        let AssessmentEmission::SealedSetAssessment(report) = engine
            .advance(AssessmentEvent::SetFinished)
            .expect("sealed report")
        else {
            panic!("expected sealed report")
        };
        assert!(!report.reps.is_empty());
        assert_eq!(report.rep_assessments.len(), report.reps.len());
        let first_features = &report.rep_assessments[0].features;
        for independent_channel in ["equipment_primary_excursion", "pose_primary_excursion"] {
            assert!(
                first_features.iter().any(|feature| {
                    feature.feature_id == independent_channel && feature.value.is_some()
                }),
                "{action_id}/{capture_position} must retain measured {independent_channel} evidence independently"
            );
        }
        assert_eq!(
            report.dimension_findings.len(),
            AssessmentDimension::ALL.len()
        );
        assert!(
            AssessmentDimension::ALL.iter().all(|dimension| report
                .dimension_findings
                .iter()
                .any(|finding| finding.dimension == *dimension)),
            "{action_id}/{capture_position} must classify or abstain every dimension"
        );
        let kinds = report
            .trace
            .nodes
            .iter()
            .map(|node| node.kind)
            .collect::<Vec<_>>();
        assert!(
            [
                TraceNodeKind::SourceObservation,
                TraceNodeKind::LocalCoordinate,
                TraceNodeKind::PoseEquipmentFusion,
                TraceNodeKind::RepBoundary,
                TraceNodeKind::FeatureFact,
                TraceNodeKind::ReferenceComparison,
                TraceNodeKind::RuleConclusion,
                TraceNodeKind::SetPattern,
                TraceNodeKind::SetConclusion,
            ]
            .into_iter()
            .all(|required| kinds.contains(&required)),
            "{action_id}/{capture_position} must preserve the complete causal route"
        );
    }
}

#[test]
fn v12_report_executes_the_bound_motion_plan_instead_of_wrist_proxy_semantics() {
    let binding = current_action_motion_assessment_profiles_v12()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::Front
        })
        .expect("v12 bench profile");
    let source_capture_id = "fixture:v12-motion-plan-runtime";
    let (packets, closure) = canonical_packets_for(&binding, source_capture_id);
    let mut engine = ExecutionAssessmentEngine::configure(
        current_motion_assessment_catalog_v12(),
        WorkoutAssessmentContext {
            workout_session_id: "v12-plan-runtime".into(),
        },
    )
    .expect("v12 catalog");
    let mut context = video_context("barbell_bench_press", "front");
    context.source_capture_id = source_capture_id.into();
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "v12-set".into(),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start set");
    for packet in packets {
        engine
            .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
            .expect("canonical packet");
    }
    engine
        .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
            closure,
        )))
        .expect("canonical closure");
    let AssessmentEmission::SealedSetAssessment(report) = engine
        .advance(AssessmentEvent::SetFinished)
        .expect("sealed report")
    else {
        panic!("sealed report")
    };
    assert!(
        report
            .resolved_context
            .observation_plan_hash
            .as_ref()
            .is_some_and(|hash| !hash.is_empty())
    );
    let assessment = report.rep_assessments.first().expect("sealed Rep");
    let primary = assessment
        .features
        .iter()
        .find(|feature| feature.feature_id == "motion_relation:task_primary")
        .expect("plan-generated TaskPrimary fact");
    assert!(
        primary.value.is_some(),
        "measured equipment drives the primary relation"
    );
    assert!(
        primary
            .provenance
            .iter()
            .any(|entry| entry.starts_with("action_observation_plan:"))
    );
    assert!(
        assessment.features.iter().any(|feature| {
            feature.feature_id == "motion_relation:torso_support_stability"
                && feature.status == maxpower_motion_sdk::MotionFeatureStatus::Observed
                && feature.value.is_some()
        }),
        "the plan-declared segment-angle operator executes on canonical pose evidence"
    );
    let task_rule = report
        .trace
        .nodes
        .iter()
        .find(|node| {
            node.kind == TraceNodeKind::RuleConclusion && node.node_id.contains("task_completion")
        })
        .expect("task completion rule");
    assert!(
        task_rule
            .input_node_ids
            .iter()
            .any(|node| node.contains("comparison:motion_relation:task_primary"))
    );
}

#[test]
fn an_external_action_asset_runs_the_real_set_lifecycle_without_a_rust_action_branch() {
    let external_catalog = ActionMotionCatalog::from_json(include_str!(
        "fixtures/asset_only_action_motion_catalog_v1.json"
    ))
    .expect("external action asset");
    let external_definition = external_catalog.definitions[0].clone();
    let plan = ActionMotionCompiler::new(OperatorRegistry::standard())
        .compile(&external_definition, "front_right_45")
        .expect("generic plan");
    let mut catalog = current_motion_assessment_catalog_v12();
    let template_bundle = catalog
        .bundles
        .iter()
        .find(|bundle| bundle.bundle_id == "barbell_bench_press/front-oblique-right/v1")
        .expect("rigid bar template")
        .clone();
    let template_definition = catalog
        .action_definitions
        .iter()
        .find(|definition| definition.action_id == "barbell_bench_press")
        .expect("action definition template")
        .clone();
    let mut bundle = template_bundle.clone();
    bundle.bundle_id = "asset_only_floor_press/front-oblique-right/v1".into();
    bundle.exact_context.action_id = "asset_only_floor_press".into();
    let semantic_assets = [
        (
            AssessmentAssetKind::RecognitionProfile,
            template_bundle.lineage.recognition_profile,
        ),
        (
            AssessmentAssetKind::ExecutionContract,
            template_bundle.lineage.execution_contract,
        ),
        (
            AssessmentAssetKind::FeatureProgram,
            template_bundle.lineage.feature_program,
        ),
        (
            AssessmentAssetKind::RulePack,
            template_bundle.lineage.rule_pack,
        ),
    ];
    for (kind, old_reference) in semantic_assets {
        let mut asset = catalog
            .installed_assets
            .iter()
            .find(|asset| asset.id == old_reference.id && asset.kind == kind)
            .expect("template semantic asset")
            .clone();
        asset.id = format!("{}/asset-only", asset.id);
        asset = asset.with_computed_hash();
        let reference = asset.reference();
        match kind {
            AssessmentAssetKind::RecognitionProfile => {
                bundle.lineage.recognition_profile = reference
            }
            AssessmentAssetKind::ExecutionContract => bundle.lineage.execution_contract = reference,
            AssessmentAssetKind::FeatureProgram => bundle.lineage.feature_program = reference,
            AssessmentAssetKind::RulePack => bundle.lineage.rule_pack = reference,
            _ => unreachable!(),
        }
        catalog.installed_assets.push(asset);
    }
    bundle = bundle.with_computed_hash();
    catalog.bundles.push(bundle);
    let mut action_definition = template_definition;
    action_definition.action_definition_id = "asset-only/floor-press/action-definition/v1".into();
    action_definition.action_id = "asset_only_floor_press".into();
    action_definition.supported_views = vec![ActionViewBinding {
        capture_view: AssessmentCaptureView::FrontObliqueRight,
        bundle_id: "asset_only_floor_press/front-oblique-right/v1".into(),
    }];
    action_definition = action_definition.with_computed_hash();
    catalog.action_definitions.push(action_definition);
    catalog
        .action_motion_catalog
        .as_mut()
        .expect("v12 motion catalog")
        .definitions
        .push(external_definition);
    catalog
        .action_motion_bindings
        .push(ActionMotionBundleBinding {
            bundle_id: "asset_only_floor_press/front-oblique-right/v1".into(),
            leaf_action_id: "asset_only_floor_press".into(),
        });
    let mut profile = wrist_constrained_rigid_bar_assessment_profiles_v3()
        .into_iter()
        .find(|binding| {
            binding.action_id == "barbell_bench_press"
                && binding.capture_view == AssessmentCaptureView::FrontObliqueRight
        })
        .expect("provider profile");
    profile.action_id = "asset_only_floor_press".into();
    profile.profile = bind_runtime_profile_to_action_plan(profile.profile, &plan);
    install_action_motion_runtime_profile(
        &mut catalog,
        "asset_only_floor_press/front-oblique-right/v1",
        &profile.profile,
        &plan,
    );
    install_compiled_action_motion_semantics(
        &mut catalog,
        "asset_only_floor_press/front-oblique-right/v1",
        &plan,
    );

    let source_capture_id = "fixture:external-asset-lifecycle";
    let (packets, closure) = canonical_packets_for(&profile, source_capture_id);
    let mut engine = ExecutionAssessmentEngine::configure(
        catalog,
        WorkoutAssessmentContext {
            workout_session_id: "external-asset-lifecycle".into(),
        },
    )
    .expect("external asset configures without a Rust action-name branch");
    let mut context = video_context("asset_only_floor_press", "frontRight45");
    context.source_capture_id = source_capture_id.into();
    engine
        .advance(AssessmentEvent::SetStarted(SetExecutionContext {
            set_id: "external-set".into(),
            set_ordinal: 1,
            video_context: context,
            intent: SetIntent::Working,
            planned_load: None,
            performed_load: None,
        }))
        .expect("start external set");
    for packet in packets {
        engine
            .advance(AssessmentEvent::CanonicalPacketObserved(Box::new(packet)))
            .expect("canonical packet");
    }
    engine
        .advance(AssessmentEvent::CanonicalSetClosureObserved(Box::new(
            closure,
        )))
        .expect("closure");
    let AssessmentEmission::SealedSetAssessment(report) = engine
        .advance(AssessmentEvent::SetFinished)
        .expect("sealed external report")
    else {
        panic!("sealed report")
    };
    assert_eq!(report.resolved_context.action_id, "asset_only_floor_press");
    assert!(!report.reps.is_empty());
    assert!(
        report.rep_assessments[0]
            .features
            .iter()
            .any(|feature| feature.feature_id == "motion_relation:load_press")
    );
    assert!(!report.trace.conclusion_root_ids.is_empty());
}
