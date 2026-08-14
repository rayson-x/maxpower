#![deny(unsafe_op_in_unsafe_fn)]

mod barbell_phase;
mod equipment_fusion;
mod equipment_pose_constraint;
mod execution_assessment;
mod execution_assessment_engine;
mod local_motion_coordinate;
#[doc(hidden)]
pub mod temporal_template;
mod visual_equipment;
#[doc(hidden)]
pub mod web_abi;

pub use equipment_fusion::*;
pub use execution_assessment::*;
pub use execution_assessment_engine::*;
pub use local_motion_coordinate::*;
pub use visual_equipment::*;

use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt;
use std::hint::black_box;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};

pub const SUPPORTED_CONTRACT_MAJOR: u16 = 1;

/// Reproducible host-only benchmark seam. It deliberately exposes only an
/// elapsed duration rather than the private continuity engine API.
#[doc(hidden)]
pub fn benchmark_canonical_core(iterations: usize) -> std::time::Duration {
    let mut core = ContinuityEngine::new(ContinuityMode::Fusion, 1280, 720);
    let observations = vec![PoseObservation::new(0.5, 0.5, 0.0, 0.99); 33];
    let started = std::time::Instant::now();
    for index in 0..iterations {
        black_box(core.process(&observations, index as u64 * 33));
    }
    started.elapsed()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ContractVersion {
    pub major: u16,
    pub minor: u16,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DiagnosticLevel {
    Off,
    Summary,
    Full,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionConfig {
    pub sequence_id: String,
    pub contract: ContractVersion,
    pub diagnostics: DiagnosticLevel,
    pub image_width_px: u32,
    pub image_height_px: u32,
    pub continuity: ContinuityMode,
    pub subject_policy: SubjectPolicy,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContinuityMode {
    Raw,
    Fusion,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SubjectPolicy {
    AssumeSingle,
    DominantVisible,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InferenceRequest {
    AcquireMulti,
    TrackTarget,
    RefreshCandidates,
    SkipFrame,
}

pub struct InferenceScheduler {
    refresh_interval_ms: u64,
    acquire_interval_ms: u64,
    last_multi_ms: Option<u64>,
    minimum_inference_interval_ms: u64,
    last_inference_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SafeDegradationPolicy {
    pub level: u8,
    pub candidate_refresh_interval_ms: u64,
    pub acquire_interval_ms: u64,
    /// Reserved for a host adapter that can resize before inference. Rust does
    /// not silently change the canonical coordinate or identity contracts.
    pub suggested_input_scale_percent: u8,
    /// Reserved for host model selection; zero keeps the configured tier.
    pub suggested_model_tier_step: u8,
}

pub const fn safe_degradation_policy(level: u8) -> SafeDegradationPolicy {
    match level {
        0 => SafeDegradationPolicy {
            level: 0,
            candidate_refresh_interval_ms: 500,
            acquire_interval_ms: 100,
            suggested_input_scale_percent: 100,
            suggested_model_tier_step: 0,
        },
        1 => SafeDegradationPolicy {
            level: 1,
            candidate_refresh_interval_ms: 900,
            acquire_interval_ms: 150,
            suggested_input_scale_percent: 100,
            suggested_model_tier_step: 0,
        },
        _ => SafeDegradationPolicy {
            level: 2,
            candidate_refresh_interval_ms: 1_500,
            acquire_interval_ms: 250,
            suggested_input_scale_percent: 100,
            suggested_model_tier_step: 0,
        },
    }
}

impl InferenceScheduler {
    pub const fn new(refresh_interval_ms: u64, acquire_interval_ms: u64) -> Self {
        Self {
            refresh_interval_ms,
            acquire_interval_ms,
            last_multi_ms: None,
            minimum_inference_interval_ms: 0,
            last_inference_ms: None,
        }
    }

    pub fn decide(
        &mut self,
        timestamp_ms: u64,
        target: Option<TargetState>,
        inference_in_flight: bool,
    ) -> InferenceRequest {
        self.decide_with_roi_capability(timestamp_ms, target, inference_in_flight, true)
    }

    pub fn decide_with_roi_capability(
        &mut self,
        timestamp_ms: u64,
        target: Option<TargetState>,
        inference_in_flight: bool,
        roi_tracking: bool,
    ) -> InferenceRequest {
        if inference_in_flight {
            return InferenceRequest::SkipFrame;
        }
        if self.last_inference_ms.is_some_and(|last| {
            timestamp_ms.saturating_sub(last) < self.minimum_inference_interval_ms
        }) {
            return InferenceRequest::SkipFrame;
        }
        let since_multi = self
            .last_multi_ms
            .map_or(u64::MAX, |last| timestamp_ms.saturating_sub(last));
        match target {
            Some(TargetState::Locked) if roi_tracking && since_multi < self.refresh_interval_ms => {
                self.last_inference_ms = Some(timestamp_ms);
                InferenceRequest::TrackTarget
            }
            Some(TargetState::Locked) => {
                self.last_multi_ms = Some(timestamp_ms);
                self.last_inference_ms = Some(timestamp_ms);
                InferenceRequest::RefreshCandidates
            }
            Some(TargetState::Uncertain | TargetState::Lost | TargetState::Reacquiring)
                if since_multi < self.acquire_interval_ms =>
            {
                InferenceRequest::SkipFrame
            }
            Some(TargetState::Acquiring) if since_multi < self.acquire_interval_ms => {
                InferenceRequest::SkipFrame
            }
            _ => {
                self.last_multi_ms = Some(timestamp_ms);
                self.last_inference_ms = Some(timestamp_ms);
                InferenceRequest::AcquireMulti
            }
        }
    }

    pub fn apply_safe_degradation(&mut self, level: u8) -> SafeDegradationPolicy {
        let policy = safe_degradation_policy(level);
        self.refresh_interval_ms = policy.candidate_refresh_interval_ms;
        self.acquire_interval_ms = policy.acquire_interval_ms;
        self.minimum_inference_interval_ms = match policy.level {
            0 => 0,
            1 => 50,
            _ => 100,
        };
        policy
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AdapterCapabilities {
    pub monotonic_timestamps: bool,
    pub multi_pose: bool,
    pub roi_tracking: bool,
    pub max_candidates: u8,
    pub frame_format: FrameFormat,
    pub max_in_flight: u8,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FrameFormat {
    RecordedObservations,
    Rgba8,
    Yuv420,
}

impl AdapterCapabilities {
    pub const fn fixture() -> Self {
        Self {
            monotonic_timestamps: true,
            multi_pose: true,
            roi_tracking: true,
            max_candidates: 4,
            frame_format: FrameFormat::RecordedObservations,
            max_in_flight: 1,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OpenError {
    UnsupportedContractMajor { requested: u16, supported: u16 },
    MissingMonotonicTimestamps,
    MissingMultiPoseCapability,
    InvalidConcurrencyLimit,
    InvalidSequenceId,
}

impl fmt::Display for OpenError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for OpenError {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MotionError {
    SessionClosed,
    TimestampNotMonotonic { previous: u64, received: u64 },
    InferenceAdapter(String),
    OutputAdapter(String),
    PanicIsolated(&'static str),
    ProfileAlreadyActive,
    ProfileInstallAfterFrames,
    InvalidExerciseProfile(&'static str),
    InvalidRepRevision(&'static str),
    RepProfileMismatch,
}

impl fmt::Display for MotionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for MotionError {}

pub struct FrameLease {
    frame_id: u64,
    timestamp_ms: u64,
    released: AtomicBool,
    release_counter: Arc<AtomicUsize>,
}

impl FrameLease {
    pub fn fixture(frame_id: u64, timestamp_ms: u64, release_counter: Arc<AtomicUsize>) -> Self {
        Self {
            frame_id,
            timestamp_ms,
            released: AtomicBool::new(false),
            release_counter,
        }
    }

    pub fn frame_id(&self) -> u64 {
        self.frame_id
    }

    pub fn timestamp_ms(&self) -> u64 {
        self.timestamp_ms
    }

    fn release(&self) {
        if !self.released.swap(true, Ordering::AcqRel) {
            self.release_counter.fetch_add(1, Ordering::SeqCst);
        }
    }
}

impl Drop for FrameLease {
    fn drop(&mut self) {
        self.release();
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LandmarkSource {
    Measured,
    Fused,
    Predicted,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContinuityReason {
    WeakObservationBoneFusion,
    ShortGapPrediction,
    OutlierRejectedPrediction,
    OutlierRejectedUnknown,
    PredictionTimeout,
    NoMeasurementBaseline,
    /// A current subject-associated equipment path repaired an unreliable
    /// wrist using a previously measured person/equipment relationship.
    EquipmentPathConstraint,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PoseObservation {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub visibility: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NormalizedRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl NormalizedRect {
    pub const fn new(x: f32, y: f32, width: f32, height: f32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    fn center(self) -> (f32, f32) {
        (self.x + self.width * 0.5, self.y + self.height * 0.5)
    }

    fn contains(self, x: f32, y: f32) -> bool {
        x >= self.x && x <= self.x + self.width && y >= self.y && y <= self.y + self.height
    }

    fn area(self) -> f32 {
        self.width.max(0.0) * self.height.max(0.0)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PoseCandidate {
    pub id: u64,
    pub bbox: NormalizedRect,
    pub observations: Vec<PoseObservation>,
    pub torso_color: [f32; 3],
}

impl PoseObservation {
    pub const fn new(x: f32, y: f32, z: f32, visibility: f32) -> Self {
        Self {
            x,
            y,
            z,
            visibility,
        }
    }

    fn is_finite(self) -> bool {
        self.x.is_finite()
            && self.y.is_finite()
            && self.z.is_finite()
            && self.visibility.is_finite()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct CanonicalLandmark {
    pub x: Option<f32>,
    pub y: Option<f32>,
    pub z: Option<f32>,
    pub observation_score: f32,
    pub canonical_confidence: f32,
    pub uncertainty: Option<f32>,
    pub source: LandmarkSource,
    pub renderable: bool,
    pub reason: Option<ContinuityReason>,
}

impl CanonicalLandmark {
    pub fn measured(x: f32, y: f32, z: f32, confidence: f32) -> Self {
        Self {
            x: Some(x),
            y: Some(y),
            z: Some(z),
            observation_score: confidence,
            canonical_confidence: confidence,
            uncertainty: None,
            source: LandmarkSource::Measured,
            renderable: confidence >= 0.5,
            reason: None,
        }
    }

    pub fn unknown(observation_score: f32, uncertainty: Option<f32>) -> Self {
        Self {
            x: None,
            y: None,
            z: None,
            observation_score,
            canonical_confidence: 0.0,
            uncertainty,
            source: LandmarkSource::Unknown,
            renderable: false,
            reason: Some(ContinuityReason::NoMeasurementBaseline),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TargetState {
    Acquiring,
    Locked,
    Uncertain,
    Lost,
    Reacquiring,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TargetSnapshot {
    pub state: TargetState,
    pub candidate_count: u8,
    pub selected_candidate_id: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PacketLineage {
    pub sequence_id: String,
    pub contract: ContractVersion,
    pub algorithm_version: String,
    pub config_version: String,
    pub inference_version: String,
    pub diagnostic_version: String,
    pub active_profile_identity: Option<String>,
    pub active_profile_hash: Option<u64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExerciseMaturity {
    Provisional,
    Calibrated,
}

impl ExerciseMaturity {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Provisional => "provisional",
            Self::Calibrated => "calibrated",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MovementDirection {
    Increasing,
    Decreasing,
    /// The first coherent excursion selects the cycle orientation. This is
    /// for exercises whose recording may begin at either physical extreme;
    /// it is not an invitation to infer action identity.
    Auto,
}

/// The scalar extracted from canonical landmarks before the generic rep state
/// machine runs.  Profiles describe the signal explicitly so an exercise is
/// never silently reduced to vertical motion.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExerciseSignalKind {
    LandmarkY,
    JointAngle,
    LandmarkDistance,
    LandmarkHorizontalDistance,
    LandmarkVerticalDistance,
    PairedLandmarkDistanceSum,
    LocalAlongAxisProgress,
    LocalCrossAxisDisplacement,
    LocalEndpointRelativeProgress,
    LocalDynamicBarAngle,
    LocalChannelAgreement,
    LocalObservability,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ExerciseSignal {
    pub kind: ExerciseSignalKind,
    pub landmarks: Vec<usize>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PoseSchemaId {
    BlazePose33,
    /// RTMPose Halpe-26. Indices 0..16 are the unchanged COCO-17 prefix.
    Halpe26,
}

impl PoseSchemaId {
    const fn hash_code(self) -> u8 {
        match self {
            Self::BlazePose33 => 0,
            Self::Halpe26 => 1,
        }
    }

    const fn landmark_count(self) -> usize {
        match self {
            Self::BlazePose33 => 33,
            Self::Halpe26 => 26,
        }
    }
}

pub const PROFILE_CAP_CANONICAL_LANDMARKS: u32 = 1 << 0;
pub const PROFILE_CAP_SUBJECT_LOCK: u32 = 1 << 1;
const PROFILE_REQUIRED_CAPABILITIES: u32 =
    PROFILE_CAP_CANONICAL_LANDMARKS | PROFILE_CAP_SUBJECT_LOCK;

/// Validated data profile consumed by the generic rep state machine. Adding an
/// exercise is data-only when the movement can be represented by these gates.
#[derive(Clone, Debug, PartialEq)]
pub struct ExerciseProfile {
    pub identity: String,
    pub content_hash: u64,
    pub maturity: ExerciseMaturity,
    pub schema: PoseSchemaId,
    pub coordinate_unit: String,
    pub state_machine_id: String,
    pub required_capabilities: u32,
    pub primary_signal: ExerciseSignal,
    pub secondary_signal: ExerciseSignal,
    pub direction: MovementDirection,
    pub start_amplitude: f32,
    pub min_primary_amplitude: f32,
    pub min_secondary_amplitude: f32,
    pub return_hysteresis: f32,
    pub ready_tolerance: f32,
    pub max_gap_ms: u64,
    pub min_rep_duration_ms: u64,
    pub max_rep_duration_ms: u64,
}

pub(crate) struct RigidBarProfileInitializer {
    pub primary_signal: ExerciseSignal,
    pub secondary_signal: ExerciseSignal,
    pub direction: MovementDirection,
    pub start_amplitude: f32,
    pub minimum_amplitude: f32,
    pub return_hysteresis: f32,
    pub ready_tolerance: f32,
    pub max_gap_ms: u64,
    pub min_rep_duration_ms: u64,
    pub max_rep_duration_ms: u64,
}

impl ExerciseProfile {
    fn into_halpe26(mut self) -> Result<Self, MotionError> {
        const BLAZEPOSE33_TO_HALPE26: [(usize, usize); 21] = [
            (0, 0),
            (2, 1),
            (5, 2),
            (7, 3),
            (8, 4),
            (11, 5),
            (12, 6),
            (13, 7),
            (14, 8),
            (15, 9),
            (16, 10),
            (23, 11),
            (24, 12),
            (25, 13),
            (26, 14),
            (27, 15),
            (28, 16),
            (29, 24),
            (30, 25),
            (31, 20),
            (32, 21),
        ];
        let map_signal = |signal: &mut ExerciseSignal| -> Result<(), MotionError> {
            for index in &mut signal.landmarks {
                let Some((_, mapped)) = BLAZEPOSE33_TO_HALPE26
                    .iter()
                    .find(|(source, _)| source == index)
                else {
                    return Err(MotionError::InvalidExerciseProfile(
                        "BlazePose joint has no Halpe26 equivalent",
                    ));
                };
                *index = *mapped;
            }
            Ok(())
        };
        map_signal(&mut self.primary_signal)?;
        map_signal(&mut self.secondary_signal)?;
        self.schema = PoseSchemaId::Halpe26;
        self.identity = format!("{}-halpe26", self.identity);
        self.content_hash = self.computed_content_hash();
        Ok(self)
    }

    pub fn march_in_place_front_provisional() -> Self {
        Self::with_computed_hash(Self {
            identity: "march-in-place/front/bilateral/bodyweight/v1".into(),
            content_hash: 0,
            maturity: ExerciseMaturity::Provisional,
            schema: PoseSchemaId::BlazePose33,
            coordinate_unit: "torso-normalized-distance".into(),
            state_machine_id: "alternating-ready-effort-return/v1".into(),
            required_capabilities: PROFILE_REQUIRED_CAPABILITIES,
            primary_signal: ExerciseSignal {
                kind: ExerciseSignalKind::LandmarkVerticalDistance,
                landmarks: vec![23, 25],
            },
            secondary_signal: ExerciseSignal {
                kind: ExerciseSignalKind::LandmarkVerticalDistance,
                landmarks: vec![24, 26],
            },
            direction: MovementDirection::Decreasing,
            start_amplitude: 0.18,
            min_primary_amplitude: 0.80,
            min_secondary_amplitude: 0.80,
            return_hysteresis: 0.18,
            ready_tolerance: 0.22,
            max_gap_ms: 700,
            min_rep_duration_ms: 500,
            max_rep_duration_ms: 4_000,
        })
    }

    pub fn alternating_knee_raise_front_provisional() -> Self {
        let mut profile = Self::march_in_place_front_provisional();
        profile.identity = "alternating-knee-raise/front/bilateral/bodyweight/v1".into();
        profile.start_amplitude = 0.25;
        profile.min_primary_amplitude = 1.10;
        profile.min_secondary_amplitude = 1.10;
        profile.return_hysteresis = 0.24;
        profile.ready_tolerance = 0.28;
        Self::with_computed_hash(profile)
    }

    pub fn side_step_touch_front_provisional() -> Self {
        Self::with_computed_hash(Self {
            identity: "side-step-touch/front/bilateral/bodyweight/v1".into(),
            content_hash: 0,
            maturity: ExerciseMaturity::Provisional,
            schema: PoseSchemaId::BlazePose33,
            coordinate_unit: "torso-normalized-distance".into(),
            state_machine_id: "alternating-ready-effort-return/v1".into(),
            required_capabilities: PROFILE_REQUIRED_CAPABILITIES,
            primary_signal: ExerciseSignal {
                kind: ExerciseSignalKind::LandmarkHorizontalDistance,
                landmarks: vec![23, 27],
            },
            secondary_signal: ExerciseSignal {
                kind: ExerciseSignalKind::LandmarkHorizontalDistance,
                landmarks: vec![24, 28],
            },
            direction: MovementDirection::Increasing,
            start_amplitude: 0.20,
            min_primary_amplitude: 0.80,
            min_secondary_amplitude: 0.80,
            return_hysteresis: 0.18,
            ready_tolerance: 0.22,
            max_gap_ms: 700,
            min_rep_duration_ms: 500,
            max_rep_duration_ms: 4_000,
        })
    }

    pub fn step_jack_front_provisional() -> Self {
        Self::with_computed_hash(Self {
            identity: "step-jack/front/bilateral/bodyweight/v1".into(),
            content_hash: 0,
            maturity: ExerciseMaturity::Provisional,
            schema: PoseSchemaId::BlazePose33,
            coordinate_unit: "torso-normalized-distance".into(),
            state_machine_id: "alternating-ready-effort-return/v1".into(),
            required_capabilities: PROFILE_REQUIRED_CAPABILITIES,
            primary_signal: ExerciseSignal {
                kind: ExerciseSignalKind::PairedLandmarkDistanceSum,
                landmarks: vec![11, 15, 23, 27],
            },
            secondary_signal: ExerciseSignal {
                kind: ExerciseSignalKind::PairedLandmarkDistanceSum,
                landmarks: vec![12, 16, 24, 28],
            },
            direction: MovementDirection::Increasing,
            start_amplitude: 0.30,
            min_primary_amplitude: 1.20,
            min_secondary_amplitude: 1.20,
            return_hysteresis: 0.22,
            ready_tolerance: 0.25,
            max_gap_ms: 700,
            min_rep_duration_ms: 500,
            max_rep_duration_ms: 4_000,
        })
    }

    pub fn lat_pulldown_provisional() -> Self {
        Self::with_computed_hash(Self {
            identity: "lat-pulldown/rear/bilateral/cable/v1".into(),
            content_hash: 0,
            maturity: ExerciseMaturity::Provisional,
            schema: PoseSchemaId::BlazePose33,
            coordinate_unit: "image-normalized-y".into(),
            state_machine_id: "ready-effort-peak-return/v1".into(),
            required_capabilities: PROFILE_REQUIRED_CAPABILITIES,
            primary_signal: ExerciseSignal {
                kind: ExerciseSignalKind::LandmarkY,
                landmarks: vec![15, 16],
            },
            secondary_signal: ExerciseSignal {
                kind: ExerciseSignalKind::LandmarkY,
                landmarks: vec![13, 14],
            },
            direction: MovementDirection::Increasing,
            start_amplitude: 0.05,
            min_primary_amplitude: 0.22,
            min_secondary_amplitude: 0.18,
            return_hysteresis: 0.05,
            ready_tolerance: 0.06,
            max_gap_ms: 700,
            min_rep_duration_ms: 450,
            max_rep_duration_ms: 8_000,
        })
    }

    pub fn lat_pulldown_rear_left_45_provisional() -> Self {
        Self::with_identity(
            Self::lat_pulldown_provisional(),
            "lat-pulldown/rear-left-45/bilateral/cable/v1",
        )
    }

    pub fn seated_shoulder_press_provisional() -> Self {
        Self::with_computed_hash(Self {
            identity: "seated-shoulder-press/front-left-45/bilateral/dumbbell/v1".into(),
            content_hash: 0,
            maturity: ExerciseMaturity::Provisional,
            schema: PoseSchemaId::BlazePose33,
            coordinate_unit: "image-normalized-y".into(),
            state_machine_id: "ready-effort-peak-return/v1".into(),
            required_capabilities: PROFILE_REQUIRED_CAPABILITIES,
            primary_signal: ExerciseSignal {
                kind: ExerciseSignalKind::LandmarkY,
                landmarks: vec![15, 16],
            },
            secondary_signal: ExerciseSignal {
                kind: ExerciseSignalKind::LandmarkY,
                landmarks: vec![13, 14],
            },
            direction: MovementDirection::Decreasing,
            start_amplitude: 0.04,
            min_primary_amplitude: 0.14,
            min_secondary_amplitude: 0.12,
            return_hysteresis: 0.04,
            ready_tolerance: 0.06,
            max_gap_ms: 700,
            min_rep_duration_ms: 450,
            max_rep_duration_ms: 8_000,
        })
    }

    pub fn seated_shoulder_press_front_provisional() -> Self {
        Self::with_identity(
            Self::seated_shoulder_press_provisional(),
            "seated-shoulder-press/front/bilateral/dumbbell/v1",
        )
    }

    pub fn barbell_bench_press_local_front_provisional() -> Self {
        Self::local_barbell_profile(
            "barbell-bench-press/front/bilateral/barbell/local-v1",
            "local-barbell-bench-ready-effort-return/v1",
            0.08,
            0.13,
            0.045,
            0.07,
            450,
        )
    }

    pub fn barbell_bench_press_local_front_left_provisional() -> Self {
        Self::with_identity(
            Self::barbell_bench_press_local_front_provisional(),
            "barbell-bench-press/front-left-45/bilateral/barbell/local-v1",
        )
    }

    pub fn barbell_bench_press_local_front_right_provisional() -> Self {
        Self::with_identity(
            Self::barbell_bench_press_local_front_provisional(),
            "barbell-bench-press/front-right-45/bilateral/barbell/local-v1",
        )
    }

    /// Frozen known-video tracer profile. Its name and maturity deliberately
    /// prevent callers from mistaking a touched-benchmark feasibility profile
    /// for source-independent production recognition.
    pub fn barbell_bench_press_touched_benchmark_front_left_provisional() -> Self {
        Self::with_computed_hash(Self {
            identity:
                "barbell_bench_press/frontLeft45/bilateral/barbell/touched-benchmark-provisional-v1"
                    .into(),
            content_hash: 0,
            maturity: ExerciseMaturity::Provisional,
            schema: PoseSchemaId::Halpe26,
            coordinate_unit: "image-angle-deg".into(),
            state_machine_id: "barbell-axis-primary-ready-effort-return/v1".into(),
            required_capabilities: PROFILE_REQUIRED_CAPABILITIES,
            primary_signal: ExerciseSignal {
                kind: ExerciseSignalKind::JointAngle,
                landmarks: vec![6, 8, 10],
            },
            secondary_signal: ExerciseSignal {
                kind: ExerciseSignalKind::JointAngle,
                landmarks: vec![5, 7, 9],
            },
            direction: MovementDirection::Decreasing,
            start_amplitude: 10.0,
            min_primary_amplitude: 30.0,
            min_secondary_amplitude: 30.0,
            return_hysteresis: 15.0,
            ready_tolerance: 8.0,
            max_gap_ms: 1_000,
            min_rep_duration_ms: 350,
            max_rep_duration_ms: 10_000,
        })
    }

    /// Provisional rigid-bar family initializer used by the assessment Bundle
    /// catalog. It observes bilateral elbow excursion in the canonical Halpe-26
    /// stream; action identity and camera view remain explicit inputs rather
    /// than being inferred from pose geometry.
    pub(crate) fn rigid_bar_provisional(
        identity: &str,
        initializer: RigidBarProfileInitializer,
    ) -> Self {
        let coordinate_unit = expected_coordinate_unit(
            initializer.primary_signal.kind,
            initializer.secondary_signal.kind,
        );
        Self::with_computed_hash(Self {
            identity: identity.into(),
            content_hash: 0,
            maturity: ExerciseMaturity::Provisional,
            schema: PoseSchemaId::Halpe26,
            coordinate_unit: coordinate_unit.into(),
            state_machine_id: "cycle-aligned-ready-effort-peak-return/v1".into(),
            required_capabilities: PROFILE_REQUIRED_CAPABILITIES,
            primary_signal: initializer.primary_signal,
            secondary_signal: initializer.secondary_signal,
            direction: initializer.direction,
            start_amplitude: initializer.start_amplitude,
            min_primary_amplitude: initializer.minimum_amplitude,
            min_secondary_amplitude: initializer.minimum_amplitude,
            return_hysteresis: initializer.return_hysteresis,
            ready_tolerance: initializer.ready_tolerance,
            max_gap_ms: initializer.max_gap_ms,
            min_rep_duration_ms: initializer.min_rep_duration_ms,
            max_rep_duration_ms: initializer.max_rep_duration_ms,
        })
    }

    pub fn seated_barbell_shoulder_press_local_front_provisional() -> Self {
        Self::local_barbell_profile(
            "seated-shoulder-press/front/bilateral/barbell/local-v1",
            "local-barbell-shoulder-press-ready-effort-return/v1",
            0.10,
            0.18,
            0.05,
            0.08,
            400,
        )
    }

    pub fn seated_barbell_shoulder_press_local_front_left_provisional() -> Self {
        Self::with_identity(
            Self::seated_barbell_shoulder_press_local_front_provisional(),
            "seated-shoulder-press/front-left-45/bilateral/barbell/local-v1",
        )
    }

    pub fn seated_barbell_shoulder_press_local_front_right_provisional() -> Self {
        Self::with_identity(
            Self::seated_barbell_shoulder_press_local_front_provisional(),
            "seated-shoulder-press/front-right-45/bilateral/barbell/local-v1",
        )
    }

    pub fn dumbbell_shoulder_press_front_provisional() -> Self {
        Self::with_identity(
            Self::seated_shoulder_press_front_provisional(),
            "dumbbell-shoulder-press/front/bilateral/dumbbell/v1",
        )
    }

    fn local_barbell_profile(
        identity: &str,
        state_machine_id: &str,
        start_amplitude: f32,
        minimum_amplitude: f32,
        return_hysteresis: f32,
        ready_tolerance: f32,
        min_rep_duration_ms: u64,
    ) -> Self {
        Self::with_computed_hash(Self {
            identity: identity.into(),
            content_hash: 0,
            maturity: ExerciseMaturity::Provisional,
            schema: PoseSchemaId::Halpe26,
            coordinate_unit: "set-normalized-local-motion".into(),
            state_machine_id: state_machine_id.into(),
            required_capabilities: PROFILE_REQUIRED_CAPABILITIES,
            primary_signal: ExerciseSignal {
                kind: ExerciseSignalKind::LocalAlongAxisProgress,
                landmarks: vec![],
            },
            secondary_signal: ExerciseSignal {
                kind: ExerciseSignalKind::LocalChannelAgreement,
                landmarks: vec![],
            },
            direction: MovementDirection::Increasing,
            start_amplitude,
            min_primary_amplitude: minimum_amplitude,
            min_secondary_amplitude: 0.10,
            return_hysteresis,
            ready_tolerance,
            max_gap_ms: 700,
            min_rep_duration_ms,
            max_rep_duration_ms: 6_000,
        })
    }

    fn with_identity(mut profile: Self, identity: &str) -> Self {
        profile.identity = identity.into();
        Self::with_computed_hash(profile)
    }

    fn with_computed_hash(mut profile: Self) -> Self {
        profile.content_hash = profile.computed_content_hash();
        profile
    }

    pub fn computed_content_hash(&self) -> u64 {
        let mut hash = FNV_OFFSET;
        for bytes in [
            self.identity.as_bytes(),
            self.coordinate_unit.as_bytes(),
            self.state_machine_id.as_bytes(),
        ] {
            hash = fnv_bytes(hash, bytes.iter().copied());
            hash = fnv_bytes(hash, [0]);
        }
        hash = fnv_bytes(hash, self.required_capabilities.to_le_bytes());
        hash = fnv_bytes(
            hash,
            [match self.maturity {
                ExerciseMaturity::Provisional => 0,
                ExerciseMaturity::Calibrated => 1,
            }],
        );
        hash = fnv_bytes(hash, [self.schema.hash_code()]);
        hash = fnv_bytes(
            hash,
            [match self.direction {
                MovementDirection::Increasing => 0,
                MovementDirection::Decreasing => 1,
                MovementDirection::Auto => 2,
            }],
        );
        for signal in [&self.primary_signal, &self.secondary_signal] {
            hash = fnv_bytes(
                hash,
                [signal.kind.hash_code(), signal.landmarks.len() as u8],
            );
            hash = fnv_bytes(hash, signal.landmarks.iter().map(|value| *value as u8));
        }
        for gate in [
            self.start_amplitude,
            self.min_primary_amplitude,
            self.min_secondary_amplitude,
            self.return_hysteresis,
            self.ready_tolerance,
        ] {
            hash = fnv_bytes(hash, gate.to_bits().to_le_bytes());
        }
        hash = fnv_bytes(hash, self.max_gap_ms.to_le_bytes());
        hash = fnv_bytes(hash, self.min_rep_duration_ms.to_le_bytes());
        fnv_bytes(hash, self.max_rep_duration_ms.to_le_bytes())
    }

    fn validate(&self) -> Result<(), MotionError> {
        if self.identity.trim().is_empty()
            || self.identity.split('/').count() < 5
            || self.identity.chars().any(char::is_whitespace)
        {
            return Err(MotionError::InvalidExerciseProfile("empty identity"));
        }
        if self.content_hash == 0 || self.content_hash != self.computed_content_hash() {
            return Err(MotionError::InvalidExerciseProfile("content hash mismatch"));
        }
        if self.coordinate_unit
            != expected_coordinate_unit(self.primary_signal.kind, self.secondary_signal.kind)
        {
            return Err(MotionError::InvalidExerciseProfile(
                "unsupported coordinate unit",
            ));
        }
        if self.state_machine_id != "ready-effort-peak-return/v1"
            && self.state_machine_id != "cycle-aligned-ready-effort-peak-return/v1"
            && self.state_machine_id != "cycle-aligned-equipment-turnaround-down-fusion/v1"
            && self.state_machine_id != "cycle-aligned-equipment-turnaround-up-fusion/v1"
            && self.state_machine_id != "median-100ms-ready-effort-peak-return/v1"
            && self.state_machine_id != "median-200ms-ready-effort-peak-return/v1"
            && self.state_machine_id != "median-300ms-ready-effort-peak-return/v1"
            && self.state_machine_id != "median-400ms-ready-effort-peak-return/v1"
            && self.state_machine_id != "median-600ms-ready-effort-peak-return/v1"
            && self.state_machine_id != "cycle-aligned-median-100ms-ready-effort-peak-return/v1"
            && self.state_machine_id != "cycle-aligned-median-200ms-ready-effort-peak-return/v1"
            && self.state_machine_id != "cycle-aligned-median-300ms-ready-effort-peak-return/v1"
            && self.state_machine_id != "cycle-aligned-median-400ms-ready-effort-peak-return/v1"
            && self.state_machine_id != "cycle-aligned-median-600ms-ready-effort-peak-return/v1"
            && self.state_machine_id != "stable-cycle-200ms-ready-effort-peak-return/v1"
            && self.state_machine_id != "alternating-ready-effort-return/v1"
            && self.state_machine_id != "barbell-axis-primary-ready-effort-return/v1"
            && self.state_machine_id != "local-barbell-bench-ready-effort-return/v1"
            && self.state_machine_id != "local-barbell-shoulder-press-ready-effort-return/v1"
        {
            return Err(MotionError::InvalidExerciseProfile(
                "unsupported state graph",
            ));
        }
        if self.required_capabilities != PROFILE_REQUIRED_CAPABILITIES {
            return Err(MotionError::InvalidExerciseProfile(
                "required capabilities mismatch",
            ));
        }
        if self.maturity != ExerciseMaturity::Provisional {
            return Err(MotionError::InvalidExerciseProfile(
                "calibrated profile requires an evidence manifest",
            ));
        }
        let schema_landmark_count = self.schema.landmark_count();
        if !self.primary_signal.validate(schema_landmark_count)
            || !self.secondary_signal.validate(schema_landmark_count)
        {
            return Err(MotionError::InvalidExerciseProfile("missing joint group"));
        }
        let joints = self
            .primary_signal
            .landmarks
            .iter()
            .chain(&self.secondary_signal.landmarks)
            .copied()
            .collect::<Vec<_>>();
        if joints.iter().any(|index| *index >= schema_landmark_count) {
            return Err(MotionError::InvalidExerciseProfile(
                "joint index outside schema",
            ));
        }
        let gates = [
            self.start_amplitude,
            self.min_primary_amplitude,
            self.min_secondary_amplitude,
            self.return_hysteresis,
            self.ready_tolerance,
        ];
        if gates
            .iter()
            .any(|value| !value.is_finite() || *value <= 0.0)
            || self.start_amplitude >= self.min_primary_amplitude
            || self.return_hysteresis >= self.min_primary_amplitude
            || self.max_gap_ms < MAX_PREDICTION_MS
            || self.min_rep_duration_ms == 0
            || self.min_rep_duration_ms > self.max_rep_duration_ms
        {
            return Err(MotionError::InvalidExerciseProfile(
                "invalid state-machine gates",
            ));
        }
        Ok(())
    }

    fn uses_alternating_state_graph(&self) -> bool {
        self.state_machine_id == "alternating-ready-effort-return/v1"
    }

    fn uses_barbell_axis_state_graph(&self) -> bool {
        self.state_machine_id == "barbell-axis-primary-ready-effort-return/v1"
            || self.uses_local_barbell_state_graph()
    }

    fn uses_local_barbell_state_graph(&self) -> bool {
        self.state_machine_id == "local-barbell-bench-ready-effort-return/v1"
            || self.state_machine_id == "local-barbell-shoulder-press-ready-effort-return/v1"
    }

    fn uses_local_signals(&self) -> bool {
        self.primary_signal.kind.is_local() || self.secondary_signal.kind.is_local()
    }

    fn uses_local_shoulder_press_state_graph(&self) -> bool {
        self.state_machine_id == "local-barbell-shoulder-press-ready-effort-return/v1"
    }

    fn uses_cycle_aligned_boundaries(&self) -> bool {
        self.state_machine_id == "cycle-aligned-ready-effort-peak-return/v1"
            || self.uses_equipment_turnaround_fusion()
            || self.state_machine_id.starts_with("cycle-aligned-median-")
            || self.state_machine_id.starts_with("stable-cycle-")
    }

    fn uses_equipment_turnaround_fusion(&self) -> bool {
        self.state_machine_id == "cycle-aligned-equipment-turnaround-down-fusion/v1"
            || self.state_machine_id == "cycle-aligned-equipment-turnaround-up-fusion/v1"
    }

    fn equipment_effort_direction(&self) -> Option<MovementDirection> {
        match self.state_machine_id.as_str() {
            "cycle-aligned-equipment-turnaround-down-fusion/v1" => {
                Some(MovementDirection::Increasing)
            }
            "cycle-aligned-equipment-turnaround-up-fusion/v1" => {
                Some(MovementDirection::Decreasing)
            }
            _ => None,
        }
    }

    fn stable_phase_dwell_ms(&self) -> Option<u64> {
        match self.state_machine_id.as_str() {
            "stable-cycle-200ms-ready-effort-peak-return/v1" => Some(200),
            _ => None,
        }
    }

    fn signal_smoothing_ms(&self) -> Option<u64> {
        match self.state_machine_id.as_str() {
            "median-100ms-ready-effort-peak-return/v1" => Some(100),
            "median-200ms-ready-effort-peak-return/v1" => Some(200),
            "median-300ms-ready-effort-peak-return/v1" => Some(300),
            "median-400ms-ready-effort-peak-return/v1" => Some(400),
            "median-600ms-ready-effort-peak-return/v1" => Some(600),
            "cycle-aligned-median-100ms-ready-effort-peak-return/v1" => Some(100),
            "cycle-aligned-median-200ms-ready-effort-peak-return/v1" => Some(200),
            "cycle-aligned-median-300ms-ready-effort-peak-return/v1" => Some(300),
            "cycle-aligned-median-400ms-ready-effort-peak-return/v1" => Some(400),
            "cycle-aligned-median-600ms-ready-effort-peak-return/v1" => Some(600),
            _ => None,
        }
    }
}

impl ExerciseSignalKind {
    const fn hash_code(self) -> u8 {
        match self {
            Self::LandmarkY => 0,
            Self::JointAngle => 1,
            Self::LandmarkDistance => 2,
            Self::LandmarkHorizontalDistance => 3,
            Self::PairedLandmarkDistanceSum => 4,
            Self::LandmarkVerticalDistance => 5,
            Self::LocalAlongAxisProgress => 6,
            Self::LocalCrossAxisDisplacement => 7,
            Self::LocalEndpointRelativeProgress => 8,
            Self::LocalDynamicBarAngle => 9,
            Self::LocalChannelAgreement => 10,
            Self::LocalObservability => 11,
        }
    }
}

impl ExerciseSignal {
    fn validate(&self, schema_landmark_count: usize) -> bool {
        let expected_count = match self.kind {
            ExerciseSignalKind::LandmarkY => 1..=2,
            ExerciseSignalKind::JointAngle => 3..=3,
            ExerciseSignalKind::LandmarkDistance => 2..=2,
            ExerciseSignalKind::LandmarkHorizontalDistance => 2..=2,
            ExerciseSignalKind::LandmarkVerticalDistance => 2..=2,
            ExerciseSignalKind::PairedLandmarkDistanceSum => 4..=4,
            ExerciseSignalKind::LocalAlongAxisProgress
            | ExerciseSignalKind::LocalCrossAxisDisplacement
            | ExerciseSignalKind::LocalEndpointRelativeProgress
            | ExerciseSignalKind::LocalDynamicBarAngle
            | ExerciseSignalKind::LocalChannelAgreement
            | ExerciseSignalKind::LocalObservability => 0..=0,
        };
        expected_count.contains(&self.landmarks.len())
            && self
                .landmarks
                .iter()
                .all(|index| *index < schema_landmark_count)
            && self.landmarks.windows(2).all(|pair| pair[0] != pair[1])
    }
}

fn expected_coordinate_unit(
    primary: ExerciseSignalKind,
    secondary: ExerciseSignalKind,
) -> &'static str {
    match (primary, secondary) {
        (ExerciseSignalKind::LandmarkY, ExerciseSignalKind::LandmarkY) => "image-normalized-y",
        (ExerciseSignalKind::JointAngle, ExerciseSignalKind::JointAngle) => "image-angle-deg",
        (ExerciseSignalKind::LandmarkDistance, ExerciseSignalKind::LandmarkDistance)
        | (
            ExerciseSignalKind::LandmarkHorizontalDistance,
            ExerciseSignalKind::LandmarkHorizontalDistance,
        )
        | (
            ExerciseSignalKind::LandmarkVerticalDistance,
            ExerciseSignalKind::LandmarkVerticalDistance,
        )
        | (
            ExerciseSignalKind::PairedLandmarkDistanceSum,
            ExerciseSignalKind::PairedLandmarkDistanceSum,
        ) => "torso-normalized-distance",
        (primary, secondary) if primary.is_local() && secondary.is_local() => {
            "set-normalized-local-motion"
        }
        _ => "derived-kinematic-signal",
    }
}

impl ExerciseSignalKind {
    const fn is_local(self) -> bool {
        matches!(
            self,
            Self::LocalAlongAxisProgress
                | Self::LocalCrossAxisDisplacement
                | Self::LocalEndpointRelativeProgress
                | Self::LocalDynamicBarAngle
                | Self::LocalChannelAgreement
                | Self::LocalObservability
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RepPhase {
    Ready,
    Effort,
    Peak,
    Return,
    Frozen,
}

/// Explicit ownership of the current recorded training set. A replay session
/// starts active for backwards-compatible offline processing; live hosts must
/// call `begin_set` before recording and `finish_set` when recording stops.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SetLifecycle {
    Idle,
    Arming,
    Active,
    Paused,
    Finished,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetStateSnapshot {
    pub lifecycle: SetLifecycle,
}

impl Default for SetStateSnapshot {
    fn default() -> Self {
        Self {
            lifecycle: SetLifecycle::Idle,
        }
    }
}

const SET_ARMING_STABLE_MS: u64 = 500;
const SET_ARMING_MAX_MS: u64 = 2_000;
const SET_PAUSE_IDLE_MS: u64 = 1_500;
/// A cycle boundary is the observed ready extremum, not the first threshold
/// crossing on the way back. Keep a short causal look-behind window so the
/// sealed timestamp can point at that extremum without using a future frame.
const CYCLE_ALIGNED_READY_DWELL_MS: u64 = 500;

#[derive(Clone, Debug)]
struct SetGate {
    state: SetStateSnapshot,
    arming_since_ms: Option<u64>,
    stable_since_ms: Option<u64>,
    idle_since_ms: Option<u64>,
    previous_primary: Option<f32>,
    manually_paused: bool,
}

impl Default for SetGate {
    fn default() -> Self {
        Self {
            state: SetStateSnapshot::default(),
            arming_since_ms: None,
            stable_since_ms: None,
            idle_since_ms: None,
            previous_primary: None,
            manually_paused: false,
        }
    }
}

impl SetGate {
    fn replay_active() -> Self {
        Self {
            state: SetStateSnapshot {
                lifecycle: SetLifecycle::Active,
            },
            arming_since_ms: None,
            stable_since_ms: None,
            idle_since_ms: None,
            previous_primary: None,
            manually_paused: false,
        }
    }

    fn begin(&mut self) {
        self.state.lifecycle = SetLifecycle::Arming;
        self.arming_since_ms = None;
        self.stable_since_ms = None;
        self.idle_since_ms = None;
        self.previous_primary = None;
        self.manually_paused = false;
    }

    fn finish(&mut self) {
        self.state.lifecycle = SetLifecycle::Finished;
        self.arming_since_ms = None;
        self.stable_since_ms = None;
        self.idle_since_ms = None;
        self.previous_primary = None;
        self.manually_paused = false;
    }

    fn pause(&mut self) {
        if matches!(
            self.state.lifecycle,
            SetLifecycle::Arming | SetLifecycle::Active
        ) {
            self.state.lifecycle = SetLifecycle::Paused;
            self.idle_since_ms = None;
            self.manually_paused = true;
        }
    }

    fn resume(&mut self) {
        if self.state.lifecycle == SetLifecycle::Paused {
            self.state.lifecycle = SetLifecycle::Active;
            self.idle_since_ms = None;
            self.manually_paused = false;
        }
    }

    /// Returns whether this frame may advance the rep state machine.  The
    /// first `active` frame after arming is deliberately withheld, so the
    /// stable setup pose becomes an engine baseline rather than a rep sample.
    fn advance(
        &mut self,
        profile: Option<&ExerciseProfile>,
        target_state: TargetState,
        canonical: &[CanonicalLandmark],
        equipment: Option<&EquipmentFrameEvidence>,
        local_coordinate: Option<&LocalMotionCoordinateEvidence>,
        timestamp_ms: u64,
        rep_phase: RepPhase,
    ) -> bool {
        let primary = profile.and_then(|profile| {
            if profile.uses_local_signals() {
                resolved_profile_primary(profile, canonical, local_coordinate)
                    .map(|measurement| measurement.value)
            } else if profile.uses_barbell_axis_state_graph() {
                equipment.and_then(|frame| {
                    frame
                        .tracks
                        .iter()
                        .filter(|track| {
                            track.kind == EquipmentKind::BarbellShaft && track.judgeable_path
                        })
                        .max_by(|left, right| {
                            (left.observation_score * left.association_confidence).total_cmp(
                                &(right.observation_score * right.association_confidence),
                            )
                        })
                        .map(|track| track.center_y)
                })
            } else {
                profile_signal_with_local(profile, canonical, local_coordinate)
                    .map(|(primary, _, _, _)| primary)
            }
        });
        let observable =
            target_state == TargetState::Locked && (profile.is_none() || primary.is_some());
        let resume_delta = profile
            .map(|profile| {
                if profile.uses_local_barbell_state_graph() {
                    (profile.start_amplitude * 0.30).max(0.001)
                } else if profile.uses_barbell_axis_state_graph() {
                    (32.0 / 640.0) * 0.30
                } else {
                    (profile.start_amplitude * 0.30).max(0.001)
                }
            })
            .unwrap_or(0.001);

        match self.state.lifecycle {
            SetLifecycle::Idle | SetLifecycle::Finished => false,
            SetLifecycle::Arming => {
                if !observable {
                    self.stable_since_ms = None;
                    self.previous_primary = None;
                    return false;
                }
                let arming_since = *self.arming_since_ms.get_or_insert(timestamp_ms);
                if let (Some(previous), Some(current)) = (self.previous_primary, primary) {
                    if (current - previous).abs() >= resume_delta {
                        self.stable_since_ms = Some(timestamp_ms);
                    }
                }
                let stable_since = *self.stable_since_ms.get_or_insert(timestamp_ms);
                self.previous_primary = primary;
                if timestamp_ms.saturating_sub(stable_since) >= SET_ARMING_STABLE_MS
                    || timestamp_ms.saturating_sub(arming_since) >= SET_ARMING_MAX_MS
                {
                    self.state.lifecycle = SetLifecycle::Active;
                    self.arming_since_ms = None;
                }
                false
            }
            SetLifecycle::Active => {
                if !observable {
                    self.state.lifecycle = SetLifecycle::Paused;
                    self.idle_since_ms = Some(timestamp_ms);
                    return rep_phase != RepPhase::Ready;
                }
                if rep_phase == RepPhase::Ready {
                    match (self.previous_primary, primary) {
                        (Some(previous), Some(current))
                            if (current - previous).abs() < resume_delta =>
                        {
                            let idle_since = *self.idle_since_ms.get_or_insert(timestamp_ms);
                            if timestamp_ms.saturating_sub(idle_since) >= SET_PAUSE_IDLE_MS {
                                self.state.lifecycle = SetLifecycle::Paused;
                            }
                        }
                        _ => self.idle_since_ms = None,
                    }
                } else {
                    self.idle_since_ms = None;
                }
                self.previous_primary = primary;
                true
            }
            SetLifecycle::Paused => {
                if self.manually_paused {
                    return false;
                }
                if !observable {
                    return rep_phase != RepPhase::Ready;
                }
                let resumed = match (self.previous_primary, primary) {
                    (Some(previous), Some(current)) => (current - previous).abs() >= resume_delta,
                    (None, Some(current)) => {
                        self.previous_primary = Some(current);
                        false
                    }
                    _ => false,
                };
                if resumed {
                    self.state.lifecycle = SetLifecycle::Active;
                    self.idle_since_ms = None;
                    self.previous_primary = primary;
                    true
                } else {
                    rep_phase != RepPhase::Ready
                }
            }
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepStateSnapshot {
    pub phase: RepPhase,
    pub active_rep_id: Option<u64>,
    pub partial_attempts: u64,
    pub recovered_across_gap: bool,
}

impl Default for RepStateSnapshot {
    fn default() -> Self {
        Self {
            phase: RepPhase::Ready,
            active_rep_id: None,
            partial_attempts: 0,
            recovered_across_gap: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SealedRep {
    pub rep_id: u64,
    pub start_frame_id: u64,
    pub start_timestamp_ms: u64,
    pub peak_frame_id: u64,
    pub peak_timestamp_ms: u64,
    /// First later observation that causally confirmed the earlier extremum.
    pub turnaround_confirmed_timestamp_ms: u64,
    pub end_frame_id: u64,
    pub end_timestamp_ms: u64,
    pub revision: u32,
    pub canonical_slice_hash: u64,
    pub profile_identity: String,
    pub profile_hash: u64,
    pub profile_maturity: &'static str,
    pub quality_verdict: Option<String>,
    pub recovered_across_gap: bool,
    pub disposition: RepDisposition,
    pub evidence_reason: Option<RepEvidenceReason>,
    /// Descriptive observations about a coherent motion cycle. These never
    /// decide whether a movement exists: they explain how its measured path
    /// differs from the recognition profile so callers can give useful
    /// feedback instead of silently discarding a smaller, real effort.
    pub observation_findings: Vec<RepObservationFinding>,
    /// Causal normalized facts captured at the three immutable Rep endpoints.
    /// This is additive shadow evidence; legacy profiles leave it absent.
    pub normalized_endpoints: Option<NormalizedRepEndpointEvidence>,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedRepEndpointEvidence {
    pub coordinate_frame_id: u64,
    pub start_anchor: LocalMotionCoordinateEvidence,
    pub primary_turnaround: LocalMotionCoordinateEvidence,
    pub end_return: LocalMotionCoordinateEvidence,
    #[serde(default)]
    pub anatomical_left_turnaround_timestamp_ms: Option<u64>,
    #[serde(default)]
    pub anatomical_right_turnaround_timestamp_ms: Option<u64>,
}

/// Immutable recognition decision for one completed movement candidate. Only
/// `Confirmed` contributes to formal training volume.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RepDisposition {
    Confirmed,
    NeedsReview,
    Rejected,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RepEvidenceReason {
    ShortContinuityRecovery,
    LongContinuityLoss,
    SubjectChanged,
    IncompleteCycle,
    AntiInterferenceFilter,
    DurationExceeded,
    RequiredJointLoss,
    CoordinateProvisional,
    LocalTrajectoryChannelConflict,
}

/// Profile-relative observations attached to a sealed movement. They are not
/// a correctness score and must not be interpreted as a medical judgement.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RepObservationFinding {
    PrimaryRangeBelowExpectation,
    SecondaryRangeBelowExpectation,
    CycleFasterThanExpected,
    /// At least the turnaround boundary was established by the
    /// subject-associated shaft trajectory. Pose remains an independent
    /// channel and may still own the complete-cycle start/end lifecycle.
    EquipmentPrimaryBoundary,
    PoseEquipmentTurnaroundAligned,
    PoseUnavailableAtTurnaround,
    PoseEquipmentTurnaroundConflict,
    EquipmentPathCoverageLow,
    /// Reliable view-normalized pose and equipment paths materially
    /// disagreed during this Rep, even if their extrema occurred together.
    LocalTrajectoryChannelConflict,
}

/// Stable anatomical names for the projected joint angles published with
/// every canonical frame.  These definitions are deliberately independent of
/// an exercise profile so every client sees the same number for the same
/// three landmarks.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JointAngleKind {
    Elbow,
    Shoulder,
    Hip,
    Knee,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BodySide {
    Left,
    Right,
}

/// One camera-plane angle derived from the canonical skeleton. `judgeable`
/// is false when the subject is not locked, confidence is weak, or any input
/// landmark is only predicted. Callers may retain the value for diagnostics,
/// but must not present it as a trustworthy live measurement.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct JointAngleSnapshot {
    pub kind: JointAngleKind,
    pub side: BodySide,
    pub value_degrees: Option<f32>,
    pub confidence: f32,
    pub source: LandmarkSource,
    pub judgeable: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RepBoundaryRevision {
    pub start_frame_id: u64,
    pub start_timestamp_ms: u64,
    pub peak_frame_id: u64,
    pub peak_timestamp_ms: u64,
    pub end_frame_id: u64,
    pub end_timestamp_ms: u64,
    pub canonical_slice_hash: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MotionPacket {
    pub lineage: PacketLineage,
    pub frame_id: u64,
    pub source_timestamp_ms: u64,
    pub subject_epoch: u64,
    pub target: TargetSnapshot,
    pub canonical: Vec<CanonicalLandmark>,
    pub joint_angles: Vec<JointAngleSnapshot>,
    /// Subject-associated equipment evidence. Contract minors before 1.7 do
    /// not serialize this field; callers must not infer equipment from wrists.
    pub equipment: EquipmentFrameEvidence,
    /// Additive camera-plane evidence from the per-set Rust coordinate layer.
    /// Raw landmarks and equipment geometry remain authoritative observations.
    pub local_motion_coordinate: LocalMotionCoordinateEvidence,
    pub set_state: SetStateSnapshot,
    pub rep_state: RepStateSnapshot,
    /// Newly sealed objects only. Consumers accumulate by `(subject_epoch,
    /// rep_id, revision)`; boundaries never mutate in later packets.
    pub completed_reps: Vec<SealedRep>,
    /// Subject epoch captured when each corresponding Rep outcome was sealed.
    /// This is native provenance for assessment; legacy packet encodings omit
    /// it until a future contract minor explicitly adds the field.
    pub completed_rep_subject_epochs: Vec<u64>,
    /// Rust-authored, immutable review proposals for `completed_reps`.  This
    /// remains empty for packet contract minors before 1.8.
    pub quality_proposals: Vec<RustQualityProposal>,
}

/// Opaque end-of-set output authored by `MotionSession`. It carries only Rep
/// candidates sealed by the installed RepEngine; assessment consumers cannot
/// construct a second, competing repetition stream.
#[derive(Clone, Debug, PartialEq)]
pub struct MotionSetClosure {
    lineage: PacketLineage,
    source_timestamp_ms: Option<u64>,
    subject_epoch: u64,
    completed_reps: Vec<SealedRep>,
    completed_rep_subject_epochs: Vec<u64>,
}

impl MotionSetClosure {
    pub fn completed_rep_count(&self) -> usize {
        self.completed_reps.len()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PacketEncodeError {
    FieldTooLong(&'static str),
    TooManyLandmarks,
    NonFiniteLandmark { index: usize },
    NonFiniteEquipment { track_id: u64 },
    NonFiniteLocalCoordinate,
    QualityPayloadTooLarge,
    PacketTooLarge,
}

impl fmt::Display for PacketEncodeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for PacketEncodeError {}

/// Encodes the immutable product packet once for all cross-language consumers.
/// Optional numeric fields use presence bits and zero payloads; NaN is never a
/// missing-value sentinel.
pub fn encode_motion_packet(packet: &MotionPacket) -> Result<Vec<u8>, PacketEncodeError> {
    let sequence = packet.lineage.sequence_id.as_bytes();
    let algorithm = packet.lineage.algorithm_version.as_bytes();
    let config_version = packet.lineage.config_version.as_bytes();
    let inference_version = packet.lineage.inference_version.as_bytes();
    let diagnostic_version = packet.lineage.diagnostic_version.as_bytes();
    let sequence_len = u16::try_from(sequence.len())
        .map_err(|_| PacketEncodeError::FieldTooLong("sequence_id"))?;
    let algorithm_len = u16::try_from(algorithm.len())
        .map_err(|_| PacketEncodeError::FieldTooLong("algorithm_version"))?;
    let config_version_len = u16::try_from(config_version.len())
        .map_err(|_| PacketEncodeError::FieldTooLong("config_version"))?;
    let inference_version_len = u16::try_from(inference_version.len())
        .map_err(|_| PacketEncodeError::FieldTooLong("inference_version"))?;
    let diagnostic_version_len = u16::try_from(diagnostic_version.len())
        .map_err(|_| PacketEncodeError::FieldTooLong("diagnostic_version"))?;
    let profile_identity = packet
        .lineage
        .active_profile_identity
        .as_deref()
        .unwrap_or("")
        .as_bytes();
    let profile_identity_len = u16::try_from(profile_identity.len())
        .map_err(|_| PacketEncodeError::FieldTooLong("active_profile_identity"))?;
    let landmark_count =
        u16::try_from(packet.canonical.len()).map_err(|_| PacketEncodeError::TooManyLandmarks)?;

    let mut bytes =
        Vec::with_capacity(42 + sequence.len() + algorithm.len() + packet.canonical.len() * 26);
    bytes.extend_from_slice(b"MOTN");
    bytes.extend_from_slice(&packet.lineage.contract.major.to_le_bytes());
    bytes.extend_from_slice(&packet.lineage.contract.minor.to_le_bytes());
    bytes.extend_from_slice(&0_u32.to_le_bytes());
    bytes.extend_from_slice(&packet.frame_id.to_le_bytes());
    bytes.extend_from_slice(&packet.source_timestamp_ms.to_le_bytes());
    bytes.extend_from_slice(&packet.subject_epoch.to_le_bytes());
    bytes.push(target_state_code(packet.target.state));
    bytes.push(packet.target.candidate_count);
    bytes.extend_from_slice(&sequence_len.to_le_bytes());
    bytes.extend_from_slice(sequence);
    bytes.extend_from_slice(&algorithm_len.to_le_bytes());
    bytes.extend_from_slice(algorithm);
    bytes.extend_from_slice(&landmark_count.to_le_bytes());

    for (index, landmark) in packet.canonical.iter().enumerate() {
        let coordinates = match (landmark.x, landmark.y, landmark.z) {
            (Some(x), Some(y), Some(z)) if x.is_finite() && y.is_finite() && z.is_finite() => {
                Some((x, y, z))
            }
            (None, None, None) => None,
            _ => return Err(PacketEncodeError::NonFiniteLandmark { index }),
        };
        if !landmark.observation_score.is_finite()
            || !landmark.canonical_confidence.is_finite()
            || landmark.uncertainty.is_some_and(|value| !value.is_finite())
        {
            return Err(PacketEncodeError::NonFiniteLandmark { index });
        }
        bytes.push(landmark_source_code(landmark.source));
        let mut flags = 0_u8;
        if landmark.renderable {
            flags |= 1;
        }
        if coordinates.is_some() {
            flags |= 1 << 1;
        }
        if landmark.uncertainty.is_some() {
            flags |= 1 << 2;
        }
        flags |= continuity_reason_code(landmark.reason) << 3;
        bytes.push(flags);
        let (x, y, z) = coordinates.unwrap_or((0.0, 0.0, 0.0));
        for value in [
            x,
            y,
            z,
            landmark.observation_score,
            landmark.canonical_confidence,
            landmark.uncertainty.unwrap_or(0.0),
        ] {
            // Fused/predicted landmarks are produced by floating-point
            // temporal math. Native ARM, native x86 and Wasm can differ by a
            // single ULP even when they consume identical observations. Keep
            // full precision inside the recognizer, but stabilize the public
            // packet so all client bridges emit the same evidence bytes.
            let value = if landmark.source == LandmarkSource::Measured {
                value
            } else {
                stable_packet_landmark(value)
            };
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }

    // Minor-version extension: old decoders intentionally stop after the
    // canonical array. The marker lets newer consumers share target identity
    // and immutable rep boundaries without changing the major header.
    bytes.extend_from_slice(b"RPS1");
    bytes.push(u8::from(packet.target.selected_candidate_id.is_some()));
    bytes.extend_from_slice(
        &packet
            .target
            .selected_candidate_id
            .unwrap_or(0)
            .to_le_bytes(),
    );
    bytes.push(rep_phase_code(packet.rep_state.phase));
    bytes.extend_from_slice(&packet.rep_state.partial_attempts.to_le_bytes());
    bytes.push(u8::from(packet.rep_state.active_rep_id.is_some()));
    bytes.extend_from_slice(&packet.rep_state.active_rep_id.unwrap_or(0).to_le_bytes());
    bytes.push(u8::from(packet.rep_state.recovered_across_gap));
    let rep_count = u16::try_from(packet.completed_reps.len())
        .map_err(|_| PacketEncodeError::PacketTooLarge)?;
    bytes.extend_from_slice(&rep_count.to_le_bytes());
    for rep in &packet.completed_reps {
        let identity = rep.profile_identity.as_bytes();
        let identity_len = u16::try_from(identity.len())
            .map_err(|_| PacketEncodeError::FieldTooLong("profile_identity"))?;
        let verdict = rep.quality_verdict.as_deref().unwrap_or("").as_bytes();
        let verdict_len = u16::try_from(verdict.len())
            .map_err(|_| PacketEncodeError::FieldTooLong("quality_verdict"))?;
        for value in [
            rep.rep_id,
            rep.start_frame_id,
            rep.start_timestamp_ms,
            rep.peak_frame_id,
            rep.peak_timestamp_ms,
            rep.end_frame_id,
            rep.end_timestamp_ms,
            rep.canonical_slice_hash,
            rep.profile_hash,
        ] {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes.extend_from_slice(&rep.revision.to_le_bytes());
        bytes.push(match rep.profile_maturity {
            "provisional" => 0,
            _ => 1,
        });
        let mut flags = 0_u8;
        if rep.quality_verdict.is_some() {
            flags |= 1;
        }
        if rep.recovered_across_gap {
            flags |= 1 << 1;
        }
        flags |= rep_disposition_code(rep.disposition) << 2;
        bytes.push(flags);
        bytes.push(rep.evidence_reason.map_or(0, rep_evidence_reason_code));
        bytes.push(rep_observation_findings_flags(&rep.observation_findings));
        bytes.extend_from_slice(&identity_len.to_le_bytes());
        bytes.extend_from_slice(identity);
        bytes.extend_from_slice(&verdict_len.to_le_bytes());
        bytes.extend_from_slice(verdict);
    }

    bytes.extend_from_slice(b"SET1");
    bytes.push(set_lifecycle_code(packet.set_state.lifecycle));

    bytes.extend_from_slice(b"VER1");
    for (length, value) in [
        (config_version_len, config_version),
        (inference_version_len, inference_version),
        (diagnostic_version_len, diagnostic_version),
    ] {
        bytes.extend_from_slice(&length.to_le_bytes());
        bytes.extend_from_slice(value);
    }
    bytes.push(u8::from(
        packet.lineage.active_profile_identity.is_some()
            && packet.lineage.active_profile_hash.is_some(),
    ));
    bytes.extend_from_slice(
        &packet
            .lineage
            .active_profile_hash
            .unwrap_or(0)
            .to_le_bytes(),
    );
    bytes.extend_from_slice(&profile_identity_len.to_le_bytes());
    bytes.extend_from_slice(profile_identity);

    if packet.lineage.contract.minor >= 6 {
        bytes.extend_from_slice(b"ANG1");
        let angle_count = u8::try_from(packet.joint_angles.len())
            .map_err(|_| PacketEncodeError::PacketTooLarge)?;
        bytes.push(angle_count);
        for angle in &packet.joint_angles {
            if !angle.confidence.is_finite()
                || angle.value_degrees.is_some_and(|value| !value.is_finite())
            {
                return Err(PacketEncodeError::PacketTooLarge);
            }
            bytes.push(joint_angle_kind_code(angle.kind));
            bytes.push(body_side_code(angle.side));
            bytes.push(landmark_source_code(angle.source));
            let mut flags = 0_u8;
            if angle.value_degrees.is_some() {
                flags |= 1;
            }
            if angle.judgeable {
                flags |= 1 << 1;
            }
            bytes.push(flags);
            bytes.extend_from_slice(
                &stable_packet_angle(angle.value_degrees.unwrap_or(0.0)).to_le_bytes(),
            );
            bytes.extend_from_slice(&angle.confidence.to_le_bytes());
        }
    }

    if packet.lineage.contract.minor >= 7 {
        bytes.extend_from_slice(b"EQP1");
        let (status_code, reason_code) = equipment_status_codes(packet.equipment.status);
        bytes.push(status_code);
        bytes.push(reason_code);
        bytes.push(u8::from(packet.equipment.subject_candidate_id.is_some()));
        bytes.extend_from_slice(
            &packet
                .equipment
                .subject_candidate_id
                .unwrap_or(0)
                .to_le_bytes(),
        );
        for count in [
            packet.equipment.rejected_reflection_count,
            packet.equipment.rejected_static_count,
            packet.equipment.rejected_low_confidence_or_invalid_count,
            packet.equipment.rejected_outside_subject_count,
        ] {
            let count = u16::try_from(count).map_err(|_| PacketEncodeError::PacketTooLarge)?;
            bytes.extend_from_slice(&count.to_le_bytes());
        }
        let track_count = u16::try_from(packet.equipment.tracks.len())
            .map_err(|_| PacketEncodeError::PacketTooLarge)?;
        bytes.extend_from_slice(&track_count.to_le_bytes());
        for track in &packet.equipment.tracks {
            let finite_values = [
                track.bbox.x,
                track.bbox.y,
                track.bbox.width,
                track.bbox.height,
                track.center_x,
                track.center_y,
                track.observation_score,
                stable_packet_confidence(track.association_confidence),
                track.uncertainty_px.unwrap_or(0.0),
            ];
            if finite_values.iter().any(|value| !value.is_finite()) {
                return Err(PacketEncodeError::NonFiniteEquipment {
                    track_id: track.track_id,
                });
            }
            bytes.extend_from_slice(&track.track_id.to_le_bytes());
            bytes.extend_from_slice(&track.proposal_id.to_le_bytes());
            bytes.extend_from_slice(&track.subject_candidate_id.to_le_bytes());
            bytes.push(equipment_kind_code(track.kind));
            bytes.push(equipment_source_code(track.source));
            bytes.push(equipment_hand_code(track.held_by));
            let mut flags = 0_u8;
            if track.judgeable_path {
                flags |= 1;
            }
            if track.uncertainty_px.is_some() {
                flags |= 1 << 1;
            }
            bytes.push(flags);
            for value in finite_values {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
        }
    }

    if packet.lineage.contract.minor >= 8 {
        bytes.extend_from_slice(b"QLT1");
        let payload = serde_json::to_vec(&QualityExtension {
            schema_version: QUALITY_SCHEMA_VERSION.into(),
            proposals: packet.quality_proposals.clone(),
        })
        .map_err(|_| PacketEncodeError::PacketTooLarge)?;
        const MAX_QUALITY_PAYLOAD_BYTES: usize = 1_048_576;
        if payload.len() > MAX_QUALITY_PAYLOAD_BYTES {
            return Err(PacketEncodeError::QualityPayloadTooLarge);
        }
        let payload_len =
            u32::try_from(payload.len()).map_err(|_| PacketEncodeError::QualityPayloadTooLarge)?;
        bytes.extend_from_slice(&payload_len.to_le_bytes());
        bytes.extend_from_slice(&payload);
    }

    if packet.lineage.contract.minor >= 9 {
        bytes.extend_from_slice(b"AXI1");
        let axes = packet
            .equipment
            .tracks
            .iter()
            .filter_map(|track| track.axis.map(|axis| (track.track_id, axis)))
            .collect::<Vec<_>>();
        let axis_count =
            u16::try_from(axes.len()).map_err(|_| PacketEncodeError::PacketTooLarge)?;
        bytes.extend_from_slice(&axis_count.to_le_bytes());
        for (track_id, axis) in axes {
            let values = [
                axis.x1,
                axis.y1,
                axis.x2,
                axis.y2,
                axis.projected_length(),
                axis.image_angle_radians(),
            ];
            if values.iter().any(|value| !value.is_finite()) {
                return Err(PacketEncodeError::NonFiniteEquipment { track_id });
            }
            bytes.extend_from_slice(&track_id.to_le_bytes());
            for value in values {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
        }
    }

    if packet.lineage.contract.minor >= 10 {
        bytes.extend_from_slice(b"LMC1");
        let payload = serde_json::to_vec(&packet.local_motion_coordinate)
            .map_err(|_| PacketEncodeError::NonFiniteLocalCoordinate)?;
        let payload_len =
            u32::try_from(payload.len()).map_err(|_| PacketEncodeError::PacketTooLarge)?;
        bytes.extend_from_slice(&payload_len.to_le_bytes());
        bytes.extend_from_slice(&payload);
    }

    let packet_len = u32::try_from(bytes.len()).map_err(|_| PacketEncodeError::PacketTooLarge)?;
    bytes[8..12].copy_from_slice(&packet_len.to_le_bytes());
    Ok(bytes)
}

/// Platform libm implementations can differ by one `f32` ULP for `acos`.
/// Quantize only the client-facing angle extension to 0.001° so identical
/// canonical observations produce a stable packet on native and WebAssembly.
fn stable_packet_angle(value: f32) -> f32 {
    const SCALE: f32 = 1_000.0;
    (value * SCALE).round() / SCALE
}

fn stable_packet_landmark(value: f32) -> f32 {
    const SCALE: f64 = 100_000.0;
    let scaled = f64::from(value) * SCALE;
    let rounded = if scaled >= 0.0 {
        (scaled + 0.5).floor()
    } else {
        (scaled - 0.5).ceil()
    };
    (rounded / SCALE) as f32
}

/// Subject association uses `hypot`, whose native and WebAssembly `f32`
/// implementations can differ by one ULP. Preserve the full internal value,
/// but publish confidence to five decimal places so one observation produces
/// byte-identical MOTN packets on every client.
fn stable_packet_confidence(value: f32) -> f32 {
    const SCALE: f64 = 100_000.0;
    let grid_value = (f64::from(value.clamp(0.0, 1.0)) * SCALE + 0.5) as u32;
    (f64::from(grid_value) / SCALE) as f32
}

fn equipment_status_codes(status: EquipmentFrameStatus) -> (u8, u8) {
    match status {
        EquipmentFrameStatus::Observed => (0, 0),
        EquipmentFrameStatus::CannotJudge(reason) => (1, equipment_reason_code(reason)),
    }
}

fn equipment_reason_code(reason: EquipmentCannotJudgeReason) -> u8 {
    match reason {
        EquipmentCannotJudgeReason::NoLockedSubject => 1,
        EquipmentCannotJudgeReason::NoEquipmentObservation => 2,
        EquipmentCannotJudgeReason::TimestampNotMonotonic => 3,
        EquipmentCannotJudgeReason::LowConfidenceOrInvalid => 4,
        EquipmentCannotJudgeReason::ReflectionOrStaticOnly => 5,
        EquipmentCannotJudgeReason::OutsideLockedSubject => 6,
    }
}

fn equipment_kind_code(kind: EquipmentKind) -> u8 {
    match kind {
        EquipmentKind::WeightPlate => 0,
        EquipmentKind::BarbellShaft => 1,
        EquipmentKind::Dumbbell => 2,
        EquipmentKind::MachineHandle => 3,
    }
}

fn equipment_source_code(source: EquipmentSource) -> u8 {
    match source {
        EquipmentSource::Detector => 0,
        EquipmentSource::OpticalFlow => 1,
        EquipmentSource::Geometry => 2,
        EquipmentSource::Predicted => 3,
    }
}

fn equipment_hand_code(hand: EquipmentHand) -> u8 {
    match hand {
        EquipmentHand::Left => 0,
        EquipmentHand::Right => 1,
        EquipmentHand::Both => 2,
        EquipmentHand::Unknown => 3,
    }
}

#[cfg(test)]
mod packet_float_stability_tests {
    use super::stable_packet_angle;

    #[test]
    fn published_angles_collapse_one_ulp_platform_math_drift() {
        let native = f32::from_bits(0x41e2_c21c);
        let wasm = f32::from_bits(0x41e2_c21b);
        let observed_native = 77.0792_f32;
        let observed_wasm = 77.0791_f32;

        assert_ne!(native.to_bits(), wasm.to_bits());
        assert_eq!(
            stable_packet_angle(native).to_bits(),
            stable_packet_angle(wasm).to_bits()
        );
        assert_eq!(
            stable_packet_angle(observed_native).to_bits(),
            stable_packet_angle(observed_wasm).to_bits(),
        );
    }
}

fn joint_angle_kind_code(kind: JointAngleKind) -> u8 {
    match kind {
        JointAngleKind::Elbow => 0,
        JointAngleKind::Shoulder => 1,
        JointAngleKind::Hip => 2,
        JointAngleKind::Knee => 3,
    }
}

fn body_side_code(side: BodySide) -> u8 {
    match side {
        BodySide::Left => 0,
        BodySide::Right => 1,
    }
}

fn rep_disposition_code(disposition: RepDisposition) -> u8 {
    match disposition {
        RepDisposition::Confirmed => 0,
        RepDisposition::NeedsReview => 1,
        RepDisposition::Rejected => 2,
    }
}

fn rep_evidence_reason_code(reason: RepEvidenceReason) -> u8 {
    match reason {
        RepEvidenceReason::ShortContinuityRecovery => 1,
        RepEvidenceReason::LongContinuityLoss => 2,
        RepEvidenceReason::SubjectChanged => 3,
        RepEvidenceReason::IncompleteCycle => 4,
        RepEvidenceReason::AntiInterferenceFilter => 5,
        RepEvidenceReason::DurationExceeded => 6,
        RepEvidenceReason::RequiredJointLoss => 7,
        RepEvidenceReason::CoordinateProvisional => 8,
        RepEvidenceReason::LocalTrajectoryChannelConflict => 9,
    }
}

fn rep_observation_findings_flags(findings: &[RepObservationFinding]) -> u8 {
    findings.iter().fold(0_u8, |flags, finding| {
        flags
            | match finding {
                RepObservationFinding::PrimaryRangeBelowExpectation => 1 << 0,
                RepObservationFinding::SecondaryRangeBelowExpectation => 1 << 1,
                RepObservationFinding::CycleFasterThanExpected => 1 << 2,
                RepObservationFinding::EquipmentPrimaryBoundary => 1 << 3,
                RepObservationFinding::PoseEquipmentTurnaroundAligned => 1 << 4,
                RepObservationFinding::PoseUnavailableAtTurnaround => 1 << 5,
                RepObservationFinding::PoseEquipmentTurnaroundConflict => 1 << 6,
                RepObservationFinding::EquipmentPathCoverageLow => 1 << 7,
                // The legacy RPS1 flags byte is exhausted. Preserve the
                // fail-closed conflict semantic for old decoders on the
                // existing pose/equipment conflict bit; QLT1 retains the
                // exact local-trajectory finding and explanation.
                RepObservationFinding::LocalTrajectoryChannelConflict => 1 << 6,
            }
    })
}

fn set_lifecycle_code(lifecycle: SetLifecycle) -> u8 {
    match lifecycle {
        SetLifecycle::Idle => 0,
        SetLifecycle::Arming => 1,
        SetLifecycle::Active => 2,
        SetLifecycle::Paused => 3,
        SetLifecycle::Finished => 4,
    }
}

fn rep_phase_code(phase: RepPhase) -> u8 {
    match phase {
        RepPhase::Ready => 0,
        RepPhase::Effort => 1,
        RepPhase::Peak => 2,
        RepPhase::Return => 3,
        RepPhase::Frozen => 4,
    }
}

fn target_state_code(state: TargetState) -> u8 {
    match state {
        TargetState::Acquiring => 0,
        TargetState::Locked => 1,
        TargetState::Uncertain => 2,
        TargetState::Lost => 3,
        TargetState::Reacquiring => 4,
    }
}

fn landmark_source_code(source: LandmarkSource) -> u8 {
    match source {
        LandmarkSource::Measured => 0,
        LandmarkSource::Fused => 1,
        LandmarkSource::Predicted => 2,
        LandmarkSource::Unknown => 3,
    }
}

fn continuity_reason_code(reason: Option<ContinuityReason>) -> u8 {
    match reason {
        None => 0,
        Some(ContinuityReason::WeakObservationBoneFusion) => 1,
        Some(ContinuityReason::ShortGapPrediction) => 2,
        Some(ContinuityReason::OutlierRejectedPrediction) => 3,
        Some(ContinuityReason::OutlierRejectedUnknown) => 4,
        Some(ContinuityReason::PredictionTimeout) => 5,
        Some(ContinuityReason::NoMeasurementBaseline) => 6,
        Some(ContinuityReason::EquipmentPathConstraint) => 7,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct FrameObservations {
    pub pose_candidates: Vec<PoseCandidate>,
    pub equipment: Vec<EquipmentObservation>,
}

pub type InferenceResult = FrameObservations;

pub trait InferenceAdapter {
    fn infer(&mut self, frame: &FrameLease) -> Result<InferenceResult, MotionError>;
}

pub trait OutputAdapter {
    fn publish(&mut self, packet: MotionPacket) -> Result<(), MotionError>;
}

#[derive(Clone, Debug)]
pub struct FixtureInferenceAdapter {
    frames: VecDeque<Vec<PoseCandidate>>,
    last: Vec<PoseCandidate>,
}

impl FixtureInferenceAdapter {
    pub fn single_pose(canonical: Vec<CanonicalLandmark>) -> Self {
        let observations = canonical
            .into_iter()
            .map(|landmark| PoseObservation {
                x: landmark.x.unwrap_or(0.0),
                y: landmark.y.unwrap_or(0.0),
                z: landmark.z.unwrap_or(0.0),
                visibility: landmark.observation_score,
            })
            .collect::<Vec<_>>();
        Self {
            frames: VecDeque::from([vec![fixture_candidate(0, observations.clone())]]),
            last: vec![fixture_candidate(0, observations)],
        }
    }

    pub fn sequence(frames: Vec<Vec<PoseObservation>>) -> Self {
        let frames = frames
            .into_iter()
            .map(|observations| vec![fixture_candidate(0, observations)])
            .collect::<Vec<_>>();
        let last = frames.last().cloned().unwrap_or_default();
        Self {
            frames: VecDeque::from(frames),
            last,
        }
    }

    pub fn candidate_sequence(frames: Vec<Vec<PoseCandidate>>) -> Self {
        let last = frames.last().cloned().unwrap_or_default();
        Self {
            frames: VecDeque::from(frames),
            last,
        }
    }
}

impl InferenceAdapter for FixtureInferenceAdapter {
    fn infer(&mut self, _frame: &FrameLease) -> Result<InferenceResult, MotionError> {
        let candidates = self.frames.pop_front().unwrap_or_else(|| self.last.clone());
        self.last = candidates.clone();
        Ok(FrameObservations {
            pose_candidates: candidates,
            equipment: Vec::new(),
        })
    }
}

fn fixture_candidate(id: u64, observations: Vec<PoseObservation>) -> PoseCandidate {
    PoseCandidate {
        id,
        bbox: NormalizedRect::new(0.25, 0.1, 0.5, 0.8),
        observations,
        torso_color: [0.25, 0.35, 0.45],
    }
}

#[derive(Clone, Default)]
pub struct RecordingOutputAdapter {
    packets: Arc<Mutex<Vec<MotionPacket>>>,
}

impl RecordingOutputAdapter {
    pub fn packets(&self) -> Vec<MotionPacket> {
        self.packets.lock().expect("recording output lock").clone()
    }
}

impl OutputAdapter for RecordingOutputAdapter {
    fn publish(&mut self, packet: MotionPacket) -> Result<(), MotionError> {
        self.packets
            .lock()
            .map_err(|_| MotionError::OutputAdapter("recording output lock poisoned".into()))?
            .push(packet);
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionSummary {
    pub accepted_frames: u64,
    pub published_packets: u64,
    pub released_frames: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubjectSelectionAck {
    pub candidate_id: u64,
    pub subject_epoch: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SubjectSelectionError {
    InvalidCoordinate,
    NoCandidateAtPoint,
}

struct SubjectTracker {
    policy: SubjectPolicy,
    locked_id: Option<u64>,
    missing_since_ms: Option<u64>,
    locked_descriptor: Option<PoseCandidate>,
    pending_switch: Option<PendingSubjectSwitch>,
    identity_boundary: bool,
    last_candidates: Vec<PoseCandidate>,
}

struct PendingSubjectSwitch {
    since_ms: u64,
    descriptor: PoseCandidate,
}

impl SubjectTracker {
    fn new(policy: SubjectPolicy) -> Self {
        Self {
            policy,
            locked_id: None,
            missing_since_ms: None,
            locked_descriptor: None,
            pending_switch: None,
            identity_boundary: false,
            last_candidates: Vec::new(),
        }
    }

    fn update(
        &mut self,
        candidates: Vec<PoseCandidate>,
        timestamp_ms: u64,
    ) -> (TargetSnapshot, Option<PoseCandidate>) {
        self.last_candidates = candidates;
        let candidate_count = self.last_candidates.len().min(u8::MAX as usize) as u8;
        if self.policy == SubjectPolicy::AssumeSingle {
            let selected = self.last_candidates.first().cloned();
            self.locked_id = selected.as_ref().map(|candidate| candidate.id);
            self.locked_descriptor = selected.clone();
            return (
                TargetSnapshot {
                    state: if selected.is_some() {
                        TargetState::Locked
                    } else {
                        TargetState::Lost
                    },
                    candidate_count,
                    selected_candidate_id: self.locked_id,
                },
                selected,
            );
        }

        if let Some(locked_id) = self.locked_id {
            if let Some(descriptor) = self.locked_descriptor.as_ref() {
                let mut ranked = self
                    .last_candidates
                    .iter()
                    .map(|candidate| (subject_continuity_cost(descriptor, candidate), candidate))
                    .collect::<Vec<_>>();
                ranked.sort_by(|left, right| left.0.total_cmp(&right.0));
                if let Some((cost, candidate)) = ranked.first() {
                    let candidate = (*candidate).clone();
                    let requires_switch_confirmation = *cost > SUBJECT_SWITCH_CONTINUITY_COST;
                    if requires_switch_confirmation
                        && !self.switch_candidate_is_confirmed(&candidate, timestamp_ms)
                    {
                        return (
                            TargetSnapshot {
                                state: TargetState::Uncertain,
                                candidate_count,
                                selected_candidate_id: Some(locked_id),
                            },
                            Some(candidate),
                        );
                    }
                    return self.lock_visible_candidate(
                        candidate,
                        candidate_count,
                        requires_switch_confirmation,
                    );
                }
            }
            self.clear_pending_switch();
            let missing_since = *self.missing_since_ms.get_or_insert(timestamp_ms);
            let state = if timestamp_ms.saturating_sub(missing_since) < 1_500 {
                TargetState::Uncertain
            } else {
                TargetState::Lost
            };
            return (
                TargetSnapshot {
                    state,
                    candidate_count,
                    selected_candidate_id: Some(locked_id),
                },
                None,
            );
        }

        let best = self
            .last_candidates
            .iter()
            .max_by(|left, right| {
                subject_dominance_score(left).total_cmp(&subject_dominance_score(right))
            })
            .cloned();
        let Some(best) = best else {
            return (
                TargetSnapshot {
                    state: TargetState::Acquiring,
                    candidate_count,
                    selected_candidate_id: None,
                },
                None,
            );
        };
        self.locked_id = Some(best.id);
        self.locked_descriptor = Some(best.clone());
        self.missing_since_ms = None;
        self.clear_pending_switch();
        (
            TargetSnapshot {
                state: TargetState::Locked,
                candidate_count,
                selected_candidate_id: Some(best.id),
            },
            Some(best),
        )
    }

    fn select_at(&mut self, x: f32, y: f32) -> Result<u64, SubjectSelectionError> {
        if !x.is_finite()
            || !y.is_finite()
            || !(0.0..=1.0).contains(&x)
            || !(0.0..=1.0).contains(&y)
        {
            return Err(SubjectSelectionError::InvalidCoordinate);
        }
        let selected = self
            .last_candidates
            .iter()
            .filter(|candidate| candidate.bbox.contains(x, y))
            // The smaller containing box is normally the foreground person
            // the user clicked, rather than a larger overlapping bystander.
            .min_by(|left, right| left.bbox.area().total_cmp(&right.bbox.area()))
            .cloned()
            .ok_or(SubjectSelectionError::NoCandidateAtPoint)?;
        self.locked_id = Some(selected.id);
        self.locked_descriptor = Some(selected.clone());
        self.missing_since_ms = None;
        self.clear_pending_switch();
        Ok(selected.id)
    }

    fn take_identity_boundary(&mut self) -> bool {
        std::mem::take(&mut self.identity_boundary)
    }

    fn update_locked_descriptor(&mut self, mut candidate: PoseCandidate) {
        if let Some(previous) = self.locked_descriptor.as_ref() {
            for (value, old) in candidate.torso_color.iter_mut().zip(previous.torso_color) {
                *value = old * 0.8 + *value * 0.2;
            }
        }
        self.locked_descriptor = Some(candidate);
    }

    fn lock_visible_candidate(
        &mut self,
        candidate: PoseCandidate,
        candidate_count: u8,
        subject_changed: bool,
    ) -> (TargetSnapshot, Option<PoseCandidate>) {
        if subject_changed {
            self.identity_boundary = true;
            self.locked_descriptor = Some(candidate.clone());
        } else {
            self.update_locked_descriptor(candidate.clone());
        }
        self.locked_id = Some(candidate.id);
        self.missing_since_ms = None;
        self.clear_pending_switch();
        (
            TargetSnapshot {
                state: TargetState::Locked,
                candidate_count,
                selected_candidate_id: Some(candidate.id),
            },
            Some(candidate),
        )
    }

    fn switch_candidate_is_confirmed(
        &mut self,
        candidate: &PoseCandidate,
        timestamp_ms: u64,
    ) -> bool {
        let same_pending_candidate = self.pending_switch.as_ref().is_some_and(|pending| {
            subject_continuity_cost(&pending.descriptor, candidate)
                <= SUBJECT_SWITCH_CONTINUITY_COST
        });
        if !same_pending_candidate {
            self.pending_switch = Some(PendingSubjectSwitch {
                since_ms: timestamp_ms,
                descriptor: candidate.clone(),
            });
        } else if let Some(pending) = self.pending_switch.as_mut() {
            pending.descriptor = candidate.clone();
        }
        self.pending_switch.as_ref().is_some_and(|pending| {
            timestamp_ms.saturating_sub(pending.since_ms) >= SUBJECT_SWITCH_CONFIRM_MS
        })
    }

    fn clear_pending_switch(&mut self) {
        self.pending_switch = None;
    }
}

const SUBJECT_SWITCH_CONTINUITY_COST: f32 = 0.25;
const SUBJECT_SWITCH_CONFIRM_MS: u64 = 300;

fn subject_continuity_cost(reference: &PoseCandidate, candidate: &PoseCandidate) -> f32 {
    subject_continuity_cost_components(reference, candidate)
        .iter()
        .sum()
}

fn subject_continuity_cost_components(
    reference: &PoseCandidate,
    candidate: &PoseCandidate,
) -> [f32; 3] {
    let mut landmark_distance = 0.0;
    let mut comparable_landmarks = 0_u32;
    for (previous, current) in reference
        .observations
        .iter()
        .zip(candidate.observations.iter())
    {
        if previous.visibility < 0.2
            || current.visibility < 0.2
            || !previous.x.is_finite()
            || !previous.y.is_finite()
            || !current.x.is_finite()
            || !current.y.is_finite()
        {
            continue;
        }
        landmark_distance += (previous.x - current.x).hypot(previous.y - current.y);
        comparable_landmarks += 1;
    }
    let mean_landmark_distance = if comparable_landmarks > 0 {
        landmark_distance / comparable_landmarks as f32
    } else {
        let (previous_x, previous_y) = reference.bbox.center();
        let (current_x, current_y) = candidate.bbox.center();
        (previous_x - current_x).hypot(previous_y - current_y)
    };
    let (previous_x, previous_y) = reference.bbox.center();
    let (current_x, current_y) = candidate.bbox.center();
    let center_distance = (previous_x - current_x).hypot(previous_y - current_y);
    let color_distance = reference
        .torso_color
        .iter()
        .zip(candidate.torso_color)
        .map(|(left, right)| (left - right).powi(2))
        .sum::<f32>()
        .sqrt();
    [
        mean_landmark_distance * 0.75,
        center_distance * 0.20,
        color_distance * 0.05,
    ]
}

fn subject_dominance_score(candidate: &PoseCandidate) -> f32 {
    let observation_quality = if candidate.observations.is_empty() {
        0.0
    } else {
        candidate
            .observations
            .iter()
            .map(|observation| observation.visibility.clamp(0.0, 1.0))
            .sum::<f32>()
            / candidate.observations.len() as f32
    };
    candidate.bbox.area().sqrt() * 0.7 + observation_quality * 0.3
}

#[derive(Clone, Copy)]
struct RepSample {
    frame_id: u64,
    timestamp_ms: u64,
    primary: f32,
    secondary: f32,
    torso: f32,
}

#[derive(Clone, Copy)]
struct EquipmentTurnaroundSample {
    frame_id: u64,
    timestamp_ms: u64,
    center_y: f32,
    confidence: f32,
}

struct ActiveRep {
    rep_id: u64,
    direction: MovementDirection,
    start: RepSample,
    peak: RepSample,
    peak_amplitude: f32,
    peak_secondary_amplitude: f32,
    hash: u64,
    recovered_across_gap: bool,
    active_signal: ActiveSignal,
}

#[derive(Clone, Copy)]
struct PendingActivation {
    since_ms: u64,
    start: RepSample,
    peak: RepSample,
    peak_amplitude: f32,
    peak_secondary_amplitude: f32,
    direction: MovementDirection,
    active_signal: ActiveSignal,
}

#[derive(Clone, Copy)]
struct PendingReady {
    since_ms: u64,
    best: RepSample,
    best_absolute_amplitude: f32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ActiveSignal {
    Bilateral,
    Primary,
    Secondary,
}

struct RepEngine {
    profile: ExerciseProfile,
    barbell_phase: Option<barbell_phase::BarbellBenchPhaseEngine>,
    state: RepStateSnapshot,
    baseline_primary: Option<f32>,
    baseline_secondary: Option<f32>,
    baseline_torso: Option<f32>,
    /// `Auto` chooses the orientation from the first complete cycle of a
    /// set, then retains it. A return is the opposite direction of the same
    /// movement, not permission to start a new rep in reverse.
    locked_auto_direction: Option<MovementDirection>,
    previous: Option<RepSample>,
    active: Option<ActiveRep>,
    next_rep_id: u64,
    gap_since_ms: Option<u64>,
    signal_window: VecDeque<RepSample>,
    ready_history: VecDeque<RepSample>,
    pending_activation: Option<PendingActivation>,
    pending_return_since_ms: Option<u64>,
    pending_ready: Option<PendingReady>,
    local_evidence_history: VecDeque<(u64, u64, LocalMotionCoordinateEvidence)>,
    equipment_turnaround_history: VecDeque<EquipmentTurnaroundSample>,
    finalized_outcomes: Option<Vec<SealedRep>>,
}

impl RepEngine {
    fn new(profile: ExerciseProfile) -> Self {
        let barbell_phase = if profile.uses_local_shoulder_press_state_graph() {
            Some(
                barbell_phase::BarbellBenchPhaseEngine::local_shoulder_press(
                    profile.start_amplitude,
                    profile.min_primary_amplitude,
                    profile.return_hysteresis,
                    profile.ready_tolerance,
                    profile.min_rep_duration_ms,
                    profile.max_rep_duration_ms,
                ),
            )
        } else if profile.uses_local_barbell_state_graph() {
            Some(barbell_phase::BarbellBenchPhaseEngine::local_bench(
                profile.start_amplitude,
                profile.min_primary_amplitude,
                profile.return_hysteresis,
                profile.ready_tolerance,
                profile.min_rep_duration_ms,
                profile.max_rep_duration_ms,
            ))
        } else if profile.uses_barbell_axis_state_graph() {
            Some(barbell_phase::BarbellBenchPhaseEngine::new())
        } else {
            None
        };
        Self {
            profile,
            barbell_phase,
            state: RepStateSnapshot::default(),
            baseline_primary: None,
            baseline_secondary: None,
            baseline_torso: None,
            locked_auto_direction: None,
            previous: None,
            active: None,
            next_rep_id: 1,
            gap_since_ms: None,
            signal_window: VecDeque::new(),
            ready_history: VecDeque::new(),
            pending_activation: None,
            pending_return_since_ms: None,
            pending_ready: None,
            local_evidence_history: VecDeque::new(),
            equipment_turnaround_history: VecDeque::new(),
            finalized_outcomes: None,
        }
    }

    fn abort_active(&mut self) {
        if let Some(engine) = self.barbell_phase.as_mut() {
            engine.abort_active();
            self.sync_barbell_phase_state();
            return;
        }
        if self.active.take().is_some() {
            self.state.partial_attempts = self.state.partial_attempts.saturating_add(1);
        }
        self.state.phase = RepPhase::Ready;
        self.state.active_rep_id = None;
        self.state.recovered_across_gap = false;
        self.gap_since_ms = None;
        self.pending_activation = None;
        self.pending_return_since_ms = None;
        self.pending_ready = None;
    }

    fn begin_set(&mut self) {
        self.finalized_outcomes = None;
        if let Some(engine) = self.barbell_phase.as_mut() {
            engine.begin_set();
            self.sync_barbell_phase_state();
            return;
        }
        self.abort_active();
        self.signal_window.clear();
        self.ready_history.clear();
        self.local_evidence_history.clear();
        self.equipment_turnaround_history.clear();
        // Orientation is a set-level decision. A later set may legitimately
        // begin from the opposite physical extreme, so it must earn a fresh
        // auto-direction lock rather than inheriting the prior set's choice.
        self.locked_auto_direction = None;
    }

    fn finish_set(&mut self) -> Vec<SealedRep> {
        if let Some(finalized) = self.finalized_outcomes.as_ref() {
            return finalized.clone();
        }
        let finalized: Vec<SealedRep> = if self.barbell_phase.is_some() {
            let candidates = self
                .barbell_phase
                .as_mut()
                .expect("barbell phase graph disappeared")
                .finish_set();
            self.sync_barbell_phase_state();
            candidates
                .into_iter()
                .map(|candidate| self.seal_barbell_candidate(candidate))
                .collect()
        } else {
            self.reject_active(RepEvidenceReason::IncompleteCycle, self.previous)
                .into_iter()
                .collect()
        };
        self.finalized_outcomes = Some(finalized.clone());
        finalized
    }

    /// Learns the observable setup pose while the explicit set gate is still
    /// arming. These samples can never advance a rep, but the final stable
    /// sample must be the reference for the first movement after arming.
    fn prime_ready_baseline(
        &mut self,
        frame_id: u64,
        timestamp_ms: u64,
        target_state: TargetState,
        canonical: &[CanonicalLandmark],
        local_coordinate: Option<&LocalMotionCoordinateEvidence>,
    ) {
        if self.barbell_phase.is_some() {
            return;
        }
        if target_state != TargetState::Locked || self.state.phase != RepPhase::Ready {
            return;
        }
        if !profile_signal_transition_eligible(&self.profile, canonical, local_coordinate) {
            return;
        }
        let Some((primary, secondary, torso, _repaired)) =
            profile_signal_with_local(&self.profile, canonical, local_coordinate)
        else {
            return;
        };
        let sample = self.signal_sample(frame_id, timestamp_ms, primary, secondary, torso);
        let (primary, secondary, torso) = (sample.primary, sample.secondary, sample.torso);
        update_ready_baseline(self.profile.direction, &mut self.baseline_primary, primary);
        update_ready_baseline(
            self.profile.direction,
            &mut self.baseline_secondary,
            secondary,
        );
        update_ready_baseline(self.profile.direction, &mut self.baseline_torso, torso);
        self.previous = Some(sample);
    }

    fn prime_barbell_ready(
        &mut self,
        frame_id: u64,
        timestamp_ms: u64,
        target_state: TargetState,
        canonical: &[CanonicalLandmark],
        equipment: &EquipmentFrameEvidence,
        local_coordinate: Option<&LocalMotionCoordinateEvidence>,
    ) {
        if target_state != TargetState::Locked {
            return;
        }
        let pose_signal = barbell_pose_signal(&self.profile, canonical);
        let primary_signal = resolved_profile_primary(&self.profile, canonical, local_coordinate);
        if let Some(engine) = self.barbell_phase.as_mut() {
            engine.prime_boundary(
                frame_id,
                timestamp_ms,
                equipment,
                pose_signal,
                primary_signal,
                local_coordinate,
            );
            self.sync_barbell_phase_state();
        }
    }

    fn observe_equipment_turnaround(
        &mut self,
        frame_id: u64,
        timestamp_ms: u64,
        equipment: &EquipmentFrameEvidence,
    ) {
        if !self.profile.uses_equipment_turnaround_fusion() {
            return;
        }
        let Some(track) = equipment
            .tracks
            .iter()
            .filter(|track| {
                track.kind == EquipmentKind::BarbellShaft
                    && track.judgeable_path
                    && track.source != EquipmentSource::Predicted
                    && track.center_y.is_finite()
            })
            .max_by(|left, right| {
                (left.observation_score * left.association_confidence)
                    .total_cmp(&(right.observation_score * right.association_confidence))
            })
        else {
            return;
        };
        self.equipment_turnaround_history
            .push_back(EquipmentTurnaroundSample {
                frame_id,
                timestamp_ms,
                center_y: track.center_y,
                confidence: (track.observation_score * track.association_confidence)
                    .clamp(0.0, 1.0),
            });
        let oldest_retained =
            timestamp_ms.saturating_sub(self.profile.max_rep_duration_ms + self.profile.max_gap_ms);
        while self
            .equipment_turnaround_history
            .front()
            .is_some_and(|sample| sample.timestamp_ms < oldest_retained)
        {
            self.equipment_turnaround_history.pop_front();
        }
    }

    fn fused_equipment_turnaround(
        &self,
        start_timestamp_ms: u64,
        pose_turnaround_ms: u64,
        end_timestamp_ms: u64,
    ) -> Option<EquipmentTurnaroundSample> {
        let direction = self.profile.equipment_effort_direction()?;
        let samples = self
            .equipment_turnaround_history
            .iter()
            .copied()
            .filter(|sample| {
                sample.timestamp_ms >= start_timestamp_ms
                    && sample.timestamp_ms <= end_timestamp_ms
                    && sample.confidence >= 0.50
            })
            .collect::<Vec<_>>();
        if samples.len() < 3 {
            return None;
        }
        let extreme = samples.iter().copied().reduce(|selected, candidate| {
            let candidate_is_more_extreme = match direction {
                MovementDirection::Increasing => candidate.center_y > selected.center_y,
                MovementDirection::Decreasing => candidate.center_y < selected.center_y,
                MovementDirection::Auto => false,
            };
            if candidate_is_more_extreme {
                candidate
            } else {
                selected
            }
        })?;
        // A bench/row/press endpoint commonly dwells for several frames. Use
        // the plateau sample nearest the independent pose extremum instead of
        // letting one detector-pixel spike choose the published timestamp.
        samples
            .into_iter()
            .filter(|sample| (sample.center_y - extreme.center_y).abs() <= 0.01)
            .min_by_key(|sample| sample.timestamp_ms.abs_diff(pose_turnaround_ms))
    }

    /// The external seam for closing an active attempt. Callers only choose
    /// whether the evidence is unusable; this module owns immutable
    /// boundaries, identifiers, reset semantics, and profile provenance.
    fn finish_active(
        &mut self,
        mut active: ActiveRep,
        end: RepSample,
        disposition: RepDisposition,
        evidence_reason: Option<RepEvidenceReason>,
        mut observation_findings: Vec<RepObservationFinding>,
    ) -> SealedRep {
        // A continuity recovery may retain a pre-gap return candidate while a
        // later sample becomes the peak. A sealed causal interval can never
        // end before that peak; preserve the outcome as reviewable evidence
        // and close it at the latest observed peak instead of emitting an
        // impossible frame/timestamp order.
        let end =
            if end.frame_id < active.peak.frame_id || end.timestamp_ms < active.peak.timestamp_ms {
                active.peak
            } else {
                end
            };
        if disposition == RepDisposition::Rejected {
            self.state.partial_attempts = self.state.partial_attempts.saturating_add(1);
        }
        self.state.phase = RepPhase::Ready;
        self.state.active_rep_id = None;
        self.state.recovered_across_gap = false;
        self.gap_since_ms = None;
        self.pending_activation = None;
        self.pending_return_since_ms = None;
        self.pending_ready = None;
        let pose_turnaround_ms = active.peak.timestamp_ms;
        if let Some(equipment_turnaround) = self.fused_equipment_turnaround(
            active.start.timestamp_ms,
            pose_turnaround_ms,
            end.timestamp_ms,
        ) {
            observation_findings.push(RepObservationFinding::EquipmentPrimaryBoundary);
            observation_findings.push(
                if equipment_turnaround
                    .timestamp_ms
                    .abs_diff(pose_turnaround_ms)
                    <= 250
                {
                    RepObservationFinding::PoseEquipmentTurnaroundAligned
                } else {
                    RepObservationFinding::PoseEquipmentTurnaroundConflict
                },
            );
            active.peak.frame_id = equipment_turnaround.frame_id;
            active.peak.timestamp_ms = equipment_turnaround.timestamp_ms;
        }
        let normalized_endpoints = self.normalized_endpoints_for(&active, end);
        let sealed = SealedRep {
            rep_id: active.rep_id,
            start_frame_id: active.start.frame_id,
            start_timestamp_ms: active.start.timestamp_ms,
            peak_frame_id: active.peak.frame_id,
            peak_timestamp_ms: active.peak.timestamp_ms,
            turnaround_confirmed_timestamp_ms: end.timestamp_ms.max(active.peak.timestamp_ms),
            end_frame_id: end.frame_id,
            end_timestamp_ms: end.timestamp_ms,
            revision: 0,
            canonical_slice_hash: hash_sample(active.hash, end),
            profile_identity: self.profile.identity.clone(),
            profile_hash: self.profile.content_hash,
            profile_maturity: self.profile.maturity.as_str(),
            quality_verdict: None,
            recovered_across_gap: active.recovered_across_gap,
            disposition,
            evidence_reason,
            observation_findings,
            normalized_endpoints,
        };
        // Every outcome, including a filtered one, is immutable and
        // addressable evidence. Never reuse its id in the same set.
        self.next_rep_id = self.next_rep_id.saturating_add(1);
        sealed
    }

    fn reject_active(
        &mut self,
        reason: RepEvidenceReason,
        end: Option<RepSample>,
    ) -> Option<SealedRep> {
        if self.barbell_phase.is_some() {
            self.abort_active();
            return None;
        }
        let active = self.active.take()?;
        let end = end.unwrap_or(active.peak);
        Some(self.finish_active(
            active,
            end,
            RepDisposition::Rejected,
            Some(reason),
            Vec::new(),
        ))
    }

    /// A recognition profile has two thresholds for different jobs:
    /// `min_*` describes the normally comparable range; this lower floor is
    /// only an anti-noise guard. A cycle between the two is still a real
    /// effort and must be returned with descriptive findings.
    fn minimum_observable_primary(&self) -> f32 {
        // `min_primary_amplitude` describes a normally comparable range, not
        // whether a cycle happened. Low-range fatigue reps remain real reps
        // and are surfaced with `PrimaryRangeBelowExpectation`; the start
        // threshold still prevents detector jitter from becoming volume.
        self.profile.start_amplitude * 1.20
    }

    fn minimum_observable_secondary(&self) -> f32 {
        self.profile.start_amplitude * 0.50
    }

    fn minimum_observable_duration_ms(&self) -> u64 {
        (self.profile.min_rep_duration_ms / 2).max(250)
    }

    fn findings_for(&self, active: &ActiveRep, end: RepSample) -> Vec<RepObservationFinding> {
        let mut findings = Vec::new();
        if active.peak_amplitude < self.profile.min_primary_amplitude {
            findings.push(RepObservationFinding::PrimaryRangeBelowExpectation);
        }
        if active.peak_secondary_amplitude < self.profile.min_secondary_amplitude {
            findings.push(RepObservationFinding::SecondaryRangeBelowExpectation);
        }
        if end.timestamp_ms.saturating_sub(active.start.timestamp_ms)
            < self.profile.min_rep_duration_ms
        {
            findings.push(RepObservationFinding::CycleFasterThanExpected);
        }
        findings
    }

    fn seal_active(&mut self, end: RepSample) -> Option<SealedRep> {
        let active = self.active.take()?;
        let duration_ms = end.timestamp_ms.saturating_sub(active.start.timestamp_ms);
        let minimum_evidence = active.peak_amplitude >= self.minimum_observable_primary()
            && active.peak_secondary_amplitude >= self.minimum_observable_secondary()
            && duration_ms >= self.minimum_observable_duration_ms();
        if !minimum_evidence {
            return Some(self.finish_active(
                active,
                end,
                RepDisposition::Rejected,
                Some(RepEvidenceReason::IncompleteCycle),
                Vec::new(),
            ));
        }
        let findings = self.findings_for(&active, end);
        if self.profile.direction == MovementDirection::Auto && self.locked_auto_direction.is_none()
        {
            self.locked_auto_direction = Some(active.direction);
        }
        // A rapid full-looking reversal is an ambiguous observation: on a
        // noisy 2D joint-angle signal it is often a local fold rather than a
        // second training repetition. Preserve it for review, but do not let
        // it inflate the formal set volume. This is deliberately independent
        // from range findings: a short but genuine range is still observable
        // and remains visible to the caller.
        let faster_than_expected = duration_ms < self.profile.min_rep_duration_ms;
        let disposition = if active.recovered_across_gap || faster_than_expected {
            RepDisposition::NeedsReview
        } else {
            RepDisposition::Confirmed
        };
        let evidence_reason = active
            .recovered_across_gap
            .then_some(RepEvidenceReason::ShortContinuityRecovery);
        Some(self.finish_active(active, end, disposition, evidence_reason, findings))
    }

    fn reject_for_subject_change(&mut self) -> Option<SealedRep> {
        self.reject_active(RepEvidenceReason::SubjectChanged, self.previous)
    }

    #[allow(dead_code)]
    fn process(
        &mut self,
        frame_id: u64,
        timestamp_ms: u64,
        target_state: TargetState,
        canonical: &[CanonicalLandmark],
    ) -> Vec<SealedRep> {
        self.process_pose(frame_id, timestamp_ms, target_state, canonical, None)
    }

    fn process_with_equipment(
        &mut self,
        frame_id: u64,
        timestamp_ms: u64,
        target_state: TargetState,
        canonical: &[CanonicalLandmark],
        equipment: &EquipmentFrameEvidence,
        raw_equipment: &[EquipmentObservation],
        local_coordinate: Option<&LocalMotionCoordinateEvidence>,
    ) -> Vec<SealedRep> {
        self.observe_equipment_turnaround(frame_id, timestamp_ms, equipment);
        if self.barbell_phase.is_none() {
            return self.process_pose(
                frame_id,
                timestamp_ms,
                target_state,
                canonical,
                local_coordinate,
            );
        }
        let active_barbell_rep = self
            .barbell_phase
            .as_ref()
            .is_some_and(|engine| engine.snapshot().active_rep_id.is_some());
        if target_state != TargetState::Locked && !active_barbell_rep {
            return Vec::new();
        }
        let pose_signal = (target_state == TargetState::Locked)
            .then(|| barbell_pose_signal(&self.profile, canonical))
            .flatten();
        let primary_signal = resolved_profile_primary(&self.profile, canonical, local_coordinate);
        let candidates = self
            .barbell_phase
            .as_mut()
            .expect("barbell phase graph disappeared")
            .process(
                frame_id,
                timestamp_ms,
                equipment,
                raw_equipment,
                pose_signal,
                MovementDirection::Decreasing,
                primary_signal,
                local_coordinate,
            );
        self.sync_barbell_phase_state();
        candidates
            .into_iter()
            .map(|candidate| self.seal_barbell_candidate(candidate))
            .collect()
    }

    fn sync_barbell_phase_state(&mut self) {
        let Some(engine) = self.barbell_phase.as_ref() else {
            return;
        };
        let snapshot = engine.snapshot();
        self.state.phase = snapshot.phase;
        self.state.active_rep_id = snapshot.active_rep_id;
        self.state.partial_attempts = snapshot.partial_attempts;
        self.state.recovered_across_gap = false;
    }

    fn seal_barbell_candidate(&self, candidate: barbell_phase::BarbellRepCandidate) -> SealedRep {
        let mut findings = vec![RepObservationFinding::EquipmentPrimaryBoundary];
        let mut disposition = candidate.disposition;
        match candidate.pose_peak_timestamp_ms {
            Some(pose_peak) if pose_peak.abs_diff(candidate.peak_timestamp_ms) <= 250 => {
                findings.push(RepObservationFinding::PoseEquipmentTurnaroundAligned);
            }
            Some(_) => {
                findings.push(RepObservationFinding::PoseEquipmentTurnaroundConflict);
            }
            None => findings.push(RepObservationFinding::PoseUnavailableAtTurnaround),
        }
        if candidate.local_trajectory_channel_conflict {
            findings.retain(|finding| {
                *finding != RepObservationFinding::PoseEquipmentTurnaroundAligned
            });
            findings.push(RepObservationFinding::LocalTrajectoryChannelConflict);
            if disposition == RepDisposition::Confirmed {
                disposition = RepDisposition::NeedsReview;
            }
        }
        if candidate.equipment_coverage < 0.70 {
            findings.push(RepObservationFinding::EquipmentPathCoverageLow);
            if disposition == RepDisposition::Confirmed {
                disposition = RepDisposition::NeedsReview;
            }
        }
        let coordinate_provisional = candidate
            .normalized_endpoints
            .as_ref()
            .is_some_and(|value| value.start_anchor.state != LocalCoordinateState::Frozen);
        SealedRep {
            rep_id: candidate.rep_id,
            start_frame_id: candidate.start_frame_id,
            start_timestamp_ms: candidate.start_timestamp_ms,
            peak_frame_id: candidate.peak_frame_id,
            peak_timestamp_ms: candidate.peak_timestamp_ms,
            turnaround_confirmed_timestamp_ms: candidate.turnaround_confirmed_timestamp_ms,
            end_frame_id: candidate.end_frame_id,
            end_timestamp_ms: candidate.end_timestamp_ms,
            revision: 0,
            canonical_slice_hash: candidate.path_hash,
            profile_identity: self.profile.identity.clone(),
            profile_hash: self.profile.content_hash,
            profile_maturity: self.profile.maturity.as_str(),
            quality_verdict: None,
            recovered_across_gap: false,
            disposition,
            evidence_reason: if disposition == RepDisposition::Rejected {
                Some(RepEvidenceReason::AntiInterferenceFilter)
            } else if candidate.local_trajectory_channel_conflict {
                Some(RepEvidenceReason::LocalTrajectoryChannelConflict)
            } else if disposition == RepDisposition::NeedsReview && coordinate_provisional {
                Some(RepEvidenceReason::CoordinateProvisional)
            } else {
                None
            },
            observation_findings: findings,
            normalized_endpoints: candidate.normalized_endpoints,
        }
    }

    fn process_pose(
        &mut self,
        frame_id: u64,
        timestamp_ms: u64,
        target_state: TargetState,
        canonical: &[CanonicalLandmark],
        local_coordinate: Option<&LocalMotionCoordinateEvidence>,
    ) -> Vec<SealedRep> {
        if let Some(evidence) = local_coordinate {
            self.local_evidence_history
                .push_back((frame_id, timestamp_ms, evidence.clone()));
            let oldest_retained = timestamp_ms
                .saturating_sub(self.profile.max_rep_duration_ms + self.profile.max_gap_ms);
            while self
                .local_evidence_history
                .front()
                .is_some_and(|(_, timestamp_ms, _)| *timestamp_ms < oldest_retained)
            {
                self.local_evidence_history.pop_front();
            }
        }
        if target_state != TargetState::Locked {
            return self.handle_gap(timestamp_ms, RepEvidenceReason::LongContinuityLoss);
        }
        let Some((primary, secondary, torso, _repaired)) =
            profile_signal_with_local(&self.profile, canonical, local_coordinate)
        else {
            return self.handle_gap(timestamp_ms, RepEvidenceReason::RequiredJointLoss);
        };
        // Short-horizon prediction remains useful to keep the canonical
        // skeleton visually continuous, but it is not a new observation. In
        // particular, a projected elbow can move outside the image and create
        // an anatomically impossible joint-angle extremum. Freeze the rep
        // engine until measured or topology-fused signal evidence returns;
        // predicted/weak samples must never create start/peak/end events.
        if !profile_signal_transition_eligible(&self.profile, canonical, local_coordinate) {
            return self.handle_gap(timestamp_ms, RepEvidenceReason::RequiredJointLoss);
        }
        let sample = self.signal_sample(frame_id, timestamp_ms, primary, secondary, torso);
        let (primary, secondary, torso) = (sample.primary, sample.secondary, sample.torso);
        if let Some(gap_since) = self.gap_since_ms.take() {
            let gap_duration_ms = timestamp_ms.saturating_sub(gap_since);
            if gap_duration_ms > self.profile.max_gap_ms {
                return self
                    .reject_active(RepEvidenceReason::LongContinuityLoss, self.previous)
                    .into_iter()
                    .collect();
            } else if let Some(active) = self.active.as_mut() {
                if gap_duration_ms >= CONTINUITY_REVIEW_GAP_MS {
                    active.recovered_across_gap = true;
                    self.state.recovered_across_gap = true;
                }
                self.state.phase = if active.peak_amplitude >= self.profile.min_primary_amplitude {
                    RepPhase::Peak
                } else {
                    RepPhase::Effort
                };
            }
        }

        if let Some(dwell_ms) = self.profile.stable_phase_dwell_ms() {
            let sealed = self.process_stable_cycle_sample(sample, dwell_ms);
            self.previous = Some(sample);
            return sealed;
        }

        if self.state.phase == RepPhase::Ready {
            update_ready_baseline(self.profile.direction, &mut self.baseline_primary, primary);
            update_ready_baseline(
                self.profile.direction,
                &mut self.baseline_secondary,
                secondary,
            );
            update_ready_baseline(self.profile.direction, &mut self.baseline_torso, torso);
            self.ready_history.push_back(sample);
            while self
                .ready_history
                .front()
                .is_some_and(|ready| timestamp_ms.saturating_sub(ready.timestamp_ms) > 2_000)
            {
                self.ready_history.pop_front();
            }
        }
        let baseline_primary = *self.baseline_primary.get_or_insert(primary);
        let baseline_secondary = *self.baseline_secondary.get_or_insert(secondary);
        let baseline_torso = *self.baseline_torso.get_or_insert(torso);
        let alternating = self.profile.uses_alternating_state_graph();
        let direction = self
            .active
            .as_ref()
            .map(|active| active.direction)
            .or_else(|| {
                let configured_direction = if self.profile.direction == MovementDirection::Auto {
                    self.locked_auto_direction
                        .unwrap_or(MovementDirection::Auto)
                } else {
                    self.profile.direction
                };
                if alternating {
                    Some(configured_direction)
                } else {
                    activation_direction(
                        configured_direction,
                        baseline_primary,
                        primary,
                        baseline_secondary,
                        secondary,
                        self.profile.start_amplitude,
                    )
                }
            });
        let configured_direction = direction.unwrap_or(self.profile.direction);
        let primary_amplitude = directional_delta(configured_direction, baseline_primary, primary);
        let secondary_side_amplitude =
            directional_delta(configured_direction, baseline_secondary, secondary);
        let active_signal = self
            .active
            .as_ref()
            .map(|active| active.active_signal)
            .unwrap_or_else(|| {
                if !alternating {
                    ActiveSignal::Bilateral
                } else if primary_amplitude >= secondary_side_amplitude {
                    ActiveSignal::Primary
                } else {
                    ActiveSignal::Secondary
                }
            });
        let amplitude = match active_signal {
            ActiveSignal::Bilateral | ActiveSignal::Primary => primary_amplitude,
            ActiveSignal::Secondary => secondary_side_amplitude,
        };
        let secondary_amplitude = if alternating {
            amplitude
        } else {
            secondary_side_amplitude
        };
        let torso_amplitude = directional_delta(configured_direction, baseline_torso, torso);
        let mut sealed = Vec::new();

        let translation_like = !alternating
            && self.profile.primary_signal.kind == ExerciseSignalKind::LandmarkY
            && self.profile.secondary_signal.kind == ExerciseSignalKind::LandmarkY
            && amplitude > self.profile.start_amplitude
            && torso_amplitude.abs() >= amplitude.abs() * 0.70
            && secondary_amplitude.abs() >= amplitude.abs() * 0.70
            && (torso_amplitude - amplitude).abs() <= 0.08
            && (secondary_amplitude - amplitude).abs() <= 0.08;
        if translation_like {
            let rejected =
                self.reject_active(RepEvidenceReason::AntiInterferenceFilter, Some(sample));
            self.previous = Some(sample);
            return rejected.into_iter().collect();
        }

        match self.state.phase {
            RepPhase::Ready => {
                if amplitude >= self.profile.start_amplitude {
                    let start = if self.profile.uses_cycle_aligned_boundaries() {
                        cycle_aligned_start_sample(
                            &self.ready_history,
                            sample,
                            configured_direction,
                            active_signal,
                            baseline_primary,
                            baseline_secondary,
                            self.profile.start_amplitude,
                        )
                    } else {
                        self.previous.unwrap_or(sample)
                    };
                    self.ready_history.clear();
                    let rep_id = self.next_rep_id;
                    self.active = Some(ActiveRep {
                        rep_id,
                        direction: direction.expect("ready activation has a direction"),
                        start,
                        peak: sample,
                        peak_amplitude: amplitude,
                        peak_secondary_amplitude: secondary_amplitude,
                        hash: hash_sample(FNV_OFFSET, start),
                        recovered_across_gap: false,
                        active_signal,
                    });
                    self.state.phase = RepPhase::Effort;
                    self.state.active_rep_id = Some(rep_id);
                }
            }
            RepPhase::Effort | RepPhase::Peak => {
                let active = self.active.as_mut().expect("active effort rep");
                if timestamp_ms.saturating_sub(active.start.timestamp_ms)
                    > self.profile.max_rep_duration_ms
                {
                    let rejected =
                        self.reject_active(RepEvidenceReason::DurationExceeded, Some(sample));
                    self.previous = Some(sample);
                    return rejected.into_iter().collect();
                }
                active.hash = hash_sample(active.hash, sample);
                if amplitude >= active.peak_amplitude {
                    active.peak = sample;
                    active.peak_amplitude = amplitude;
                }
                active.peak_secondary_amplitude =
                    active.peak_secondary_amplitude.max(secondary_amplitude);
                let return_hysteresis =
                    if active.peak_amplitude >= self.profile.min_primary_amplitude {
                        self.profile.return_hysteresis
                    } else {
                        // Smaller but coherent excursions do not need to meet the
                        // same reversal distance as a full-range movement. They
                        // are still protected by `seal_active`'s multi-joint
                        // evidence floor before becoming an outcome.
                        (active.peak_amplitude * 0.35)
                            .max(self.profile.start_amplitude * 0.35)
                            .min(self.profile.return_hysteresis)
                    };
                let returned = active.peak_amplitude - amplitude >= return_hysteresis;
                let directly_ready = amplitude <= self.profile.ready_tolerance;
                if returned {
                    self.state.phase = RepPhase::Return;
                } else if directly_ready {
                    sealed.extend(self.seal_active(sample));
                }
            }
            RepPhase::Return => {
                let active = self.active.as_mut().expect("active return rep");
                active.hash = hash_sample(active.hash, sample);
                if amplitude > active.peak_amplitude {
                    active.peak = sample;
                    active.peak_amplitude = amplitude;
                    self.state.phase = RepPhase::Peak;
                    self.pending_ready = None;
                } else if amplitude <= seal_ready_threshold(&self.profile, active.peak_amplitude) {
                    if self.profile.uses_cycle_aligned_boundaries() {
                        let ready_distance = active_ready_distance(active, sample);
                        match self.pending_ready.as_mut() {
                            Some(pending) => {
                                if ready_distance + 1e-6 < pending.best_absolute_amplitude {
                                    pending.best = sample;
                                    pending.best_absolute_amplitude = ready_distance;
                                }
                            }
                            None => {
                                self.pending_ready = Some(PendingReady {
                                    since_ms: sample.timestamp_ms,
                                    best: sample,
                                    best_absolute_amplitude: ready_distance,
                                });
                            }
                        }
                        let pending = self.pending_ready.expect("pending cycle ready");
                        if sample.timestamp_ms.saturating_sub(pending.since_ms)
                            < CYCLE_ALIGNED_READY_DWELL_MS
                        {
                            self.previous = Some(sample);
                            return sealed;
                        }
                        let end = pending.best;
                        self.baseline_primary = Some(end.primary);
                        self.baseline_secondary = Some(end.secondary);
                        self.baseline_torso = Some(end.torso);
                        sealed.extend(self.seal_active(end));
                        self.previous = Some(sample);
                        return sealed;
                    }
                    let next_ready = self.active.as_ref().map(|active| {
                        if self.profile.direction == MovementDirection::Auto {
                            (
                                active.start.primary,
                                active.start.secondary,
                                active.start.torso,
                            )
                        } else {
                            (primary, secondary, torso)
                        }
                    });
                    sealed.extend(self.seal_active(sample));
                    if let Some((next_ready_primary, next_ready_secondary, next_ready_torso)) =
                        next_ready
                    {
                        // Auto-oriented profiles may seal while travelling through the
                        // ready corridor. Keep the cycle's original resting anchor,
                        // rather than the mid-return sample, so the remainder of that
                        // return cannot start an opposite-direction ghost rep.
                        self.baseline_primary = Some(next_ready_primary);
                        self.baseline_secondary = Some(next_ready_secondary);
                        self.baseline_torso = Some(next_ready_torso);
                    }
                } else if self.profile.uses_cycle_aligned_boundaries() {
                    if let Some(pending) = self.pending_ready.take() {
                        // A new departure before the dwell timer expires is
                        // itself evidence that the prior cycle reached its
                        // ready-side extremum. Seal the historical best now;
                        // the following frame may causally arm the next rep.
                        let end = pending.best;
                        self.baseline_primary = Some(end.primary);
                        self.baseline_secondary = Some(end.secondary);
                        self.baseline_torso = Some(end.torso);
                        self.ready_history.clear();
                        self.ready_history.push_back(end);
                        sealed.extend(self.seal_active(end));
                    }
                }
            }
            RepPhase::Frozen => {}
        }
        self.previous = Some(sample);
        sealed
    }

    fn normalized_endpoints_for(
        &self,
        active: &ActiveRep,
        end: RepSample,
    ) -> Option<NormalizedRepEndpointEvidence> {
        let evidence_for = |frame_id: u64| {
            self.local_evidence_history
                .iter()
                .find(|(candidate_frame_id, _, _)| *candidate_frame_id == frame_id)
                .map(|(_, _, evidence)| evidence.clone())
        };
        let independent_turnaround =
            |channel: fn(&LocalMotionCoordinateEvidence) -> Option<LocalTrajectoryChannel>| {
                let start =
                    evidence_for(active.start.frame_id).and_then(|value| channel(&value))?;
                self.local_evidence_history
                    .iter()
                    .filter(|(frame_id, _, _)| {
                        *frame_id >= active.start.frame_id && *frame_id <= end.frame_id
                    })
                    .filter_map(|(_, timestamp_ms, evidence)| {
                        channel(evidence).map(|sample| {
                            (
                                (sample.along_axis_progress - start.along_axis_progress).abs(),
                                *timestamp_ms,
                            )
                        })
                    })
                    .max_by(|left, right| left.0.total_cmp(&right.0))
                    .map(|(_, timestamp_ms)| timestamp_ms)
            };
        Some(NormalizedRepEndpointEvidence {
            coordinate_frame_id: evidence_for(active.start.frame_id)?.coordinate_frame_id,
            start_anchor: evidence_for(active.start.frame_id)?,
            primary_turnaround: evidence_for(active.peak.frame_id)?,
            end_return: evidence_for(end.frame_id)?,
            anatomical_left_turnaround_timestamp_ms: independent_turnaround(|evidence| {
                evidence.anatomical_left_equipment
            }),
            anatomical_right_turnaround_timestamp_ms: independent_turnaround(|evidence| {
                evidence.anatomical_right_equipment
            }),
        })
    }

    /// Temporal variant of the profile graph. Thresholds remain the
    /// exercise-specific amplitude contract, while transitions must persist
    /// for `dwell_ms`. This prevents a single noisy shoulder/elbow fold from
    /// splitting one human repetition into several short cycles and keeps the
    /// reported boundaries at the ready/turning-point/ready extrema rather
    /// than at arbitrary threshold crossings.
    fn process_stable_cycle_sample(&mut self, sample: RepSample, dwell_ms: u64) -> Vec<SealedRep> {
        let (primary, secondary, torso) = (sample.primary, sample.secondary, sample.torso);
        let baseline_primary = *self.baseline_primary.get_or_insert(primary);
        let baseline_secondary = *self.baseline_secondary.get_or_insert(secondary);
        let baseline_torso = *self.baseline_torso.get_or_insert(torso);
        let direction = self
            .active
            .as_ref()
            .map(|active| active.direction)
            .or_else(|| self.pending_activation.map(|pending| pending.direction))
            .or_else(|| {
                let configured = if self.profile.direction == MovementDirection::Auto {
                    self.locked_auto_direction
                        .unwrap_or(MovementDirection::Auto)
                } else {
                    self.profile.direction
                };
                activation_direction(
                    configured,
                    baseline_primary,
                    primary,
                    baseline_secondary,
                    secondary,
                    self.profile.start_amplitude,
                )
            });

        let Some(direction) = direction else {
            self.pending_activation = None;
            self.record_stable_ready_sample(sample);
            return Vec::new();
        };
        let primary_amplitude = directional_delta(direction, baseline_primary, primary);
        let secondary_amplitude = directional_delta(direction, baseline_secondary, secondary);
        let active_signal = self
            .active
            .as_ref()
            .map(|active| active.active_signal)
            .or_else(|| self.pending_activation.map(|pending| pending.active_signal))
            .unwrap_or(ActiveSignal::Bilateral);
        let amplitude = match active_signal {
            ActiveSignal::Bilateral | ActiveSignal::Primary => primary_amplitude,
            ActiveSignal::Secondary => secondary_amplitude,
        };
        let torso_amplitude = directional_delta(direction, baseline_torso, torso);

        let translation_like = self.profile.primary_signal.kind == ExerciseSignalKind::LandmarkY
            && self.profile.secondary_signal.kind == ExerciseSignalKind::LandmarkY
            && amplitude > self.profile.start_amplitude
            && torso_amplitude.abs() >= amplitude.abs() * 0.70
            && secondary_amplitude.abs() >= amplitude.abs() * 0.70
            && (torso_amplitude - amplitude).abs() <= 0.08
            && (secondary_amplitude - amplitude).abs() <= 0.08;
        if translation_like {
            self.pending_activation = None;
            self.pending_return_since_ms = None;
            self.pending_ready = None;
            return self
                .reject_active(RepEvidenceReason::AntiInterferenceFilter, Some(sample))
                .into_iter()
                .collect();
        }

        match self.state.phase {
            RepPhase::Ready => {
                if amplitude < self.profile.start_amplitude * 0.65 {
                    self.pending_activation = None;
                    self.record_stable_ready_sample(sample);
                    return Vec::new();
                }

                if self.pending_activation.is_none() {
                    let start = cycle_aligned_start_sample(
                        &self.ready_history,
                        sample,
                        direction,
                        active_signal,
                        baseline_primary,
                        baseline_secondary,
                        self.profile.start_amplitude,
                    );
                    self.pending_activation = Some(PendingActivation {
                        since_ms: sample.timestamp_ms,
                        start,
                        peak: sample,
                        peak_amplitude: amplitude,
                        peak_secondary_amplitude: secondary_amplitude,
                        direction,
                        active_signal,
                    });
                    return Vec::new();
                }

                let pending = self
                    .pending_activation
                    .as_mut()
                    .expect("pending activation");
                if pending.direction != direction {
                    self.pending_activation = None;
                    return Vec::new();
                }
                if amplitude >= pending.peak_amplitude {
                    pending.peak = sample;
                    pending.peak_amplitude = amplitude;
                }
                pending.peak_secondary_amplitude =
                    pending.peak_secondary_amplitude.max(secondary_amplitude);
                if sample.timestamp_ms.saturating_sub(pending.since_ms) < dwell_ms {
                    return Vec::new();
                }

                let pending = self.pending_activation.take().expect("pending activation");
                let rep_id = self.next_rep_id;
                self.active = Some(ActiveRep {
                    rep_id,
                    direction: pending.direction,
                    start: pending.start,
                    peak: pending.peak,
                    peak_amplitude: pending.peak_amplitude,
                    peak_secondary_amplitude: pending.peak_secondary_amplitude,
                    hash: hash_sample(FNV_OFFSET, pending.start),
                    recovered_across_gap: false,
                    active_signal: pending.active_signal,
                });
                self.ready_history.clear();
                self.state.phase = RepPhase::Effort;
                self.state.active_rep_id = Some(rep_id);
                Vec::new()
            }
            RepPhase::Effort | RepPhase::Peak => {
                let active = self.active.as_mut().expect("active stable effort rep");
                if sample
                    .timestamp_ms
                    .saturating_sub(active.start.timestamp_ms)
                    > self.profile.max_rep_duration_ms
                {
                    return self
                        .reject_active(RepEvidenceReason::DurationExceeded, Some(sample))
                        .into_iter()
                        .collect();
                }
                active.hash = hash_sample(active.hash, sample);
                if amplitude >= active.peak_amplitude {
                    active.peak = sample;
                    active.peak_amplitude = amplitude;
                    self.pending_return_since_ms = None;
                }
                active.peak_secondary_amplitude =
                    active.peak_secondary_amplitude.max(secondary_amplitude);
                let reversal = active.peak_amplitude - amplitude >= self.profile.return_hysteresis;
                if !reversal {
                    self.pending_return_since_ms = None;
                    return Vec::new();
                }
                let since = *self
                    .pending_return_since_ms
                    .get_or_insert(sample.timestamp_ms);
                if sample.timestamp_ms.saturating_sub(since) >= dwell_ms {
                    self.state.phase = RepPhase::Return;
                    self.pending_ready = None;
                }
                Vec::new()
            }
            RepPhase::Return => {
                let active = self.active.as_mut().expect("active stable return rep");
                active.hash = hash_sample(active.hash, sample);
                if amplitude > active.peak_amplitude {
                    active.peak = sample;
                    active.peak_amplitude = amplitude;
                    self.state.phase = RepPhase::Effort;
                    self.pending_return_since_ms = None;
                    self.pending_ready = None;
                    return Vec::new();
                }

                let ready_threshold = self
                    .profile
                    .ready_tolerance
                    .max(self.profile.start_amplitude * 0.35);
                if amplitude.abs() > ready_threshold {
                    self.pending_ready = None;
                    return Vec::new();
                }

                match self.pending_ready.as_mut() {
                    Some(pending) => {
                        if amplitude.abs() <= pending.best_absolute_amplitude {
                            pending.best = sample;
                            pending.best_absolute_amplitude = amplitude.abs();
                        }
                    }
                    None => {
                        self.pending_ready = Some(PendingReady {
                            since_ms: sample.timestamp_ms,
                            best: sample,
                            best_absolute_amplitude: amplitude.abs(),
                        });
                    }
                }
                let pending = self.pending_ready.expect("pending ready");
                if sample.timestamp_ms.saturating_sub(pending.since_ms) < dwell_ms {
                    return Vec::new();
                }
                let end = pending.best;
                self.baseline_primary = Some(end.primary);
                self.baseline_secondary = Some(end.secondary);
                self.baseline_torso = Some(end.torso);
                self.seal_active(end).into_iter().collect()
            }
            RepPhase::Frozen => Vec::new(),
        }
    }

    fn record_stable_ready_sample(&mut self, sample: RepSample) {
        update_ready_baseline(
            self.profile.direction,
            &mut self.baseline_primary,
            sample.primary,
        );
        update_ready_baseline(
            self.profile.direction,
            &mut self.baseline_secondary,
            sample.secondary,
        );
        update_ready_baseline(
            self.profile.direction,
            &mut self.baseline_torso,
            sample.torso,
        );
        self.ready_history.push_back(sample);
        while self
            .ready_history
            .front()
            .is_some_and(|ready| sample.timestamp_ms.saturating_sub(ready.timestamp_ms) > 2_500)
        {
            self.ready_history.pop_front();
        }
    }

    fn signal_sample(
        &mut self,
        frame_id: u64,
        timestamp_ms: u64,
        primary: f32,
        secondary: f32,
        torso: f32,
    ) -> RepSample {
        let raw = RepSample {
            frame_id,
            timestamp_ms,
            primary,
            secondary,
            torso,
        };
        let Some(window_ms) = self.profile.signal_smoothing_ms() else {
            return raw;
        };
        self.signal_window.push_back(raw);
        while self
            .signal_window
            .front()
            .is_some_and(|sample| timestamp_ms.saturating_sub(sample.timestamp_ms) > window_ms)
        {
            self.signal_window.pop_front();
        }
        RepSample {
            frame_id,
            timestamp_ms,
            primary: median_values(self.signal_window.iter().map(|sample| sample.primary)),
            secondary: median_values(self.signal_window.iter().map(|sample| sample.secondary)),
            torso: median_values(self.signal_window.iter().map(|sample| sample.torso)),
        }
    }

    fn handle_gap(
        &mut self,
        timestamp_ms: u64,
        rejection_reason: RepEvidenceReason,
    ) -> Vec<SealedRep> {
        if self.active.is_none() {
            self.pending_activation = None;
            self.pending_return_since_ms = None;
            self.pending_ready = None;
            return Vec::new();
        }
        let gap_since = *self.gap_since_ms.get_or_insert(timestamp_ms);
        if timestamp_ms.saturating_sub(gap_since) > self.profile.max_gap_ms {
            self.reject_active(rejection_reason, self.previous)
                .into_iter()
                .collect()
        } else {
            self.state.phase = RepPhase::Frozen;
            Vec::new()
        }
    }
}

#[cfg(test)]
mod profile_signal_smoothing_tests {
    use super::{CanonicalLandmark, ExerciseProfile, RepEngine, RepPhase, TargetState};

    fn canonical_frame(wrist_y: f32, elbow_y: f32) -> Vec<CanonicalLandmark> {
        let mut landmarks = vec![CanonicalLandmark::measured(0.5, 0.5, 0.0, 0.95); 33];
        for (index, x) in [(15, 0.35), (16, 0.65)] {
            landmarks[index] = CanonicalLandmark::measured(x, wrist_y, 0.0, 0.95);
        }
        for (index, x) in [(13, 0.40), (14, 0.60)] {
            landmarks[index] = CanonicalLandmark::measured(x, elbow_y, 0.0, 0.95);
        }
        landmarks
    }

    fn engine(state_machine_id: &str) -> RepEngine {
        let mut profile = ExerciseProfile::lat_pulldown_provisional();
        profile.state_machine_id = state_machine_id.into();
        profile.content_hash = profile.computed_content_hash();
        RepEngine::new(profile)
    }

    #[test]
    fn median_state_graphs_reject_spikes_by_elapsed_time_window() {
        let mut regular = engine("ready-effort-peak-return/v1");
        let mut short = engine("median-100ms-ready-effort-peak-return/v1");
        let mut long = engine("median-400ms-ready-effort-peak-return/v1");
        let frames = [
            (0, 0.20, 0.30),
            (100, 0.20, 0.30),
            (200, 0.20, 0.30),
            (300, 0.80, 0.70),
            (400, 0.80, 0.70),
        ];
        for (frame_id, &(timestamp_ms, wrist_y, elbow_y)) in frames.iter().enumerate() {
            let canonical = canonical_frame(wrist_y, elbow_y);
            for engine in [&mut regular, &mut short, &mut long] {
                engine.process(
                    frame_id as u64,
                    timestamp_ms,
                    TargetState::Locked,
                    &canonical,
                );
            }
        }

        assert_eq!(regular.state.phase, RepPhase::Effort);
        assert_eq!(short.state.phase, RepPhase::Effort);
        assert_eq!(long.state.phase, RepPhase::Ready);
    }

    #[test]
    fn cycle_aligned_graph_backtracks_onset_and_waits_for_the_ready_pose() {
        let mut regular = engine("ready-effort-peak-return/v1");
        let mut aligned = engine("cycle-aligned-ready-effort-peak-return/v1");
        let wrist_values = [
            0.20, 0.20, 0.21, 0.26, 0.40, 0.50, 0.38, 0.33, 0.255, 0.22, 0.205, 0.20, 0.20, 0.20,
            0.20,
        ];
        let mut regular_outcomes = Vec::new();
        let mut aligned_outcomes = Vec::new();
        for (frame_id, wrist_y) in wrist_values.into_iter().enumerate() {
            let timestamp_ms = frame_id as u64 * 100;
            let canonical = canonical_frame(wrist_y, wrist_y - 0.02);
            regular_outcomes.extend(regular.process(
                frame_id as u64,
                timestamp_ms,
                TargetState::Locked,
                &canonical,
            ));
            aligned_outcomes.extend(aligned.process(
                frame_id as u64,
                timestamp_ms,
                TargetState::Locked,
                &canonical,
            ));
        }

        assert_eq!(regular_outcomes.len(), 1);
        assert_eq!(aligned_outcomes.len(), 1);
        assert!(aligned_outcomes[0].start_timestamp_ms < regular_outcomes[0].start_timestamp_ms);
        assert!(aligned_outcomes[0].end_timestamp_ms > regular_outcomes[0].end_timestamp_ms);
        assert_eq!(aligned_outcomes[0].start_timestamp_ms, 200);
        assert_eq!(aligned_outcomes[0].end_timestamp_ms, 1_000);
    }

    #[test]
    fn stable_cycle_graph_does_not_split_one_rep_on_a_brief_reversal() {
        let mut engine = engine("stable-cycle-200ms-ready-effort-peak-return/v1");
        // One complete excursion contains a two-frame reversal at 800-900 ms.
        // A threshold-only graph closes there and treats the remaining return
        // as another movement.  The temporal graph must wait for a sustained
        // reversal and a stable ready pose, while retaining the full-cycle
        // boundary timestamps.
        let wrist_values = [
            0.20, 0.20, 0.20, 0.21, 0.25, 0.34, 0.45, 0.52, 0.43, 0.50, 0.53, 0.47, 0.39, 0.31,
            0.24, 0.205, 0.20, 0.20,
        ];
        let mut outcomes = Vec::new();
        for (frame_id, wrist_y) in wrist_values.into_iter().enumerate() {
            let timestamp_ms = frame_id as u64 * 100;
            outcomes.extend(engine.process(
                frame_id as u64,
                timestamp_ms,
                TargetState::Locked,
                &canonical_frame(wrist_y, wrist_y - 0.02),
            ));
        }

        assert_eq!(outcomes.len(), 1);
        assert!(outcomes[0].start_timestamp_ms <= 400);
        assert_eq!(outcomes[0].peak_timestamp_ms, 1_000);
        assert!(outcomes[0].end_timestamp_ms >= 1_500);
    }
}

fn profile_signal(
    profile: &ExerciseProfile,
    canonical: &[CanonicalLandmark],
) -> Option<(f32, f32, f32, bool)> {
    profile_signal_with_local(profile, canonical, None)
}

fn profile_signal_with_local(
    profile: &ExerciseProfile,
    canonical: &[CanonicalLandmark],
    local_coordinate: Option<&LocalMotionCoordinateEvidence>,
) -> Option<(f32, f32, f32, bool)> {
    let torso_origin_y = if profile.primary_signal.kind == ExerciseSignalKind::LandmarkY
        && profile.secondary_signal.kind == ExerciseSignalKind::LandmarkY
    {
        stable_torso_origin_y(profile.schema, canonical)?
    } else {
        0.0
    };
    Some((
        measure_signal(
            profile.schema,
            &profile.primary_signal,
            canonical,
            local_coordinate,
        )?
        .value,
        measure_signal(
            profile.schema,
            &profile.secondary_signal,
            canonical,
            local_coordinate,
        )?
        .value,
        torso_origin_y,
        profile
            .primary_signal
            .landmarks
            .iter()
            .chain(&profile.secondary_signal.landmarks)
            .any(|&index| {
                canonical.get(index).is_some_and(|landmark| {
                    matches!(
                        landmark.source,
                        LandmarkSource::Fused | LandmarkSource::Predicted
                    )
                })
            }),
    ))
}

fn profile_signal_measurement(
    profile: &ExerciseProfile,
    signal: &ExerciseSignal,
    canonical: &[CanonicalLandmark],
    local_coordinate: Option<&LocalMotionCoordinateEvidence>,
) -> Option<SignalMeasurement> {
    measure_signal(profile.schema, signal, canonical, local_coordinate)
}

fn resolved_profile_primary(
    profile: &ExerciseProfile,
    canonical: &[CanonicalLandmark],
    local_coordinate: Option<&LocalMotionCoordinateEvidence>,
) -> Option<SignalMeasurement> {
    profile_signal_transition_eligible(profile, canonical, local_coordinate).then_some(())?;
    profile_signal_measurement(
        profile,
        &profile.primary_signal,
        canonical,
        local_coordinate,
    )
}

/// Independent pose corroboration for a barbell-bench turnaround. Both arms
/// must be judgeable in the current Halpe/Blaze schema; one drifting arm can
/// therefore explain a conflict but can never relocate the shaft boundary.
fn barbell_pose_signal(profile: &ExerciseProfile, canonical: &[CanonicalLandmark]) -> Option<f32> {
    let angles = measure_joint_angles_for_schema(canonical, TargetState::Locked, profile.schema);
    let left = angles.iter().find(|angle| {
        angle.kind == JointAngleKind::Elbow && angle.side == BodySide::Left && angle.judgeable
    })?;
    let right = angles.iter().find(|angle| {
        angle.kind == JointAngleKind::Elbow && angle.side == BodySide::Right && angle.judgeable
    })?;
    let elbow_flexion = (left.value_degrees? + right.value_degrees?) * 0.5;
    if profile.uses_local_shoulder_press_state_graph() {
        // Shoulder press gets a dedicated pose corroboration definition. The
        // shaft still owns phase boundaries, while the mean wrist-to-shoulder
        // rise distinguishes an overhead press from a bench-style elbow fold.
        let left_shoulder = canonical.get(5)?;
        let right_shoulder = canonical.get(6)?;
        let left_wrist = canonical.get(9)?;
        let right_wrist = canonical.get(10)?;
        if [left_shoulder, right_shoulder, left_wrist, right_wrist]
            .into_iter()
            .any(|landmark| {
                landmark.source == LandmarkSource::Unknown
                    || landmark.canonical_confidence < PHASE_SIGNAL_MIN_CONFIDENCE
                    || !landmark.renderable
            })
        {
            return None;
        }
        let shoulder_y = (left_shoulder.y? + right_shoulder.y?) * 0.5;
        let wrist_y = (left_wrist.y? + right_wrist.y?) * 0.5;
        return Some(shoulder_y - wrist_y);
    }
    Some(elbow_flexion)
}

const PHASE_SIGNAL_MIN_CONFIDENCE: f32 = 0.5;

/// Whether every coordinate needed for a phase signal is backed by a current
/// measured or topology-fused observation. Predicted points may be rendered
/// for at most the continuity horizon, but cannot establish a new motion
/// event or update the ready baseline.
fn profile_signal_transition_eligible(
    profile: &ExerciseProfile,
    canonical: &[CanonicalLandmark],
    local_coordinate: Option<&LocalMotionCoordinateEvidence>,
) -> bool {
    [&profile.primary_signal, &profile.secondary_signal]
        .into_iter()
        .all(|signal| {
            if signal.kind.is_local() {
                return measure_signal(profile.schema, signal, canonical, local_coordinate)
                    .is_some_and(|measurement| {
                        measurement.confidence >= PHASE_SIGNAL_MIN_CONFIDENCE
                    });
            }
            signal.landmarks.iter().all(|&index| {
                canonical.get(index).is_some_and(|landmark| {
                    matches!(
                        landmark.source,
                        LandmarkSource::Measured | LandmarkSource::Fused
                    ) && landmark.renderable
                        && landmark.canonical_confidence.is_finite()
                        && landmark.canonical_confidence >= PHASE_SIGNAL_MIN_CONFIDENCE
                        && landmark.x.is_some_and(f32::is_finite)
                        && landmark.y.is_some_and(f32::is_finite)
                })
            })
        })
}

#[cfg(test)]
mod rep_signal_observation_trust_tests {
    use super::{
        CanonicalLandmark, ContinuityReason, ExerciseMaturity, ExerciseProfile, ExerciseSignal,
        ExerciseSignalKind, LandmarkSource, MovementDirection, PROFILE_REQUIRED_CAPABILITIES,
        PoseSchemaId, RepEngine, TargetState,
    };

    fn elbow_point(angle_degrees: f32, mirrored: bool) -> (f32, f32) {
        let radians = angle_degrees.to_radians();
        let direction = if mirrored { -1.0 } else { 1.0 };
        (
            0.5 + direction * -radians.cos() * 0.1,
            0.5 + radians.sin() * 0.1,
        )
    }

    fn measured_arm_frame(angle_degrees: f32) -> Vec<CanonicalLandmark> {
        let mut canonical = vec![CanonicalLandmark::unknown(0.0, None); 26];
        let (left_wrist_x, left_wrist_y) = elbow_point(angle_degrees, true);
        let (right_wrist_x, right_wrist_y) = elbow_point(angle_degrees, false);
        for (index, x, y) in [
            (5, 0.6, 0.5),
            (7, 0.5, 0.5),
            (9, left_wrist_x, left_wrist_y),
            (6, 0.4, 0.5),
            (8, 0.5, 0.5),
            (10, right_wrist_x, right_wrist_y),
        ] {
            canonical[index] = CanonicalLandmark::measured(x, y, 0.0, 0.95);
        }
        canonical
    }

    fn frame_with_out_of_bounds_predicted_right_elbow(
        secondary_angle_degrees: f32,
    ) -> Vec<CanonicalLandmark> {
        let mut canonical = measured_arm_frame(secondary_angle_degrees);
        canonical[6] = CanonicalLandmark::measured(0.40, 0.50, 0.0, 0.95);
        canonical[8] = CanonicalLandmark {
            x: Some(2.445),
            y: Some(0.425),
            z: Some(0.0),
            observation_score: 0.05,
            canonical_confidence: 0.06,
            uncertainty: Some(0.05),
            source: LandmarkSource::Predicted,
            renderable: true,
            reason: Some(ContinuityReason::ShortGapPrediction),
        };
        canonical[10] = CanonicalLandmark::measured(0.21, 0.43, 0.0, 0.95);
        canonical
    }

    fn front_bench_joint_angle_engine() -> RepEngine {
        let mut profile = ExerciseProfile {
            identity: "barbell-bench-press/front/bilateral/barbell/test-signal-trust-v1".into(),
            content_hash: 0,
            maturity: ExerciseMaturity::Provisional,
            schema: PoseSchemaId::Halpe26,
            coordinate_unit: "image-angle-deg".into(),
            state_machine_id: "cycle-aligned-ready-effort-peak-return/v1".into(),
            required_capabilities: PROFILE_REQUIRED_CAPABILITIES,
            primary_signal: ExerciseSignal {
                kind: ExerciseSignalKind::JointAngle,
                landmarks: vec![6, 8, 10],
            },
            secondary_signal: ExerciseSignal {
                kind: ExerciseSignalKind::JointAngle,
                landmarks: vec![5, 7, 9],
            },
            direction: MovementDirection::Decreasing,
            start_amplitude: 10.0,
            min_primary_amplitude: 30.0,
            min_secondary_amplitude: 30.0,
            return_hysteresis: 15.0,
            ready_tolerance: 8.0,
            max_gap_ms: 400,
            min_rep_duration_ms: 300,
            max_rep_duration_ms: 3_000,
        };
        profile.content_hash = profile.computed_content_hash();
        RepEngine::new(profile)
    }

    #[test]
    fn predicted_low_confidence_joint_cannot_become_the_rep_peak() {
        let mut engine = front_bench_joint_angle_engine();
        engine.begin_set();
        let mut outcomes = Vec::new();
        let sequence = [
            (0, measured_arm_frame(160.0)),
            (200, measured_arm_frame(160.0)),
            (400, measured_arm_frame(160.0)),
            (600, measured_arm_frame(160.0)),
            (700, measured_arm_frame(120.0)),
            (800, frame_with_out_of_bounds_predicted_right_elbow(100.0)),
            (900, measured_arm_frame(90.0)),
            (1_000, measured_arm_frame(120.0)),
            (1_100, measured_arm_frame(145.0)),
            (1_200, measured_arm_frame(160.0)),
            (1_400, measured_arm_frame(160.0)),
            (1_600, measured_arm_frame(160.0)),
            (1_800, measured_arm_frame(160.0)),
        ];
        for (frame_id, (timestamp_ms, canonical)) in sequence.into_iter().enumerate() {
            outcomes.extend(engine.process(
                frame_id as u64,
                timestamp_ms,
                TargetState::Locked,
                &canonical,
            ));
        }

        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].peak_timestamp_ms, 900);
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SignalMeasurement {
    pub(crate) value: f32,
    pub(crate) confidence: f32,
}

impl SignalMeasurement {
    fn new(value: f32, confidence: f32) -> Option<Self> {
        (value.is_finite() && confidence.is_finite()).then_some(Self {
            value,
            confidence: confidence.clamp(0.0, 1.0),
        })
    }
}

fn measure_signal(
    schema: PoseSchemaId,
    signal: &ExerciseSignal,
    canonical: &[CanonicalLandmark],
    local_coordinate: Option<&LocalMotionCoordinateEvidence>,
) -> Option<SignalMeasurement> {
    if signal.kind.is_local() {
        return measure_local_signal(signal.kind, local_coordinate?);
    }
    let value = match signal.kind {
        ExerciseSignalKind::LandmarkY => mean_landmark_y(&signal.landmarks, canonical),
        ExerciseSignalKind::JointAngle => {
            let [first, joint, third]: [usize; 3] = signal.landmarks.as_slice().try_into().ok()?;
            joint_angle_degrees(
                landmark_xy(first, canonical)?,
                landmark_xy(joint, canonical)?,
                landmark_xy(third, canonical)?,
            )
        }
        ExerciseSignalKind::LandmarkDistance => {
            let [first, second]: [usize; 2] = signal.landmarks.as_slice().try_into().ok()?;
            let scale = torso_scale(schema, canonical)?;
            let (left_x, left_y) = landmark_xy(first, canonical)?;
            let (right_x, right_y) = landmark_xy(second, canonical)?;
            Some(((left_x - right_x).hypot(left_y - right_y)) / scale)
        }
        ExerciseSignalKind::LandmarkHorizontalDistance => {
            let [first, second]: [usize; 2] = signal.landmarks.as_slice().try_into().ok()?;
            let scale = torso_scale(schema, canonical)?;
            let (first_x, _) = landmark_xy(first, canonical)?;
            let (second_x, _) = landmark_xy(second, canonical)?;
            Some((first_x - second_x).abs() / scale)
        }
        ExerciseSignalKind::LandmarkVerticalDistance => {
            let [first, second]: [usize; 2] = signal.landmarks.as_slice().try_into().ok()?;
            let scale = torso_scale(schema, canonical)?;
            let (_, first_y) = landmark_xy(first, canonical)?;
            let (_, second_y) = landmark_xy(second, canonical)?;
            Some((first_y - second_y).abs() / scale)
        }
        ExerciseSignalKind::PairedLandmarkDistanceSum => {
            let [first, second, third, fourth]: [usize; 4] =
                signal.landmarks.as_slice().try_into().ok()?;
            let scale = torso_scale(schema, canonical)?;
            let distance = |left: usize, right: usize| {
                let (left_x, left_y) = landmark_xy(left, canonical)?;
                let (right_x, right_y) = landmark_xy(right, canonical)?;
                Some((left_x - right_x).hypot(left_y - right_y))
            };
            Some((distance(first, second)? + distance(third, fourth)?) / scale)
        }
        ExerciseSignalKind::LocalAlongAxisProgress
        | ExerciseSignalKind::LocalCrossAxisDisplacement
        | ExerciseSignalKind::LocalEndpointRelativeProgress
        | ExerciseSignalKind::LocalDynamicBarAngle
        | ExerciseSignalKind::LocalChannelAgreement
        | ExerciseSignalKind::LocalObservability => None,
    }?;
    SignalMeasurement::new(value, signal_confidence(signal, canonical))
}

fn measure_local_signal(
    kind: ExerciseSignalKind,
    local: &LocalMotionCoordinateEvidence,
) -> Option<SignalMeasurement> {
    if local.state == LocalCoordinateState::Degraded
        || local.source_timestamp_ms.is_none()
        || local.confidence <= 0.0
    {
        return None;
    }
    match kind {
        ExerciseSignalKind::LocalAlongAxisProgress => {
            let channel = local.equipment?;
            local_channel_measurement(channel, channel.along_axis_progress)
        }
        ExerciseSignalKind::LocalCrossAxisDisplacement => {
            let channel = local.equipment?;
            local_channel_measurement(channel, channel.cross_axis_displacement)
        }
        ExerciseSignalKind::LocalEndpointRelativeProgress => {
            let endpoint_one = local.endpoint_one_progress?;
            let endpoint_two = local.endpoint_two_progress?;
            local_channel_measurement(local.equipment?, (endpoint_one + endpoint_two) * 0.5)
        }
        ExerciseSignalKind::LocalDynamicBarAngle => local_channel_measurement(
            local.equipment?,
            local.baseline_corrected_bar_angle_radians?,
        ),
        ExerciseSignalKind::LocalChannelAgreement => {
            let (value, confidence) = match local.channel_agreement {
                LocalChannelAgreement::Agreement => (
                    1.0,
                    local
                        .equipment
                        .zip(local.pose)
                        .map_or(0.0, |(equipment, pose)| {
                            equipment.confidence.min(pose.confidence)
                        }),
                ),
                LocalChannelAgreement::EquipmentOnly => (
                    0.5,
                    local.equipment.map_or(0.0, |channel| channel.confidence),
                ),
                LocalChannelAgreement::PoseOnly => {
                    (0.5, local.pose.map_or(0.0, |channel| channel.confidence))
                }
                LocalChannelAgreement::Conflict => (
                    0.0,
                    local
                        .equipment
                        .zip(local.pose)
                        .map_or(0.0, |(equipment, pose)| {
                            equipment.confidence.min(pose.confidence)
                        }),
                ),
                LocalChannelAgreement::CannotJudge => return None,
            };
            let reliability = match local.channel_agreement {
                LocalChannelAgreement::Agreement | LocalChannelAgreement::Conflict => {
                    local.equipment.zip(local.pose).map(|(equipment, pose)| {
                        local_channel_reliability(equipment).min(local_channel_reliability(pose))
                    })?
                }
                LocalChannelAgreement::EquipmentOnly => local_channel_reliability(local.equipment?),
                LocalChannelAgreement::PoseOnly => local_channel_reliability(local.pose?),
                LocalChannelAgreement::CannotJudge => return None,
            };
            SignalMeasurement::new(value, confidence.min(reliability))
        }
        ExerciseSignalKind::LocalObservability => {
            SignalMeasurement::new(local.confidence, local.confidence)
        }
        _ => None,
    }
}

fn local_channel_measurement(
    channel: LocalTrajectoryChannel,
    value: f32,
) -> Option<SignalMeasurement> {
    SignalMeasurement::new(value, local_channel_reliability(channel))
}

/// Claim eligibility remains Rust-owned. Confidence cannot mask sparse
/// coverage or detector uncertainty; either one lowers the phase signal below
/// the same public transition gate used by all Recognition Profiles.
fn local_channel_reliability(channel: LocalTrajectoryChannel) -> f32 {
    channel
        .confidence
        .min(channel.coverage)
        .min(1.0 - channel.uncertainty.clamp(0.0, 1.0))
        .clamp(0.0, 1.0)
}

fn signal_confidence(signal: &ExerciseSignal, canonical: &[CanonicalLandmark]) -> f32 {
    signal
        .landmarks
        .iter()
        .filter_map(|index| canonical.get(*index))
        .filter(|landmark| landmark.source != LandmarkSource::Unknown)
        .map(|landmark| landmark.canonical_confidence)
        .filter(|confidence| confidence.is_finite())
        .fold(1.0_f32, f32::min)
        .clamp(0.0, 1.0)
}

#[cfg(test)]
mod local_profile_signal_consumption_tests {
    use super::*;

    fn local_evidence(
        kind: ExerciseSignalKind,
        progress: f32,
        timestamp_ms: u64,
    ) -> LocalMotionCoordinateEvidence {
        let channel = LocalTrajectoryChannel {
            along_axis_progress: progress,
            cross_axis_displacement: progress,
            confidence: 0.95,
            coverage: 1.0,
            uncertainty: 0.05,
            provenance: LocalChannelProvenance::EquipmentMeasured,
        };
        let channel_agreement = if kind == ExerciseSignalKind::LocalChannelAgreement {
            if progress >= 0.75 {
                LocalChannelAgreement::Agreement
            } else if progress >= 0.25 {
                LocalChannelAgreement::EquipmentOnly
            } else {
                LocalChannelAgreement::Conflict
            }
        } else {
            LocalChannelAgreement::EquipmentOnly
        };
        LocalMotionCoordinateEvidence {
            coordinate_frame_id: 1,
            source_timestamp_ms: Some(timestamp_ms),
            state: LocalCoordinateState::Frozen,
            reason: None,
            equipment: Some(channel),
            pose: (kind == ExerciseSignalKind::LocalChannelAgreement).then_some(channel),
            endpoint_one_progress: Some(progress),
            endpoint_two_progress: Some(progress),
            baseline_corrected_bar_angle_radians: Some(progress),
            channel_agreement,
            confidence: if kind == ExerciseSignalKind::LocalObservability {
                0.60 + progress * 0.40
            } else {
                0.95
            },
            ..LocalMotionCoordinateEvidence::default()
        }
    }

    fn local_profile(kind: ExerciseSignalKind) -> ExerciseProfile {
        let mut profile = ExerciseProfile::barbell_bench_press_local_front_provisional();
        profile.primary_signal = ExerciseSignal {
            kind,
            landmarks: Vec::new(),
        };
        profile.secondary_signal = ExerciseSignal {
            kind,
            landmarks: Vec::new(),
        };
        profile.min_primary_amplitude = 0.20;
        profile.content_hash = profile.computed_content_hash();
        profile
    }

    fn observed_barbell_frame(timestamp_ms: u64) -> EquipmentFrameEvidence {
        EquipmentFrameEvidence {
            timestamp_ms,
            subject_candidate_id: Some(7),
            status: EquipmentFrameStatus::Observed,
            tracks: vec![EquipmentTrackEvidence {
                track_id: 1,
                proposal_id: 1,
                subject_candidate_id: 7,
                kind: EquipmentKind::BarbellShaft,
                bbox: NormalizedRect::new(0.20, 0.20, 0.60, 0.02),
                axis: None,
                center_x: 0.50,
                center_y: 0.20,
                observation_score: 0.95,
                association_confidence: 0.95,
                uncertainty_px: Some(1.0),
                source: EquipmentSource::Geometry,
                held_by: EquipmentHand::Both,
                judgeable_path: true,
            }],
            rejected_reflection_count: 0,
            rejected_static_count: 0,
            rejected_low_confidence_or_invalid_count: 0,
            rejected_outside_subject_count: 0,
        }
    }

    fn run_local_profile(kind: ExerciseSignalKind, provide_local_evidence: bool) -> Vec<SealedRep> {
        let mut engine = RepEngine::new(local_profile(kind));
        engine.begin_set();
        let canonical = vec![CanonicalLandmark::unknown(0.0, None); 26];
        let mut missing_evidence_frame = observed_barbell_frame(0);
        if !provide_local_evidence {
            missing_evidence_frame.tracks[0].center_y = 0.20;
        }
        let progress = [0.0; 10]
            .into_iter()
            .chain([0.10, 0.30, 0.60, 1.0, 0.80, 0.40, 0.10, 0.0])
            .chain([0.0; 5]);
        let mut sealed = Vec::new();
        for (frame_id, progress) in progress.enumerate() {
            let timestamp_ms = frame_id as u64 * 100;
            let evidence = local_evidence(kind, progress, timestamp_ms);
            let equipment = if provide_local_evidence {
                observed_barbell_frame(timestamp_ms)
            } else {
                let mut equipment = missing_evidence_frame.clone();
                equipment.timestamp_ms = timestamp_ms;
                equipment.tracks[0].center_y = 0.20 + progress * 0.40;
                equipment
            };
            sealed.extend(engine.process_with_equipment(
                frame_id as u64,
                timestamp_ms,
                TargetState::Locked,
                &canonical,
                &equipment,
                &[],
                provide_local_evidence.then_some(&evidence),
            ));
        }
        sealed.extend(engine.finish_set());
        sealed
    }

    #[test]
    fn every_named_local_signal_can_drive_the_real_rep_engine() {
        for kind in [
            ExerciseSignalKind::LocalAlongAxisProgress,
            ExerciseSignalKind::LocalCrossAxisDisplacement,
            ExerciseSignalKind::LocalEndpointRelativeProgress,
            ExerciseSignalKind::LocalDynamicBarAngle,
            ExerciseSignalKind::LocalChannelAgreement,
            ExerciseSignalKind::LocalObservability,
        ] {
            let sealed = run_local_profile(kind, true);
            assert!(
                sealed
                    .iter()
                    .any(|rep| rep.disposition != RepDisposition::Rejected),
                "{kind:?} did not drive a reviewable Rep: {sealed:?}",
            );
        }
    }

    #[test]
    fn local_profile_fails_closed_without_local_evidence_instead_of_using_screen_bar_y() {
        assert!(
            run_local_profile(ExerciseSignalKind::LocalAlongAxisProgress, false).is_empty(),
            "a local Profile must not fall back to the available screen-space bar center",
        );
    }

    #[test]
    fn legacy_landmark_signal_still_measures_without_local_evidence() {
        let canonical = vec![CanonicalLandmark::measured(0.4, 0.25, 0.0, 0.95)];
        let signal = ExerciseSignal {
            kind: ExerciseSignalKind::LandmarkY,
            landmarks: vec![0],
        };
        assert_eq!(
            measure_signal(PoseSchemaId::Halpe26, &signal, &canonical, None)
                .map(|measurement| measurement.value),
            Some(0.25),
        );
    }

    #[test]
    fn local_phase_eligibility_uses_coverage_and_uncertainty_with_confidence() {
        let profile = local_profile(ExerciseSignalKind::LocalAlongAxisProgress);
        let canonical = vec![CanonicalLandmark::unknown(0.0, None); 26];
        let mut evidence = local_evidence(ExerciseSignalKind::LocalAlongAxisProgress, 0.5, 1_000);
        evidence.equipment.as_mut().unwrap().coverage = 0.30;
        assert!(
            !profile_signal_transition_eligible(&profile, &canonical, Some(&evidence)),
            "high detector confidence cannot hide sparse channel coverage",
        );

        let channel = evidence.equipment.as_mut().unwrap();
        channel.coverage = 0.95;
        channel.uncertainty = 0.70;
        assert!(
            !profile_signal_transition_eligible(&profile, &canonical, Some(&evidence)),
            "high detector confidence and coverage cannot hide channel uncertainty",
        );
    }
}

fn landmark_xy(index: usize, canonical: &[CanonicalLandmark]) -> Option<(f32, f32)> {
    let landmark = canonical.get(index)?;
    if landmark.source == LandmarkSource::Unknown || landmark.canonical_confidence <= 0.0 {
        return None;
    }
    let (x, y) = (landmark.x?, landmark.y?);
    (x.is_finite() && y.is_finite()).then_some((x, y))
}

fn joint_angle_degrees(first: (f32, f32), joint: (f32, f32), third: (f32, f32)) -> Option<f32> {
    let left = (first.0 - joint.0, first.1 - joint.1);
    let right = (third.0 - joint.0, third.1 - joint.1);
    let left_length = left.0.hypot(left.1);
    let right_length = right.0.hypot(right.1);
    if left_length <= 1e-6 || right_length <= 1e-6 {
        return None;
    }
    let cosine =
        ((left.0 * right.0 + left.1 * right.1) / (left_length * right_length)).clamp(-1.0, 1.0);
    Some(cosine.acos().to_degrees())
}

/// Measures the eight stable left/right joint angles used by the live camera
/// overlay. These are projected image-plane angles, not clinical 3D joint
/// measurements. The triplets are fixed here so profile fitting and clients
/// cannot silently assign different meanings to a named angle.
pub fn measure_joint_angles(
    canonical: &[CanonicalLandmark],
    target_state: TargetState,
) -> Vec<JointAngleSnapshot> {
    measure_joint_angles_for_schema(canonical, target_state, PoseSchemaId::BlazePose33)
}

pub fn measure_joint_angles_for_schema(
    canonical: &[CanonicalLandmark],
    target_state: TargetState,
    schema: PoseSchemaId,
) -> Vec<JointAngleSnapshot> {
    const BLAZEPOSE33_DEFINITIONS: [(JointAngleKind, BodySide, [usize; 3]); 8] = [
        (JointAngleKind::Elbow, BodySide::Left, [11, 13, 15]),
        (JointAngleKind::Elbow, BodySide::Right, [12, 14, 16]),
        (JointAngleKind::Shoulder, BodySide::Left, [23, 11, 13]),
        (JointAngleKind::Shoulder, BodySide::Right, [24, 12, 14]),
        (JointAngleKind::Hip, BodySide::Left, [11, 23, 25]),
        (JointAngleKind::Hip, BodySide::Right, [12, 24, 26]),
        (JointAngleKind::Knee, BodySide::Left, [23, 25, 27]),
        (JointAngleKind::Knee, BodySide::Right, [24, 26, 28]),
    ];
    const HALPE26_DEFINITIONS: [(JointAngleKind, BodySide, [usize; 3]); 8] = [
        (JointAngleKind::Elbow, BodySide::Left, [5, 7, 9]),
        (JointAngleKind::Elbow, BodySide::Right, [6, 8, 10]),
        (JointAngleKind::Shoulder, BodySide::Left, [11, 5, 7]),
        (JointAngleKind::Shoulder, BodySide::Right, [12, 6, 8]),
        (JointAngleKind::Hip, BodySide::Left, [5, 11, 13]),
        (JointAngleKind::Hip, BodySide::Right, [6, 12, 14]),
        (JointAngleKind::Knee, BodySide::Left, [11, 13, 15]),
        (JointAngleKind::Knee, BodySide::Right, [12, 14, 16]),
    ];
    let definitions = match schema {
        PoseSchemaId::BlazePose33 => &BLAZEPOSE33_DEFINITIONS,
        PoseSchemaId::Halpe26 => &HALPE26_DEFINITIONS,
    };

    definitions
        .iter()
        .copied()
        .map(|(kind, side, [first, joint, third])| {
            let landmarks = [first, joint, third].map(|index| canonical.get(index));
            let confidence = landmarks
                .iter()
                .filter_map(|landmark| *landmark)
                .map(|landmark| landmark.canonical_confidence)
                .filter(|value| value.is_finite())
                .fold(1.0_f32, f32::min)
                .clamp(0.0, 1.0);
            let source = landmarks
                .iter()
                .filter_map(|landmark| *landmark)
                .map(|landmark| landmark.source)
                .max_by_key(|source| landmark_source_risk(*source))
                .unwrap_or(LandmarkSource::Unknown);
            let value_degrees = match (
                landmark_xy(first, canonical),
                landmark_xy(joint, canonical),
                landmark_xy(third, canonical),
            ) {
                (Some(first), Some(joint), Some(third)) => joint_angle_degrees(first, joint, third),
                _ => None,
            };
            let inputs_renderable = landmarks
                .iter()
                .all(|landmark| landmark.is_some_and(|value| value.renderable));
            let judgeable = target_state == TargetState::Locked
                && value_degrees.is_some_and(f32::is_finite)
                && confidence >= 0.5
                && inputs_renderable
                && matches!(source, LandmarkSource::Measured | LandmarkSource::Fused);
            JointAngleSnapshot {
                kind,
                side,
                value_degrees,
                confidence,
                source,
                judgeable,
            }
        })
        .collect()
}

fn landmark_source_risk(source: LandmarkSource) -> u8 {
    match source {
        LandmarkSource::Measured => 0,
        LandmarkSource::Fused => 1,
        LandmarkSource::Predicted => 2,
        LandmarkSource::Unknown => 3,
    }
}

fn torso_scale(schema: PoseSchemaId, canonical: &[CanonicalLandmark]) -> Option<f32> {
    let [shoulders, hips] = torso_landmark_pairs(schema);
    for [left, right] in [shoulders, hips] {
        let (Some((left_x, left_y)), Some((right_x, right_y))) =
            (landmark_xy(left, canonical), landmark_xy(right, canonical))
        else {
            continue;
        };
        let scale = (left_x - right_x).hypot(left_y - right_y);
        if scale > 1e-6 {
            return Some(scale);
        }
    }
    None
}

fn stable_torso_origin_y(schema: PoseSchemaId, canonical: &[CanonicalLandmark]) -> Option<f32> {
    let [
        [left_shoulder_index, right_shoulder_index],
        [left_hip_index, right_hip_index],
    ] = torso_landmark_pairs(schema);
    let left_hip = landmark_y(left_hip_index, canonical);
    let right_hip = landmark_y(right_hip_index, canonical);
    if let (Some(left), Some(right)) = (left_hip, right_hip) {
        return Some((left + right) * 0.5);
    }
    let left_shoulder = landmark_y(left_shoulder_index, canonical);
    let right_shoulder = landmark_y(right_shoulder_index, canonical);
    let hip = left_hip.or(right_hip);
    match (left_shoulder, right_shoulder, hip) {
        (Some(left), Some(right), Some(hip)) => Some(((left + right) * 0.5 + hip) * 0.5),
        _ => None,
    }
}

const fn torso_landmark_pairs(schema: PoseSchemaId) -> [[usize; 2]; 2] {
    match schema {
        PoseSchemaId::BlazePose33 => [[11, 12], [23, 24]],
        PoseSchemaId::Halpe26 => [[5, 6], [11, 12]],
    }
}

#[cfg(test)]
mod pose_schema_geometry_tests {
    use super::{CanonicalLandmark, PoseSchemaId, stable_torso_origin_y, torso_scale};

    #[test]
    fn halpe_torso_helpers_do_not_require_foot_landmarks() {
        let mut canonical = vec![CanonicalLandmark::unknown(0.0, None); 26];
        canonical[5] = CanonicalLandmark::measured(0.30, 0.30, 0.0, 0.9);
        canonical[6] = CanonicalLandmark::measured(0.70, 0.30, 0.0, 0.9);
        canonical[11] = CanonicalLandmark::measured(0.40, 0.70, 0.0, 0.9);
        canonical[12] = CanonicalLandmark::measured(0.60, 0.70, 0.0, 0.9);

        assert_eq!(
            stable_torso_origin_y(PoseSchemaId::Halpe26, &canonical),
            Some(0.70)
        );
        assert!((torso_scale(PoseSchemaId::Halpe26, &canonical).unwrap() - 0.40).abs() < 1e-6);
        assert_eq!(canonical[23].source, super::LandmarkSource::Unknown);
        assert_eq!(canonical[24].source, super::LandmarkSource::Unknown);
    }
}

fn landmark_y(index: usize, canonical: &[CanonicalLandmark]) -> Option<f32> {
    let landmark = canonical.get(index)?;
    if landmark.source == LandmarkSource::Unknown || landmark.canonical_confidence <= 0.0 {
        return None;
    }
    landmark.y.filter(|value| value.is_finite())
}

fn mean_landmark_y(indices: &[usize], canonical: &[CanonicalLandmark]) -> Option<f32> {
    let mut sum = 0.0;
    let mut observed = 0;
    for &index in indices {
        let Some(landmark) = canonical.get(index) else {
            continue;
        };
        if landmark.source == LandmarkSource::Unknown || landmark.canonical_confidence <= 0.0 {
            continue;
        }
        let Some(y) = landmark.y else { continue };
        sum += y;
        observed += 1;
    }
    (observed > 0).then_some(sum / observed as f32)
}

fn directional_delta(direction: MovementDirection, baseline: f32, value: f32) -> f32 {
    match direction {
        MovementDirection::Increasing => value - baseline,
        MovementDirection::Decreasing => baseline - value,
        MovementDirection::Auto => 0.0,
    }
}

fn activation_direction(
    configured: MovementDirection,
    baseline_primary: f32,
    primary: f32,
    baseline_secondary: f32,
    secondary: f32,
    start_amplitude: f32,
) -> Option<MovementDirection> {
    if configured != MovementDirection::Auto {
        return Some(configured);
    }
    let increasing_primary = primary - baseline_primary;
    let decreasing_primary = baseline_primary - primary;
    let increasing_secondary = secondary - baseline_secondary;
    let decreasing_secondary = baseline_secondary - secondary;
    let secondary_start = start_amplitude * 0.5;
    let increasing =
        increasing_primary >= start_amplitude && increasing_secondary >= secondary_start;
    let decreasing =
        decreasing_primary >= start_amplitude && decreasing_secondary >= secondary_start;
    match (increasing, decreasing) {
        (true, false) => Some(MovementDirection::Increasing),
        (false, true) => Some(MovementDirection::Decreasing),
        (true, true) if increasing_primary >= decreasing_primary => {
            Some(MovementDirection::Increasing)
        }
        (true, true) => Some(MovementDirection::Decreasing),
        (false, false) => None,
    }
}

/// All profiles close after a well-evidenced return. Auto-oriented profiles
/// retain the original ready anchor when sealing (see above), which prevents a
/// mid-return close from becoming a second, opposite-direction action.
fn seal_ready_threshold(profile: &ExerciseProfile, peak_amplitude: f32) -> f32 {
    if profile.uses_cycle_aligned_boundaries() {
        // A camera-space baseline drifts slightly across otherwise valid
        // repetitions (especially for a supine subject). Waiting for an exact
        // historical baseline merges adjacent cycles. Seal in the terminal
        // 30% of the observed excursion: late enough to represent the full
        // human-labelled return, but tolerant of small perspective drift.
        profile.ready_tolerance.max(peak_amplitude * 0.30)
    } else {
        profile.ready_tolerance.max(peak_amplitude * 0.40)
    }
}

fn cycle_aligned_start_sample(
    history: &VecDeque<RepSample>,
    fallback: RepSample,
    direction: MovementDirection,
    active_signal: ActiveSignal,
    _baseline_primary: f32,
    _baseline_secondary: f32,
    start_amplitude: f32,
) -> RepSample {
    let signal = |sample: RepSample| match active_signal {
        ActiveSignal::Bilateral | ActiveSignal::Primary => sample.primary,
        ActiveSignal::Secondary => sample.secondary,
    };
    let candidates = history
        .iter()
        .rev()
        .copied()
        .take_while(|sample| fallback.timestamp_ms.saturating_sub(sample.timestamp_ms) <= 1_500)
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return fallback;
    }

    // The baseline is deliberately adaptive while Ready, so using the latest
    // baseline to back-project onset can move the boundary into the movement.
    // Recover the most recent sample on the ready-side extremum instead. This
    // is still causal: activation has already happened and every candidate is
    // historical.
    let extreme = match direction {
        MovementDirection::Increasing | MovementDirection::Auto => candidates
            .iter()
            .map(|sample| signal(*sample))
            .fold(f32::INFINITY, f32::min),
        MovementDirection::Decreasing => candidates
            .iter()
            .map(|sample| signal(*sample))
            .fold(f32::NEG_INFINITY, f32::max),
    };
    let ready_band = (start_amplitude * 0.35).max(0.002);
    candidates
        .into_iter()
        .find(|sample| (signal(*sample) - extreme).abs() <= ready_band)
        .unwrap_or(fallback)
}

fn active_ready_distance(active: &ActiveRep, sample: RepSample) -> f32 {
    let signal = |value: RepSample| match active.active_signal {
        ActiveSignal::Bilateral | ActiveSignal::Primary => value.primary,
        ActiveSignal::Secondary => value.secondary,
    };
    (signal(sample) - signal(active.start)).abs()
}

fn update_ready_baseline(direction: MovementDirection, baseline: &mut Option<f32>, value: f32) {
    let _ = direction;
    *baseline = Some(match *baseline {
        Some(current) => current + (value - current) * 0.2,
        None => value,
    });
}

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

fn fnv_bytes(mut hash: u64, bytes: impl IntoIterator<Item = u8>) -> u64 {
    for byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

fn hash_sample(mut hash: u64, sample: RepSample) -> u64 {
    for byte in sample
        .frame_id
        .to_le_bytes()
        .into_iter()
        .chain(sample.timestamp_ms.to_le_bytes())
        .chain(sample.primary.to_bits().to_le_bytes())
        .chain(sample.secondary.to_bits().to_le_bytes())
        .chain(sample.torso.to_bits().to_le_bytes())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

pub struct MotionSession<I: InferenceAdapter, O: OutputAdapter> {
    config: SessionConfig,
    inference: I,
    output: O,
    closed: bool,
    last_timestamp_ms: Option<u64>,
    accepted_frames: u64,
    published_packets: u64,
    released_frames: u64,
    subject_epoch: u64,
    continuity: ContinuityEngine,
    subject_tracker: SubjectTracker,
    equipment_fusion: EquipmentFusionEngine,
    equipment_pose_constraint: equipment_pose_constraint::EquipmentPoseConstraintEngine,
    local_motion_coordinate: LocalMotionCoordinateEstimator,
    rep_engine: Option<RepEngine>,
    set_gate: SetGate,
    pending_outcomes: Vec<PendingRepOutcome>,
    assessment_outcomes: Vec<PendingRepOutcome>,
}

#[derive(Clone, Debug)]
struct PendingRepOutcome {
    subject_epoch: u64,
    rep: SealedRep,
}

impl<I: InferenceAdapter, O: OutputAdapter> MotionSession<I, O> {
    pub fn open(
        config: SessionConfig,
        capabilities: AdapterCapabilities,
        inference: I,
        output: O,
    ) -> Result<Self, OpenError> {
        if config.contract.major != SUPPORTED_CONTRACT_MAJOR {
            return Err(OpenError::UnsupportedContractMajor {
                requested: config.contract.major,
                supported: SUPPORTED_CONTRACT_MAJOR,
            });
        }
        if config.sequence_id.trim().is_empty() {
            return Err(OpenError::InvalidSequenceId);
        }
        if !capabilities.monotonic_timestamps {
            return Err(OpenError::MissingMonotonicTimestamps);
        }
        if config.subject_policy == SubjectPolicy::DominantVisible
            && (!capabilities.multi_pose || capabilities.max_candidates < 2)
        {
            return Err(OpenError::MissingMultiPoseCapability);
        }
        if capabilities.max_in_flight == 0 {
            return Err(OpenError::InvalidConcurrencyLimit);
        }
        if config.image_width_px == 0 || config.image_height_px == 0 {
            return Err(OpenError::InvalidSequenceId);
        }
        let continuity = ContinuityEngine::new(
            config.continuity,
            config.image_width_px,
            config.image_height_px,
        );
        let subject_tracker = SubjectTracker::new(config.subject_policy);
        let image_width_px = config.image_width_px;
        let image_height_px = config.image_height_px;
        Ok(Self {
            config,
            inference,
            output,
            closed: false,
            last_timestamp_ms: None,
            accepted_frames: 0,
            published_packets: 0,
            released_frames: 0,
            subject_epoch: 0,
            continuity,
            subject_tracker,
            equipment_fusion: EquipmentFusionEngine::new(),
            equipment_pose_constraint:
                equipment_pose_constraint::EquipmentPoseConstraintEngine::new(),
            local_motion_coordinate: LocalMotionCoordinateEstimator::new(
                image_width_px,
                image_height_px,
            ),
            rep_engine: None,
            set_gate: SetGate::replay_active(),
            pending_outcomes: Vec::new(),
            assessment_outcomes: Vec::new(),
        })
    }

    /// Begins one explicitly recorded training set. Live adapters call this at
    /// the same boundary as their recorder; offline replay retains its active
    /// default until it opts into the set lifecycle.
    pub fn begin_set(&mut self) {
        self.pending_outcomes.clear();
        self.assessment_outcomes.clear();
        self.set_gate.begin();
        self.local_motion_coordinate.begin_set();
        if let Some(rep_engine) = self.rep_engine.as_mut() {
            rep_engine.begin_set();
        }
    }

    /// Seals the lifecycle without synthesising a rep from an incomplete
    /// movement. A later `begin_set` creates a fresh arming window.
    pub fn finish_set(&mut self) -> Vec<SealedRep> {
        let outcomes = self
            .finish_set_outcomes()
            .into_iter()
            .map(|outcome| outcome.rep)
            .collect();
        self.assessment_outcomes.clear();
        outcomes
    }

    fn finish_set_outcomes(&mut self) -> Vec<PendingRepOutcome> {
        self.set_gate.finish();
        self.local_motion_coordinate.finish_set();
        let mut outcomes = std::mem::take(&mut self.pending_outcomes);
        outcomes.extend(
            self.rep_engine
                .as_mut()
                .map_or_else(Vec::new, RepEngine::finish_set)
                .into_iter()
                .map(|rep| PendingRepOutcome {
                    subject_epoch: self.subject_epoch,
                    rep,
                }),
        );
        outcomes
    }

    /// Finishes the canonical set and retains RepEngine provenance for the
    /// execution-assessment lifecycle. Use this instead of `finish_set` when
    /// driving `ExecutionAssessmentEngine`.
    pub fn finish_set_for_assessment(&mut self) -> MotionSetClosure {
        let terminal_outcomes = self.finish_set_outcomes();
        self.assessment_outcomes.extend(terminal_outcomes);
        let outcomes = std::mem::take(&mut self.assessment_outcomes);
        MotionSetClosure {
            lineage: self.packet_lineage(),
            source_timestamp_ms: self.last_timestamp_ms,
            subject_epoch: self.subject_epoch,
            completed_rep_subject_epochs: outcomes
                .iter()
                .map(|outcome| outcome.subject_epoch)
                .collect(),
            completed_reps: outcomes.into_iter().map(|outcome| outcome.rep).collect(),
        }
    }

    fn packet_lineage(&self) -> PacketLineage {
        let active_profile = self.rep_engine.as_ref().map(|engine| &engine.profile);
        PacketLineage {
            sequence_id: self.config.sequence_id.clone(),
            contract: self.config.contract,
            algorithm_version: "motion-session-replay/v1".into(),
            config_version: "motion-session-config/v1".into(),
            inference_version: "inference-adapter-contract/v1".into(),
            diagnostic_version: match self.config.diagnostics {
                DiagnosticLevel::Off => "diagnostics-off/v1",
                DiagnosticLevel::Summary => "diagnostics-summary/v1",
                DiagnosticLevel::Full => "diagnostics-full/v1",
            }
            .into(),
            active_profile_identity: active_profile.map(|profile| profile.identity.clone()),
            active_profile_hash: active_profile.map(|profile| profile.content_hash),
        }
    }

    pub fn pause_set(&mut self) {
        self.set_gate.pause();
        self.local_motion_coordinate.pause_set();
    }

    pub fn resume_set(&mut self) {
        self.set_gate.resume();
        self.local_motion_coordinate.resume_set();
    }

    pub fn set_state(&self) -> SetStateSnapshot {
        self.set_gate.state.clone()
    }

    pub fn install_exercise_profile(
        &mut self,
        profile: ExerciseProfile,
    ) -> Result<(), MotionError> {
        self.install_exercise_profile_internal(profile, None)
    }

    pub fn install_exercise_profile_with_local_strategy(
        &mut self,
        profile: ExerciseProfile,
        strategy: LocalMotionCoordinateStrategy,
    ) -> Result<(), MotionError> {
        self.install_exercise_profile_internal(profile, Some(strategy))
    }

    fn install_exercise_profile_internal(
        &mut self,
        profile: ExerciseProfile,
        strategy: Option<LocalMotionCoordinateStrategy>,
    ) -> Result<(), MotionError> {
        if self.accepted_frames != 0 {
            return Err(MotionError::ProfileInstallAfterFrames);
        }
        if self.rep_engine.is_some() {
            return Err(MotionError::ProfileAlreadyActive);
        }
        profile.validate()?;
        if let Some(strategy) = strategy {
            self.local_motion_coordinate.set_strategy(Some(strategy));
        } else {
            self.local_motion_coordinate
                .set_legacy_profile_identity(Some(&profile.identity));
        }
        self.rep_engine = Some(RepEngine::new(profile));
        Ok(())
    }

    /// Declares whether submitted canonical coordinates themselves have been
    /// horizontally mirrored. Preview mirroring is a renderer concern and
    /// must not call this method.
    pub fn set_canonical_feed_mirroring(&mut self, mirrored: Option<bool>) {
        self.local_motion_coordinate
            .set_canonical_feed_mirroring(mirrored);
    }

    pub fn revise_sealed_rep(
        &self,
        original: &SealedRep,
        revision: RepBoundaryRevision,
    ) -> Result<SealedRep, MotionError> {
        let Some(profile) = self.rep_engine.as_ref().map(|engine| &engine.profile) else {
            return Err(MotionError::RepProfileMismatch);
        };
        if original.profile_identity != profile.identity
            || original.profile_hash != profile.content_hash
        {
            return Err(MotionError::RepProfileMismatch);
        }
        if revision.start_frame_id > revision.peak_frame_id
            || revision.peak_frame_id > revision.end_frame_id
            || revision.start_timestamp_ms > revision.peak_timestamp_ms
            || revision.peak_timestamp_ms > revision.end_timestamp_ms
            || revision.canonical_slice_hash == 0
        {
            return Err(MotionError::InvalidRepRevision(
                "invalid boundary order or hash",
            ));
        }
        let next_revision = original
            .revision
            .checked_add(1)
            .ok_or(MotionError::InvalidRepRevision("revision overflow"))?;
        Ok(SealedRep {
            rep_id: original.rep_id,
            start_frame_id: revision.start_frame_id,
            start_timestamp_ms: revision.start_timestamp_ms,
            peak_frame_id: revision.peak_frame_id,
            peak_timestamp_ms: revision.peak_timestamp_ms,
            turnaround_confirmed_timestamp_ms: revision
                .end_timestamp_ms
                .max(revision.peak_timestamp_ms),
            end_frame_id: revision.end_frame_id,
            end_timestamp_ms: revision.end_timestamp_ms,
            revision: next_revision,
            canonical_slice_hash: revision.canonical_slice_hash,
            profile_identity: original.profile_identity.clone(),
            profile_hash: original.profile_hash,
            profile_maturity: original.profile_maturity,
            // A boundary edit invalidates any old derived verdict. The matcher
            // may compute new evidence for this revision without mutating the
            // historical algorithm result.
            quality_verdict: None,
            recovered_across_gap: original.recovered_across_gap,
            disposition: original.disposition,
            evidence_reason: original.evidence_reason,
            observation_findings: original.observation_findings.clone(),
            normalized_endpoints: original.normalized_endpoints.clone(),
        })
    }

    pub fn offer(&mut self, lease: FrameLease) -> Result<(), MotionError> {
        if self.closed {
            return Err(MotionError::SessionClosed);
        }
        if let Some(previous) = self.last_timestamp_ms {
            if lease.timestamp_ms() <= previous {
                return Err(MotionError::TimestampNotMonotonic {
                    previous,
                    received: lease.timestamp_ms(),
                });
            }
            if lease.timestamp_ms().saturating_sub(previous) > 1_000 {
                self.continuity.reset();
                self.equipment_pose_constraint.reset();
                self.local_motion_coordinate
                    .reset_for_discontinuity(LocalCoordinateReason::ObservationGap);
                if let Some(rep_engine) = self.rep_engine.as_mut() {
                    self.pending_outcomes.extend(
                        rep_engine
                            .reject_active(
                                RepEvidenceReason::LongContinuityLoss,
                                rep_engine.previous,
                            )
                            .into_iter()
                            .map(|rep| PendingRepOutcome {
                                subject_epoch: self.subject_epoch,
                                rep,
                            }),
                    );
                }
            }
        }

        let frame_id = lease.frame_id();
        let source_timestamp_ms = lease.timestamp_ms();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.inference.infer(&lease)
        }))
        .map_err(|_| MotionError::PanicIsolated("inference_adapter"))??;
        let FrameObservations {
            pose_candidates,
            equipment: raw_equipment,
        } = result;
        let pending_outcomes = std::mem::take(&mut self.pending_outcomes);
        let mut completed_rep_subject_epochs = pending_outcomes
            .iter()
            .map(|outcome| outcome.subject_epoch)
            .collect::<Vec<_>>();
        let mut completed_reps = pending_outcomes
            .into_iter()
            .map(|outcome| outcome.rep)
            .collect::<Vec<_>>();
        let (target, selected) = self
            .subject_tracker
            .update(pose_candidates, source_timestamp_ms);
        if self.subject_tracker.take_identity_boundary() {
            let previous_subject_epoch = self.subject_epoch;
            self.subject_epoch = self.subject_epoch.saturating_add(1);
            self.continuity.reset();
            self.equipment_pose_constraint.reset();
            self.local_motion_coordinate
                .reset_for_discontinuity(LocalCoordinateReason::SubjectChanged);
            if let Some(rep_engine) = self.rep_engine.as_mut()
                && let Some(rep) = rep_engine.reject_for_subject_change()
            {
                completed_reps.push(rep);
                completed_rep_subject_epochs.push(previous_subject_epoch);
            }
        }
        let mut canonical = if let Some(selected) = selected.as_ref() {
            self.continuity
                .process(&selected.observations, source_timestamp_ms)
        } else {
            let landmark_count = self
                .subject_tracker
                .last_candidates
                .iter()
                .map(|candidate| candidate.observations.len())
                .max()
                .unwrap_or(0);
            vec![CanonicalLandmark::unknown(0.0, None); landmark_count]
        };
        let equipment = self.equipment_fusion.process(EquipmentFrameInput {
            timestamp_ms: source_timestamp_ms,
            selected_subject: selected.as_ref(),
            canonical: &canonical,
            equipment: &raw_equipment,
        });
        // Preserve the independent pose observation for phase fusion.  The
        // equipment-conditioned repair is published to clients and quality
        // metrics, but must not corroborate the same equipment twice.
        let phase_pose_canonical = canonical.clone();
        let local_motion_coordinate = self.local_motion_coordinate.observe(
            source_timestamp_ms,
            target.selected_candidate_id,
            &phase_pose_canonical,
            &equipment,
        );
        if self
            .rep_engine
            .as_ref()
            .is_some_and(|engine| engine.profile.uses_barbell_axis_state_graph())
        {
            let schema = self
                .rep_engine
                .as_ref()
                .map_or(PoseSchemaId::BlazePose33, |engine| engine.profile.schema);
            self.equipment_pose_constraint.process_barbell(
                schema,
                source_timestamp_ms,
                &mut canonical,
                &equipment,
            );
        }
        let rep_phase = self
            .rep_engine
            .as_ref()
            .map_or(RepPhase::Ready, |engine| engine.state.phase);
        if self.set_gate.state.lifecycle == SetLifecycle::Arming {
            if let Some(rep_engine) = self.rep_engine.as_mut() {
                rep_engine.prime_ready_baseline(
                    frame_id,
                    source_timestamp_ms,
                    target.state,
                    &phase_pose_canonical,
                    Some(&local_motion_coordinate),
                );
            }
        }
        let may_process_rep = self.set_gate.advance(
            self.rep_engine.as_ref().map(|engine| &engine.profile),
            target.state,
            &canonical,
            Some(&equipment),
            Some(&local_motion_coordinate),
            source_timestamp_ms,
            rep_phase,
        );
        if may_process_rep {
            self.rep_engine.as_mut().map_or_else(Vec::new, |engine| {
                engine.process_with_equipment(
                    frame_id,
                    source_timestamp_ms,
                    target.state,
                    &phase_pose_canonical,
                    &equipment,
                    &raw_equipment,
                    Some(&local_motion_coordinate),
                )
            })
        } else {
            if let Some(rep_engine) = self.rep_engine.as_mut() {
                rep_engine.prime_barbell_ready(
                    frame_id,
                    source_timestamp_ms,
                    target.state,
                    &phase_pose_canonical,
                    &equipment,
                    Some(&local_motion_coordinate),
                );
            }
            Vec::new()
        }
        .into_iter()
        .for_each(|rep| {
            completed_reps.push(rep);
            completed_rep_subject_epochs.push(self.subject_epoch);
        });
        let rep_state = self
            .rep_engine
            .as_ref()
            .map_or_else(RepStateSnapshot::default, |engine| engine.state.clone());
        let pose_schema = self
            .rep_engine
            .as_ref()
            .map_or(PoseSchemaId::BlazePose33, |engine| engine.profile.schema);
        let joint_angles = measure_joint_angles_for_schema(&canonical, target.state, pose_schema);
        let packet = MotionPacket {
            lineage: self.packet_lineage(),
            frame_id,
            source_timestamp_ms,
            subject_epoch: self.subject_epoch,
            target,
            canonical,
            joint_angles,
            equipment,
            local_motion_coordinate,
            set_state: self.set_gate.state.clone(),
            rep_state,
            quality_proposals: if self.config.contract.minor >= 8 {
                build_quality_proposals(&completed_reps)
            } else {
                Vec::new()
            },
            completed_rep_subject_epochs,
            completed_reps,
        };
        let assessment_outcomes = packet
            .completed_rep_subject_epochs
            .iter()
            .copied()
            .zip(packet.completed_reps.iter().cloned())
            .map(|(subject_epoch, rep)| PendingRepOutcome { subject_epoch, rep })
            .collect::<Vec<_>>();
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.output.publish(packet)))
            .map_err(|_| MotionError::PanicIsolated("output_adapter"))??;
        self.assessment_outcomes.extend(assessment_outcomes);

        lease.release();
        self.last_timestamp_ms = Some(source_timestamp_ms);
        self.accepted_frames += 1;
        self.published_packets += 1;
        self.released_frames += 1;
        Ok(())
    }

    pub fn select_subject_at(
        &mut self,
        x: f32,
        y: f32,
    ) -> Result<SubjectSelectionAck, SubjectSelectionError> {
        let candidate_id = self.subject_tracker.select_at(x, y)?;
        let previous_subject_epoch = self.subject_epoch;
        self.subject_epoch = self.subject_epoch.saturating_add(1);
        self.continuity.reset();
        self.equipment_pose_constraint.reset();
        self.local_motion_coordinate
            .reset_for_discontinuity(LocalCoordinateReason::SubjectChanged);
        if let Some(rep_engine) = self.rep_engine.as_mut() {
            self.pending_outcomes
                .extend(
                    rep_engine
                        .reject_for_subject_change()
                        .into_iter()
                        .map(|rep| PendingRepOutcome {
                            subject_epoch: previous_subject_epoch,
                            rep,
                        }),
                );
        }
        Ok(SubjectSelectionAck {
            candidate_id,
            subject_epoch: self.subject_epoch,
        })
    }

    pub fn close(mut self) -> Result<SessionSummary, MotionError> {
        if self.closed {
            return Err(MotionError::SessionClosed);
        }
        self.closed = true;
        Ok(SessionSummary {
            accepted_frames: self.accepted_frames,
            published_packets: self.published_packets,
            released_frames: self.released_frames,
        })
    }
}

const BLAZEPOSE_MEASURED_MIN_SCORE: f32 = 0.5;
const BLAZEPOSE_WEAK_MIN_SCORE: f32 = 0.2;
// RTMPose SimCC peak responses are not MediaPipe visibility probabilities.
// Keep weak observations available to the temporal/bone fusion path, but do
// not promote them to reliable direct measurements. The raw response remains
// available as `observation_score` so clients can distinguish model evidence
// from canonical confidence.
const HALPE26_MEASURED_MIN_SCORE: f32 = 0.5;
const HALPE26_WEAK_MIN_SCORE: f32 = 0.12;
const MIN_BASELINE_SAMPLES: usize = 5;
const BASELINE_WINDOW: usize = 15;
const MAX_RAW_BONE_RESIDUAL: f32 = 0.45;
const MAX_PREDICTION_MS: u64 = 150;
const MAX_WEAK_COORDINATE_INNOVATION_RATIO: f32 = 0.08;
// One or two dropped 20 Hz inference frames are normal on mobile and must not
// downgrade an otherwise continuous rep. Longer recoveries remain visible for
// review; the profile-specific max gap still rejects an actual tracking loss.
const CONTINUITY_REVIEW_GAP_MS: u64 = 500;
const BLAZEPOSE33_SKELETON_BONES: [(usize, usize); 12] = [
    (11, 12),
    (11, 13),
    (13, 15),
    (12, 14),
    (14, 16),
    (11, 23),
    (12, 24),
    (23, 24),
    (23, 25),
    (25, 27),
    (24, 26),
    (26, 28),
];
const HALPE26_SKELETON_BONES: [(usize, usize); 18] = [
    (5, 6),
    (5, 7),
    (7, 9),
    (6, 8),
    (8, 10),
    (5, 11),
    (6, 12),
    (11, 12),
    (11, 13),
    (13, 15),
    (12, 14),
    (14, 16),
    (15, 20),
    (15, 22),
    (15, 24),
    (16, 21),
    (16, 23),
    (16, 25),
];
const BLAZEPOSE33_ARM_CHAINS: [(usize, usize, usize); 2] = [(11, 13, 15), (12, 14, 16)];
const HALPE26_ARM_CHAINS: [(usize, usize, usize); 2] = [(5, 7, 9), (6, 8, 10)];

#[derive(Clone, Copy)]
struct Point {
    x: f32,
    y: f32,
}

#[derive(Clone, Copy)]
struct MotionState {
    point: Point,
    z: f32,
    vx_per_ms: f32,
    vy_per_ms: f32,
    accepted_timestamp_ms: u64,
}

struct ContinuityEngine {
    mode: ContinuityMode,
    schema: PoseSchemaId,
    width: f32,
    height: f32,
    motion: HashMap<usize, MotionState>,
    previous_elbows: HashMap<usize, Point>,
    bone_lengths: HashMap<(usize, usize), VecDeque<f32>>,
}

impl ContinuityEngine {
    fn new(mode: ContinuityMode, width: u32, height: u32) -> Self {
        Self::new_with_schema(mode, width, height, PoseSchemaId::BlazePose33)
    }

    fn new_with_schema(
        mode: ContinuityMode,
        width: u32,
        height: u32,
        schema: PoseSchemaId,
    ) -> Self {
        Self {
            mode,
            schema,
            width: width as f32,
            height: height as f32,
            motion: HashMap::new(),
            previous_elbows: HashMap::new(),
            bone_lengths: HashMap::new(),
        }
    }

    fn arm_chains(&self) -> &'static [(usize, usize, usize)] {
        match self.schema {
            PoseSchemaId::BlazePose33 => &BLAZEPOSE33_ARM_CHAINS,
            PoseSchemaId::Halpe26 => &HALPE26_ARM_CHAINS,
        }
    }

    fn skeleton_bones(&self) -> &'static [(usize, usize)] {
        match self.schema {
            PoseSchemaId::BlazePose33 => &BLAZEPOSE33_SKELETON_BONES,
            PoseSchemaId::Halpe26 => &HALPE26_SKELETON_BONES,
        }
    }

    /// RTMPose Halpe-26 often keeps a geometrically stable supine arm below
    /// the calibrated 0.5 score when a bar occludes the wrists. Bootstrap only
    /// arm-chain lengths from those weak coordinates. The raw point is not
    /// promoted: `fuse_weak_child` still validates it against a multi-frame
    /// topology baseline before it becomes usable canonical evidence.
    fn allows_weak_bone_baseline(&self, from: usize, to: usize) -> bool {
        self.schema == PoseSchemaId::Halpe26
            && self.arm_chains().iter().any(|&(shoulder, elbow, wrist)| {
                bone_key(from, to) == bone_key(shoulder, elbow)
                    || bone_key(from, to) == bone_key(elbow, wrist)
            })
    }

    fn measured_min_score(&self) -> f32 {
        match self.schema {
            PoseSchemaId::BlazePose33 => BLAZEPOSE_MEASURED_MIN_SCORE,
            PoseSchemaId::Halpe26 => HALPE26_MEASURED_MIN_SCORE,
        }
    }

    fn weak_min_score(&self) -> f32 {
        match self.schema {
            PoseSchemaId::BlazePose33 => BLAZEPOSE_WEAK_MIN_SCORE,
            PoseSchemaId::Halpe26 => HALPE26_WEAK_MIN_SCORE,
        }
    }

    fn normalized_confidence(&self, observation_score: f32) -> f32 {
        if !observation_score.is_finite() || observation_score <= 0.0 {
            return 0.0;
        }
        match self.schema {
            PoseSchemaId::BlazePose33 => observation_score.clamp(0.0, 1.0),
            PoseSchemaId::Halpe26 => {
                let progress = (observation_score - HALPE26_MEASURED_MIN_SCORE)
                    / (1.0 - HALPE26_MEASURED_MIN_SCORE);
                (0.5 + progress * 0.5).clamp(0.0, 1.0)
            }
        }
    }

    fn raw_canonical(&self, observation: PoseObservation) -> CanonicalLandmark {
        if !observation.is_finite() || observation.visibility <= 0.0 {
            return CanonicalLandmark::unknown(0.0, None);
        }
        CanonicalLandmark {
            x: Some(observation.x),
            y: Some(observation.y),
            z: Some(observation.z),
            observation_score: observation.visibility,
            canonical_confidence: self.normalized_confidence(observation.visibility),
            uncertainty: None,
            source: LandmarkSource::Measured,
            renderable: observation.visibility >= self.measured_min_score(),
            reason: None,
        }
    }

    fn process(
        &mut self,
        observations: &[PoseObservation],
        timestamp_ms: u64,
    ) -> Vec<CanonicalLandmark> {
        if self.mode == ContinuityMode::Raw {
            return observations
                .iter()
                .copied()
                .map(|observation| self.raw_canonical(observation))
                .collect();
        }

        let measured_min_score = self.measured_min_score();
        let weak_min_score = self.weak_min_score();
        let rejected = self.find_outliers(observations, timestamp_ms);
        self.update_bone_baselines(observations, &rejected);
        let mut fused = HashMap::<usize, CanonicalLandmark>::new();
        for &(shoulder_index, elbow_index, wrist_index) in self.arm_chains() {
            let (Some(shoulder), Some(elbow), Some(wrist)) = (
                observations.get(shoulder_index).copied(),
                observations.get(elbow_index).copied(),
                observations.get(wrist_index).copied(),
            ) else {
                continue;
            };
            if !shoulder.is_finite() || !elbow.is_finite() || !wrist.is_finite() {
                continue;
            }
            let anchors_reliable = !rejected.contains(&shoulder_index)
                && !rejected.contains(&wrist_index)
                && shoulder.visibility >= measured_min_score
                && wrist.visibility >= measured_min_score;
            if anchors_reliable
                && !rejected.contains(&elbow_index)
                && elbow.visibility >= measured_min_score
            {
                self.previous_elbows
                    .insert(elbow_index, self.to_pixels(elbow));
                continue;
            }
            if !anchors_reliable
                || rejected.contains(&elbow_index)
                || elbow.visibility < weak_min_score
            {
                continue;
            }
            let upper = self
                .bone_lengths
                .get(&bone_key(shoulder_index, elbow_index));
            let lower = self.bone_lengths.get(&bone_key(elbow_index, wrist_index));
            let (Some(upper), Some(lower)) = (upper, lower) else {
                continue;
            };
            if upper.len() < MIN_BASELINE_SAMPLES || lower.len() < MIN_BASELINE_SAMPLES {
                continue;
            }
            let upper_length = median(upper);
            let lower_length = median(lower);
            let shoulder_px = self.to_pixels(shoulder);
            let elbow_px = self.to_pixels(elbow);
            let wrist_px = self.to_pixels(wrist);
            let upper_residual =
                (distance(shoulder_px, elbow_px) - upper_length).abs() / upper_length;
            let lower_residual = (distance(elbow_px, wrist_px) - lower_length).abs() / lower_length;
            if upper_residual.max(lower_residual) > MAX_RAW_BONE_RESIDUAL {
                continue;
            }
            let previous = self.previous_elbows.get(&elbow_index).copied();
            let Some(constrained) = choose_constrained_elbow(
                shoulder_px,
                wrist_px,
                upper_length,
                lower_length,
                elbow_px,
                previous,
            ) else {
                continue;
            };
            let changed_branch = previous.is_some_and(|point| {
                signed_side(shoulder_px, wrist_px, elbow_px)
                    * signed_side(shoulder_px, wrist_px, point)
                    < 0.0
            });
            let raw_weight = if changed_branch {
                0.2
            } else {
                (0.65 + elbow.visibility * 0.3).clamp(0.7, 0.85)
            };
            let result = Point {
                x: elbow_px.x * raw_weight + constrained.x * (1.0 - raw_weight),
                y: elbow_px.y * raw_weight + constrained.y * (1.0 - raw_weight),
            };
            let uncertainty = distance(elbow_px, constrained) / self.width.hypot(self.height)
                + (measured_min_score - elbow.visibility) * 0.025;
            let confidence =
                shoulder.visibility.min(wrist.visibility) * (0.7 + elbow.visibility * 0.3);
            self.previous_elbows.insert(elbow_index, result);
            fused.insert(
                elbow_index,
                CanonicalLandmark {
                    x: Some(result.x / self.width),
                    y: Some(result.y / self.height),
                    z: Some(elbow.z),
                    observation_score: elbow.visibility,
                    canonical_confidence: self.normalized_confidence(confidence).clamp(0.5, 1.0),
                    uncertainty: Some(uncertainty),
                    source: LandmarkSource::Fused,
                    renderable: true,
                    reason: Some(ContinuityReason::WeakObservationBoneFusion),
                },
            );
        }

        // MediaPipe can keep geometrically coherent arm coordinates while
        // assigning near-zero visibility to supine/occluded elbows and
        // wrists. Pure velocity prediction correctly times out after 150 ms;
        // it cannot follow a multi-second cyclic rep. Continue only when each
        // weak coordinate agrees with both the learned bone length and the
        // short-horizon motion prior, walking outward from a reliable
        // shoulder. This is measurement fusion, not unbounded extrapolation.
        for &(shoulder_index, elbow_index, wrist_index) in self.arm_chains() {
            if !fused.contains_key(&elbow_index)
                && observations
                    .get(elbow_index)
                    .is_some_and(|observation| observation.visibility < measured_min_score)
            {
                if let Some(landmark) = self.fuse_weak_child(
                    shoulder_index,
                    elbow_index,
                    observations,
                    &rejected,
                    &fused,
                    timestamp_ms,
                ) {
                    fused.insert(elbow_index, landmark);
                }
            }
            if !fused.contains_key(&wrist_index)
                && observations
                    .get(wrist_index)
                    .is_some_and(|observation| observation.visibility < measured_min_score)
            {
                if let Some(landmark) = self.fuse_weak_child(
                    elbow_index,
                    wrist_index,
                    observations,
                    &rejected,
                    &fused,
                    timestamp_ms,
                ) {
                    fused.insert(wrist_index, landmark);
                }
            }
        }

        observations
            .iter()
            .copied()
            .enumerate()
            .map(|(index, observation)| {
                if let Some(fused_landmark) = fused.remove(&index) {
                    self.accept_motion(index, &fused_landmark, timestamp_ms);
                    return fused_landmark;
                }
                if !rejected.contains(&index)
                    && observation.is_finite()
                    && observation.visibility >= measured_min_score
                {
                    let landmark = self.raw_canonical(observation);
                    self.accept_motion(index, &landmark, timestamp_ms);
                    return landmark;
                }
                let state = self.motion.get(&index).copied();
                let elapsed =
                    state.map(|value| timestamp_ms.saturating_sub(value.accepted_timestamp_ms));
                if let (Some(state), Some(elapsed @ 1..=MAX_PREDICTION_MS)) = (state, elapsed) {
                    let point = Point {
                        x: state.point.x + state.vx_per_ms * elapsed as f32,
                        y: state.point.y + state.vy_per_ms * elapsed as f32,
                    };
                    return CanonicalLandmark {
                        x: Some(point.x / self.width),
                        y: Some(point.y / self.height),
                        z: Some(state.z),
                        observation_score: observation.visibility,
                        canonical_confidence: (0.5 * (1.0 - elapsed as f32 / 151.0))
                            .clamp(0.05, 0.49),
                        uncertainty: Some(0.01 + elapsed as f32 / MAX_PREDICTION_MS as f32 * 0.04),
                        source: LandmarkSource::Predicted,
                        renderable: true,
                        reason: Some(if rejected.contains(&index) {
                            ContinuityReason::OutlierRejectedPrediction
                        } else {
                            ContinuityReason::ShortGapPrediction
                        }),
                    };
                }
                self.motion.remove(&index);
                CanonicalLandmark {
                    x: None,
                    y: None,
                    z: None,
                    observation_score: if observation.visibility.is_finite() {
                        observation.visibility
                    } else {
                        0.0
                    },
                    canonical_confidence: 0.0,
                    uncertainty: Some(
                        0.05 + elapsed
                            .map_or(0.05, |value| value.min(1_000) as f32 / 1_000.0 * 0.05),
                    ),
                    source: LandmarkSource::Unknown,
                    renderable: false,
                    reason: Some(if rejected.contains(&index) {
                        ContinuityReason::OutlierRejectedUnknown
                    } else if state.is_some() {
                        ContinuityReason::PredictionTimeout
                    } else {
                        ContinuityReason::NoMeasurementBaseline
                    }),
                }
            })
            .collect()
    }

    fn reset(&mut self) {
        self.motion.clear();
        self.previous_elbows.clear();
        self.bone_lengths.clear();
    }

    fn to_pixels(&self, observation: PoseObservation) -> Point {
        Point {
            x: observation.x * self.width,
            y: observation.y * self.height,
        }
    }

    fn fuse_weak_child(
        &self,
        parent_index: usize,
        child_index: usize,
        observations: &[PoseObservation],
        rejected: &HashSet<usize>,
        fused: &HashMap<usize, CanonicalLandmark>,
        timestamp_ms: u64,
    ) -> Option<CanonicalLandmark> {
        if rejected.contains(&child_index) {
            return None;
        }
        let child = observations.get(child_index).copied()?;
        if !child.is_finite() || child.visibility <= 0.0 {
            return None;
        }
        let (parent_point, parent_confidence) = if let Some(parent) = fused.get(&parent_index) {
            let (Some(x), Some(y)) = (parent.x, parent.y) else {
                return None;
            };
            (
                Point {
                    x: x * self.width,
                    y: y * self.height,
                },
                parent.canonical_confidence,
            )
        } else {
            let parent = observations.get(parent_index).copied()?;
            if rejected.contains(&parent_index)
                || !parent.is_finite()
                || parent.visibility < self.measured_min_score()
            {
                return None;
            }
            (
                self.to_pixels(parent),
                self.normalized_confidence(parent.visibility),
            )
        };
        let baseline_samples = self
            .bone_lengths
            .get(&bone_key(parent_index, child_index))?;
        if baseline_samples.len() < MIN_BASELINE_SAMPLES {
            return None;
        }
        let baseline = median(baseline_samples);
        let raw_point = self.to_pixels(child);
        let bone_residual = (distance(parent_point, raw_point) - baseline).abs() / baseline;
        if !bone_residual.is_finite() || bone_residual > MAX_RAW_BONE_RESIDUAL {
            return None;
        }
        let predicted = match self.motion.get(&child_index).copied() {
            Some(state) => {
                let elapsed = timestamp_ms.checked_sub(state.accepted_timestamp_ms)?;
                if !(1..=MAX_PREDICTION_MS).contains(&elapsed) {
                    return None;
                }
                Point {
                    x: state.point.x + state.vx_per_ms * elapsed as f32,
                    y: state.point.y + state.vy_per_ms * elapsed as f32,
                }
            }
            // A stable topology baseline can initialize a weak arm point.
            // Later frames use the normal short-horizon motion prior.
            None => raw_point,
        };
        let diagonal = self.width.hypot(self.height);
        let innovation = distance(raw_point, predicted);
        if !innovation.is_finite() || innovation > diagonal * MAX_WEAK_COORDINATE_INNOVATION_RATIO {
            return None;
        }
        // Treat visibility as the measurement gain. Near-zero observations
        // may still steer a validated chain, but must not dominate the motion
        // prior and turn coordinate jitter into artificial rep cycles.
        let raw_weight = (0.08 + child.visibility * 0.84).clamp(0.08, 0.50);
        let blended = Point {
            x: raw_point.x * raw_weight + predicted.x * (1.0 - raw_weight),
            y: raw_point.y * raw_weight + predicted.y * (1.0 - raw_weight),
        };
        let direction = Point {
            x: blended.x - parent_point.x,
            y: blended.y - parent_point.y,
        };
        let direction_length = direction.x.hypot(direction.y);
        if !direction_length.is_finite() || direction_length <= 1e-6 {
            return None;
        }
        let result = Point {
            x: parent_point.x + direction.x / direction_length * baseline,
            y: parent_point.y + direction.y / direction_length * baseline,
        };
        let uncertainty = innovation / diagonal
            + bone_residual * 0.03
            + (self.measured_min_score() - child.visibility).max(0.0) * 0.025;
        Some(CanonicalLandmark {
            x: Some(result.x / self.width),
            y: Some(result.y / self.height),
            z: Some(child.z),
            observation_score: child.visibility,
            canonical_confidence: (parent_confidence * 0.70).clamp(0.5, 0.75),
            uncertainty: Some(uncertainty),
            source: LandmarkSource::Fused,
            renderable: true,
            reason: Some(ContinuityReason::WeakObservationBoneFusion),
        })
    }

    fn accept_motion(&mut self, index: usize, landmark: &CanonicalLandmark, timestamp_ms: u64) {
        let (Some(x), Some(y), Some(z)) = (landmark.x, landmark.y, landmark.z) else {
            return;
        };
        let point = Point {
            x: x * self.width,
            y: y * self.height,
        };
        let previous = self.motion.get(&index).copied();
        let elapsed = previous.map_or(0, |value| {
            timestamp_ms.saturating_sub(value.accepted_timestamp_ms)
        });
        self.motion.insert(
            index,
            MotionState {
                point,
                z,
                vx_per_ms: if elapsed > 0 {
                    (point.x - previous.expect("elapsed requires previous").point.x)
                        / elapsed as f32
                } else {
                    0.0
                },
                vy_per_ms: if elapsed > 0 {
                    (point.y - previous.expect("elapsed requires previous").point.y)
                        / elapsed as f32
                } else {
                    0.0
                },
                accepted_timestamp_ms: timestamp_ms,
            },
        );
    }

    fn find_outliers(&self, observations: &[PoseObservation], timestamp_ms: u64) -> HashSet<usize> {
        struct Candidate {
            index: usize,
            point: Point,
            dx: f32,
            dy: f32,
            predicted: Point,
        }

        let candidates = observations
            .iter()
            .copied()
            .enumerate()
            .filter_map(|(index, observation)| {
                let state = self.motion.get(&index).copied()?;
                if !observation.is_finite() || observation.visibility < self.measured_min_score() {
                    return None;
                }
                let elapsed = timestamp_ms.checked_sub(state.accepted_timestamp_ms)?;
                if !(1..=MAX_PREDICTION_MS * 2).contains(&elapsed) {
                    return None;
                }
                let point = self.to_pixels(observation);
                Some(Candidate {
                    index,
                    point,
                    dx: point.x - state.point.x,
                    dy: point.y - state.point.y,
                    predicted: Point {
                        x: state.point.x + state.vx_per_ms * elapsed as f32,
                        y: state.point.y + state.vy_per_ms * elapsed as f32,
                    },
                })
            })
            .collect::<Vec<_>>();
        if candidates.len() < 3 {
            return HashSet::new();
        }

        let coherent_dx = median_values(candidates.iter().map(|candidate| candidate.dx));
        let coherent_dy = median_values(candidates.iter().map(|candidate| candidate.dy));
        let diagonal = self.width.hypot(self.height);
        candidates
            .iter()
            .filter_map(|candidate| {
                let innovation = distance(candidate.point, candidate.predicted);
                let incoherent = (candidate.dx - coherent_dx).hypot(candidate.dy - coherent_dy);
                let bone_residual =
                    self.topology_bone_residual(candidate.index, candidate.point, observations);
                let candidate_motion = candidate.dx.hypot(candidate.dy);
                let has_coherent_neighbor = self.skeleton_bones().iter().any(|&(from, to)| {
                    let neighbor_index = if from == candidate.index {
                        Some(to)
                    } else if to == candidate.index {
                        Some(from)
                    } else {
                        None
                    };
                    let Some(neighbor_index) = neighbor_index else {
                        return false;
                    };
                    candidates.iter().any(|neighbor| {
                        if neighbor.index != neighbor_index {
                            return false;
                        }
                        let neighbor_motion = neighbor.dx.hypot(neighbor.dy);
                        candidate_motion > 1e-6
                            && neighbor_motion >= candidate_motion * 0.30
                            && (candidate.dx * neighbor.dx + candidate.dy * neighbor.dy)
                                / (candidate_motion * neighbor_motion).max(1e-6)
                                >= 0.70
                    })
                });
                (innovation > diagonal * 0.08
                    && incoherent > diagonal * 0.06
                    && !has_coherent_neighbor
                    && (bone_residual > 0.35 || innovation > diagonal * 0.25))
                    .then_some(candidate.index)
            })
            .collect()
    }

    fn topology_bone_residual(
        &self,
        index: usize,
        point: Point,
        observations: &[PoseObservation],
    ) -> f32 {
        self.skeleton_bones()
            .iter()
            .filter_map(|&(from, to)| {
                if from != index && to != index {
                    return None;
                }
                let samples = self.bone_lengths.get(&bone_key(from, to))?;
                if samples.len() < MIN_BASELINE_SAMPLES {
                    return None;
                }
                let other_index = if from == index { to } else { from };
                let other = observations.get(other_index).copied()?;
                if !other.is_finite() {
                    return None;
                }
                let baseline = median(samples);
                Some((distance(point, self.to_pixels(other)) - baseline).abs() / baseline)
            })
            .fold(0.0, f32::max)
    }

    fn update_bone_baselines(
        &mut self,
        observations: &[PoseObservation],
        rejected: &HashSet<usize>,
    ) {
        for &(from, to) in self.skeleton_bones() {
            let (Some(left), Some(right)) = (
                observations.get(from).copied(),
                observations.get(to).copied(),
            ) else {
                continue;
            };
            let minimum_score = if self.allows_weak_bone_baseline(from, to) {
                self.weak_min_score()
            } else {
                self.measured_min_score()
            };
            if rejected.contains(&from)
                || rejected.contains(&to)
                || !left.is_finite()
                || !right.is_finite()
                || left.visibility < minimum_score
                || right.visibility < minimum_score
            {
                continue;
            }
            let length = distance(self.to_pixels(left), self.to_pixels(right));
            let samples = self.bone_lengths.entry(bone_key(from, to)).or_default();
            if samples.len() >= MIN_BASELINE_SAMPLES {
                let baseline = median(samples);
                if (length - baseline).abs() / baseline > MAX_RAW_BONE_RESIDUAL {
                    continue;
                }
            }
            if length.is_finite() && length > 1e-6 {
                samples.push_back(length);
                if samples.len() > BASELINE_WINDOW {
                    samples.pop_front();
                }
            }
        }
    }
}

#[cfg(test)]
mod pose_score_calibration_tests {
    use super::{ContinuityEngine, ContinuityMode, LandmarkSource, PoseObservation, PoseSchemaId};

    #[test]
    fn halpe_simcc_weak_scores_are_preserved_without_becoming_reliable_measurements() {
        let weak_observations = vec![PoseObservation::new(0.5, 0.5, 0.0, 0.15); 26];
        let mut halpe = ContinuityEngine::new_with_schema(
            ContinuityMode::Raw,
            720,
            1280,
            PoseSchemaId::Halpe26,
        );
        let weak_halpe_output = halpe.process(&weak_observations, 0);
        assert!(!weak_halpe_output[5].renderable);
        assert!(weak_halpe_output[5].canonical_confidence < 0.5);
        assert_eq!(weak_halpe_output[5].observation_score, 0.15);

        let reliable_observations = vec![PoseObservation::new(0.5, 0.5, 0.0, 0.6); 26];
        let reliable_halpe_output = halpe.process(&reliable_observations, 100);
        assert!(reliable_halpe_output[5].renderable);
        assert!(reliable_halpe_output[5].canonical_confidence >= 0.5);

        let mut blaze = ContinuityEngine::new(ContinuityMode::Raw, 720, 1280);
        let blaze_output = blaze.process(&weak_observations, 0);
        assert!(!blaze_output[5].renderable);
        assert_eq!(blaze_output[5].canonical_confidence, 0.15);
    }

    #[test]
    fn halpe_supine_arm_bootstraps_weak_elbow_and_wrist_from_stable_topology() {
        let mut engine = ContinuityEngine::new_with_schema(
            ContinuityMode::Fusion,
            720,
            1280,
            PoseSchemaId::Halpe26,
        );
        let mut output = Vec::new();
        for frame in 0..6 {
            let mut observations = vec![PoseObservation::new(0.5, 0.5, 0.0, 0.9); 26];
            observations[5] = PoseObservation::new(0.35, 0.35, 0.0, 0.9);
            observations[7] = PoseObservation::new(0.30, 0.50 + frame as f32 * 0.002, 0.0, 0.45);
            observations[9] = PoseObservation::new(0.28, 0.66 + frame as f32 * 0.004, 0.0, 0.30);
            output = engine.process(&observations, frame * 50);
        }

        assert_eq!(output[7].source, LandmarkSource::Fused);
        assert_eq!(output[9].source, LandmarkSource::Fused);
        assert!(output[7].renderable);
        assert!(output[9].renderable);
        assert_eq!(output[7].observation_score, 0.45);
        assert_eq!(output[9].observation_score, 0.30);
    }
}

fn bone_key(from: usize, to: usize) -> (usize, usize) {
    if from < to { (from, to) } else { (to, from) }
}

fn median(values: &VecDeque<f32>) -> f32 {
    let mut sorted = values.iter().copied().collect::<Vec<_>>();
    sorted.sort_by(f32::total_cmp);
    sorted[sorted.len() / 2]
}

fn median_values(values: impl Iterator<Item = f32>) -> f32 {
    let mut sorted = values.collect::<Vec<_>>();
    sorted.sort_by(f32::total_cmp);
    sorted[sorted.len() / 2]
}

fn distance(left: Point, right: Point) -> f32 {
    (left.x - right.x).hypot(left.y - right.y)
}

fn signed_side(from: Point, to: Point, point: Point) -> f32 {
    (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x)
}

fn choose_constrained_elbow(
    shoulder: Point,
    wrist: Point,
    upper_length: f32,
    lower_length: f32,
    raw: Point,
    previous: Option<Point>,
) -> Option<Point> {
    let dx = wrist.x - shoulder.x;
    let dy = wrist.y - shoulder.y;
    let anchor_distance = dx.hypot(dy);
    if anchor_distance < 1e-6
        || anchor_distance > upper_length + lower_length
        || anchor_distance < (upper_length - lower_length).abs()
    {
        return None;
    }
    let along = (upper_length.powi(2) - lower_length.powi(2) + anchor_distance.powi(2))
        / (2.0 * anchor_distance);
    let perpendicular = (upper_length.powi(2) - along.powi(2)).max(0.0).sqrt();
    let unit_x = dx / anchor_distance;
    let unit_y = dy / anchor_distance;
    let base = Point {
        x: shoulder.x + along * unit_x,
        y: shoulder.y + along * unit_y,
    };
    let candidates = [
        Point {
            x: base.x - perpendicular * unit_y,
            y: base.y + perpendicular * unit_x,
        },
        Point {
            x: base.x + perpendicular * unit_y,
            y: base.y - perpendicular * unit_x,
        },
    ];
    Some(
        if branch_cost(candidates[1], raw, previous) < branch_cost(candidates[0], raw, previous) {
            candidates[1]
        } else {
            candidates[0]
        },
    )
}

fn branch_cost(candidate: Point, raw: Point, previous: Option<Point>) -> f32 {
    previous.map_or_else(
        || distance(candidate, raw),
        |previous| distance(candidate, raw) * 0.35 + distance(candidate, previous) * 0.65,
    )
}

#[derive(Clone, Debug, PartialEq)]
pub struct CanonicalFrameSample {
    pub frame_id: u64,
    pub timestamp_ms: u64,
    pub canonical: Vec<CanonicalLandmark>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BodyNormalizationConfig {
    pub origin_landmarks: [usize; 2],
    pub scale_landmarks: [usize; 2],
    pub feature_landmarks: Vec<usize>,
    pub source_is_mirrored: bool,
    pub coordinate_system: &'static str,
    pub algorithm_version: &'static str,
}

impl BodyNormalizationConfig {
    pub fn rear_bilateral(source_is_mirrored: bool) -> Self {
        Self {
            origin_landmarks: [23, 24],
            scale_landmarks: [11, 12],
            feature_landmarks: vec![13, 14, 15, 16],
            source_is_mirrored,
            coordinate_system: "hip-center/shoulder-width/image-xy/v1",
            algorithm_version: "body-normalization/v1",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PhaseName {
    Effort,
    Return,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RegisteredTrajectoryNode {
    pub phase: PhaseName,
    pub phase_progress: f32,
    pub source_timestamp_ms: u64,
    /// Interleaved x/y values in `feature_landmarks` order. Coordinates are
    /// deliberately not clipped to preserve amplitude errors.
    pub values: Vec<Option<f32>>,
    pub confidence: Vec<f32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct NormalizedRepTrajectory {
    pub rep_id: u64,
    pub rep_revision: u32,
    pub canonical_slice_hash: u64,
    pub profile_identity: String,
    pub profile_hash: u64,
    pub coordinate_system: &'static str,
    pub algorithm_version: &'static str,
    pub source_is_mirrored: bool,
    pub effort_duration_ms: u64,
    pub return_duration_ms: u64,
    pub total_duration_ms: u64,
    pub nodes: Vec<RegisteredTrajectoryNode>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TrajectoryRefusal {
    InvalidBoundary,
    MissingBoundaryFrame,
    MissingBodyOrigin { frame_id: u64 },
    MissingBodyScale { frame_id: u64 },
    InvalidBodyScale { frame_id: u64 },
    MissingFeature { frame_id: u64, landmark: usize },
    TooFewPhaseNodes,
}

#[derive(Clone)]
struct BodyFrame {
    timestamp_ms: u64,
    values: Vec<Option<f32>>,
    confidence: Vec<f32>,
}

pub fn normalize_rep_trajectory(
    rep: &SealedRep,
    frames: &[CanonicalFrameSample],
    config: &BodyNormalizationConfig,
    nodes_per_phase: usize,
) -> Result<NormalizedRepTrajectory, TrajectoryRefusal> {
    if rep.start_timestamp_ms > rep.peak_timestamp_ms
        || rep.peak_timestamp_ms > rep.end_timestamp_ms
    {
        return Err(TrajectoryRefusal::InvalidBoundary);
    }
    if nodes_per_phase < 2 {
        return Err(TrajectoryRefusal::TooFewPhaseNodes);
    }
    let selected = frames
        .iter()
        .filter(|frame| {
            frame.timestamp_ms >= rep.start_timestamp_ms
                && frame.timestamp_ms <= rep.end_timestamp_ms
        })
        .map(|frame| normalize_body_frame(frame, config))
        .collect::<Result<Vec<_>, _>>()?;
    if selected.is_empty()
        || selected
            .first()
            .is_none_or(|frame| frame.timestamp_ms > rep.start_timestamp_ms)
        || selected
            .last()
            .is_none_or(|frame| frame.timestamp_ms < rep.end_timestamp_ms)
    {
        return Err(TrajectoryRefusal::MissingBoundaryFrame);
    }
    let mut nodes = resample_phase(
        &selected,
        rep.start_timestamp_ms,
        rep.peak_timestamp_ms,
        nodes_per_phase,
        PhaseName::Effort,
    );
    let mut return_nodes = resample_phase(
        &selected,
        rep.peak_timestamp_ms,
        rep.end_timestamp_ms,
        nodes_per_phase,
        PhaseName::Return,
    );
    if !return_nodes.is_empty() {
        return_nodes.remove(0);
    }
    nodes.extend(return_nodes);
    Ok(NormalizedRepTrajectory {
        rep_id: rep.rep_id,
        rep_revision: rep.revision,
        canonical_slice_hash: rep.canonical_slice_hash,
        profile_identity: rep.profile_identity.clone(),
        profile_hash: rep.profile_hash,
        coordinate_system: config.coordinate_system,
        algorithm_version: config.algorithm_version,
        source_is_mirrored: config.source_is_mirrored,
        effort_duration_ms: rep.peak_timestamp_ms - rep.start_timestamp_ms,
        return_duration_ms: rep.end_timestamp_ms - rep.peak_timestamp_ms,
        total_duration_ms: rep.end_timestamp_ms - rep.start_timestamp_ms,
        nodes,
    })
}

fn normalize_body_frame(
    frame: &CanonicalFrameSample,
    config: &BodyNormalizationConfig,
) -> Result<BodyFrame, TrajectoryRefusal> {
    let origin_left =
        xy(frame, config.origin_landmarks[0]).ok_or(TrajectoryRefusal::MissingBodyOrigin {
            frame_id: frame.frame_id,
        })?;
    let origin_right =
        xy(frame, config.origin_landmarks[1]).ok_or(TrajectoryRefusal::MissingBodyOrigin {
            frame_id: frame.frame_id,
        })?;
    let scale_left =
        xy(frame, config.scale_landmarks[0]).ok_or(TrajectoryRefusal::MissingBodyScale {
            frame_id: frame.frame_id,
        })?;
    let scale_right =
        xy(frame, config.scale_landmarks[1]).ok_or(TrajectoryRefusal::MissingBodyScale {
            frame_id: frame.frame_id,
        })?;
    let origin = (
        (origin_left.0 + origin_right.0) * 0.5,
        (origin_left.1 + origin_right.1) * 0.5,
    );
    let scale = (scale_left.0 - scale_right.0).hypot(scale_left.1 - scale_right.1);
    if !scale.is_finite() || scale <= 1e-6 {
        return Err(TrajectoryRefusal::InvalidBodyScale {
            frame_id: frame.frame_id,
        });
    }
    let mut values = Vec::with_capacity(config.feature_landmarks.len() * 2);
    let mut confidence = Vec::with_capacity(config.feature_landmarks.len() * 2);
    for &index in &config.feature_landmarks {
        if let Some((x, y)) = xy(frame, index) {
            let normalized_x = (x - origin.0) / scale;
            values.push(Some(if config.source_is_mirrored {
                -normalized_x
            } else {
                normalized_x
            }));
            values.push(Some((y - origin.1) / scale));
            let score = frame.canonical[index].canonical_confidence.clamp(0.0, 1.0);
            confidence.extend([score, score]);
        } else {
            values.extend([None, None]);
            confidence.extend([0.0, 0.0]);
        }
    }
    Ok(BodyFrame {
        timestamp_ms: frame.timestamp_ms,
        values,
        confidence,
    })
}

fn xy(frame: &CanonicalFrameSample, index: usize) -> Option<(f32, f32)> {
    let landmark = frame.canonical.get(index)?;
    if landmark.source == LandmarkSource::Unknown {
        return None;
    }
    let (x, y) = (landmark.x?, landmark.y?);
    (x.is_finite() && y.is_finite()).then_some((x, y))
}

fn resample_phase(
    frames: &[BodyFrame],
    start_ms: u64,
    end_ms: u64,
    node_count: usize,
    phase: PhaseName,
) -> Vec<RegisteredTrajectoryNode> {
    (0..node_count)
        .map(|index| {
            let progress = index as f32 / (node_count - 1) as f32;
            let timestamp_ms = start_ms + ((end_ms - start_ms) as f32 * progress).round() as u64;
            let (values, confidence) = interpolate_body_frame(frames, timestamp_ms);
            RegisteredTrajectoryNode {
                phase,
                phase_progress: progress,
                source_timestamp_ms: timestamp_ms,
                values,
                confidence,
            }
        })
        .collect()
}

fn interpolate_body_frame(frames: &[BodyFrame], timestamp_ms: u64) -> (Vec<Option<f32>>, Vec<f32>) {
    let upper = frames.partition_point(|frame| frame.timestamp_ms < timestamp_ms);
    if upper == 0 {
        return (frames[0].values.clone(), frames[0].confidence.clone());
    }
    if upper >= frames.len() {
        let last = &frames[frames.len() - 1];
        return (last.values.clone(), last.confidence.clone());
    }
    let left = &frames[upper - 1];
    let right = &frames[upper];
    let span = right.timestamp_ms.saturating_sub(left.timestamp_ms);
    let ratio = if span == 0 {
        0.0
    } else {
        timestamp_ms.saturating_sub(left.timestamp_ms) as f32 / span as f32
    };
    let values = left
        .values
        .iter()
        .zip(&right.values)
        .map(|(left, right)| match (left, right) {
            (Some(left), Some(right)) => Some(left + (right - left) * ratio),
            _ => None,
        })
        .collect();
    let confidence = left
        .confidence
        .iter()
        .zip(&right.confidence)
        .map(|(left, right)| (left + (right - left) * ratio).clamp(0.0, 1.0))
        .collect();
    (values, confidence)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReferenceIdentity {
    pub exercise_id: String,
    pub capture_position: String,
    pub variation: String,
    pub training_side: String,
    pub equipment: String,
    pub coordinate_system: String,
    pub feature_schema_id: String,
    pub pose_model_version: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CorridorPoint {
    pub q_low: Option<f32>,
    pub q_high: Option<f32>,
    pub median_absolute_deviation: Option<f32>,
    pub n_observed: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ReferenceCorridorNode {
    pub phase: String,
    pub phase_progress: f32,
    pub features: Vec<CorridorPoint>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ReferenceTrajectoryProfile {
    pub identity: ReferenceIdentity,
    pub profile_hash: u64,
    pub profile_status: String,
    pub feature_names: Vec<String>,
    pub nodes: Vec<ReferenceCorridorNode>,
    pub minimum_observation_confidence: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ObservedReferenceNode {
    pub phase: String,
    pub phase_progress: f32,
    pub values: Vec<Option<f32>>,
    pub confidence: Vec<f32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ObservedReferenceRep {
    pub identity: ReferenceIdentity,
    pub rep_id: u64,
    pub rep_revision: u32,
    pub canonical_slice_hash: u64,
    pub nodes: Vec<ObservedReferenceNode>,
}

pub const LAT_PULLDOWN_REFERENCE_FEATURES: [&str; 11] = [
    "leftWristHeight",
    "rightWristHeight",
    "leftElbowAngleDeg",
    "rightElbowAngleDeg",
    "leftUpperArmToTorsoDeg",
    "rightUpperArmToTorsoDeg",
    "leftWristLateral",
    "rightWristLateral",
    "bilateralWristHeightDelta",
    "torsoLateralShift",
    "torsoLateralTiltDeg",
];

/// Generic, profile-bound phase features. These values are normalized within
/// one sealed rep (start -> peak -> end), so they preserve phase direction and
/// path continuity across camera distance and anthropometry. They are not
/// absolute pose coordinates and must never be promoted to a form score
/// without a separately reviewed, observed corridor.
pub const PROFILE_SIGNAL_REFERENCE_FEATURES: [&str; 2] =
    ["primarySignalPhase", "secondarySignalPhase"];

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReferenceExtractionError {
    InvalidBoundary,
    MissingBoundaryFrame,
    UnsortedFrames,
}

#[derive(Clone)]
struct ReferenceFeatureVector {
    values: Vec<Option<f32>>,
    confidence: Vec<f32>,
    torso_center_x: Option<f32>,
    torso_scale: Option<f32>,
}

/// Frozen TypeScript-compatible 16 pull + 16 return extraction. This is
/// intentionally distinct from the generic body-normalized trajectory: the
/// reference profile schema fixes nearest-source sampling and 11 feature
/// meanings, including the duplicated peak node at the phase boundary.
pub fn extract_lat_pulldown_reference_rep(
    identity: ReferenceIdentity,
    rep: &SealedRep,
    frames: &[CanonicalFrameSample],
) -> Result<ObservedReferenceRep, ReferenceExtractionError> {
    if rep.start_timestamp_ms >= rep.peak_timestamp_ms
        || rep.peak_timestamp_ms >= rep.end_timestamp_ms
    {
        return Err(ReferenceExtractionError::InvalidBoundary);
    }
    if frames
        .windows(2)
        .any(|pair| pair[0].timestamp_ms > pair[1].timestamp_ms)
    {
        return Err(ReferenceExtractionError::UnsortedFrames);
    }
    if frames
        .first()
        .is_none_or(|frame| frame.timestamp_ms > rep.start_timestamp_ms)
        || frames
            .last()
            .is_none_or(|frame| frame.timestamp_ms < rep.end_timestamp_ms)
    {
        return Err(ReferenceExtractionError::MissingBoundaryFrame);
    }

    let mut vectors = Vec::with_capacity(32);
    let mut nodes = Vec::with_capacity(32);
    for (phase, start_ms, end_ms) in [
        ("pull", rep.start_timestamp_ms, rep.peak_timestamp_ms),
        ("return", rep.peak_timestamp_ms, rep.end_timestamp_ms),
    ] {
        for index in 0..16 {
            let progress = index as f32 / 15.0;
            let target_ms = start_ms as f64 + (end_ms - start_ms) as f64 * f64::from(progress);
            let nearest = frames.iter().min_by(|left, right| {
                ((left.timestamp_ms as f64 - target_ms).abs())
                    .total_cmp(&(right.timestamp_ms as f64 - target_ms).abs())
            });
            let vector = nearest
                .filter(|frame| (frame.timestamp_ms as f64 - target_ms).abs() <= 180.0)
                .map(reference_feature_vector)
                .unwrap_or_else(empty_reference_feature_vector);
            vectors.push(vector.clone());
            nodes.push(ObservedReferenceNode {
                phase: phase.into(),
                phase_progress: round5(progress),
                values: vector.values,
                confidence: vector.confidence,
            });
        }
    }

    let baseline = vectors
        .iter()
        .find_map(|vector| Some((vector.torso_center_x?, vector.torso_scale?)));
    for (node, vector) in nodes.iter_mut().zip(&vectors) {
        node.values[9] = match (vector.torso_center_x, baseline) {
            (Some(current), Some((center, scale))) if scale >= 1e-3 => {
                Some(round5((current - center) / scale))
            }
            _ => None,
        };
        node.confidence[9] = if node.values[9].is_some() {
            vector.confidence[10]
        } else {
            0.0
        };
    }

    Ok(ObservedReferenceRep {
        identity,
        rep_id: rep.rep_id,
        rep_revision: rep.revision,
        canonical_slice_hash: rep.canonical_slice_hash,
        nodes,
    })
}

/// Extracts a portable two-signal trajectory from the exact canonical slice
/// sealed by the Rust rep engine. This is the only extractor used by the
/// simulated five-split baseline: it cannot silently fall back to vertical
/// wrist motion or a TypeScript-side re-segmentation.
pub fn extract_profile_signal_reference_rep(
    identity: ReferenceIdentity,
    rep: &SealedRep,
    profile: &ExerciseProfile,
    frames: &[CanonicalFrameSample],
) -> Result<ObservedReferenceRep, ReferenceExtractionError> {
    validate_reference_slice(rep, frames)?;
    let mut nodes = Vec::with_capacity(32);
    for (phase, start_ms, end_ms) in [
        ("to_extreme", rep.start_timestamp_ms, rep.peak_timestamp_ms),
        ("from_extreme", rep.peak_timestamp_ms, rep.end_timestamp_ms),
    ] {
        for index in 0..16 {
            let progress = index as f32 / 15.0;
            let target_ms = start_ms as f64 + (end_ms - start_ms) as f64 * f64::from(progress);
            let values_and_confidence = frames
                .iter()
                .min_by(|left, right| {
                    (left.timestamp_ms as f64 - target_ms)
                        .abs()
                        .total_cmp(&(right.timestamp_ms as f64 - target_ms).abs())
                })
                .filter(|frame| (frame.timestamp_ms as f64 - target_ms).abs() <= 180.0)
                .and_then(|frame| {
                    profile_signal(profile, &frame.canonical).map(|(primary, secondary, _, _)| {
                        let primary_confidence =
                            signal_confidence(&profile.primary_signal, &frame.canonical);
                        let secondary_confidence =
                            signal_confidence(&profile.secondary_signal, &frame.canonical);
                        (
                            vec![Some(primary), Some(secondary)],
                            vec![primary_confidence, secondary_confidence],
                        )
                    })
                })
                .unwrap_or_else(|| (vec![None, None], vec![0.0, 0.0]));
            nodes.push(ObservedReferenceNode {
                phase: phase.into(),
                phase_progress: round5(progress),
                values: values_and_confidence.0,
                confidence: values_and_confidence.1,
            });
        }
    }
    normalize_profile_signal_nodes(&mut nodes);
    Ok(ObservedReferenceRep {
        identity,
        rep_id: rep.rep_id,
        rep_revision: rep.revision,
        canonical_slice_hash: rep.canonical_slice_hash,
        nodes,
    })
}

fn validate_reference_slice(
    rep: &SealedRep,
    frames: &[CanonicalFrameSample],
) -> Result<(), ReferenceExtractionError> {
    if rep.start_timestamp_ms >= rep.peak_timestamp_ms
        || rep.peak_timestamp_ms >= rep.end_timestamp_ms
    {
        return Err(ReferenceExtractionError::InvalidBoundary);
    }
    if frames
        .windows(2)
        .any(|pair| pair[0].timestamp_ms > pair[1].timestamp_ms)
    {
        return Err(ReferenceExtractionError::UnsortedFrames);
    }
    if frames
        .first()
        .is_none_or(|frame| frame.timestamp_ms > rep.start_timestamp_ms)
        || frames
            .last()
            .is_none_or(|frame| frame.timestamp_ms < rep.end_timestamp_ms)
    {
        return Err(ReferenceExtractionError::MissingBoundaryFrame);
    }
    Ok(())
}

fn normalize_profile_signal_nodes(nodes: &mut [ObservedReferenceNode]) {
    if nodes.len() != 32 {
        return;
    }
    for feature_index in 0..PROFILE_SIGNAL_REFERENCE_FEATURES.len() {
        let start = nodes[0].values[feature_index];
        let peak = nodes[15].values[feature_index];
        let Some((start, peak)) = start.zip(peak) else {
            for node in nodes.iter_mut() {
                node.values[feature_index] = None;
                node.confidence[feature_index] = 0.0;
            }
            continue;
        };
        let amplitude = peak - start;
        if !amplitude.is_finite() || amplitude.abs() < 1e-5 {
            for node in nodes.iter_mut() {
                node.values[feature_index] = None;
                node.confidence[feature_index] = 0.0;
            }
            continue;
        }
        for node in nodes.iter_mut() {
            node.values[feature_index] =
                node.values[feature_index].map(|value| round5((value - start) / amplitude));
        }
    }
}

fn reference_feature_vector(frame: &CanonicalFrameSample) -> ReferenceFeatureVector {
    let mut output = empty_reference_feature_vector();
    let shoulders = pair_measurement(frame, 11, 12);
    let hips = pair_measurement(frame, 23, 24);
    let torso =
        shoulders
            .zip(hips)
            .map(|((left_shoulder, right_shoulder), (left_hip, right_hip))| {
                let shoulder = midpoint_xy(left_shoulder.0, right_shoulder.0);
                let hip = midpoint_xy(left_hip.0, right_hip.0);
                let confidence = left_shoulder
                    .1
                    .min(right_shoulder.1)
                    .min(left_hip.1)
                    .min(right_hip.1);
                (shoulder, hip, confidence)
            });
    if let Some((shoulder, hip, torso_confidence)) = torso {
        let scale = (shoulder.0 - hip.0).hypot(shoulder.1 - hip.1);
        if scale >= 1e-3 && scale.is_finite() {
            output.torso_center_x = Some(shoulder.0);
            output.torso_scale = Some(scale);
            for (wrist_index, height_index, lateral_index) in [(15, 0, 6), (16, 1, 7)] {
                if let Some(((x, y), confidence)) = point_measurement(frame, wrist_index) {
                    let feature_confidence = torso_confidence.min(confidence);
                    set_reference_feature(
                        &mut output,
                        height_index,
                        Some((y - shoulder.1) / scale),
                        feature_confidence,
                    );
                    set_reference_feature(
                        &mut output,
                        lateral_index,
                        Some((x - shoulder.0) / scale),
                        feature_confidence,
                    );
                }
            }
            if let (Some(left), Some(right)) = (output.values[0], output.values[1]) {
                let wrist_confidence = output.confidence[0].min(output.confidence[1]);
                set_reference_feature(&mut output, 8, Some(left - right), wrist_confidence);
            }
            let tilt = (shoulder.0 - hip.0).atan2(hip.1 - shoulder.1).to_degrees();
            set_reference_feature(&mut output, 10, Some(tilt), torso_confidence);
        }
    }
    for (feature, indices) in [
        (2, [11, 13, 15]),
        (3, [12, 14, 16]),
        (4, [23, 11, 13]),
        (5, [24, 12, 14]),
    ] {
        if let Some((value, confidence)) = reference_angle(frame, indices) {
            set_reference_feature(&mut output, feature, Some(value), confidence);
        }
    }
    output
}

fn empty_reference_feature_vector() -> ReferenceFeatureVector {
    ReferenceFeatureVector {
        values: vec![None; LAT_PULLDOWN_REFERENCE_FEATURES.len()],
        confidence: vec![0.0; LAT_PULLDOWN_REFERENCE_FEATURES.len()],
        torso_center_x: None,
        torso_scale: None,
    }
}

fn point_measurement(frame: &CanonicalFrameSample, index: usize) -> Option<((f32, f32), f32)> {
    let landmark = frame.canonical.get(index)?;
    let confidence = landmark.canonical_confidence;
    if landmark.source == LandmarkSource::Unknown || !confidence.is_finite() || confidence < 0.5 {
        return None;
    }
    let (x, y) = (landmark.x?, landmark.y?);
    (x.is_finite() && y.is_finite()).then_some(((x, y), confidence.clamp(0.0, 1.0)))
}

fn pair_measurement(
    frame: &CanonicalFrameSample,
    left: usize,
    right: usize,
) -> Option<(((f32, f32), f32), ((f32, f32), f32))> {
    Some((
        point_measurement(frame, left)?,
        point_measurement(frame, right)?,
    ))
}

fn midpoint_xy(left: (f32, f32), right: (f32, f32)) -> (f32, f32) {
    ((left.0 + right.0) * 0.5, (left.1 + right.1) * 0.5)
}

fn reference_angle(frame: &CanonicalFrameSample, indices: [usize; 3]) -> Option<(f32, f32)> {
    let (a, a_confidence) = point_measurement(frame, indices[0])?;
    let (b, b_confidence) = point_measurement(frame, indices[1])?;
    let (c, c_confidence) = point_measurement(frame, indices[2])?;
    let first = (a.0 - b.0, a.1 - b.1);
    let second = (c.0 - b.0, c.1 - b.1);
    let denominator = first.0.hypot(first.1) * second.0.hypot(second.1);
    if denominator < 1e-6 {
        return None;
    }
    let cosine = ((first.0 * second.0 + first.1 * second.1) / denominator).clamp(-1.0, 1.0);
    Some((
        cosine.acos().to_degrees(),
        a_confidence.min(b_confidence).min(c_confidence),
    ))
}

fn set_reference_feature(
    output: &mut ReferenceFeatureVector,
    index: usize,
    value: Option<f32>,
    confidence: f32,
) {
    output.values[index] = value.filter(|value| value.is_finite()).map(round5);
    output.confidence[index] = if output.values[index].is_some() {
        round5(confidence.clamp(0.0, 1.0))
    } else {
        0.0
    };
}

fn round5(value: f32) -> f32 {
    (value * 100_000.0).round() / 100_000.0
}

pub fn observed_reference_rep_from_normalized(
    identity: ReferenceIdentity,
    trajectory: &NormalizedRepTrajectory,
) -> ObservedReferenceRep {
    ObservedReferenceRep {
        identity,
        rep_id: trajectory.rep_id,
        rep_revision: trajectory.rep_revision,
        canonical_slice_hash: trajectory.canonical_slice_hash,
        nodes: trajectory
            .nodes
            .iter()
            .map(|node| ObservedReferenceNode {
                phase: match node.phase {
                    PhaseName::Effort => "pull",
                    PhaseName::Return => "return",
                }
                .into(),
                phase_progress: node.phase_progress,
                values: node.values.clone(),
                confidence: node.confidence.clone(),
            })
            .collect(),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TrajectoryComparisonStatus {
    ComparisonAvailable,
    ProfileMismatch,
    InsufficientObservation,
    InvalidProfile,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FeatureTrajectoryEvidence {
    pub feature: String,
    pub comparable_node_count: usize,
    pub unknown_node_count: usize,
    pub outside_node_count: usize,
    pub outside_node_ratio: Option<f32>,
    pub maximum_consecutive_outside_nodes: usize,
    pub total_normalized_excess: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TrajectoryMatchEvidence {
    pub status: TrajectoryComparisonStatus,
    pub mismatch_reason: Option<String>,
    pub rep_id: u64,
    pub rep_revision: u32,
    pub canonical_slice_hash: u64,
    pub profile_hash: u64,
    pub profile_status: String,
    pub features: Vec<FeatureTrajectoryEvidence>,
    /// Deliberately absent until a reviewed calibration cohort establishes a
    /// decision policy. Descriptive corridor evidence is not a form score.
    pub quality_verdict: Option<String>,
}

pub fn match_reference_trajectory(
    profile: &ReferenceTrajectoryProfile,
    observed: &ObservedReferenceRep,
) -> TrajectoryMatchEvidence {
    if let Some(reason) = identity_mismatch(&profile.identity, &observed.identity) {
        return trajectory_refusal(
            profile,
            observed,
            TrajectoryComparisonStatus::ProfileMismatch,
            Some(reason),
        );
    }
    if profile.feature_names.is_empty()
        || !profile.minimum_observation_confidence.is_finite()
        || !(0.0..=1.0).contains(&profile.minimum_observation_confidence)
        || profile.nodes.iter().any(|node| {
            node.features.len() != profile.feature_names.len()
                || node
                    .features
                    .iter()
                    .any(|point| !valid_corridor_point_for_status(point, &profile.profile_status))
        })
        || !valid_reference_phase_layout(&profile.nodes)
    {
        return trajectory_refusal(
            profile,
            observed,
            TrajectoryComparisonStatus::InvalidProfile,
            Some("invalid profile feature schema or phase layout".into()),
        );
    }
    if profile.nodes.len() != observed.nodes.len()
        || observed.nodes.iter().any(|node| {
            node.values.len() != profile.feature_names.len()
                || node.confidence.len() != profile.feature_names.len()
        })
        || profile
            .nodes
            .iter()
            .zip(&observed.nodes)
            .any(|(expected, actual)| {
                expected.phase != actual.phase
                    || !actual.phase_progress.is_finite()
                    || (expected.phase_progress - actual.phase_progress).abs() > 1e-4
            })
    {
        return trajectory_refusal(
            profile,
            observed,
            TrajectoryComparisonStatus::ProfileMismatch,
            Some("node count or feature schema mismatch".into()),
        );
    }

    let features = profile
        .feature_names
        .iter()
        .enumerate()
        .map(|(feature_index, feature)| {
            let mut comparable = 0;
            let mut unknown = 0;
            let mut outside = 0;
            let mut consecutive = 0;
            let mut maximum_consecutive = 0;
            let mut total_normalized_excess = 0.0;
            let mut previous_phase: Option<&str> = None;
            for (reference, value) in profile.nodes.iter().zip(&observed.nodes) {
                if previous_phase != Some(value.phase.as_str()) {
                    consecutive = 0;
                }
                previous_phase = Some(value.phase.as_str());
                let corridor = &reference.features[feature_index];
                let confidence = value.confidence[feature_index];
                let Some(value) = value.values[feature_index].filter(|value| value.is_finite())
                else {
                    unknown += 1;
                    consecutive = 0;
                    continue;
                };
                if !confidence.is_finite() || confidence < profile.minimum_observation_confidence {
                    unknown += 1;
                    consecutive = 0;
                    continue;
                }
                let (Some(low), Some(high)) = (corridor.q_low, corridor.q_high) else {
                    unknown += 1;
                    consecutive = 0;
                    continue;
                };
                if !low.is_finite() || !high.is_finite() || low > high {
                    unknown += 1;
                    consecutive = 0;
                    continue;
                }
                comparable += 1;
                let excess = if value < low {
                    low - value
                } else if value > high {
                    value - high
                } else {
                    0.0
                };
                if excess > 0.0 {
                    outside += 1;
                    consecutive += 1;
                    maximum_consecutive = maximum_consecutive.max(consecutive);
                    let corridor_width = high - low;
                    let robust_scale = corridor
                        .median_absolute_deviation
                        .filter(|value| value.is_finite() && *value >= 0.0)
                        .map_or(0.0, |value| value * 1.4826);
                    let scale = corridor_width.max(robust_scale);
                    if scale > 1e-9 {
                        total_normalized_excess += excess / scale;
                    }
                } else {
                    consecutive = 0;
                }
            }
            FeatureTrajectoryEvidence {
                feature: feature.clone(),
                comparable_node_count: comparable,
                unknown_node_count: unknown,
                outside_node_count: outside,
                outside_node_ratio: (comparable > 0).then_some(outside as f32 / comparable as f32),
                maximum_consecutive_outside_nodes: maximum_consecutive,
                total_normalized_excess,
            }
        })
        .collect::<Vec<_>>();
    let status = if features
        .iter()
        .any(|feature| feature.comparable_node_count > 0)
    {
        TrajectoryComparisonStatus::ComparisonAvailable
    } else {
        TrajectoryComparisonStatus::InsufficientObservation
    };
    TrajectoryMatchEvidence {
        status,
        mismatch_reason: None,
        rep_id: observed.rep_id,
        rep_revision: observed.rep_revision,
        canonical_slice_hash: observed.canonical_slice_hash,
        profile_hash: profile.profile_hash,
        profile_status: profile.profile_status.clone(),
        features,
        quality_verdict: None,
    }
}

fn valid_corridor_point(point: &CorridorPoint) -> bool {
    let corridor = match (point.q_low, point.q_high) {
        (None, None) => true,
        (Some(low), Some(high)) => {
            low.is_finite() && high.is_finite() && low <= high && point.n_observed > 0
        }
        _ => false,
    };
    corridor
        && point
            .median_absolute_deviation
            .is_none_or(|value| value.is_finite() && value >= 0.0)
}

fn valid_corridor_point_for_status(point: &CorridorPoint, profile_status: &str) -> bool {
    if profile_status != "simulated_nominal" {
        return valid_corridor_point(point);
    }
    let corridor = match (point.q_low, point.q_high) {
        (None, None) => true,
        (Some(low), Some(high)) => low.is_finite() && high.is_finite() && low <= high,
        _ => false,
    };
    corridor
        && point
            .median_absolute_deviation
            .is_none_or(|value| value.is_finite() && value >= 0.0)
}

fn valid_reference_phase_layout(nodes: &[ReferenceCorridorNode]) -> bool {
    if nodes.len() < 4 {
        return false;
    }
    let first_phase = nodes[0].phase.as_str();
    if first_phase.is_empty() {
        return false;
    }
    let Some(split) = nodes.iter().position(|node| node.phase != first_phase) else {
        return false;
    };
    if split < 2 || nodes.len() - split < 2 {
        return false;
    }
    let second_phase = nodes[split].phase.as_str();
    if second_phase.is_empty() || second_phase == first_phase {
        return false;
    }
    let valid_phase = |phase_nodes: &[ReferenceCorridorNode], phase: &str| {
        phase_nodes.iter().all(|node| {
            node.phase == phase
                && node.phase_progress.is_finite()
                && (0.0..=1.0).contains(&node.phase_progress)
        }) && phase_nodes
            .windows(2)
            .all(|pair| pair[0].phase_progress <= pair[1].phase_progress)
            && phase_nodes
                .first()
                .is_some_and(|node| node.phase_progress.abs() <= 1e-4)
            && phase_nodes
                .last()
                .is_some_and(|node| (node.phase_progress - 1.0).abs() <= 1e-4)
    };
    valid_phase(&nodes[..split], first_phase) && valid_phase(&nodes[split..], second_phase)
}

fn identity_mismatch(expected: &ReferenceIdentity, observed: &ReferenceIdentity) -> Option<String> {
    for (field, expected, observed) in [
        ("exercise_id", &expected.exercise_id, &observed.exercise_id),
        (
            "capture_position",
            &expected.capture_position,
            &observed.capture_position,
        ),
        ("variation", &expected.variation, &observed.variation),
        (
            "training_side",
            &expected.training_side,
            &observed.training_side,
        ),
        ("equipment", &expected.equipment, &observed.equipment),
        (
            "coordinate_system",
            &expected.coordinate_system,
            &observed.coordinate_system,
        ),
        (
            "feature_schema_id",
            &expected.feature_schema_id,
            &observed.feature_schema_id,
        ),
        (
            "pose_model_version",
            &expected.pose_model_version,
            &observed.pose_model_version,
        ),
    ] {
        if expected != observed {
            return Some(format!("{field} mismatch"));
        }
    }
    None
}

/// Maps a complete, trusted runtime context to the one ExerciseProfile it is
/// allowed to bind. This is deliberately an exact tuple: a reference captured
/// with another model, coordinate system, attachment, grip, or side must be
/// refused rather than silently compared.
fn supported_reference_exercise_profile_identity(
    identity: &ReferenceIdentity,
) -> Option<&'static str> {
    if identity.exercise_id != "lat_pulldown"
        || identity.variation != "front_bar_pronated"
        || identity.training_side != "bilateral"
        || identity.equipment != "cable_lat_pulldown/straight_bar"
        || identity.coordinate_system != "source-image/v1"
        || identity.feature_schema_id != "lat_pulldown/source-image-piecewise-32/v2"
        || identity.pose_model_version != "mediapipe-pose-heavy"
    {
        return None;
    }
    match identity.capture_position.as_str() {
        "rear" => Some("lat-pulldown/rear/bilateral/cable/v1"),
        "rearLeft45" => Some("lat-pulldown/rear-left-45/bilateral/cable/v1"),
        _ => None,
    }
}

#[cfg(test)]
mod reference_identity_tests {
    use super::{ReferenceIdentity, supported_reference_exercise_profile_identity};

    fn reviewed_rear_identity() -> ReferenceIdentity {
        ReferenceIdentity {
            exercise_id: "lat_pulldown".into(),
            capture_position: "rear".into(),
            variation: "front_bar_pronated".into(),
            training_side: "bilateral".into(),
            equipment: "cable_lat_pulldown/straight_bar".into(),
            coordinate_system: "source-image/v1".into(),
            feature_schema_id: "lat_pulldown/source-image-piecewise-32/v2".into(),
            pose_model_version: "mediapipe-pose-heavy".into(),
        }
    }

    #[test]
    fn reference_binding_accepts_only_the_complete_supported_identity() {
        assert_eq!(
            supported_reference_exercise_profile_identity(&reviewed_rear_identity()),
            Some("lat-pulldown/rear/bilateral/cable/v1")
        );

        let mutations: [fn(&mut ReferenceIdentity); 4] = [
            |identity| identity.variation = "behind_neck".into(),
            |identity| identity.equipment = "plate_loaded_lat_pulldown".into(),
            |identity| identity.coordinate_system = "world-space/v1".into(),
            |identity| identity.pose_model_version = "mediapipe-pose-lite".into(),
        ];
        for mutation in mutations {
            let mut spoofed = reviewed_rear_identity();
            mutation(&mut spoofed);
            assert_eq!(
                supported_reference_exercise_profile_identity(&spoofed),
                None
            );
        }
    }
}

fn trajectory_refusal(
    profile: &ReferenceTrajectoryProfile,
    observed: &ObservedReferenceRep,
    status: TrajectoryComparisonStatus,
    reason: Option<String>,
) -> TrajectoryMatchEvidence {
    TrajectoryMatchEvidence {
        status,
        mismatch_reason: reason,
        rep_id: observed.rep_id,
        rep_revision: observed.rep_revision,
        canonical_slice_hash: observed.canonical_slice_hash,
        profile_hash: profile.profile_hash,
        profile_status: profile.profile_status.clone(),
        features: Vec::new(),
        quality_verdict: None,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct DtwDiagnostic {
    pub normalized_cost: f32,
    pub path_length: usize,
    pub warp_ratio: f32,
    pub window: usize,
}

/// Shadow-only constrained DTW for a single already-segmented phase. It is
/// intentionally unavailable for rep boundaries or production verdicts.
pub fn constrained_phase_dtw(
    left: &[Vec<f32>],
    right: &[Vec<f32>],
    window: usize,
) -> Option<DtwDiagnostic> {
    if left.is_empty()
        || right.is_empty()
        || window == 0
        || window > left.len().max(right.len()) / 4 + 1
        || left
            .iter()
            .chain(right)
            .any(|row| row.is_empty() || row.iter().any(|value| !value.is_finite()))
        || left[0].len() != right[0].len()
        || left.iter().any(|row| row.len() != left[0].len())
        || right.iter().any(|row| row.len() != right[0].len())
    {
        return None;
    }
    let n = left.len();
    let m = right.len();
    let band = window.max(n.abs_diff(m));
    let mut cost = vec![vec![f32::INFINITY; m + 1]; n + 1];
    let mut steps = vec![vec![usize::MAX; m + 1]; n + 1];
    cost[0][0] = 0.0;
    steps[0][0] = 0;
    for i in 1..=n {
        let start = 1.max(i.saturating_sub(band));
        let end = m.min(i.saturating_add(band));
        for j in start..=end {
            let distance = left[i - 1]
                .iter()
                .zip(&right[j - 1])
                .map(|(left, right)| (left - right).powi(2))
                .sum::<f32>()
                .sqrt();
            let predecessors = [
                (cost[i - 1][j], steps[i - 1][j]),
                (cost[i][j - 1], steps[i][j - 1]),
                (cost[i - 1][j - 1], steps[i - 1][j - 1]),
            ];
            let (best_cost, best_steps) = predecessors
                .into_iter()
                .min_by(|left, right| left.0.total_cmp(&right.0))?;
            if best_cost.is_finite() {
                cost[i][j] = best_cost + distance;
                steps[i][j] = best_steps.saturating_add(1);
            }
        }
    }
    let path_length = steps[n][m];
    if !cost[n][m].is_finite() || path_length == usize::MAX || path_length == 0 {
        return None;
    }
    Some(DtwDiagnostic {
        normalized_cost: cost[n][m] / path_length as f32,
        path_length,
        warp_ratio: path_length as f32 / n.max(m) as f32,
        window,
    })
}
