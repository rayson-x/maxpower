use std::sync::{Mutex, OnceLock};

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
    completed_reps: Vec<super::SealedRep>,
    packet_bytes: Vec<u8>,
    sequence_id: String,
    sequence_buffer: Vec<u8>,
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
    runtime.completed_reps.clear();
    runtime.packet_bytes.clear();
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
        if let Some(rep_engine) = runtime.rep_engine.as_mut() {
            rep_engine.abort_active();
        }
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
    runtime.completed_reps.clear();
    let Some(target) = runtime.target.as_ref() else {
        return;
    };
    if let Some(rep_engine) = runtime.rep_engine.as_mut() {
        runtime.completed_reps = rep_engine.process(
            runtime.frame_id,
            runtime.timestamp_ms,
            target.state,
            &runtime.output,
        );
        runtime.rep_state = rep_engine.state.clone();
    } else {
        runtime.rep_state = super::RepStateSnapshot::default();
    }
    if let Some(target) = runtime.target.clone() {
        let packet = super::MotionPacket {
            lineage: super::PacketLineage {
                sequence_id: runtime.sequence_id.clone(),
                contract: super::ContractVersion { major: 1, minor: 1 },
                algorithm_version: "rust-canonical-wasm/v1".into(),
            },
            frame_id: runtime.frame_id,
            source_timestamp_ms: runtime.timestamp_ms,
            subject_epoch: runtime.subject_epoch,
            target,
            canonical: runtime.output.clone(),
            rep_state: runtime.rep_state.clone(),
            completed_reps: runtime.completed_reps.clone(),
        };
        runtime.packet_bytes = super::encode_motion_packet(&packet).unwrap_or_default();
    } else {
        runtime.packet_bytes.clear();
    }
    runtime.frame_id = runtime.frame_id.saturating_add(1);
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
        _ => return -2,
    };
    runtime.rep_engine = profile.map(super::RepEngine::new);
    runtime.rep_state = super::RepStateSnapshot::default();
    runtime.completed_reps.clear();
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn motion_sdk_install_profile(
    hash_low: u32,
    hash_high: u32,
    direction: u32,
    primary_0: u32,
    primary_1: u32,
    secondary_0: u32,
    secondary_1: u32,
    start_amplitude: f32,
    min_primary_amplitude: f32,
    min_secondary_amplitude: f32,
    return_hysteresis: f32,
    ready_tolerance: f32,
    max_gap_ms: u32,
) -> i32 {
    // This numeric prototype cannot carry or authenticate the complete
    // schema/identity/capability bundle. Fail closed rather than treating a
    // caller-supplied hash as proof of content. Versioned built-in data
    // profiles remain available through motion_sdk_set_profile.
    let _ = (
        hash_low,
        hash_high,
        direction,
        primary_0,
        primary_1,
        secondary_0,
        secondary_1,
        start_amplitude,
        min_primary_amplitude,
        min_secondary_amplitude,
        return_hysteresis,
        ready_tolerance,
        max_gap_ms,
    );
    -4
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
    if let Some(rep_engine) = runtime.rep_engine.as_mut() {
        rep_engine.abort_active();
    }
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
    match scheduler.decide(timestamp_ms, target, inference_in_flight != 0) {
        super::InferenceRequest::AcquireMulti => 0,
        super::InferenceRequest::TrackTarget => 1,
        super::InferenceRequest::RefreshCandidates => 2,
        super::InferenceRequest::SkipFrame => 3,
    }
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
