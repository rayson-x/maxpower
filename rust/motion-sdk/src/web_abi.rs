use std::sync::{Mutex, OnceLock};

use serde::Deserialize;

use super::{
    CanonicalLandmark, ContinuityEngine, ContinuityMode, NormalizedRect, PoseCandidate,
    PoseObservation, SubjectPolicy, SubjectTracker, TargetSnapshot, TargetState,
};

#[derive(Default)]
struct WebRuntime {
    engine: Option<ContinuityEngine>,
    timestamp_ms: u64,
    observations: Vec<PoseObservation>,
    output: Vec<CanonicalLandmark>,
    candidates: Vec<PoseCandidate>,
    candidate_meta: Option<(u64, NormalizedRect, [f32; 3])>,
    subject_tracker: Option<SubjectTracker>,
    target: Option<TargetSnapshot>,
    subject_epoch: u64,
    scheduler: Option<super::InferenceScheduler>,
    frame_id: u64,
    rep_engine: Option<super::RepEngine>,
    rep_state: super::RepStateSnapshot,
    set_gate: super::SetGate,
    completed_reps: Vec<super::SealedRep>,
    pending_outcomes: Vec<super::SealedRep>,
    packet_bytes: Vec<u8>,
    sequence_id: String,
    sequence_buffer: Vec<u8>,
    profile_identity_buffer: Vec<u8>,
    reference_context_buffer: Vec<u8>,
    reference_profile_buffer: Vec<u8>,
    reference_profile: Option<super::ReferenceTrajectoryProfile>,
    reference_context: Option<super::ReferenceIdentity>,
    reference_exercise_profile_binding: Option<(String, u64)>,
    reference_state: ReferenceRuntimeState,
    simulated_baseline_buffer: Vec<u8>,
    simulated_baseline: Option<super::ReferenceTrajectoryProfile>,
    simulated_baseline_context: Option<super::ReferenceIdentity>,
    simulated_baseline_binding: Option<(String, u64)>,
    simulated_baseline_state: ReferenceRuntimeState,
    frame_history: Vec<super::CanonicalFrameSample>,
}

#[derive(Default)]
enum ReferenceRuntimeState {
    #[default]
    Unavailable,
    AwaitingSealedRep,
    ExtractionRefused,
    Evidence(super::TrajectoryMatchEvidence),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReferenceEnvelopeDto {
    profile: ReferenceProfileDto,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceProfileDto {
    schema_version: String,
    profile_status: String,
    identity: ReferenceIdentityDto,
    phase_model: ReferencePhaseModelDto,
    feature_names: Vec<String>,
    corridor: ReferenceCorridorDto,
    matching_policy: ReferenceMatchingPolicyDto,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceIdentityDto {
    exercise_id: String,
    capture_position: String,
    variation: String,
    training_side: String,
    equipment: String,
    coordinate_system: String,
    feature_schema_id: String,
    pose_model_version: String,
}

#[derive(Deserialize)]
struct ReferenceCorridorDto {
    nodes: Vec<ReferenceNodeDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceNodeDto {
    phase: String,
    phase_percent: f32,
    features: Vec<ReferencePointDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferencePointDto {
    q_low: Option<f32>,
    q_high: Option<f32>,
    median_absolute_deviation: Option<f32>,
    n_observed: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceMatchingPolicyDto {
    minimum_observation_confidence: f32,
    unrestricted_dtw_allowed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SimulatedBaselineEnvelopeDto {
    baseline: SimulatedBaselineDto,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SimulatedBaselineDto {
    schema_version: String,
    source: String,
    evidence_status: String,
    calibration_status: String,
    identity: ReferenceIdentityDto,
    profile_binding: SimulatedBaselineBindingDto,
    feature_names: Vec<String>,
    corridor: ReferenceCorridorDto,
    matching_policy: ReferenceMatchingPolicyDto,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SimulatedBaselineBindingDto {
    exercise_profile_identity: String,
    exercise_profile_hash: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferencePhaseModelDto {
    normalization: String,
    pull_nodes: u32,
    return_nodes: u32,
    unrestricted_dtw_allowed: bool,
}

impl From<ReferenceIdentityDto> for super::ReferenceIdentity {
    fn from(value: ReferenceIdentityDto) -> Self {
        Self {
            exercise_id: value.exercise_id,
            capture_position: value.capture_position,
            variation: value.variation,
            training_side: value.training_side,
            equipment: value.equipment,
            coordinate_system: value.coordinate_system,
            feature_schema_id: value.feature_schema_id,
            pose_model_version: value.pose_model_version,
        }
    }
}

static RUNTIME: OnceLock<Mutex<WebRuntime>> = OnceLock::new();

fn runtime() -> &'static Mutex<WebRuntime> {
    RUNTIME.get_or_init(|| Mutex::new(WebRuntime::default()))
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_close() -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    *runtime = WebRuntime::default();
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_begin_sequence(length: u32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if length == 0 || length > 256 {
        return -2;
    }
    runtime.sequence_buffer = vec![0; length as usize];
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_set_sequence_byte(index: u32, value: u32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let Some(slot) = runtime.sequence_buffer.get_mut(index as usize) else {
        return -2;
    };
    let Ok(value) = u8::try_from(value) else {
        return -3;
    };
    *slot = value;
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_commit_sequence() -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let Ok(sequence_id) = String::from_utf8(std::mem::take(&mut runtime.sequence_buffer)) else {
        return -2;
    };
    if sequence_id.trim().is_empty() {
        return -3;
    }
    runtime.sequence_id = sequence_id;
    0
}

/// Allocation-free numeric ABI used by the browser adapter. JavaScript owns
/// camera frames and MediaPipe; Rust owns continuity state and canonical data.
#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_reset(width: u32, height: u32, fusion: u32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if width == 0 || height == 0 {
        return -2;
    }
    runtime.engine = Some(ContinuityEngine::new(
        if fusion == 0 {
            ContinuityMode::Raw
        } else {
            ContinuityMode::Fusion
        },
        width,
        height,
    ));
    runtime.observations.clear();
    runtime.output.clear();
    runtime.candidates.clear();
    runtime.candidate_meta = None;
    runtime.subject_tracker = Some(SubjectTracker::new(SubjectPolicy::CentralStable));
    runtime.target = None;
    runtime.subject_epoch = 0;
    runtime.scheduler = Some(super::InferenceScheduler::new(500, 100));
    runtime.frame_id = 0;
    runtime.rep_engine = None;
    runtime.rep_state = super::RepStateSnapshot::default();
    runtime.set_gate = super::SetGate::default();
    runtime.completed_reps.clear();
    runtime.pending_outcomes.clear();
    runtime.packet_bytes.clear();
    runtime.reference_profile = None;
    runtime.reference_context_buffer.clear();
    runtime.reference_context = None;
    runtime.reference_exercise_profile_binding = None;
    runtime.reference_state = ReferenceRuntimeState::Unavailable;
    runtime.frame_history.clear();
    0
}

/// Crosses the single recording boundary into Rust. Preview frames remain
/// canonical/renderable, but their rep state machine stays idle.
#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_begin_set() -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if runtime.engine.is_none() {
        return -2;
    }
    runtime.set_gate.begin();
    if let Some(rep_engine) = runtime.rep_engine.as_mut() {
        rep_engine.abort_active();
        runtime.rep_state = rep_engine.state.clone();
    } else {
        runtime.rep_state = super::RepStateSnapshot::default();
    }
    runtime.completed_reps.clear();
    runtime.pending_outcomes.clear();
    runtime.frame_history.clear();
    reset_reference_subject(&mut runtime);
    encode_current_packet(&mut runtime);
    0
}

/// Offline fixtures and imported-replay tools intentionally opt into the
/// legacy always-active semantics. Product camera hosts must use begin_set.
#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_begin_replay_set() -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if runtime.engine.is_none() {
        return -2;
    }
    runtime.set_gate = super::SetGate::replay_active();
    0
}

/// Ends one recorded set without turning a partial last movement into a rep.
#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_finish_set() -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if runtime.engine.is_none() {
        return -2;
    }
    runtime.set_gate.finish();
    let terminal_outcome = runtime
        .rep_engine
        .as_mut()
        .and_then(|engine| engine.reject_active(super::RepEvidenceReason::IncompleteCycle, engine.previous));
    runtime.completed_reps = terminal_outcome.into_iter().collect();
    runtime.pending_outcomes.clear();
    runtime.rep_state = runtime
        .rep_engine
        .as_ref()
        .map_or_else(super::RepStateSnapshot::default, |engine| engine.state.clone());
    encode_current_packet(&mut runtime);
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_begin_frame(
    timestamp_low: u32,
    timestamp_high: u32,
    landmark_count: u32,
) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if runtime.engine.is_none() || landmark_count > 256 {
        return -2;
    }
    runtime.timestamp_ms = (u64::from(timestamp_high) << 32) | u64::from(timestamp_low);
    runtime.observations = vec![PoseObservation::new(0.0, 0.0, 0.0, 0.0); landmark_count as usize];
    runtime.output.clear();
    runtime.candidates.clear();
    runtime.candidate_meta = None;
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_set_landmark(
    index: u32,
    x: f32,
    y: f32,
    z: f32,
    visibility: f32,
) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let Some(slot) = runtime.observations.get_mut(index as usize) else {
        return -2;
    };
    *slot = PoseObservation::new(x, y, z, visibility);
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_process_frame() -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let timestamp_ms = runtime.timestamp_ms;
    let observations = runtime.observations.clone();
    let Some(engine) = runtime.engine.as_mut() else {
        return -2;
    };
    runtime.output = engine.process(&observations, timestamp_ms);
    runtime.target = Some(TargetSnapshot {
        state: TargetState::Locked,
        candidate_count: 1,
        selected_candidate_id: Some(0),
    });
    process_rep(&mut runtime);
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_begin_multi(timestamp_low: u32, timestamp_high: u32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if runtime.engine.is_none() || runtime.subject_tracker.is_none() {
        return -2;
    }
    runtime.timestamp_ms = (u64::from(timestamp_high) << 32) | u64::from(timestamp_low);
    runtime.observations.clear();
    runtime.output.clear();
    runtime.candidates.clear();
    runtime.candidate_meta = None;
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_begin_candidate(
    id_low: u32,
    id_high: u32,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    red: f32,
    green: f32,
    blue: f32,
    landmark_count: u32,
) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if landmark_count > 256 || runtime.candidate_meta.is_some() {
        return -2;
    }
    runtime.candidate_meta = Some((
        (u64::from(id_high) << 32) | u64::from(id_low),
        NormalizedRect::new(x, y, width, height),
        [red, green, blue],
    ));
    runtime.observations = vec![PoseObservation::new(0.0, 0.0, 0.0, 0.0); landmark_count as usize];
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_commit_candidate() -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let Some((id, bbox, torso_color)) = runtime.candidate_meta.take() else {
        return -2;
    };
    let observations = std::mem::take(&mut runtime.observations);
    runtime.candidates.push(PoseCandidate {
        id,
        bbox,
        observations,
        torso_color,
    });
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_process_multi() -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if runtime.candidate_meta.is_some() {
        return -2;
    }
    let candidates = std::mem::take(&mut runtime.candidates);
    let timestamp_ms = runtime.timestamp_ms;
    let (target, selected) = {
        let Some(tracker) = runtime.subject_tracker.as_mut() else {
            return -2;
        };
        tracker.update(candidates, timestamp_ms)
    };
    let identity_boundary = runtime
        .subject_tracker
        .as_mut()
        .is_some_and(super::SubjectTracker::take_identity_boundary);
    if identity_boundary {
        runtime.subject_epoch = runtime.subject_epoch.saturating_add(1);
        if let Some(engine) = runtime.engine.as_mut() {
            engine.reset();
        }
        let subject_change_outcome = runtime
            .rep_engine
            .as_mut()
            .and_then(super::RepEngine::reject_for_subject_change);
        runtime.pending_outcomes.extend(subject_change_outcome);
        reset_reference_subject(&mut runtime);
    }
    let landmark_count = runtime
        .subject_tracker
        .as_ref()
        .and_then(|tracker| {
            tracker
                .last_candidates
                .iter()
                .map(|candidate| candidate.observations.len())
                .max()
        })
        .unwrap_or(0);
    runtime.output = if let Some(selected) = selected {
        let Some(engine) = runtime.engine.as_mut() else {
            return -2;
        };
        engine.process(&selected.observations, timestamp_ms)
    } else {
        vec![CanonicalLandmark::unknown(0.0, None); landmark_count]
    };
    runtime.target = Some(target);
    process_rep(&mut runtime);
    0
}

fn process_rep(runtime: &mut WebRuntime) {
    runtime.completed_reps = std::mem::take(&mut runtime.pending_outcomes);
    if runtime.reference_profile.is_some() || runtime.simulated_baseline.is_some() {
        runtime.frame_history.push(super::CanonicalFrameSample {
            frame_id: runtime.frame_id,
            timestamp_ms: runtime.timestamp_ms,
            canonical: runtime.output.clone(),
        });
        if runtime.rep_state.phase == super::RepPhase::Ready && runtime.frame_history.len() > 2 {
            let remove = runtime.frame_history.len() - 2;
            runtime.frame_history.drain(..remove);
        } else {
            let history_floor = runtime.timestamp_ms.saturating_sub(30_000);
            let first_retained = runtime
                .frame_history
                .partition_point(|frame| frame.timestamp_ms < history_floor);
            if first_retained > 0 {
                runtime.frame_history.drain(..first_retained);
            }
        }
    } else {
        runtime.frame_history.clear();
    }
    let Some(target) = runtime.target.as_ref() else {
        return;
    };
    let rep_phase = runtime
        .rep_engine
        .as_ref()
        .map_or(super::RepPhase::Ready, |engine| engine.state.phase);
    let may_process_rep = runtime.set_gate.advance(
        runtime.rep_engine.as_ref().map(|engine| &engine.profile),
        target.state,
        &runtime.output,
        runtime.timestamp_ms,
        rep_phase,
    );
    if may_process_rep {
        if let Some(rep_engine) = runtime.rep_engine.as_mut() {
            runtime.completed_reps.extend(rep_engine.process(
                runtime.frame_id,
                runtime.timestamp_ms,
                target.state,
                &runtime.output,
            ));
            runtime.rep_state = rep_engine.state.clone();
        } else {
            runtime.rep_state = super::RepStateSnapshot::default();
        }
    } else {
        runtime.rep_state = runtime
            .rep_engine
            .as_ref()
            .map_or_else(super::RepStateSnapshot::default, |engine| engine.state.clone());
    }
    if let (Some(profile), Some(identity), Some((bound_identity, bound_hash)), Some(rep)) = (
        runtime.reference_profile.as_ref(),
        runtime.reference_context.as_ref(),
        runtime.reference_exercise_profile_binding.as_ref(),
        runtime
            .completed_reps
            .iter()
            .rev()
            .find(|rep| rep.disposition == super::RepDisposition::Confirmed),
    ) {
        runtime.reference_state =
            if rep.profile_identity != *bound_identity || rep.profile_hash != *bound_hash {
                ReferenceRuntimeState::ExtractionRefused
            } else {
                match super::extract_lat_pulldown_reference_rep(
                    identity.clone(),
                    rep,
                    &runtime.frame_history,
                ) {
                    Ok(observed) => ReferenceRuntimeState::Evidence(
                        super::match_reference_trajectory(profile, &observed),
                    ),
                    Err(_) => ReferenceRuntimeState::ExtractionRefused,
                }
            };
    }
    if let (Some(profile), Some(identity), Some((bound_identity, bound_hash)), Some(rep), Some(rep_engine)) = (
        runtime.simulated_baseline.as_ref(),
        runtime.simulated_baseline_context.as_ref(),
        runtime.simulated_baseline_binding.as_ref(),
        runtime
            .completed_reps
            .iter()
            .rev()
            .find(|rep| rep.disposition == super::RepDisposition::Confirmed),
        runtime.rep_engine.as_ref(),
    ) {
        runtime.simulated_baseline_state =
            if rep.profile_identity != *bound_identity || rep.profile_hash != *bound_hash {
                ReferenceRuntimeState::ExtractionRefused
            } else {
                match super::extract_profile_signal_reference_rep(
                    identity.clone(),
                    rep,
                    &rep_engine.profile,
                    &runtime.frame_history,
                ) {
                    Ok(observed) => ReferenceRuntimeState::Evidence(
                        super::match_reference_trajectory(profile, &observed),
                    ),
                    Err(_) => ReferenceRuntimeState::ExtractionRefused,
                }
            };
    }
    encode_current_packet(runtime);
    runtime.frame_id = runtime.frame_id.saturating_add(1);
}

fn encode_current_packet(runtime: &mut WebRuntime) {
    let Some(target) = runtime.target.clone() else {
        runtime.packet_bytes.clear();
        return;
    };
    let packet = super::MotionPacket {
        lineage: super::PacketLineage {
            sequence_id: runtime.sequence_id.clone(),
            contract: super::ContractVersion { major: 1, minor: 4 },
            algorithm_version: "rust-canonical-wasm/v1".into(),
            config_version: "web-motion-config/v1".into(),
            inference_version: "mediapipe-host-adapter/v1".into(),
            diagnostic_version: "web-motion-diagnostics/v1".into(),
            active_profile_identity: runtime
                .rep_engine
                .as_ref()
                .map(|engine| engine.profile.identity.clone()),
            active_profile_hash: runtime
                .rep_engine
                .as_ref()
                .map(|engine| engine.profile.content_hash),
        },
        frame_id: runtime.frame_id,
        source_timestamp_ms: runtime.timestamp_ms,
        subject_epoch: runtime.subject_epoch,
        target,
        canonical: runtime.output.clone(),
        set_state: runtime.set_gate.state.clone(),
        rep_state: runtime.rep_state.clone(),
        completed_reps: runtime.completed_reps.clone(),
    };
    runtime.packet_bytes = super::encode_motion_packet(&packet).unwrap_or_default();
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_packet_len() -> u32 {
    runtime()
        .lock()
        .map_or(0, |runtime| runtime.packet_bytes.len() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_packet_ptr() -> u32 {
    runtime()
        .lock()
        .map_or(0, |runtime| runtime.packet_bytes.as_ptr() as usize as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_set_profile(profile_code: u32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let profile = match profile_code {
        0 => None,
        1 => Some(super::ExerciseProfile::lat_pulldown_provisional()),
        2 => Some(super::ExerciseProfile::seated_shoulder_press_provisional()),
        3 => Some(super::ExerciseProfile::lat_pulldown_rear_left_45_provisional()),
        4 => Some(super::ExerciseProfile::seated_shoulder_press_front_provisional()),
        _ => return -2,
    };
    runtime.rep_engine = profile.map(super::RepEngine::new);
    runtime.rep_state = super::RepStateSnapshot::default();
    runtime.completed_reps.clear();
    runtime.pending_outcomes.clear();
    clear_reference(&mut runtime);
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_begin_profile_identity(length: u32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if length == 0 || length > 512 {
        return -2;
    }
    runtime.profile_identity_buffer = vec![0; length as usize];
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_set_profile_identity_byte(index: u32, value: u32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let Some(slot) = runtime.profile_identity_buffer.get_mut(index as usize) else {
        return -2;
    };
    let Ok(value) = u8::try_from(value) else {
        return -3;
    };
    *slot = value;
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_install_profile(
    hash_low: u32,
    hash_high: u32,
    maturity: u32,
    schema: u32,
    coordinate_unit: u32,
    state_machine: u32,
    required_capabilities: u32,
    direction: u32,
    primary_kind: u32,
    primary_0: u32,
    primary_1: u32,
    primary_2: u32,
    secondary_kind: u32,
    secondary_0: u32,
    secondary_1: u32,
    secondary_2: u32,
    start_amplitude: f32,
    min_primary_amplitude: f32,
    min_secondary_amplitude: f32,
    return_hysteresis: f32,
    ready_tolerance: f32,
    max_gap_ms: u32,
    min_rep_duration_ms: u32,
    max_rep_duration_ms: u32,
) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let Ok(identity) = String::from_utf8(std::mem::take(&mut runtime.profile_identity_buffer))
    else {
        return -4;
    };
    let maturity = match maturity {
        0 => super::ExerciseMaturity::Provisional,
        _ => return -5,
    };
    let schema = match schema {
        0 => super::PoseSchemaId::BlazePose33,
        _ => return -5,
    };
    let coordinate_unit = match coordinate_unit {
        0 => "image-normalized-y",
        1 => "image-angle-deg",
        2 => "torso-normalized-distance",
        3 => "derived-kinematic-signal",
        _ => return -5,
    };
    let state_machine_id = match state_machine {
        0 => "ready-effort-peak-return/v1",
        _ => return -5,
    };
    let direction = match direction {
        0 => super::MovementDirection::Increasing,
        1 => super::MovementDirection::Decreasing,
        2 => super::MovementDirection::Auto,
        _ => return -5,
    };
    let signal_kind = |code: u32| match code {
        0 => Some(super::ExerciseSignalKind::LandmarkY),
        1 => Some(super::ExerciseSignalKind::JointAngle),
        2 => Some(super::ExerciseSignalKind::LandmarkDistance),
        _ => None,
    };
    let joints = |first: u32, second: u32, third: u32| {
        [first, second, third]
            .into_iter()
            .filter(|value| *value != u32::MAX)
            .map(|value| value as usize)
            .collect::<Vec<_>>()
    };
    let (Some(primary_kind), Some(secondary_kind)) =
        (signal_kind(primary_kind), signal_kind(secondary_kind))
    else {
        return -5;
    };
    let profile = super::ExerciseProfile {
        identity,
        content_hash: (u64::from(hash_high) << 32) | u64::from(hash_low),
        maturity,
        schema,
        coordinate_unit: coordinate_unit.into(),
        state_machine_id: state_machine_id.into(),
        required_capabilities,
        primary_signal: super::ExerciseSignal {
            kind: primary_kind,
            landmarks: joints(primary_0, primary_1, primary_2),
        },
        secondary_signal: super::ExerciseSignal {
            kind: secondary_kind,
            landmarks: joints(secondary_0, secondary_1, secondary_2),
        },
        direction,
        start_amplitude,
        min_primary_amplitude,
        min_secondary_amplitude,
        return_hysteresis,
        ready_tolerance,
        max_gap_ms: u64::from(max_gap_ms),
        min_rep_duration_ms: u64::from(min_rep_duration_ms),
        max_rep_duration_ms: u64::from(max_rep_duration_ms),
    };
    if profile.validate().is_err() {
        return -6;
    }
    runtime.rep_engine = Some(super::RepEngine::new(profile));
    runtime.rep_state = super::RepStateSnapshot::default();
    runtime.completed_reps.clear();
    runtime.pending_outcomes.clear();
    clear_reference(&mut runtime);
    0
}

fn clear_reference(runtime: &mut WebRuntime) {
    runtime.reference_profile = None;
    runtime.reference_context_buffer.clear();
    runtime.reference_context = None;
    runtime.reference_exercise_profile_binding = None;
    runtime.reference_state = ReferenceRuntimeState::Unavailable;
    runtime.simulated_baseline_buffer.clear();
    runtime.simulated_baseline = None;
    runtime.simulated_baseline_context = None;
    runtime.simulated_baseline_binding = None;
    runtime.simulated_baseline_state = ReferenceRuntimeState::Unavailable;
    runtime.frame_history.clear();
}

fn reset_reference_subject(runtime: &mut WebRuntime) {
    runtime.frame_history.clear();
    runtime.reference_state = if runtime.reference_profile.is_some() {
        ReferenceRuntimeState::AwaitingSealedRep
    } else {
        ReferenceRuntimeState::Unavailable
    };
    runtime.simulated_baseline_state = if runtime.simulated_baseline.is_some() {
        ReferenceRuntimeState::AwaitingSealedRep
    } else {
        ReferenceRuntimeState::Unavailable
    };
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_begin_reference_profile(length: u32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if length == 0 || length > 1_048_576 {
        return -2;
    }
    runtime.reference_profile_buffer = vec![0; length as usize];
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_begin_reference_context(length: u32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if length == 0 || length > 4_096 {
        return -2;
    }
    // Runtime context is immutable for the active ExerciseProfile. Changing
    // model, action, camera position, side, or equipment must rotate/reset the
    // profile first so a reviewed reference can never follow stale context.
    if runtime.reference_context.is_some() || runtime.reference_profile.is_some() {
        return -3;
    }
    runtime.reference_context_buffer = vec![0; length as usize];
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_set_reference_context_byte(index: u32, value: u32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let Some(slot) = runtime.reference_context_buffer.get_mut(index as usize) else {
        return -2;
    };
    let Ok(value) = u8::try_from(value) else {
        return -3;
    };
    *slot = value;
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_commit_reference_context() -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let bytes = std::mem::take(&mut runtime.reference_context_buffer);
    let Ok(dto) = serde_json::from_slice::<ReferenceIdentityDto>(&bytes) else {
        return -2;
    };
    let identity: super::ReferenceIdentity = dto.into();
    let Some(expected_profile_identity) =
        super::supported_reference_exercise_profile_identity(&identity)
    else {
        return -4;
    };
    let Some(active_profile) = runtime.rep_engine.as_ref().map(|engine| &engine.profile) else {
        return -5;
    };
    if active_profile.identity != expected_profile_identity {
        return -5;
    }
    runtime.reference_context = Some(identity);
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_set_reference_profile_byte(index: u32, value: u32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let Some(slot) = runtime.reference_profile_buffer.get_mut(index as usize) else {
        return -2;
    };
    let Ok(value) = u8::try_from(value) else {
        return -3;
    };
    *slot = value;
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_commit_reference_profile() -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let bytes = std::mem::take(&mut runtime.reference_profile_buffer);
    let profile_hash = bytes.iter().fold(super::FNV_OFFSET, |mut hash, byte| {
        hash ^= u64::from(*byte);
        hash.wrapping_mul(super::FNV_PRIME)
    });
    let Ok(envelope) = serde_json::from_slice::<ReferenceEnvelopeDto>(&bytes) else {
        return -2;
    };
    let ReferenceProfileDto {
        schema_version,
        profile_status,
        identity,
        phase_model,
        feature_names,
        corridor,
        matching_policy,
    } = envelope.profile;
    if schema_version != "form-coach-provisional-reference-profile/v1"
        || (profile_status != "personal_provisional_expert_reviewed"
            && profile_status != "simulated_nominal")
        || phase_model.normalization != "piecewise_linear_start_bottom_end"
        || phase_model.pull_nodes != 16
        || phase_model.return_nodes != 16
        || phase_model.unrestricted_dtw_allowed
        || matching_policy.unrestricted_dtw_allowed
        || !matching_policy.minimum_observation_confidence.is_finite()
        || !(0.0..=1.0).contains(&matching_policy.minimum_observation_confidence)
        || feature_names
            != super::LAT_PULLDOWN_REFERENCE_FEATURES
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
    {
        return -3;
    }
    let profile_identity: super::ReferenceIdentity = identity.into();
    let Some(trusted_context) = runtime.reference_context.clone() else {
        return -7;
    };
    if super::identity_mismatch(&profile_identity, &trusted_context).is_some() {
        return -4;
    }
    let Some(expected_exercise_profile) =
        super::supported_reference_exercise_profile_identity(&profile_identity)
    else {
        return -6;
    };
    let Some(active_exercise_profile) = runtime.rep_engine.as_ref().map(|engine| &engine.profile)
    else {
        return -6;
    };
    if active_exercise_profile.identity != expected_exercise_profile {
        return -6;
    }
    let exercise_profile_binding = (
        active_exercise_profile.identity.clone(),
        active_exercise_profile.content_hash,
    );
    let profile = super::ReferenceTrajectoryProfile {
        identity: profile_identity,
        profile_hash,
        profile_status,
        feature_names,
        minimum_observation_confidence: matching_policy.minimum_observation_confidence,
        nodes: corridor
            .nodes
            .into_iter()
            .map(|node| super::ReferenceCorridorNode {
                phase: node.phase,
                phase_progress: node.phase_percent / 100.0,
                features: node
                    .features
                    .into_iter()
                    .map(|point| super::CorridorPoint {
                        q_low: point.q_low,
                        q_high: point.q_high,
                        median_absolute_deviation: point.median_absolute_deviation,
                        n_observed: point.n_observed,
                    })
                    .collect(),
            })
            .collect(),
    };
    if !valid_fixed_reference_layout(&profile.nodes)
        || profile.nodes.iter().any(|node| {
            node.features.len() != profile.feature_names.len()
                || node
                    .features
                    .iter()
                    .any(|point| !super::valid_corridor_point(point))
        })
    {
        return -5;
    }
    runtime.reference_profile = Some(profile);
    runtime.reference_exercise_profile_binding = Some(exercise_profile_binding);
    runtime.reference_state = ReferenceRuntimeState::AwaitingSealedRep;
    0
}

/// Installs an uncalibrated simulated phase baseline for the currently active
/// Rust exercise profile. Unlike a reviewed reference profile, this endpoint
/// is intentionally restricted to the generic two-signal schema and only
/// exposes descriptive corridor evidence (never a quality verdict).
#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_begin_simulated_baseline(length: u32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if length == 0 || length > 131_072 {
        return -2;
    }
    runtime.simulated_baseline_buffer = vec![0; length as usize];
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_set_simulated_baseline_byte(index: u32, value: u32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let Some(slot) = runtime.simulated_baseline_buffer.get_mut(index as usize) else {
        return -2;
    };
    let Ok(value) = u8::try_from(value) else {
        return -3;
    };
    *slot = value;
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_commit_simulated_baseline() -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let bytes = std::mem::take(&mut runtime.simulated_baseline_buffer);
    let profile_hash = bytes.iter().fold(super::FNV_OFFSET, |mut hash, byte| {
        hash ^= u64::from(*byte);
        hash.wrapping_mul(super::FNV_PRIME)
    });
    let Ok(envelope) = serde_json::from_slice::<SimulatedBaselineEnvelopeDto>(&bytes) else {
        return -2;
    };
    let SimulatedBaselineDto {
        schema_version,
        source,
        evidence_status,
        calibration_status,
        identity,
        profile_binding,
        feature_names,
        corridor,
        matching_policy,
    } = envelope.baseline;
    if schema_version != "form-coach-simulated-trajectory-baseline/v1"
        || source != "simulated_kinematic_prior"
        || evidence_status != "uncalibrated"
        || calibration_status != "uncalibrated"
        || feature_names
            != super::PROFILE_SIGNAL_REFERENCE_FEATURES
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        || matching_policy.unrestricted_dtw_allowed
        || !matching_policy.minimum_observation_confidence.is_finite()
        || !(0.0..=1.0).contains(&matching_policy.minimum_observation_confidence)
    {
        return -3;
    }
    let Ok(bound_hash) = profile_binding.exercise_profile_hash.parse::<u64>() else {
        return -4;
    };
    let Some(active_exercise_profile) = runtime.rep_engine.as_ref().map(|engine| &engine.profile)
    else {
        return -5;
    };
    if active_exercise_profile.identity != profile_binding.exercise_profile_identity
        || active_exercise_profile.content_hash != bound_hash
    {
        return -5;
    }
    let baseline_identity: super::ReferenceIdentity = identity.into();
    let profile = super::ReferenceTrajectoryProfile {
        identity: baseline_identity.clone(),
        profile_hash,
        profile_status: "simulated_nominal".into(),
        feature_names,
        minimum_observation_confidence: matching_policy.minimum_observation_confidence,
        nodes: corridor
            .nodes
            .into_iter()
            .map(|node| super::ReferenceCorridorNode {
                phase: node.phase,
                phase_progress: node.phase_percent / 100.0,
                features: node
                    .features
                    .into_iter()
                    .map(|point| super::CorridorPoint {
                        q_low: point.q_low,
                        q_high: point.q_high,
                        median_absolute_deviation: point.median_absolute_deviation,
                        n_observed: point.n_observed,
                    })
                    .collect(),
            })
            .collect(),
    };
    if !valid_fixed_simulated_baseline_layout(&profile.nodes)
        || profile.nodes.iter().any(|node| {
            node.features.len() != profile.feature_names.len()
                || node
                    .features
                    .iter()
                    .any(|point| {
                        !super::valid_corridor_point_for_status(point, "simulated_nominal")
                    })
        })
    {
        return -6;
    }
    runtime.simulated_baseline = Some(profile);
    runtime.simulated_baseline_context = Some(baseline_identity);
    runtime.simulated_baseline_binding = Some((
        profile_binding.exercise_profile_identity,
        bound_hash,
    ));
    runtime.simulated_baseline_state = ReferenceRuntimeState::AwaitingSealedRep;
    0
}

fn valid_fixed_reference_layout(nodes: &[super::ReferenceCorridorNode]) -> bool {
    nodes.len() == 32
        && nodes.iter().enumerate().all(|(index, node)| {
            let phase_index = index % 16;
            let expected_phase = if index < 16 { "pull" } else { "return" };
            let expected_progress = phase_index as f32 / 15.0;
            node.phase == expected_phase && (node.phase_progress - expected_progress).abs() <= 1e-4
        })
}

fn valid_fixed_simulated_baseline_layout(nodes: &[super::ReferenceCorridorNode]) -> bool {
    nodes.len() == 32
        && nodes.iter().enumerate().all(|(index, node)| {
            let phase_index = index % 16;
            let expected_phase = if index < 16 { "to_extreme" } else { "from_extreme" };
            let expected_progress = phase_index as f32 / 15.0;
            node.phase == expected_phase && (node.phase_progress - expected_progress).abs() <= 1e-4
        })
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_reference_status() -> u32 {
    let Ok(runtime) = runtime().lock() else {
        return u32::MAX;
    };
    match &runtime.reference_state {
        ReferenceRuntimeState::Unavailable => 0,
        ReferenceRuntimeState::AwaitingSealedRep => 1,
        ReferenceRuntimeState::ExtractionRefused => 2,
        ReferenceRuntimeState::Evidence(evidence) => match evidence.status {
            super::TrajectoryComparisonStatus::ComparisonAvailable => 3,
            super::TrajectoryComparisonStatus::InsufficientObservation => 4,
            super::TrajectoryComparisonStatus::ProfileMismatch => 5,
            super::TrajectoryComparisonStatus::InvalidProfile => 6,
        },
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_reference_field(field: u32, high: u32) -> u32 {
    let Ok(runtime) = runtime().lock() else {
        return u32::MAX;
    };
    let ReferenceRuntimeState::Evidence(evidence) = &runtime.reference_state else {
        return 0;
    };
    let value = match field {
        0 => evidence.rep_id,
        1 => u64::from(evidence.rep_revision),
        2 => evidence.canonical_slice_hash,
        3 => evidence.profile_hash,
        _ => return u32::MAX,
    };
    if high == 0 {
        value as u32
    } else {
        (value >> 32) as u32
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_reference_feature_count() -> u32 {
    let Ok(runtime) = runtime().lock() else {
        return 0;
    };
    match &runtime.reference_state {
        ReferenceRuntimeState::Evidence(evidence) => evidence.features.len() as u32,
        _ => 0,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_reference_feature_number(index: u32, field: u32) -> f32 {
    let Ok(runtime) = runtime().lock() else {
        return f32::NAN;
    };
    let ReferenceRuntimeState::Evidence(evidence) = &runtime.reference_state else {
        return f32::NAN;
    };
    let Some(feature) = evidence.features.get(index as usize) else {
        return f32::NAN;
    };
    match field {
        0 => feature.comparable_node_count as f32,
        1 => feature.unknown_node_count as f32,
        2 => feature.outside_node_count as f32,
        3 => feature.outside_node_ratio.unwrap_or(f32::NAN),
        4 => feature.maximum_consecutive_outside_nodes as f32,
        5 => feature.total_normalized_excess,
        _ => f32::NAN,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_simulated_baseline_status() -> u32 {
    let Ok(runtime) = runtime().lock() else {
        return u32::MAX;
    };
    match &runtime.simulated_baseline_state {
        ReferenceRuntimeState::Unavailable => 0,
        ReferenceRuntimeState::AwaitingSealedRep => 1,
        ReferenceRuntimeState::ExtractionRefused => 2,
        ReferenceRuntimeState::Evidence(evidence) => match evidence.status {
            super::TrajectoryComparisonStatus::ComparisonAvailable => 3,
            super::TrajectoryComparisonStatus::InsufficientObservation => 4,
            super::TrajectoryComparisonStatus::ProfileMismatch => 5,
            super::TrajectoryComparisonStatus::InvalidProfile => 6,
        },
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_simulated_baseline_field(field: u32, high: u32) -> u32 {
    let Ok(runtime) = runtime().lock() else {
        return u32::MAX;
    };
    let ReferenceRuntimeState::Evidence(evidence) = &runtime.simulated_baseline_state else {
        return 0;
    };
    let value = match field {
        0 => evidence.rep_id,
        1 => u64::from(evidence.rep_revision),
        2 => evidence.canonical_slice_hash,
        3 => evidence.profile_hash,
        _ => return u32::MAX,
    };
    if high == 0 { value as u32 } else { (value >> 32) as u32 }
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_simulated_baseline_feature_count() -> u32 {
    let Ok(runtime) = runtime().lock() else {
        return 0;
    };
    match &runtime.simulated_baseline_state {
        ReferenceRuntimeState::Evidence(evidence) => evidence.features.len() as u32,
        _ => 0,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_simulated_baseline_feature_number(index: u32, field: u32) -> f32 {
    let Ok(runtime) = runtime().lock() else {
        return f32::NAN;
    };
    let ReferenceRuntimeState::Evidence(evidence) = &runtime.simulated_baseline_state else {
        return f32::NAN;
    };
    let Some(feature) = evidence.features.get(index as usize) else {
        return f32::NAN;
    };
    match field {
        0 => feature.comparable_node_count as f32,
        1 => feature.unknown_node_count as f32,
        2 => feature.outside_node_count as f32,
        3 => feature.outside_node_ratio.unwrap_or(f32::NAN),
        4 => feature.maximum_consecutive_outside_nodes as f32,
        5 => feature.total_normalized_excess,
        _ => f32::NAN,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_rep_state_field(field: u32) -> u32 {
    let Ok(runtime) = runtime().lock() else {
        return u32::MAX;
    };
    match field {
        0 => match runtime.rep_state.phase {
            super::RepPhase::Ready => 0,
            super::RepPhase::Effort => 1,
            super::RepPhase::Peak => 2,
            super::RepPhase::Return => 3,
            super::RepPhase::Frozen => 4,
        },
        1 => runtime.rep_state.partial_attempts as u32,
        2 => (runtime.rep_state.partial_attempts >> 32) as u32,
        3 => u32::from(runtime.rep_state.active_rep_id.is_some()),
        4 => runtime.rep_state.active_rep_id.unwrap_or(0) as u32,
        5 => (runtime.rep_state.active_rep_id.unwrap_or(0) >> 32) as u32,
        6 => u32::from(runtime.rep_state.recovered_across_gap),
        _ => u32::MAX,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_completed_rep_count() -> u32 {
    runtime()
        .lock()
        .map_or(0, |runtime| runtime.completed_reps.len() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_completed_rep_field(index: u32, field: u32) -> u32 {
    let Ok(runtime) = runtime().lock() else {
        return u32::MAX;
    };
    let Some(rep) = runtime.completed_reps.get(index as usize) else {
        return u32::MAX;
    };
    let value = match field {
        0 => rep.rep_id,
        1 => rep.start_frame_id,
        2 => rep.start_timestamp_ms,
        3 => rep.peak_frame_id,
        4 => rep.peak_timestamp_ms,
        5 => rep.end_frame_id,
        6 => rep.end_timestamp_ms,
        7 => rep.canonical_slice_hash,
        8 => rep.profile_hash,
        _ => return u32::MAX,
    };
    if field < 9 {
        value as u32
    } else {
        (value >> 32) as u32
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_completed_rep_field_high(index: u32, field: u32) -> u32 {
    let Ok(runtime) = runtime().lock() else {
        return u32::MAX;
    };
    let Some(rep) = runtime.completed_reps.get(index as usize) else {
        return u32::MAX;
    };
    let value = match field {
        0 => rep.rep_id,
        1 => rep.start_frame_id,
        2 => rep.start_timestamp_ms,
        3 => rep.peak_frame_id,
        4 => rep.peak_timestamp_ms,
        5 => rep.end_frame_id,
        6 => rep.end_timestamp_ms,
        7 => rep.canonical_slice_hash,
        8 => rep.profile_hash,
        _ => return u32::MAX,
    };
    (value >> 32) as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_target_field(field: u32) -> u32 {
    let Ok(runtime) = runtime().lock() else {
        return u32::MAX;
    };
    let Some(target) = runtime.target.as_ref() else {
        return u32::MAX;
    };
    match field {
        0 => match target.state {
            TargetState::Acquiring => 0,
            TargetState::Locked => 1,
            TargetState::Uncertain => 2,
            TargetState::Lost => 3,
            TargetState::Reacquiring => 4,
        },
        1 => u32::from(target.candidate_count),
        2 => u32::from(target.selected_candidate_id.is_some()),
        3 => target.selected_candidate_id.unwrap_or(0) as u32,
        4 => (target.selected_candidate_id.unwrap_or(0) >> 32) as u32,
        5 => runtime.subject_epoch as u32,
        6 => (runtime.subject_epoch >> 32) as u32,
        _ => u32::MAX,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_candidate_count() -> u32 {
    runtime().lock().map_or(0, |runtime| {
        runtime
            .subject_tracker
            .as_ref()
            .map_or(0, |tracker| tracker.last_candidates.len() as u32)
    })
}

/// Debug-only candidate telemetry. It exposes geometry and aggregate costs,
/// never the ephemeral torso colour descriptor itself.
#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_candidate_number(index: u32, field: u32) -> f32 {
    let Ok(runtime) = runtime().lock() else {
        return f32::NAN;
    };
    let Some(tracker) = runtime.subject_tracker.as_ref() else {
        return f32::NAN;
    };
    let Some(candidate) = tracker.last_candidates.get(index as usize) else {
        return f32::NAN;
    };
    match field {
        0 => candidate.id as f32,
        1 => candidate.bbox.x,
        2 => candidate.bbox.y,
        3 => candidate.bbox.width,
        4 => candidate.bbox.height,
        5 => super::subject_acquisition_cost(candidate),
        6 => tracker
            .locked_descriptor
            .as_ref()
            .map_or(f32::NAN, |locked| super::identity_cost(locked, candidate)),
        7 => f32::from(u8::from(runtime.target.as_ref().is_some_and(|target| {
            target.state == TargetState::Locked
                && target.selected_candidate_id == Some(candidate.id)
        }))),
        8..=11 => tracker
            .locked_descriptor
            .as_ref()
            .map_or(f32::NAN, |locked| {
                super::identity_cost_components(locked, candidate)[(field - 8) as usize]
            }),
        12 => super::STABLE_SLOT_IDENTITY_COST,
        13 => 0.35,
        _ => f32::NAN,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_select_subject(x: f32, y: f32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let Some(tracker) = runtime.subject_tracker.as_mut() else {
        return -2;
    };
    if tracker.select_at(x, y).is_err() {
        return -3;
    }
    runtime.subject_epoch = runtime.subject_epoch.saturating_add(1);
    if let Some(engine) = runtime.engine.as_mut() {
        engine.reset();
    }
    let subject_change_outcome = runtime
        .rep_engine
        .as_mut()
        .and_then(super::RepEngine::reject_for_subject_change);
    runtime.pending_outcomes.extend(subject_change_outcome);
    reset_reference_subject(&mut runtime);
    runtime.completed_reps = std::mem::take(&mut runtime.pending_outcomes);
    runtime.rep_state = runtime
        .rep_engine
        .as_ref()
        .map_or_else(super::RepStateSnapshot::default, |engine| engine.state.clone());
    encode_current_packet(&mut runtime);
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_schedule(
    timestamp_low: u32,
    timestamp_high: u32,
    inference_in_flight: u32,
) -> u32 {
    let Ok(mut runtime) = runtime().lock() else {
        return u32::MAX;
    };
    let timestamp_ms = (u64::from(timestamp_high) << 32) | u64::from(timestamp_low);
    let target = runtime.target.as_ref().map(|target| target.state);
    let Some(scheduler) = runtime.scheduler.as_mut() else {
        return u32::MAX;
    };
    // MediaPipe Tasks Web does not expose a target ROI tracking call. Refuse
    // to pretend TrackTarget is supported: every accepted request remains a
    // multi-person refresh, while safe degradation reduces its cadence.
    match scheduler.decide_with_roi_capability(
        timestamp_ms,
        target,
        inference_in_flight != 0,
        false,
    ) {
        super::InferenceRequest::AcquireMulti => 0,
        super::InferenceRequest::TrackTarget => 1,
        super::InferenceRequest::RefreshCandidates => 2,
        super::InferenceRequest::SkipFrame => 3,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_set_degradation(level: u32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let Some(scheduler) = runtime.scheduler.as_mut() else {
        return -2;
    };
    scheduler.apply_safe_degradation(level.min(2) as u8);
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_output_len() -> u32 {
    runtime()
        .lock()
        .map_or(0, |runtime| runtime.output.len() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_output_number(index: u32, field: u32) -> f32 {
    let Ok(runtime) = runtime().lock() else {
        return f32::NAN;
    };
    let Some(value) = runtime.output.get(index as usize) else {
        return f32::NAN;
    };
    match field {
        0 => value.x.unwrap_or(f32::NAN),
        1 => value.y.unwrap_or(f32::NAN),
        2 => value.z.unwrap_or(f32::NAN),
        3 => value.observation_score,
        4 => value.canonical_confidence,
        5 => value.uncertainty.unwrap_or(f32::NAN),
        _ => f32::NAN,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_output_flags(index: u32) -> u32 {
    let Ok(runtime) = runtime().lock() else {
        return u32::MAX;
    };
    let Some(value) = runtime.output.get(index as usize) else {
        return u32::MAX;
    };
    let source = match value.source {
        super::LandmarkSource::Measured => 0,
        super::LandmarkSource::Fused => 1,
        super::LandmarkSource::Predicted => 2,
        super::LandmarkSource::Unknown => 3,
    };
    source | (u32::from(value.renderable) << 8)
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_output_hash(high: u32) -> u32 {
    let Ok(runtime) = runtime().lock() else {
        return u32::MAX;
    };
    let mut hash = super::FNV_OFFSET;
    for (index, landmark) in runtime.output.iter().enumerate() {
        for byte in (index as u64)
            .to_le_bytes()
            .into_iter()
            .chain(
                landmark
                    .x
                    .map(f32::to_bits)
                    .unwrap_or(u32::MAX)
                    .to_le_bytes(),
            )
            .chain(
                landmark
                    .y
                    .map(f32::to_bits)
                    .unwrap_or(u32::MAX)
                    .to_le_bytes(),
            )
            .chain(
                landmark
                    .z
                    .map(f32::to_bits)
                    .unwrap_or(u32::MAX)
                    .to_le_bytes(),
            )
            .chain(landmark.canonical_confidence.to_bits().to_le_bytes())
        {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(super::FNV_PRIME);
        }
    }
    if high == 0 {
        hash as u32
    } else {
        (hash >> 32) as u32
    }
}
