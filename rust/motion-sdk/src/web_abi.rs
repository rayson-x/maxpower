use std::sync::{Mutex, OnceLock};

use serde::Deserialize;

use super::{
    CanonicalLandmark, ContinuityEngine, ContinuityMode, NormalizedRect, PoseCandidate,
    PoseObservation, SubjectPolicy, SubjectTracker, TargetSnapshot, TargetState,
};

pub const CANDIDATE_FIELD_ID: u32 = 0;
pub const CANDIDATE_FIELD_BBOX_X: u32 = 1;
pub const CANDIDATE_FIELD_BBOX_Y: u32 = 2;
pub const CANDIDATE_FIELD_BBOX_WIDTH: u32 = 3;
pub const CANDIDATE_FIELD_BBOX_HEIGHT: u32 = 4;
pub const CANDIDATE_FIELD_DOMINANCE_SCORE: u32 = 5;
pub const CANDIDATE_FIELD_CONTINUITY_COST: u32 = 6;
pub const CANDIDATE_FIELD_SELECTED: u32 = 7;
pub const CANDIDATE_FIELD_CONTINUITY_LANDMARKS: u32 = 8;
pub const CANDIDATE_FIELD_CONTINUITY_CENTER: u32 = 9;
pub const CANDIDATE_FIELD_CONTINUITY_COLOR: u32 = 10;
pub const CANDIDATE_FIELD_SWITCH_THRESHOLD: u32 = 12;
pub const CANDIDATE_FIELD_SWITCH_CONFIRM_MS: u32 = 13;

#[derive(Default)]
struct WebRuntime {
    engine: Option<ContinuityEngine>,
    equipment_fusion: super::EquipmentFusionEngine,
    pose_schema: super::PoseSchemaId,
    timestamp_ms: u64,
    last_processed_timestamp_ms: Option<u64>,
    observations: Vec<PoseObservation>,
    output: Vec<CanonicalLandmark>,
    candidates: Vec<PoseCandidate>,
    candidate_meta: Option<(u64, NormalizedRect, [f32; 3])>,
    equipment_observations: Vec<super::EquipmentObservation>,
    equipment_output: Option<super::EquipmentFrameEvidence>,
    local_motion_coordinate: super::LocalMotionCoordinateEstimator,
    visual_equipment_tracker: super::BarbellAxisVisualTracker,
    visual_luma: Vec<u8>,
    visual_width: usize,
    visual_height: usize,
    visual_equipment_processed: bool,
    visual_barbell_axis: Option<super::BarbellAxisObservation>,
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

impl Default for super::PoseSchemaId {
    fn default() -> Self {
        Self::BlazePose33
    }
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
    runtime.pose_schema = super::PoseSchemaId::BlazePose33;
    runtime.engine = Some(ContinuityEngine::new_with_schema(
        if fusion == 0 {
            ContinuityMode::Raw
        } else {
            ContinuityMode::Fusion
        },
        width,
        height,
        runtime.pose_schema,
    ));
    runtime.equipment_fusion = super::EquipmentFusionEngine::new();
    runtime.observations.clear();
    runtime.output.clear();
    runtime.candidates.clear();
    runtime.candidate_meta = None;
    runtime.equipment_observations.clear();
    runtime.equipment_output = None;
    runtime.local_motion_coordinate = super::LocalMotionCoordinateEstimator::new(width, height);
    runtime.visual_equipment_tracker.reset();
    runtime.visual_luma.clear();
    runtime.visual_width = 0;
    runtime.visual_height = 0;
    runtime.visual_equipment_processed = false;
    runtime.visual_barbell_axis = None;
    runtime.subject_tracker = Some(SubjectTracker::new(SubjectPolicy::DominantVisible));
    runtime.target = None;
    runtime.subject_epoch = 0;
    runtime.last_processed_timestamp_ms = None;
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

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_set_pose_schema(schema: u32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let schema = match schema {
        0 => super::PoseSchemaId::BlazePose33,
        1 => super::PoseSchemaId::Halpe26,
        _ => return -2,
    };
    let Some(engine) = runtime.engine.as_ref() else {
        return -3;
    };
    let mode = engine.mode;
    let width = engine.width as u32;
    let height = engine.height as u32;
    runtime.pose_schema = schema;
    runtime.engine = Some(ContinuityEngine::new_with_schema(
        mode, width, height, schema,
    ));
    runtime.observations.clear();
    runtime.output.clear();
    runtime.candidates.clear();
    runtime.candidate_meta = None;
    runtime.equipment_fusion = super::EquipmentFusionEngine::new();
    runtime.equipment_observations.clear();
    runtime.equipment_output = None;
    runtime.local_motion_coordinate = super::LocalMotionCoordinateEstimator::new(width, height);
    runtime.visual_equipment_tracker.reset();
    runtime.visual_luma.clear();
    runtime.visual_width = 0;
    runtime.visual_height = 0;
    runtime.visual_equipment_processed = false;
    runtime.visual_barbell_axis = None;
    runtime.last_processed_timestamp_ms = None;
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
    runtime.local_motion_coordinate.begin_set();
    if let Some(rep_engine) = runtime.rep_engine.as_mut() {
        rep_engine.begin_set();
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
    runtime.local_motion_coordinate.begin_set();
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
    runtime.local_motion_coordinate.finish_set();
    runtime.completed_reps = runtime
        .rep_engine
        .as_mut()
        .map_or_else(Vec::new, super::RepEngine::finish_set);
    runtime.pending_outcomes.clear();
    runtime.rep_state = runtime
        .rep_engine
        .as_ref()
        .map_or_else(super::RepStateSnapshot::default, |engine| {
            engine.state.clone()
        });
    encode_current_packet(&mut runtime);
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_pause_set() -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if runtime.engine.is_none() {
        return -2;
    }
    runtime.set_gate.pause();
    runtime.local_motion_coordinate.pause_set();
    encode_current_packet(&mut runtime);
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_resume_set() -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if runtime.engine.is_none() {
        return -2;
    }
    runtime.set_gate.resume();
    runtime.local_motion_coordinate.resume_set();
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
    let timestamp_ms = (u64::from(timestamp_high) << 32) | u64::from(timestamp_low);
    if runtime
        .last_processed_timestamp_ms
        .is_some_and(|last| timestamp_ms <= last)
    {
        return -3;
    }
    runtime.timestamp_ms = timestamp_ms;
    runtime.observations = vec![PoseObservation::new(0.0, 0.0, 0.0, 0.0); landmark_count as usize];
    runtime.output.clear();
    runtime.candidates.clear();
    runtime.candidate_meta = None;
    runtime.equipment_observations.clear();
    runtime.equipment_output = None;
    runtime.visual_luma.clear();
    runtime.visual_equipment_processed = false;
    runtime.visual_barbell_axis = None;
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
    if runtime
        .last_processed_timestamp_ms
        .is_some_and(|last| timestamp_ms <= last)
    {
        return -3;
    }
    let observations = runtime.observations.clone();
    let selected_subject = PoseCandidate {
        id: 0,
        bbox: NormalizedRect::new(0.0, 0.0, 1.0, 1.0),
        observations: observations.clone(),
        torso_color: [0.0, 0.0, 0.0],
    };
    let Some(engine) = runtime.engine.as_mut() else {
        return -2;
    };
    runtime.output = engine.process(&observations, timestamp_ms);
    runtime.target = Some(TargetSnapshot {
        state: TargetState::Locked,
        candidate_count: 1,
        selected_candidate_id: Some(0),
    });
    let equipment_observations = std::mem::take(&mut runtime.equipment_observations);
    let canonical = runtime.output.clone();
    runtime.equipment_output = Some(
        runtime
            .equipment_fusion
            .process(super::EquipmentFrameInput {
                timestamp_ms,
                selected_subject: Some(&selected_subject),
                canonical: &canonical,
                equipment: &equipment_observations,
            }),
    );
    process_rep(&mut runtime, &equipment_observations);
    runtime.last_processed_timestamp_ms = Some(timestamp_ms);
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
    let timestamp_ms = (u64::from(timestamp_high) << 32) | u64::from(timestamp_low);
    if runtime
        .last_processed_timestamp_ms
        .is_some_and(|last| timestamp_ms <= last)
    {
        return -3;
    }
    runtime.timestamp_ms = timestamp_ms;
    runtime.observations.clear();
    runtime.output.clear();
    runtime.candidates.clear();
    runtime.candidate_meta = None;
    runtime.equipment_observations.clear();
    runtime.equipment_output = None;
    runtime.visual_luma.clear();
    runtime.visual_equipment_processed = false;
    runtime.visual_barbell_axis = None;
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

/// Allocates one downscaled luma plane for the current multi-candidate frame.
/// Platform adapters own RGBA/YUV conversion only; visual equipment semantics
/// and all trajectory state stay in this Rust runtime.
#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_begin_visual_equipment_frame(
    width: u32,
    height: u32,
    length: u32,
) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let expected = usize::try_from(width).ok().and_then(|width| {
        usize::try_from(height)
            .ok()
            .and_then(|height| width.checked_mul(height))
    });
    let Some(expected) = expected else {
        return -2;
    };
    if runtime.engine.is_none() {
        return -2;
    }
    // Visual equipment geometry uses the COCO-17 prefix shared by Halpe-26.
    // BlazePose-33 has different shoulder/wrist indices and must never enter
    // this path implicitly.
    if runtime.pose_schema != super::PoseSchemaId::Halpe26 {
        return -3;
    }
    if width < 8
        || height < 8
        || expected != length as usize
        || expected > 1280 * 1280
        || runtime.visual_equipment_processed
    {
        return -2;
    }
    runtime.visual_width = width as usize;
    runtime.visual_height = height as usize;
    runtime.visual_luma = vec![0; expected];
    0
}

/// WASM hosts write directly into linear memory after allocation. Native hosts
/// must use `motion_sdk_copy_visual_equipment_luma` because pointers are wider.
#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_visual_equipment_luma_ptr() -> u32 {
    #[cfg(target_arch = "wasm32")]
    {
        let Ok(runtime) = runtime().lock() else {
            return 0;
        };
        return runtime.visual_luma.as_ptr() as u32;
    }
    #[cfg(not(target_arch = "wasm32"))]
    0
}

/// Copies a same-frame luma plane from Android/iOS/native hosts.
///
/// # Safety
/// `input` must point to `length` readable bytes for the duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn motion_sdk_copy_visual_equipment_luma(
    input: *const u8,
    length: usize,
) -> i32 {
    if input.is_null() {
        return -1;
    }
    let Ok(mut runtime) = runtime().lock() else {
        return -2;
    };
    if runtime.visual_luma.len() != length || length == 0 {
        return -3;
    }
    // SAFETY: the caller contract above guarantees a readable input range;
    // the destination Vec has exactly the validated length.
    let source = unsafe { std::slice::from_raw_parts(input, length) };
    runtime.visual_luma.copy_from_slice(source);
    0
}

/// Arms shared visual equipment processing for the current frame. Detection
/// runs inside `motion_sdk_process_multi`, after Rust has selected the current
/// foreground subject, so mirrors/bystanders cannot contribute wrist context.
#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_detect_barbell_axis() -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if runtime.visual_equipment_processed
        || runtime.visual_luma.is_empty()
        || runtime.candidate_meta.is_some()
    {
        return -2;
    }
    runtime.visual_equipment_processed = true;
    0
}

/// 0=none, 1=measured, 2=predicted, 3=calibrated pose/equipment fusion.
#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_visual_barbell_axis_source() -> u32 {
    let Ok(runtime) = runtime().lock() else {
        return 0;
    };
    match runtime.visual_barbell_axis.map(|axis| axis.source) {
        Some(super::BarbellAxisSource::Measured) => 1,
        Some(super::BarbellAxisSource::Predicted) => 2,
        Some(super::BarbellAxisSource::Fused) => 3,
        None => 0,
    }
}

/// Numeric visual-axis fields: 0=x1, 1=y1, 2=x2, 3=y2, 4=centerY,
/// 5=confidence, 6=uncertaintyPx. Missing/unknown fields return NaN.
#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_visual_barbell_axis_number(field: u32) -> f32 {
    let Ok(runtime) = runtime().lock() else {
        return f32::NAN;
    };
    let Some(axis) = runtime.visual_barbell_axis else {
        return f32::NAN;
    };
    match field {
        0 => axis.x1,
        1 => axis.y1,
        2 => axis.x2,
        3 => axis.y2,
        4 => axis.center_y,
        5 => axis.confidence,
        6 => axis.uncertainty_px,
        _ => f32::NAN,
    }
}

/// Adds one frame-local equipment proposal. Hosts may call this after either
/// `motion_sdk_begin_frame` or `motion_sdk_begin_multi` and before processing
/// the frame. Rust validates and associates proposals with the locked subject;
/// proposal ids are diagnostic only and never become stable track ids.
///
/// Kind: 0=weight plate, 1=barbell shaft, 2=dumbbell, 3=machine handle.
/// Source: 0=detector, 1=optical flow, 2=geometry, 3=predicted.
/// Flags: bit0=reflection, bit1=static rack, bit2=partial occlusion,
/// bit3=heavy occlusion, bit4=truncated. Negative uncertainty means unknown.
#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_add_equipment_observation(
    id_low: u32,
    id_high: u32,
    kind: u32,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    score: f32,
    uncertainty_px: f32,
    source: u32,
    flags: u32,
) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    if runtime.engine.is_none() {
        return -2;
    }
    let kind = match kind {
        0 => super::EquipmentKind::WeightPlate,
        1 => super::EquipmentKind::BarbellShaft,
        2 => super::EquipmentKind::Dumbbell,
        3 => super::EquipmentKind::MachineHandle,
        _ => return -3,
    };
    let source = match source {
        0 => super::EquipmentSource::Detector,
        1 => super::EquipmentSource::OpticalFlow,
        2 => super::EquipmentSource::Geometry,
        3 => super::EquipmentSource::Predicted,
        _ => return -4,
    };
    if flags & !0b1_1111 != 0 || flags & 0b1100 == 0b1100 {
        return -5;
    }
    let uncertainty_px = if uncertainty_px < 0.0 {
        None
    } else {
        Some(uncertainty_px)
    };
    let occlusion = if flags & 0b1000 != 0 {
        super::EquipmentOcclusion::Heavy
    } else if flags & 0b0100 != 0 {
        super::EquipmentOcclusion::Partial
    } else {
        super::EquipmentOcclusion::None
    };
    runtime
        .equipment_observations
        .push(super::EquipmentObservation {
            proposal_id: (u64::from(id_high) << 32) | u64::from(id_low),
            kind,
            bbox: NormalizedRect::new(x, y, width, height),
            axis: None,
            score,
            uncertainty_px,
            source,
            attributes: super::EquipmentAttributes {
                is_reflection_candidate: flags & 0b00001 != 0,
                is_static_rack_candidate: flags & 0b00010 != 0,
                occlusion,
                truncated: flags & 0b10000 != 0,
            },
        });
    0
}

/// Additive v1.10 host ABI for a detector/tracker that measured the ordered
/// endpoints of a rigid equipment shaft. Generic boxes keep using the legacy
/// function above; no client is forced to invent endpoints.
#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_add_equipment_axis_observation(
    id_low: u32,
    id_high: u32,
    kind: u32,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    score: f32,
    uncertainty_px: f32,
    source: u32,
    flags: u32,
) -> i32 {
    let status = motion_sdk_add_equipment_observation(
        id_low,
        id_high,
        kind,
        x,
        y,
        width,
        height,
        score,
        uncertainty_px,
        source,
        flags,
    );
    if status != 0 {
        return status;
    }
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let Some(observation) = runtime.equipment_observations.last_mut() else {
        return -2;
    };
    let axis = super::EquipmentAxis2d { x1, y1, x2, y2 };
    if ![x1, y1, x2, y2]
        .into_iter()
        .all(|value| value.is_finite() && (0.0..=1.0).contains(&value))
        || axis.projected_length() <= f32::EPSILON
    {
        runtime.equipment_observations.pop();
        return -6;
    }
    observation.axis = Some(axis);
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
    if runtime
        .last_processed_timestamp_ms
        .is_some_and(|last| timestamp_ms <= last)
    {
        return -3;
    }
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
        runtime.visual_equipment_tracker.reset();
        runtime
            .local_motion_coordinate
            .reset_for_discontinuity(super::LocalCoordinateReason::SubjectChanged);
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
    runtime.output = if let Some(selected) = selected.as_ref() {
        let Some(engine) = runtime.engine.as_mut() else {
            return -2;
        };
        engine.process(&selected.observations, timestamp_ms)
    } else {
        vec![CanonicalLandmark::unknown(0.0, None); landmark_count]
    };
    if runtime.visual_equipment_processed && !runtime.visual_luma.is_empty() {
        let visual_subjects = selected.as_ref().map_or(&[][..], std::slice::from_ref);
        let mut visual_tracker = std::mem::take(&mut runtime.visual_equipment_tracker);
        let axis = match visual_tracker.process(
            runtime.pose_schema,
            &runtime.visual_luma,
            runtime.visual_width,
            runtime.visual_height,
            timestamp_ms,
            visual_subjects,
        ) {
            Ok(axis) => axis,
            Err(super::VisualEquipmentError::UnsupportedPoseSchema) => return -4,
        };
        runtime.visual_equipment_tracker = visual_tracker;
        runtime.visual_barbell_axis = axis;
        if let Some(observation) =
            axis.and_then(super::BarbellAxisObservation::equipment_observation)
        {
            runtime.equipment_observations.push(observation);
        }
    }
    let equipment_observations = std::mem::take(&mut runtime.equipment_observations);
    let canonical = runtime.output.clone();
    let selected_for_equipment = (target.state == TargetState::Locked)
        .then_some(selected.as_ref())
        .flatten();
    runtime.equipment_output = Some(
        runtime
            .equipment_fusion
            .process(super::EquipmentFrameInput {
                timestamp_ms,
                selected_subject: selected_for_equipment,
                canonical: &canonical,
                equipment: &equipment_observations,
            }),
    );
    if let Some(equipment) = runtime.equipment_output.clone() {
        let output = runtime.output.clone();
        runtime.local_motion_coordinate.observe(
            timestamp_ms,
            target.selected_candidate_id,
            &output,
            &equipment,
        );
    }
    runtime.target = Some(target);
    process_rep(&mut runtime, &equipment_observations);
    runtime.last_processed_timestamp_ms = Some(timestamp_ms);
    0
}

/// Reports whether the current canonical frame contains every landmark needed
/// by the installed recognition profile. Hosts use this for validity metrics;
/// it deliberately does not treat a merely present 33-point MediaPipe array as
/// usable recognition evidence.
#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_current_frame_valid() -> i32 {
    let Ok(runtime) = runtime().lock() else {
        return -1;
    };
    let target_locked = runtime
        .target
        .as_ref()
        .is_some_and(|target| target.state == TargetState::Locked);
    let observable = runtime.rep_engine.as_ref().is_some_and(|engine| {
        if engine.profile.uses_local_signals() {
            super::profile_signal_with_local(
                &engine.profile,
                &runtime.output,
                Some(&runtime.local_motion_coordinate.snapshot()),
            )
            .is_some()
        } else if engine.profile.uses_barbell_axis_state_graph() {
            runtime.equipment_output.as_ref().is_some_and(|equipment| {
                equipment.tracks.iter().any(|track| {
                    track.kind == super::EquipmentKind::BarbellShaft && track.judgeable_path
                })
            })
        } else {
            super::profile_signal(&engine.profile, &runtime.output).is_some()
        }
    });
    i32::from(target_locked && observable)
}

fn process_rep(runtime: &mut WebRuntime, raw_equipment: &[super::EquipmentObservation]) {
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
    let equipment = runtime.equipment_output.clone().unwrap_or_else(|| {
        super::EquipmentFrameEvidence::cannot_judge(
            runtime.timestamp_ms,
            target.selected_candidate_id,
            super::EquipmentCannotJudgeReason::NoEquipmentObservation,
        )
    });
    let may_process_rep = runtime.set_gate.advance(
        runtime.rep_engine.as_ref().map(|engine| &engine.profile),
        target.state,
        &runtime.output,
        Some(&equipment),
        Some(&runtime.local_motion_coordinate.snapshot()),
        runtime.timestamp_ms,
        rep_phase,
    );
    if may_process_rep {
        if let Some(rep_engine) = runtime.rep_engine.as_mut() {
            runtime
                .completed_reps
                .extend(rep_engine.process_with_equipment(
                    runtime.frame_id,
                    runtime.timestamp_ms,
                    target.state,
                    &runtime.output,
                    &equipment,
                    raw_equipment,
                    Some(&runtime.local_motion_coordinate.snapshot()),
                ));
            runtime.rep_state = rep_engine.state.clone();
        } else {
            runtime.rep_state = super::RepStateSnapshot::default();
        }
    } else {
        if let Some(rep_engine) = runtime.rep_engine.as_mut() {
            rep_engine.prime_barbell_ready(
                runtime.frame_id,
                runtime.timestamp_ms,
                target.state,
                &runtime.output,
                &equipment,
                Some(&runtime.local_motion_coordinate.snapshot()),
            );
        }
        runtime.rep_state = runtime
            .rep_engine
            .as_ref()
            .map_or_else(super::RepStateSnapshot::default, |engine| {
                engine.state.clone()
            });
    }
    if let (Some(profile), Some(identity), Some((bound_identity, bound_hash)), Some(rep)) = (
        runtime.reference_profile.as_ref(),
        runtime.reference_context.as_ref(),
        runtime.reference_exercise_profile_binding.as_ref(),
        runtime
            .completed_reps
            .iter()
            .rev()
            .find(|rep| rep.disposition != super::RepDisposition::Rejected),
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
    if let (
        Some(profile),
        Some(identity),
        Some((bound_identity, bound_hash)),
        Some(rep),
        Some(rep_engine),
    ) = (
        runtime.simulated_baseline.as_ref(),
        runtime.simulated_baseline_context.as_ref(),
        runtime.simulated_baseline_binding.as_ref(),
        runtime
            .completed_reps
            .iter()
            .rev()
            .find(|rep| rep.disposition != super::RepDisposition::Rejected),
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
    // A lifecycle command can arrive immediately after the host rotates the
    // canonical sequence, before the next camera frame has produced a target.
    // That command still owns an immutable packet: "acquiring, no candidate"
    // is the truthful target state, whereas an empty byte buffer makes the
    // host treat a valid begin_set command as a broken Rust runtime.
    let target = runtime.target.clone().unwrap_or(super::TargetSnapshot {
        state: super::TargetState::Acquiring,
        candidate_count: 0,
        selected_candidate_id: None,
    });
    let pose_schema = runtime
        .rep_engine
        .as_ref()
        .map_or(super::PoseSchemaId::BlazePose33, |engine| {
            engine.profile.schema
        });
    let joint_angles =
        super::measure_joint_angles_for_schema(&runtime.output, target.state, pose_schema);
    let selected_candidate_id = target.selected_candidate_id;
    let equipment = runtime.equipment_output.clone().unwrap_or_else(|| {
        super::EquipmentFrameEvidence::cannot_judge(
            runtime.timestamp_ms,
            selected_candidate_id,
            if selected_candidate_id.is_some() && target.state == super::TargetState::Locked {
                super::EquipmentCannotJudgeReason::NoEquipmentObservation
            } else {
                super::EquipmentCannotJudgeReason::NoLockedSubject
            },
        )
    });
    let packet = super::MotionPacket {
        lineage: super::PacketLineage {
            sequence_id: runtime.sequence_id.clone(),
            contract: super::ContractVersion {
                major: 1,
                minor: 10,
            },
            algorithm_version: "rust-canonical-wasm/v1".into(),
            config_version: "web-motion-config/v1".into(),
            inference_version: match runtime.pose_schema {
                super::PoseSchemaId::BlazePose33 => "mediapipe-host-adapter/v1",
                super::PoseSchemaId::Halpe26 => "yolox-rtmpose-halpe26-host-adapter/v1",
            }
            .into(),
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
        joint_angles,
        equipment,
        local_motion_coordinate: runtime.local_motion_coordinate.snapshot(),
        set_state: runtime.set_gate.state.clone(),
        rep_state: runtime.rep_state.clone(),
        quality_proposals: super::build_quality_proposals(&runtime.completed_reps),
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

/// Copies the current packet into host-owned memory. Native hosts use this
/// instead of the WASM linear-memory pointer, which is intentionally u32.
/// Returns the number of bytes copied, or a negative error code.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn motion_sdk_copy_packet(output: *mut u8, capacity: usize) -> isize {
    if output.is_null() {
        return -2;
    }
    let Ok(runtime) = runtime().lock() else {
        return -1;
    };
    if capacity < runtime.packet_bytes.len() {
        return -3;
    }
    let length = runtime.packet_bytes.len();
    // SAFETY: the caller supplied a non-null buffer whose declared capacity
    // is at least `length`; source and destination cannot overlap because the
    // source is owned by the locked runtime.
    unsafe {
        std::ptr::copy_nonoverlapping(runtime.packet_bytes.as_ptr(), output, length);
    }
    length as isize
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_contract_major() -> u32 {
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_contract_minor() -> u32 {
    10
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
        5 => Some(super::ExerciseProfile::march_in_place_front_provisional()),
        6 => Some(super::ExerciseProfile::side_step_touch_front_provisional()),
        7 => Some(super::ExerciseProfile::alternating_knee_raise_front_provisional()),
        8 => Some(super::ExerciseProfile::step_jack_front_provisional()),
        101 => super::ExerciseProfile::lat_pulldown_provisional()
            .into_halpe26()
            .ok(),
        102 => super::ExerciseProfile::seated_shoulder_press_provisional()
            .into_halpe26()
            .ok(),
        103 => super::ExerciseProfile::lat_pulldown_rear_left_45_provisional()
            .into_halpe26()
            .ok(),
        104 => super::ExerciseProfile::seated_shoulder_press_front_provisional()
            .into_halpe26()
            .ok(),
        105 => super::ExerciseProfile::march_in_place_front_provisional()
            .into_halpe26()
            .ok(),
        106 => super::ExerciseProfile::side_step_touch_front_provisional()
            .into_halpe26()
            .ok(),
        107 => super::ExerciseProfile::alternating_knee_raise_front_provisional()
            .into_halpe26()
            .ok(),
        108 => super::ExerciseProfile::step_jack_front_provisional()
            .into_halpe26()
            .ok(),
        109 => Some(super::ExerciseProfile::barbell_bench_press_local_front_provisional()),
        110 => Some(super::ExerciseProfile::barbell_bench_press_local_front_left_provisional()),
        111 => Some(super::ExerciseProfile::barbell_bench_press_local_front_right_provisional()),
        112 => {
            Some(super::ExerciseProfile::seated_barbell_shoulder_press_local_front_provisional())
        }
        113 => Some(
            super::ExerciseProfile::seated_barbell_shoulder_press_local_front_left_provisional(),
        ),
        114 => Some(
            super::ExerciseProfile::seated_barbell_shoulder_press_local_front_right_provisional(),
        ),
        115 => Some(
            super::ExerciseProfile::dumbbell_shoulder_press_front_provisional()
                .into_halpe26()
                .unwrap(),
        ),
        _ => return -2,
    };
    if profile
        .as_ref()
        .is_some_and(|profile| profile.schema != runtime.pose_schema)
    {
        return -3;
    }
    runtime
        .local_motion_coordinate
        .set_profile_identity(profile.as_ref().map(|value| value.identity.as_str()));
    runtime.rep_engine = profile.map(super::RepEngine::new);
    runtime.rep_state = super::RepStateSnapshot::default();
    runtime.completed_reps.clear();
    runtime.pending_outcomes.clear();
    clear_reference(&mut runtime);
    0
}

/// Declares mirroring of the canonical coordinate feed, not the preview.
/// `2` clears the declaration so side-dependent evidence fails closed.
#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_set_canonical_feed_mirroring(value: u32) -> i32 {
    let Ok(mut runtime) = runtime().lock() else {
        return -1;
    };
    let mirrored = match value {
        0 => Some(false),
        1 => Some(true),
        2 => None,
        _ => return -2,
    };
    runtime
        .local_motion_coordinate
        .set_canonical_feed_mirroring(mirrored);
    encode_current_packet(&mut runtime);
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
        1 => super::PoseSchemaId::Halpe26,
        _ => return -5,
    };
    if schema != runtime.pose_schema {
        return -7;
    }
    let coordinate_unit = match coordinate_unit {
        0 => "image-normalized-y",
        1 => "image-angle-deg",
        2 => "torso-normalized-distance",
        3 => "derived-kinematic-signal",
        4 => "set-normalized-local-motion",
        _ => return -5,
    };
    let state_machine_id = match state_machine {
        0 => "ready-effort-peak-return/v1",
        1 => "alternating-ready-effort-return/v1",
        2 => "median-100ms-ready-effort-peak-return/v1",
        3 => "median-200ms-ready-effort-peak-return/v1",
        4 => "median-300ms-ready-effort-peak-return/v1",
        5 => "median-400ms-ready-effort-peak-return/v1",
        6 => "median-600ms-ready-effort-peak-return/v1",
        7 => "cycle-aligned-ready-effort-peak-return/v1",
        8 => "cycle-aligned-median-100ms-ready-effort-peak-return/v1",
        9 => "cycle-aligned-median-200ms-ready-effort-peak-return/v1",
        10 => "cycle-aligned-median-300ms-ready-effort-peak-return/v1",
        11 => "cycle-aligned-median-400ms-ready-effort-peak-return/v1",
        12 => "cycle-aligned-median-600ms-ready-effort-peak-return/v1",
        13 => "stable-cycle-200ms-ready-effort-peak-return/v1",
        14 => "barbell-axis-primary-ready-effort-return/v1",
        15 => "local-barbell-bench-ready-effort-return/v1",
        16 => "local-barbell-shoulder-press-ready-effort-return/v1",
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
        3 => Some(super::ExerciseSignalKind::LandmarkHorizontalDistance),
        4 => Some(super::ExerciseSignalKind::LandmarkVerticalDistance),
        6 => Some(super::ExerciseSignalKind::LocalAlongAxisProgress),
        7 => Some(super::ExerciseSignalKind::LocalCrossAxisDisplacement),
        8 => Some(super::ExerciseSignalKind::LocalEndpointRelativeProgress),
        9 => Some(super::ExerciseSignalKind::LocalDynamicBarAngle),
        10 => Some(super::ExerciseSignalKind::LocalChannelAgreement),
        11 => Some(super::ExerciseSignalKind::LocalObservability),
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
    runtime
        .local_motion_coordinate
        .set_profile_identity(Some(&profile.identity));
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
    if schema_version != "maxpower-provisional-reference-profile/v1"
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
    if schema_version != "maxpower-simulated-trajectory-baseline/v1"
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
                || node.features.iter().any(|point| {
                    !super::valid_corridor_point_for_status(point, "simulated_nominal")
                })
        })
    {
        return -6;
    }
    runtime.simulated_baseline = Some(profile);
    runtime.simulated_baseline_context = Some(baseline_identity);
    runtime.simulated_baseline_binding =
        Some((profile_binding.exercise_profile_identity, bound_hash));
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
            let expected_phase = if index < 16 {
                "to_extreme"
            } else {
                "from_extreme"
            };
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
    if high == 0 {
        value as u32
    } else {
        (value >> 32) as u32
    }
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
        CANDIDATE_FIELD_ID => candidate.id as f32,
        CANDIDATE_FIELD_BBOX_X => candidate.bbox.x,
        CANDIDATE_FIELD_BBOX_Y => candidate.bbox.y,
        CANDIDATE_FIELD_BBOX_WIDTH => candidate.bbox.width,
        CANDIDATE_FIELD_BBOX_HEIGHT => candidate.bbox.height,
        CANDIDATE_FIELD_DOMINANCE_SCORE => super::subject_dominance_score(candidate),
        CANDIDATE_FIELD_CONTINUITY_COST => tracker
            .locked_descriptor
            .as_ref()
            .map_or(f32::NAN, |locked| {
                super::subject_continuity_cost(locked, candidate)
            }),
        CANDIDATE_FIELD_SELECTED => {
            f32::from(u8::from(runtime.target.as_ref().is_some_and(|target| {
                target.state == TargetState::Locked
                    && target.selected_candidate_id == Some(candidate.id)
            })))
        }
        CANDIDATE_FIELD_CONTINUITY_LANDMARKS
        | CANDIDATE_FIELD_CONTINUITY_CENTER
        | CANDIDATE_FIELD_CONTINUITY_COLOR => {
            tracker
                .locked_descriptor
                .as_ref()
                .map_or(f32::NAN, |locked| {
                    super::subject_continuity_cost_components(locked, candidate)
                        [(field - CANDIDATE_FIELD_CONTINUITY_LANDMARKS) as usize]
                })
        }
        11 => f32::NAN,
        CANDIDATE_FIELD_SWITCH_THRESHOLD => super::SUBJECT_SWITCH_CONTINUITY_COST,
        CANDIDATE_FIELD_SWITCH_CONFIRM_MS => super::SUBJECT_SWITCH_CONFIRM_MS as f32,
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
        .map_or_else(super::RepStateSnapshot::default, |engine| {
            engine.state.clone()
        });
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
