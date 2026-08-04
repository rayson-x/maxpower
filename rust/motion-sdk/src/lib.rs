#![deny(unsafe_op_in_unsafe_fn)]

#[cfg(target_arch = "wasm32")]
mod web_abi;

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
    CentralStable,
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
}

#[derive(Clone, Debug, PartialEq)]
pub struct ExerciseSignal {
    pub kind: ExerciseSignalKind,
    pub landmarks: Vec<usize>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PoseSchemaId {
    BlazePose33,
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

impl ExerciseProfile {
    pub fn lat_pulldown_provisional() -> Self {
        Self::with_computed_hash(Self {
            identity: "lat-pulldown/rear/bilateral/cable/v1".into(),
            content_hash: 0,
            maturity: ExerciseMaturity::Provisional,
            schema: PoseSchemaId::BlazePose33,
            coordinate_unit: "image-normalized-y".into(),
            state_machine_id: "ready-effort-peak-return/v1".into(),
            required_capabilities: PROFILE_REQUIRED_CAPABILITIES,
            primary_signal: ExerciseSignal { kind: ExerciseSignalKind::LandmarkY, landmarks: vec![15, 16] },
            secondary_signal: ExerciseSignal { kind: ExerciseSignalKind::LandmarkY, landmarks: vec![13, 14] },
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
            primary_signal: ExerciseSignal { kind: ExerciseSignalKind::LandmarkY, landmarks: vec![15, 16] },
            secondary_signal: ExerciseSignal { kind: ExerciseSignalKind::LandmarkY, landmarks: vec![13, 14] },
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
        hash = fnv_bytes(hash, [0]); // BlazePose33 schema code.
        hash = fnv_bytes(
            hash,
            [match self.direction {
                MovementDirection::Increasing => 0,
                MovementDirection::Decreasing => 1,
                MovementDirection::Auto => 2,
            }],
        );
        for signal in [&self.primary_signal, &self.secondary_signal] {
            hash = fnv_bytes(hash, [signal.kind.hash_code(), signal.landmarks.len() as u8]);
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
        if self.schema != PoseSchemaId::BlazePose33 {
            return Err(MotionError::InvalidExerciseProfile(
                "unsupported pose schema",
            ));
        }
        if self.coordinate_unit != expected_coordinate_unit(
            self.primary_signal.kind,
            self.secondary_signal.kind,
        ) {
            return Err(MotionError::InvalidExerciseProfile(
                "unsupported coordinate unit",
            ));
        }
        if self.state_machine_id != "ready-effort-peak-return/v1" {
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
        if !self.primary_signal.validate() || !self.secondary_signal.validate() {
            return Err(MotionError::InvalidExerciseProfile("missing joint group"));
        }
        let joints = self
            .primary_signal
            .landmarks
            .iter()
            .chain(&self.secondary_signal.landmarks)
            .copied()
            .collect::<Vec<_>>();
        if joints.iter().any(|index| *index >= 33) {
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
}

impl ExerciseSignalKind {
    const fn hash_code(self) -> u8 {
        match self {
            Self::LandmarkY => 0,
            Self::JointAngle => 1,
            Self::LandmarkDistance => 2,
        }
    }
}

impl ExerciseSignal {
    fn validate(&self) -> bool {
        let expected_count = match self.kind {
            ExerciseSignalKind::LandmarkY => 1..=2,
            ExerciseSignalKind::JointAngle => 3..=3,
            ExerciseSignalKind::LandmarkDistance => 2..=2,
        };
        expected_count.contains(&self.landmarks.len())
            && self.landmarks.iter().all(|index| *index < 33)
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
        (ExerciseSignalKind::LandmarkDistance, ExerciseSignalKind::LandmarkDistance) => {
            "torso-normalized-distance"
        }
        _ => "derived-kinematic-signal",
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
const SET_PAUSE_IDLE_MS: u64 = 1_500;

#[derive(Clone, Debug)]
struct SetGate {
    state: SetStateSnapshot,
    stable_since_ms: Option<u64>,
    idle_since_ms: Option<u64>,
    previous_primary: Option<f32>,
}

impl Default for SetGate {
    fn default() -> Self {
        Self {
            state: SetStateSnapshot::default(),
            stable_since_ms: None,
            idle_since_ms: None,
            previous_primary: None,
        }
    }
}

impl SetGate {
    fn replay_active() -> Self {
        Self {
            state: SetStateSnapshot {
                lifecycle: SetLifecycle::Active,
            },
            stable_since_ms: None,
            idle_since_ms: None,
            previous_primary: None,
        }
    }

    fn begin(&mut self) {
        self.state.lifecycle = SetLifecycle::Arming;
        self.stable_since_ms = None;
        self.idle_since_ms = None;
        self.previous_primary = None;
    }

    fn finish(&mut self) {
        self.state.lifecycle = SetLifecycle::Finished;
        self.stable_since_ms = None;
        self.idle_since_ms = None;
        self.previous_primary = None;
    }

    /// Returns whether this frame may advance the rep state machine.  The
    /// first `active` frame after arming is deliberately withheld, so the
    /// stable setup pose becomes an engine baseline rather than a rep sample.
    fn advance(
        &mut self,
        profile: Option<&ExerciseProfile>,
        target_state: TargetState,
        canonical: &[CanonicalLandmark],
        timestamp_ms: u64,
        rep_phase: RepPhase,
    ) -> bool {
        let primary = profile.and_then(|profile| {
            profile_signal(profile, canonical).map(|(primary, _, _, _)| primary)
        });
        let observable = target_state == TargetState::Locked
            && (profile.is_none() || primary.is_some());
        let resume_delta = profile
            .map(|profile| (profile.start_amplitude * 0.30).max(0.001))
            .unwrap_or(0.001);

        match self.state.lifecycle {
            SetLifecycle::Idle | SetLifecycle::Finished => false,
            SetLifecycle::Arming => {
                if !observable {
                    self.stable_since_ms = None;
                    self.previous_primary = None;
                    return false;
                }
                if let (Some(previous), Some(current)) = (self.previous_primary, primary) {
                    if (current - previous).abs() >= resume_delta {
                        self.stable_since_ms = Some(timestamp_ms);
                    }
                }
                let stable_since = *self.stable_since_ms.get_or_insert(timestamp_ms);
                self.previous_primary = primary;
                if timestamp_ms.saturating_sub(stable_since) >= SET_ARMING_STABLE_MS {
                    self.state.lifecycle = SetLifecycle::Active;
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
                            if (current - previous).abs() < resume_delta => {
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
    pub set_state: SetStateSnapshot,
    pub rep_state: RepStateSnapshot,
    /// Newly sealed objects only. Consumers accumulate by `(subject_epoch,
    /// rep_id, revision)`; boundaries never mutate in later packets.
    pub completed_reps: Vec<SealedRep>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PacketEncodeError {
    FieldTooLong(&'static str),
    TooManyLandmarks,
    NonFiniteLandmark { index: usize },
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

    let packet_len = u32::try_from(bytes.len()).map_err(|_| PacketEncodeError::PacketTooLarge)?;
    bytes[8..12].copy_from_slice(&packet_len.to_le_bytes());
    Ok(bytes)
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
    }
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
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct InferenceResult {
    pub candidates: Vec<PoseCandidate>,
}

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
        Ok(InferenceResult { candidates })
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
    acquiring_id: Option<u64>,
    acquiring_since_ms: Option<u64>,
    acquiring_descriptor: Option<PoseCandidate>,
    locked_id: Option<u64>,
    missing_since_ms: Option<u64>,
    locked_descriptor: Option<PoseCandidate>,
    reacquiring_id: Option<u64>,
    reacquiring_since_ms: Option<u64>,
    reacquiring_descriptor: Option<PoseCandidate>,
    identity_boundary: bool,
    last_candidates: Vec<PoseCandidate>,
}

impl SubjectTracker {
    fn new(policy: SubjectPolicy) -> Self {
        Self {
            policy,
            acquiring_id: None,
            acquiring_since_ms: None,
            acquiring_descriptor: None,
            locked_id: None,
            missing_since_ms: None,
            locked_descriptor: None,
            reacquiring_id: None,
            reacquiring_since_ms: None,
            reacquiring_descriptor: None,
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
                    .map(|candidate| (identity_cost(descriptor, candidate), candidate))
                    .collect::<Vec<_>>();
                ranked.sort_by(|left, right| left.0.total_cmp(&right.0));
                let best_is_unambiguous = ranked
                    .get(1)
                    .is_none_or(|second| ranked[0].0 + MIN_IDENTITY_MARGIN <= second.0);
                if let Some((cost, candidate)) = ranked.first()
                    && *cost <= STABLE_SLOT_IDENTITY_COST
                    && best_is_unambiguous
                {
                    let candidate = (*candidate).clone();
                    self.locked_id = Some(candidate.id);
                    self.missing_since_ms = None;
                    self.update_locked_descriptor(candidate.clone());
                    self.reacquiring_id = None;
                    self.reacquiring_since_ms = None;
                    self.reacquiring_descriptor = None;
                    return (
                        TargetSnapshot {
                            state: TargetState::Locked,
                            candidate_count,
                            selected_candidate_id: Some(candidate.id),
                        },
                        Some(candidate),
                    );
                }
                let possible = best_is_unambiguous
                    .then(|| ranked.first())
                    .flatten()
                    .filter(|(cost, _)| *cost <= 0.35)
                    .map(|(_, candidate)| (*candidate).clone());
                if let Some(candidate) = possible {
                    let same_physical_candidate =
                        self.reacquiring_descriptor
                            .as_ref()
                            .is_some_and(|descriptor| {
                                identity_cost(descriptor, &candidate) <= STABLE_SLOT_IDENTITY_COST
                            });
                    if !same_physical_candidate {
                        self.reacquiring_since_ms = Some(timestamp_ms);
                    }
                    self.reacquiring_id = Some(candidate.id);
                    self.reacquiring_descriptor = Some(candidate.clone());
                    let stable_ms = timestamp_ms
                        .saturating_sub(self.reacquiring_since_ms.unwrap_or(timestamp_ms));
                    if stable_ms >= 300 {
                        self.locked_id = Some(candidate.id);
                        self.locked_descriptor = Some(candidate.clone());
                        self.identity_boundary = true;
                        self.missing_since_ms = None;
                        self.reacquiring_id = None;
                        self.reacquiring_since_ms = None;
                        self.reacquiring_descriptor = None;
                        return (
                            TargetSnapshot {
                                state: TargetState::Locked,
                                candidate_count,
                                selected_candidate_id: Some(candidate.id),
                            },
                            Some(candidate),
                        );
                    }
                    return (
                        TargetSnapshot {
                            state: TargetState::Reacquiring,
                            candidate_count,
                            selected_candidate_id: Some(candidate.id),
                        },
                        None,
                    );
                }
            }
            self.reacquiring_id = None;
            self.reacquiring_since_ms = None;
            self.reacquiring_descriptor = None;
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
            .min_by(|left, right| {
                subject_acquisition_cost(left).total_cmp(&subject_acquisition_cost(right))
            })
            .cloned();
        let Some(best) = best else {
            self.acquiring_id = None;
            self.acquiring_since_ms = None;
            self.acquiring_descriptor = None;
            return (
                TargetSnapshot {
                    state: TargetState::Acquiring,
                    candidate_count,
                    selected_candidate_id: None,
                },
                None,
            );
        };
        let same_stable_candidate = self
            .acquiring_descriptor
            .as_ref()
            .is_some_and(|descriptor| {
                let best_cost = identity_cost(descriptor, &best);
                let unambiguous = self.last_candidates.iter().all(|candidate| {
                    candidate.id == best.id
                        || best_cost + MIN_IDENTITY_MARGIN <= identity_cost(descriptor, candidate)
                });
                best_cost <= STABLE_SLOT_IDENTITY_COST && unambiguous
            });
        if !same_stable_candidate {
            self.acquiring_id = Some(best.id);
            self.acquiring_since_ms = Some(timestamp_ms);
            self.acquiring_descriptor = Some(best.clone());
        } else {
            self.acquiring_id = Some(best.id);
            self.acquiring_descriptor = Some(best.clone());
        }
        let stable_ms =
            timestamp_ms.saturating_sub(self.acquiring_since_ms.unwrap_or(timestamp_ms));
        if stable_ms >= 500 {
            self.locked_id = Some(best.id);
            self.locked_descriptor = Some(best.clone());
            self.acquiring_descriptor = None;
            self.missing_since_ms = None;
            return (
                TargetSnapshot {
                    state: TargetState::Locked,
                    candidate_count,
                    selected_candidate_id: Some(best.id),
                },
                Some(best),
            );
        }
        (
            TargetSnapshot {
                state: TargetState::Acquiring,
                candidate_count,
                selected_candidate_id: Some(best.id),
            },
            None,
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
            .ok_or(SubjectSelectionError::NoCandidateAtPoint)?;
        self.locked_id = Some(selected.id);
        self.locked_descriptor = Some(selected.clone());
        self.acquiring_id = None;
        self.acquiring_since_ms = None;
        self.acquiring_descriptor = None;
        self.missing_since_ms = None;
        self.reacquiring_id = None;
        self.reacquiring_since_ms = None;
        self.reacquiring_descriptor = None;
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
}

const STABLE_SLOT_IDENTITY_COST: f32 = 0.12;
const MIN_IDENTITY_MARGIN: f32 = 0.025;

fn identity_cost(reference: &PoseCandidate, candidate: &PoseCandidate) -> f32 {
    identity_cost_components(reference, candidate).iter().sum()
}

fn identity_cost_components(reference: &PoseCandidate, candidate: &PoseCandidate) -> [f32; 4] {
    let (reference_x, reference_y, reference_scale, reference_ratio) =
        subject_identity_geometry(reference);
    let (candidate_x, candidate_y, candidate_scale, candidate_ratio) =
        subject_identity_geometry(candidate);
    let position = (reference_x - candidate_x).hypot(reference_y - candidate_y);
    let scale = (reference_scale.max(1e-6) / candidate_scale.max(1e-6))
        .ln()
        .abs();
    let proportion = (reference_ratio - candidate_ratio).abs();
    let color = reference
        .torso_color
        .iter()
        .zip(candidate.torso_color)
        .map(|(left, right)| (left - right).powi(2))
        .sum::<f32>()
        .sqrt();
    [
        position * 0.50,
        scale * 0.20,
        proportion * 0.15,
        color * 0.15,
    ]
}

fn subject_identity_geometry(candidate: &PoseCandidate) -> (f32, f32, f32, f32) {
    let torso = [11_usize, 12, 23, 24].map(|index| candidate.observations.get(index).copied());
    if torso.iter().all(|value| {
        value.is_some_and(|point| {
            point.visibility >= 0.2 && point.x.is_finite() && point.y.is_finite()
        })
    }) {
        let [left_shoulder, right_shoulder, left_hip, right_hip] = torso.map(Option::unwrap);
        let shoulder_center = (
            (left_shoulder.x + right_shoulder.x) * 0.5,
            (left_shoulder.y + right_shoulder.y) * 0.5,
        );
        let hip_center = (
            (left_hip.x + right_hip.x) * 0.5,
            (left_hip.y + right_hip.y) * 0.5,
        );
        let shoulder_width = (left_shoulder.x - right_shoulder.x)
            .hypot(left_shoulder.y - right_shoulder.y)
            .max(1e-6);
        let torso_height = (shoulder_center.0 - hip_center.0)
            .hypot(shoulder_center.1 - hip_center.1)
            .max(1e-6);
        return (
            (shoulder_center.0 + hip_center.0) * 0.5,
            (shoulder_center.1 + hip_center.1) * 0.5,
            shoulder_width,
            torso_height / shoulder_width,
        );
    }
    let (x, y) = candidate.bbox.center();
    (
        x,
        y,
        candidate.bbox.area().sqrt(),
        candidate.bbox.height / candidate.bbox.width.max(1e-6),
    )
}

fn subject_acquisition_cost(candidate: &PoseCandidate) -> f32 {
    let (center_x, center_y) = candidate.bbox.center();
    let center_distance = (center_x - 0.5).hypot(center_y - 0.5);
    center_distance - candidate.bbox.area() * 0.35
}

#[derive(Clone, Copy)]
struct RepSample {
    frame_id: u64,
    timestamp_ms: u64,
    primary: f32,
    secondary: f32,
    torso: f32,
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
}

struct RepEngine {
    profile: ExerciseProfile,
    state: RepStateSnapshot,
    baseline_primary: Option<f32>,
    baseline_secondary: Option<f32>,
    baseline_torso: Option<f32>,
    previous: Option<RepSample>,
    active: Option<ActiveRep>,
    next_rep_id: u64,
    gap_since_ms: Option<u64>,
}

impl RepEngine {
    fn new(profile: ExerciseProfile) -> Self {
        Self {
            profile,
            state: RepStateSnapshot::default(),
            baseline_primary: None,
            baseline_secondary: None,
            baseline_torso: None,
            previous: None,
            active: None,
            next_rep_id: 1,
            gap_since_ms: None,
        }
    }

    fn abort_active(&mut self) {
        if self.active.take().is_some() {
            self.state.partial_attempts = self.state.partial_attempts.saturating_add(1);
        }
        self.state.phase = RepPhase::Ready;
        self.state.active_rep_id = None;
        self.state.recovered_across_gap = false;
        self.gap_since_ms = None;
    }

    fn reject_active(
        &mut self,
        reason: RepEvidenceReason,
        end: Option<RepSample>,
    ) -> Option<SealedRep> {
        let active = self.active.take()?;
        let end = end.unwrap_or(active.peak);
        self.state.partial_attempts = self.state.partial_attempts.saturating_add(1);
        self.state.phase = RepPhase::Ready;
        self.state.active_rep_id = None;
        self.state.recovered_across_gap = false;
        self.gap_since_ms = None;
        let rejected = SealedRep {
            rep_id: active.rep_id,
            start_frame_id: active.start.frame_id,
            start_timestamp_ms: active.start.timestamp_ms,
            peak_frame_id: active.peak.frame_id,
            peak_timestamp_ms: active.peak.timestamp_ms,
            end_frame_id: end.frame_id,
            end_timestamp_ms: end.timestamp_ms,
            revision: 0,
            canonical_slice_hash: hash_sample(active.hash, end),
            profile_identity: self.profile.identity.clone(),
            profile_hash: self.profile.content_hash,
            profile_maturity: self.profile.maturity.as_str(),
            quality_verdict: None,
            recovered_across_gap: active.recovered_across_gap,
            disposition: RepDisposition::Rejected,
            evidence_reason: Some(reason),
        };
        // Rejected candidates are still immutable, addressable evidence. Never
        // reuse their id for the next attempt in the same set.
        self.next_rep_id = self.next_rep_id.saturating_add(1);
        Some(rejected)
    }

    fn reject_for_subject_change(&mut self) -> Option<SealedRep> {
        self.reject_active(RepEvidenceReason::SubjectChanged, self.previous)
    }

    fn process(
        &mut self,
        frame_id: u64,
        timestamp_ms: u64,
        target_state: TargetState,
        canonical: &[CanonicalLandmark],
    ) -> Vec<SealedRep> {
        if target_state != TargetState::Locked {
            return self.handle_gap(timestamp_ms, RepEvidenceReason::LongContinuityLoss);
        }
        let Some((primary, secondary, torso, repaired)) = profile_signal(&self.profile, canonical)
        else {
            return self.handle_gap(timestamp_ms, RepEvidenceReason::RequiredJointLoss);
        };
        if let Some(gap_since) = self.gap_since_ms.take() {
            if timestamp_ms.saturating_sub(gap_since) > self.profile.max_gap_ms {
                return self
                    .reject_active(RepEvidenceReason::LongContinuityLoss, self.previous)
                    .into_iter()
                    .collect();
            } else if let Some(active) = self.active.as_mut() {
                active.recovered_across_gap = true;
                self.state.recovered_across_gap = true;
                self.state.phase = if active.peak_amplitude >= self.profile.min_primary_amplitude {
                    RepPhase::Peak
                } else {
                    RepPhase::Effort
                };
            }
        }

        let sample = RepSample {
            frame_id,
            timestamp_ms,
            primary,
            secondary,
            torso,
        };
        if self.state.phase == RepPhase::Ready {
            update_ready_baseline(self.profile.direction, &mut self.baseline_primary, primary);
            update_ready_baseline(
                self.profile.direction,
                &mut self.baseline_secondary,
                secondary,
            );
            update_ready_baseline(self.profile.direction, &mut self.baseline_torso, torso);
        }
        let baseline_primary = *self.baseline_primary.get_or_insert(primary);
        let baseline_secondary = *self.baseline_secondary.get_or_insert(secondary);
        let baseline_torso = *self.baseline_torso.get_or_insert(torso);
        let direction = self.active.as_ref().map(|active| active.direction).or_else(|| {
            activation_direction(
                self.profile.direction,
                baseline_primary,
                primary,
                baseline_secondary,
                secondary,
                self.profile.start_amplitude,
            )
        });
        let (amplitude, secondary_amplitude, torso_amplitude) = direction
            .map(|direction| (
                directional_delta(direction, baseline_primary, primary),
                directional_delta(direction, baseline_secondary, secondary),
                directional_delta(direction, baseline_torso, torso),
            ))
            .unwrap_or((0.0, 0.0, 0.0));
        let mut sealed = Vec::new();

        let translation_like = self.profile.primary_signal.kind == ExerciseSignalKind::LandmarkY
            && self.profile.secondary_signal.kind == ExerciseSignalKind::LandmarkY
            && amplitude > self.profile.start_amplitude
            && torso_amplitude.abs() >= amplitude.abs() * 0.70
            && secondary_amplitude.abs() >= amplitude.abs() * 0.70
            && (torso_amplitude - amplitude).abs() <= 0.08
            && (secondary_amplitude - amplitude).abs() <= 0.08;
        if translation_like {
            let rejected = self.reject_active(RepEvidenceReason::AntiInterferenceFilter, Some(sample));
            self.previous = Some(sample);
            return rejected.into_iter().collect();
        }

        if repaired {
            if let Some(active) = self.active.as_mut() {
                active.recovered_across_gap = true;
                self.state.recovered_across_gap = true;
            }
        }

        match self.state.phase {
            RepPhase::Ready => {
                if amplitude >= self.profile.start_amplitude {
                    let start = self.previous.unwrap_or(sample);
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
                    });
                    self.state.phase = RepPhase::Effort;
                    self.state.active_rep_id = Some(rep_id);
                }
            }
            RepPhase::Effort | RepPhase::Peak => {
                let active = self.active.as_mut().expect("active effort rep");
                if timestamp_ms.saturating_sub(active.start.timestamp_ms) > self.profile.max_rep_duration_ms {
                    let rejected = self.reject_active(RepEvidenceReason::DurationExceeded, Some(sample));
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
                if active.peak_amplitude >= self.profile.min_primary_amplitude {
                    self.state.phase = RepPhase::Peak;
                    if active.peak_amplitude - amplitude >= self.profile.return_hysteresis {
                        self.state.phase = RepPhase::Return;
                    }
                } else if amplitude <= self.profile.ready_tolerance {
                    sealed.extend(self.reject_active(RepEvidenceReason::IncompleteCycle, Some(sample)));
                }
            }
            RepPhase::Return => {
                let active = self.active.as_mut().expect("active return rep");
                active.hash = hash_sample(active.hash, sample);
                if amplitude > active.peak_amplitude {
                    active.peak = sample;
                    active.peak_amplitude = amplitude;
                    self.state.phase = RepPhase::Peak;
                } else if amplitude <= seal_ready_threshold(&self.profile, active.peak_amplitude) {
                    if sample.timestamp_ms.saturating_sub(active.start.timestamp_ms) >= self.profile.min_rep_duration_ms
                        && active.peak_amplitude >= self.profile.min_primary_amplitude
                        && active.peak_secondary_amplitude >= self.profile.min_secondary_amplitude
                    {
                        let active = self.active.take().expect("sealing active rep");
                        let next_ready_primary = if self.profile.direction == MovementDirection::Auto {
                            active.start.primary
                        } else {
                            primary
                        };
                        let next_ready_secondary = if self.profile.direction == MovementDirection::Auto {
                            active.start.secondary
                        } else {
                            secondary
                        };
                        let next_ready_torso = if self.profile.direction == MovementDirection::Auto {
                            active.start.torso
                        } else {
                            torso
                        };
                        sealed.push(SealedRep {
                            rep_id: active.rep_id,
                            start_frame_id: active.start.frame_id,
                            start_timestamp_ms: active.start.timestamp_ms,
                            peak_frame_id: active.peak.frame_id,
                            peak_timestamp_ms: active.peak.timestamp_ms,
                            end_frame_id: sample.frame_id,
                            end_timestamp_ms: sample.timestamp_ms,
                            revision: 0,
                            canonical_slice_hash: hash_sample(active.hash, sample),
                            profile_identity: self.profile.identity.clone(),
                            profile_hash: self.profile.content_hash,
                            profile_maturity: self.profile.maturity.as_str(),
                            quality_verdict: None,
                            recovered_across_gap: active.recovered_across_gap,
                            disposition: if active.recovered_across_gap {
                                RepDisposition::NeedsReview
                            } else {
                                RepDisposition::Confirmed
                            },
                            evidence_reason: active.recovered_across_gap
                                .then_some(RepEvidenceReason::ShortContinuityRecovery),
                        });
                        self.next_rep_id = self.next_rep_id.saturating_add(1);
                        // Auto-oriented profiles may seal while travelling through the
                        // ready corridor. Keep the cycle's original resting anchor,
                        // rather than the mid-return sample, so the remainder of that
                        // return cannot start an opposite-direction ghost rep.
                        self.baseline_primary = Some(next_ready_primary);
                        self.baseline_secondary = Some(next_ready_secondary);
                        self.baseline_torso = Some(next_ready_torso);
                        self.state.phase = RepPhase::Ready;
                        self.state.active_rep_id = None;
                        self.state.recovered_across_gap = false;
                    } else {
                        sealed.extend(self.reject_active(RepEvidenceReason::IncompleteCycle, Some(sample)));
                    }
                }
            }
            RepPhase::Frozen => {}
        }
        self.previous = Some(sample);
        sealed
    }

    fn handle_gap(
        &mut self,
        timestamp_ms: u64,
        rejection_reason: RepEvidenceReason,
    ) -> Vec<SealedRep> {
        if self.active.is_none() {
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

fn profile_signal(
    profile: &ExerciseProfile,
    canonical: &[CanonicalLandmark],
) -> Option<(f32, f32, f32, bool)> {
    let torso_origin_y = if profile.primary_signal.kind == ExerciseSignalKind::LandmarkY
        && profile.secondary_signal.kind == ExerciseSignalKind::LandmarkY
    {
        stable_torso_origin_y(canonical)?
    } else {
        0.0
    };
    Some((
        measure_signal(&profile.primary_signal, canonical)?,
        measure_signal(&profile.secondary_signal, canonical)?,
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

fn measure_signal(signal: &ExerciseSignal, canonical: &[CanonicalLandmark]) -> Option<f32> {
    match signal.kind {
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
            let scale = torso_scale(canonical)?;
            let (left_x, left_y) = landmark_xy(first, canonical)?;
            let (right_x, right_y) = landmark_xy(second, canonical)?;
            Some(((left_x - right_x).hypot(left_y - right_y)) / scale)
        }
    }
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
    let cosine = ((left.0 * right.0 + left.1 * right.1) / (left_length * right_length))
        .clamp(-1.0, 1.0);
    Some(cosine.acos().to_degrees())
}

fn torso_scale(canonical: &[CanonicalLandmark]) -> Option<f32> {
    for [left, right] in [[11, 12], [23, 24]] {
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

fn stable_torso_origin_y(canonical: &[CanonicalLandmark]) -> Option<f32> {
    let left_hip = landmark_y(23, canonical);
    let right_hip = landmark_y(24, canonical);
    if let (Some(left), Some(right)) = (left_hip, right_hip) {
        return Some((left + right) * 0.5);
    }
    let left_shoulder = landmark_y(11, canonical);
    let right_shoulder = landmark_y(12, canonical);
    let hip = left_hip.or(right_hip);
    match (left_shoulder, right_shoulder, hip) {
        (Some(left), Some(right), Some(hip)) => Some(((left + right) * 0.5 + hip) * 0.5),
        _ => None,
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
    let increasing = increasing_primary >= start_amplitude && increasing_secondary >= secondary_start;
    let decreasing = decreasing_primary >= start_amplitude && decreasing_secondary >= secondary_start;
    match (increasing, decreasing) {
        (true, false) => Some(MovementDirection::Increasing),
        (false, true) => Some(MovementDirection::Decreasing),
        (true, true) if increasing_primary >= decreasing_primary => Some(MovementDirection::Increasing),
        (true, true) => Some(MovementDirection::Decreasing),
        (false, false) => None,
    }
}

/// All profiles close after a well-evidenced return. Auto-oriented profiles
/// retain the original ready anchor when sealing (see above), which prevents a
/// mid-return close from becoming a second, opposite-direction action.
fn seal_ready_threshold(profile: &ExerciseProfile, peak_amplitude: f32) -> f32 {
    profile.ready_tolerance.max(peak_amplitude * 0.40)
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
    rep_engine: Option<RepEngine>,
    set_gate: SetGate,
    pending_outcomes: Vec<SealedRep>,
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
        if config.subject_policy == SubjectPolicy::CentralStable
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
            rep_engine: None,
            set_gate: SetGate::replay_active(),
            pending_outcomes: Vec::new(),
        })
    }

    /// Begins one explicitly recorded training set. Live adapters call this at
    /// the same boundary as their recorder; offline replay retains its active
    /// default until it opts into the set lifecycle.
    pub fn begin_set(&mut self) {
        self.set_gate.begin();
        if let Some(rep_engine) = self.rep_engine.as_mut() {
            rep_engine.abort_active();
        }
    }

    /// Seals the lifecycle without synthesising a rep from an incomplete
    /// movement. A later `begin_set` creates a fresh arming window.
    pub fn finish_set(&mut self) {
        self.set_gate.finish();
        if let Some(rep_engine) = self.rep_engine.as_mut() {
            rep_engine.abort_active();
        }
    }

    pub fn set_state(&self) -> SetStateSnapshot {
        self.set_gate.state.clone()
    }

    pub fn install_exercise_profile(
        &mut self,
        profile: ExerciseProfile,
    ) -> Result<(), MotionError> {
        if self.accepted_frames != 0 {
            return Err(MotionError::ProfileInstallAfterFrames);
        }
        if self.rep_engine.is_some() {
            return Err(MotionError::ProfileAlreadyActive);
        }
        profile.validate()?;
        self.rep_engine = Some(RepEngine::new(profile));
        Ok(())
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
                if let Some(rep_engine) = self.rep_engine.as_mut() {
                    self.pending_outcomes.extend(rep_engine.reject_active(
                        RepEvidenceReason::LongContinuityLoss,
                        rep_engine.previous,
                    ));
                }
            }
        }

        let frame_id = lease.frame_id();
        let source_timestamp_ms = lease.timestamp_ms();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.inference.infer(&lease)
        }))
        .map_err(|_| MotionError::PanicIsolated("inference_adapter"))??;
        let mut completed_reps = std::mem::take(&mut self.pending_outcomes);
        let (target, selected) = self
            .subject_tracker
            .update(result.candidates, source_timestamp_ms);
        if self.subject_tracker.take_identity_boundary() {
            self.subject_epoch = self.subject_epoch.saturating_add(1);
            self.continuity.reset();
            if let Some(rep_engine) = self.rep_engine.as_mut() {
                completed_reps.extend(rep_engine.reject_for_subject_change());
            }
        }
        let canonical = if let Some(selected) = selected {
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
        let rep_phase = self
            .rep_engine
            .as_ref()
            .map_or(RepPhase::Ready, |engine| engine.state.phase);
        let may_process_rep = self.set_gate.advance(
            self.rep_engine.as_ref().map(|engine| &engine.profile),
            target.state,
            &canonical,
            source_timestamp_ms,
            rep_phase,
        );
        if may_process_rep {
            self.rep_engine.as_mut().map_or_else(Vec::new, |engine| {
                engine.process(frame_id, source_timestamp_ms, target.state, &canonical)
            })
        } else {
            Vec::new()
        }
        .into_iter()
        .for_each(|rep| completed_reps.push(rep));
        let rep_state = self
            .rep_engine
            .as_ref()
            .map_or_else(RepStateSnapshot::default, |engine| engine.state.clone());
        let active_profile = self.rep_engine.as_ref().map(|engine| &engine.profile);
        let packet = MotionPacket {
            lineage: PacketLineage {
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
            },
            frame_id,
            source_timestamp_ms,
            subject_epoch: self.subject_epoch,
            target,
            canonical,
            set_state: self.set_gate.state.clone(),
            rep_state,
            completed_reps,
        };
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.output.publish(packet)))
            .map_err(|_| MotionError::PanicIsolated("output_adapter"))??;

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
        self.subject_epoch = self.subject_epoch.saturating_add(1);
        self.continuity.reset();
        if let Some(rep_engine) = self.rep_engine.as_mut() {
            self.pending_outcomes
                .extend(rep_engine.reject_for_subject_change());
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

const MEASURED_MIN_SCORE: f32 = 0.5;
const WEAK_MIN_SCORE: f32 = 0.2;
const MIN_BASELINE_SAMPLES: usize = 5;
const BASELINE_WINDOW: usize = 15;
const MAX_RAW_BONE_RESIDUAL: f32 = 0.45;
const MAX_PREDICTION_MS: u64 = 150;
const SKELETON_BONES: [(usize, usize); 12] = [
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
    width: f32,
    height: f32,
    motion: HashMap<usize, MotionState>,
    previous_elbows: HashMap<usize, Point>,
    bone_lengths: HashMap<(usize, usize), VecDeque<f32>>,
}

impl ContinuityEngine {
    fn new(mode: ContinuityMode, width: u32, height: u32) -> Self {
        Self {
            mode,
            width: width as f32,
            height: height as f32,
            motion: HashMap::new(),
            previous_elbows: HashMap::new(),
            bone_lengths: HashMap::new(),
        }
    }

    fn process(
        &mut self,
        observations: &[PoseObservation],
        timestamp_ms: u64,
    ) -> Vec<CanonicalLandmark> {
        if self.mode == ContinuityMode::Raw {
            return observations.iter().copied().map(raw_canonical).collect();
        }

        let rejected = self.find_outliers(observations, timestamp_ms);
        self.update_bone_baselines(observations, &rejected);
        let mut fused = HashMap::<usize, CanonicalLandmark>::new();
        for (shoulder_index, elbow_index, wrist_index) in [(11, 13, 15), (12, 14, 16)] {
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
                && shoulder.visibility >= MEASURED_MIN_SCORE
                && wrist.visibility >= MEASURED_MIN_SCORE;
            if anchors_reliable
                && !rejected.contains(&elbow_index)
                && elbow.visibility >= MEASURED_MIN_SCORE
            {
                self.previous_elbows
                    .insert(elbow_index, self.to_pixels(elbow));
                continue;
            }
            if !anchors_reliable
                || rejected.contains(&elbow_index)
                || elbow.visibility < WEAK_MIN_SCORE
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
                + (MEASURED_MIN_SCORE - elbow.visibility) * 0.025;
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
                    canonical_confidence: confidence.clamp(MEASURED_MIN_SCORE, 1.0),
                    uncertainty: Some(uncertainty),
                    source: LandmarkSource::Fused,
                    renderable: true,
                    reason: Some(ContinuityReason::WeakObservationBoneFusion),
                },
            );
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
                    && observation.visibility >= MEASURED_MIN_SCORE
                {
                    let landmark = raw_canonical(observation);
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
                if !observation.is_finite() || observation.visibility < MEASURED_MIN_SCORE {
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
                let has_coherent_neighbor = SKELETON_BONES.iter().any(|&(from, to)| {
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
        SKELETON_BONES
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
        for (from, to) in SKELETON_BONES {
            let (Some(left), Some(right)) = (
                observations.get(from).copied(),
                observations.get(to).copied(),
            ) else {
                continue;
            };
            if rejected.contains(&from)
                || rejected.contains(&to)
                || !left.is_finite()
                || !right.is_finite()
                || left.visibility < MEASURED_MIN_SCORE
                || right.visibility < MEASURED_MIN_SCORE
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

fn raw_canonical(observation: PoseObservation) -> CanonicalLandmark {
    if !observation.is_finite() {
        return CanonicalLandmark::unknown(0.0, None);
    }
    CanonicalLandmark {
        x: Some(observation.x),
        y: Some(observation.y),
        z: Some(observation.z),
        observation_score: observation.visibility,
        canonical_confidence: observation.visibility,
        uncertainty: None,
        source: LandmarkSource::Measured,
        renderable: observation.visibility >= MEASURED_MIN_SCORE,
        reason: None,
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
pub const PROFILE_SIGNAL_REFERENCE_FEATURES: [&str; 2] = [
    "primarySignalPhase",
    "secondarySignalPhase",
];

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
                .and_then(|frame| profile_signal(profile, &frame.canonical).map(|(primary, secondary, _, _)| {
                    let primary_confidence = signal_confidence(&profile.primary_signal, &frame.canonical);
                    let secondary_confidence = signal_confidence(&profile.secondary_signal, &frame.canonical);
                    (vec![Some(primary), Some(secondary)], vec![primary_confidence, secondary_confidence])
                }))
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
            node.values[feature_index] = node.values[feature_index]
                .map(|value| round5((value - start) / amplitude));
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
#[cfg(any(target_arch = "wasm32", test))]
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
            assert_eq!(supported_reference_exercise_profile_identity(&spoofed), None);
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
