//! Causal barbell-bench phase recognition from subject-associated shaft tracks.
//!
//! This module owns the temporal state and validated front-bench thresholds.
//! Pose may corroborate a turnaround, but cannot move an equipment boundary.

use std::collections::VecDeque;

use crate::{
    EquipmentFrameEvidence, EquipmentKind, EquipmentSource, LocalMotionCoordinateEvidence,
    MovementDirection, NormalizedRepEndpointEvidence, RepDisposition, RepPhase, SignalMeasurement,
    rigid_bar_track_supports_turnaround,
};

const ENTER_DELTA: f32 = 32.0 / 640.0;
const RETURN_DELTA: f32 = 14.0 / 640.0;
const TURNAROUND_CONFIRM_DELTA: f32 = 2.0 / 640.0;
const REVERSE_STEP_EPSILON: f32 = 0.5 / 640.0;
const TURNAROUND_CONFIRM_SAMPLES: u8 = 2;
const MINIMUM_EFFORT_DURATION_MS: u64 = 450;
const MAXIMUM_EFFORT_DURATION_MS: u64 = 6_000;
// A front-bench rep must move the shaft through at least 8% of image height.
// The six-video client corpus contains coherent 7.3% setup/rack oscillations;
// accepting those lets setup establish a false set signature. The smallest
// reviewed work rep in the same raw client stream is 9.5%, leaving a narrow
// but explicit uncertainty corridor for review rather than counting setup.
const MINIMUM_AMPLITUDE: f32 = 0.08;
// A completed press returns to the same lockout corridor. Racking or leaving
// the bench can traverse a rep-like arc yet finish at a materially different
// height; that is not a closed task cycle and must never be counted.
const MAXIMUM_ENDPOINT_DRIFT: f32 = 0.04;
const MINIMUM_READY_SAMPLES: usize = 10;
const MAXIMUM_READY_HISTORY: usize = 80;
const START_LOOKBACK_MS: u64 = 1_800;
const READY_ENDPOINT_DWELL_MS: u64 = 300;
const TURNAROUND_PLATEAU_BAND: f32 = 10.0 / 640.0;
const TURNAROUND_PLATEAU_MAX_GAP_MS: u64 = 350;
const LOW_EQUIPMENT_COVERAGE: f32 = 0.70;
const SIGNATURE_MAX_GAP_MS: u64 = 4_000;
const SIGNATURE_MIN_ESTABLISH_DURATION_MS: u64 = 900;
const FIRST_CANDIDATE_ONSET_LOOKBACK_MS: u64 = 400;
const CONSECUTIVE_REP_BOUNDARY_SEPARATION_MS: u64 = 100;
const SLOW_ONSET_MINIMUM_CONFIRMATION_LAG_MS: u64 = 500;
const SLOW_ONSET_MAXIMUM_PREVIOUS_ENDPOINT_GAP_MS: u64 = 250;
const START_UNCERTAINTY_MIN_MS: u64 = 500;
const START_UNCERTAINTY_MAX_MS: u64 = 1_800;
// A fatigued bench set can legitimately lose roughly 40% of visible ROM as
// touch point or lockout height changes. The absolute 8%-of-frame gate removes
// small setup cycles first; duration and group establishment still reject
// rack paths, so this relative corridor can preserve late-set work reps.
const SIGNATURE_MIN_SCALE_RATIO: f32 = 0.58;
const SIGNATURE_MAX_AMPLITUDE_RATIO: f32 = 1.58;
const SIGNATURE_MIN_DURATION_RATIO: f32 = 0.55;
// Once a subject-associated shaft has already opened a rep, a current raw
// detector/geometry measurement may carry phase through a brief pose identity
// switch. It may never start a rep, and its step must remain continuous with
// the already calibrated shaft path. Public equipment remains cannot-judge;
// these samples count as association coverage loss.

#[derive(Clone, Copy, Debug)]
struct BarbellPhaseThresholds {
    enter_delta: f32,
    return_delta: f32,
    turnaround_confirm_delta: f32,
    reverse_step_epsilon: f32,
    minimum_effort_duration_ms: u64,
    maximum_effort_duration_ms: u64,
    minimum_amplitude: f32,
    maximum_endpoint_drift: f32,
}

impl BarbellPhaseThresholds {
    const fn legacy_bench() -> Self {
        Self {
            enter_delta: ENTER_DELTA,
            return_delta: RETURN_DELTA,
            turnaround_confirm_delta: TURNAROUND_CONFIRM_DELTA,
            reverse_step_epsilon: REVERSE_STEP_EPSILON,
            minimum_effort_duration_ms: MINIMUM_EFFORT_DURATION_MS,
            maximum_effort_duration_ms: MAXIMUM_EFFORT_DURATION_MS,
            minimum_amplitude: MINIMUM_AMPLITUDE,
            maximum_endpoint_drift: MAXIMUM_ENDPOINT_DRIFT,
        }
    }

    fn local(
        enter_delta: f32,
        minimum_amplitude: f32,
        return_delta: f32,
        maximum_endpoint_drift: f32,
        minimum_effort_duration_ms: u64,
        maximum_effort_duration_ms: u64,
    ) -> Self {
        Self {
            enter_delta,
            return_delta,
            turnaround_confirm_delta: (enter_delta * 0.08).max(0.004),
            reverse_step_epsilon: (enter_delta * 0.02).max(0.001),
            minimum_effort_duration_ms,
            maximum_effort_duration_ms,
            minimum_amplitude,
            maximum_endpoint_drift,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct BarbellFrameSample {
    pub frame_id: u64,
    pub timestamp_ms: u64,
    pub position: f32,
    pub confidence: f32,
    pub pose_signal: Option<f32>,
}

#[derive(Clone, Copy, Debug)]
struct PoseExtreme {
    timestamp_ms: u64,
    value: f32,
}

#[derive(Clone, Debug)]
struct ActiveBarbellRep {
    rep_id: u64,
    start: BarbellFrameSample,
    reported_start: BarbellFrameSample,
    activation: BarbellFrameSample,
    peak: BarbellFrameSample,
    turnaround_confirmed_at_ms: Option<u64>,
    previous_position: f32,
    reverse_sample_count: u8,
    observed_samples: u32,
    total_samples: u32,
    missed_samples: u32,
    pose_extreme: Option<PoseExtreme>,
    pending_return: Option<PendingBarbellReturn>,
    samples: VecDeque<BarbellFrameSample>,
    hash: u64,
    start_coordinate: Option<LocalMotionCoordinateEvidence>,
    coordinate_history: VecDeque<LocalMotionCoordinateEvidence>,
}

#[derive(Clone, Debug)]
struct PendingBarbellReturn {
    since_ms: u64,
    best: BarbellFrameSample,
    ready_samples: VecDeque<BarbellFrameSample>,
}

#[derive(Clone, Debug)]
pub(crate) struct BarbellRepCandidate {
    pub rep_id: u64,
    pub start_frame_id: u64,
    pub start_timestamp_ms: u64,
    activation_frame_id: u64,
    activation_timestamp_ms: u64,
    pub peak_frame_id: u64,
    pub peak_timestamp_ms: u64,
    pub turnaround_confirmed_timestamp_ms: u64,
    pub end_frame_id: u64,
    pub end_timestamp_ms: u64,
    pub equipment_coverage: f32,
    pub amplitude: f32,
    pub signature_duration_ms: u64,
    pub pose_peak_timestamp_ms: Option<u64>,
    pub local_trajectory_channel_conflict: bool,
    pub path_hash: u64,
    pub disposition: RepDisposition,
    pub normalized_endpoints: Option<NormalizedRepEndpointEvidence>,
}

#[derive(Clone, Copy, Debug)]
struct BarbellSetSignature {
    amplitude: f32,
    duration_ms: u64,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct BarbellPhaseSnapshot {
    pub phase: RepPhase,
    pub active_rep_id: Option<u64>,
    pub partial_attempts: u64,
}

pub(crate) struct BarbellBenchPhaseEngine {
    phase: RepPhase,
    ready_history: VecDeque<BarbellFrameSample>,
    boundary_history: VecDeque<BarbellFrameSample>,
    coordinate_history: VecDeque<LocalMotionCoordinateEvidence>,
    baseline: Option<f32>,
    active: Option<ActiveBarbellRep>,
    next_rep_id: u64,
    partial_attempts: u64,
    pending_signature_candidate: Option<BarbellRepCandidate>,
    set_signature: Option<BarbellSetSignature>,
    last_candidate_end_ms: Option<u64>,
    confirmed_group_established: bool,
    use_local_coordinate: bool,
    local_direction: MovementDirection,
    thresholds: BarbellPhaseThresholds,
}

impl BarbellBenchPhaseEngine {
    pub(crate) fn new() -> Self {
        Self::with_local_coordinate(
            false,
            MovementDirection::Decreasing,
            BarbellPhaseThresholds::legacy_bench(),
        )
    }

    pub(crate) fn local_bench(
        enter_delta: f32,
        minimum_amplitude: f32,
        return_delta: f32,
        maximum_endpoint_drift: f32,
        minimum_effort_duration_ms: u64,
        maximum_effort_duration_ms: u64,
    ) -> Self {
        Self::with_local_coordinate(
            true,
            MovementDirection::Increasing,
            BarbellPhaseThresholds::local(
                enter_delta,
                minimum_amplitude,
                return_delta,
                maximum_endpoint_drift,
                minimum_effort_duration_ms,
                maximum_effort_duration_ms,
            ),
        )
    }

    pub(crate) fn local_shoulder_press(
        enter_delta: f32,
        minimum_amplitude: f32,
        return_delta: f32,
        maximum_endpoint_drift: f32,
        minimum_effort_duration_ms: u64,
        maximum_effort_duration_ms: u64,
    ) -> Self {
        // The coordinate estimator gives shoulder press its own upward
        // preparation-to-effort prior. This graph owns separate thresholds
        // while consuming the resulting positive local progress.
        Self::with_local_coordinate(
            true,
            MovementDirection::Increasing,
            BarbellPhaseThresholds::local(
                enter_delta,
                minimum_amplitude,
                return_delta,
                maximum_endpoint_drift,
                minimum_effort_duration_ms,
                maximum_effort_duration_ms,
            ),
        )
    }

    fn with_local_coordinate(
        use_local_coordinate: bool,
        local_direction: MovementDirection,
        thresholds: BarbellPhaseThresholds,
    ) -> Self {
        Self {
            phase: RepPhase::Ready,
            ready_history: VecDeque::new(),
            boundary_history: VecDeque::new(),
            coordinate_history: VecDeque::new(),
            baseline: None,
            active: None,
            next_rep_id: 1,
            partial_attempts: 0,
            pending_signature_candidate: None,
            set_signature: None,
            last_candidate_end_ms: None,
            confirmed_group_established: false,
            use_local_coordinate,
            local_direction,
            thresholds,
        }
    }

    pub(crate) fn begin_set(&mut self) {
        self.abort_active();
        self.ready_history.clear();
        self.boundary_history.clear();
        self.coordinate_history.clear();
        self.baseline = None;
        self.pending_signature_candidate = None;
        self.set_signature = None;
        self.last_candidate_end_ms = None;
        self.confirmed_group_established = false;
    }

    pub(crate) fn finish_set(&mut self) -> Vec<BarbellRepCandidate> {
        self.abort_active();
        let Some(mut pending) = self.pending_signature_candidate.take() else {
            return Vec::new();
        };
        // A recording containing exactly one coherent cycle is a legitimate
        // one-rep set. Before the recording boundary there is no causal
        // evidence that distinguishes it from setup, so it is finalized only
        // when the host explicitly closes the set.
        pending.disposition = if self.confirmed_group_established {
            RepDisposition::Rejected
        } else if pending.disposition == RepDisposition::Confirmed {
            RepDisposition::Confirmed
        } else {
            // Finishing a legitimate one-rep set must not erase uncertainty
            // already attached by the causal coordinate/evidence channels.
            pending.disposition
        };
        vec![pending]
    }

    pub(crate) fn abort_active(&mut self) {
        if self.active.take().is_some() {
            self.partial_attempts = self.partial_attempts.saturating_add(1);
        }
        self.phase = RepPhase::Ready;
    }

    pub(crate) fn snapshot(&self) -> BarbellPhaseSnapshot {
        BarbellPhaseSnapshot {
            phase: self.phase,
            active_rep_id: self.active.as_ref().map(|active| active.rep_id),
            partial_attempts: self.partial_attempts,
        }
    }

    pub(crate) fn prime_boundary(
        &mut self,
        frame_id: u64,
        timestamp_ms: u64,
        equipment: &EquipmentFrameEvidence,
        pose_signal: Option<f32>,
        profile_signal: Option<SignalMeasurement>,
        local_coordinate: Option<&LocalMotionCoordinateEvidence>,
    ) {
        let selected = if self.use_local_coordinate {
            self.selected_position(equipment, profile_signal)
        } else {
            selected_bar_position_for_priming(equipment)
        };
        let Some((position, confidence)) = selected else {
            return;
        };
        let sample = BarbellFrameSample {
            frame_id,
            timestamp_ms,
            position,
            confidence,
            pose_signal,
        };
        self.record_boundary_sample(sample);
        self.record_coordinate(local_coordinate);
        let stable_ready = self.baseline.is_none_or(|baseline| {
            (sample.position - baseline).abs() <= self.thresholds.enter_delta * 0.30
        });
        if self.phase == RepPhase::Ready && stable_ready {
            self.prime_ready_sample(sample);
        }
    }

    pub(crate) fn process(
        &mut self,
        frame_id: u64,
        timestamp_ms: u64,
        equipment: &EquipmentFrameEvidence,
        pose_signal: Option<f32>,
        pose_direction: MovementDirection,
        profile_signal: Option<SignalMeasurement>,
        local_coordinate: Option<&LocalMotionCoordinateEvidence>,
    ) -> Vec<BarbellRepCandidate> {
        let mut emitted = Vec::new();
        let associated = self.selected_position(equipment, profile_signal);
        if let Some(active) = self.active.as_mut() {
            active.total_samples = active.total_samples.saturating_add(1);
            if associated.is_none() {
                active.missed_samples = active.missed_samples.saturating_add(1);
            }
        }
        let Some((position, confidence)) = associated else {
            return emitted;
        };
        let sample = BarbellFrameSample {
            frame_id,
            timestamp_ms,
            position,
            confidence,
            pose_signal,
        };
        self.record_boundary_sample(sample);
        self.record_coordinate(local_coordinate);
        match self.phase {
            RepPhase::Ready => self.update_ready(sample, local_coordinate),
            RepPhase::Effort | RepPhase::Peak | RepPhase::Return => {
                if let Some(candidate) =
                    self.update_effort(sample, pose_direction, local_coordinate)
                {
                    emitted.extend(self.accept_candidate(candidate, timestamp_ms));
                }
            }
            RepPhase::Frozen => self.phase = RepPhase::Ready,
        }
        emitted
    }

    fn update_ready(
        &mut self,
        sample: BarbellFrameSample,
        local_coordinate: Option<&LocalMotionCoordinateEvidence>,
    ) {
        self.prime_ready_sample(sample);
        let Some(baseline) = self.baseline else {
            return;
        };
        if self.ready_history.len() < MINIMUM_READY_SAMPLES
            || sample.position < baseline + self.thresholds.enter_delta
        {
            return;
        }
        let pose_extreme = sample.pose_signal.map(|value| PoseExtreme {
            timestamp_ms: sample.timestamp_ms,
            value,
        });
        let start = backtracked_ready_start(
            &self.ready_history,
            sample.timestamp_ms,
            baseline,
            self.thresholds.enter_delta,
        )
        .unwrap_or(sample);
        let reported_start = backtracked_ready_start(
            &self.boundary_history,
            sample.timestamp_ms,
            baseline,
            self.thresholds.enter_delta,
        )
        .unwrap_or(start);
        self.active = Some(ActiveBarbellRep {
            rep_id: self.next_rep_id,
            start,
            reported_start,
            activation: sample,
            peak: sample,
            turnaround_confirmed_at_ms: None,
            previous_position: sample.position,
            reverse_sample_count: 0,
            observed_samples: 1,
            total_samples: 1,
            missed_samples: 0,
            pose_extreme,
            pending_return: None,
            samples: VecDeque::from([sample]),
            hash: hash_bar_sample(FNV_OFFSET, sample),
            start_coordinate: nearest_coordinate(
                &self.coordinate_history,
                reported_start.timestamp_ms,
            )
            .or_else(|| local_coordinate.cloned()),
            coordinate_history: local_coordinate.cloned().into_iter().collect(),
        });
        self.next_rep_id = self.next_rep_id.saturating_add(1);
        self.phase = RepPhase::Effort;
    }

    fn prime_ready_sample(&mut self, sample: BarbellFrameSample) {
        self.ready_history.push_back(sample);
        while self.ready_history.len() > MAXIMUM_READY_HISTORY {
            self.ready_history.pop_front();
        }
        let mut ordered = self
            .ready_history
            .iter()
            .map(|sample| sample.position)
            .collect::<Vec<_>>();
        ordered.sort_by(f32::total_cmp);
        let lower_count = (ordered.len() / 2).max(3).min(ordered.len());
        self.baseline = median(&ordered[..lower_count]);
    }

    fn record_boundary_sample(&mut self, sample: BarbellFrameSample) {
        if self
            .boundary_history
            .back()
            .is_some_and(|last| last.timestamp_ms == sample.timestamp_ms)
        {
            return;
        }
        self.boundary_history.push_back(sample);
        while self.boundary_history.len() > MAXIMUM_READY_HISTORY {
            self.boundary_history.pop_front();
        }
    }

    fn record_coordinate(&mut self, coordinate: Option<&LocalMotionCoordinateEvidence>) {
        if !self.use_local_coordinate {
            return;
        }
        let Some(coordinate) = coordinate else {
            return;
        };
        let Some(timestamp_ms) = coordinate.source_timestamp_ms else {
            return;
        };
        if self
            .coordinate_history
            .back()
            .and_then(|sample| sample.source_timestamp_ms)
            == Some(timestamp_ms)
        {
            return;
        }
        self.coordinate_history.push_back(coordinate.clone());
        while self.coordinate_history.len() > MAXIMUM_READY_HISTORY {
            self.coordinate_history.pop_front();
        }
    }

    fn update_effort(
        &mut self,
        sample: BarbellFrameSample,
        pose_direction: MovementDirection,
        local_coordinate: Option<&LocalMotionCoordinateEvidence>,
    ) -> Option<BarbellRepCandidate> {
        let baseline = self.baseline?;
        let active = self.active.as_mut()?;
        active.observed_samples = active.observed_samples.saturating_add(1);
        active.samples.push_back(sample);
        if self.use_local_coordinate
            && let Some(coordinate) = local_coordinate
        {
            active.coordinate_history.push_back(coordinate.clone());
            while active.coordinate_history.len() > MAXIMUM_READY_HISTORY {
                active.coordinate_history.pop_front();
            }
        }
        while active.samples.len() > MAXIMUM_READY_HISTORY {
            active.samples.pop_front();
        }
        active.hash = hash_bar_sample(active.hash, sample);
        if active.turnaround_confirmed_at_ms.is_none()
            && let Some(value) = sample.pose_signal
        {
            update_pose_extreme(
                &mut active.pose_extreme,
                sample.timestamp_ms,
                value,
                pose_direction,
            );
        }
        if sample.position > active.peak.position {
            active.peak = sample;
            active.reverse_sample_count = 0;
            active.pending_return = None;
            self.phase = RepPhase::Effort;
        } else if active.previous_position - sample.position >= self.thresholds.reverse_step_epsilon
        {
            active.reverse_sample_count = active.reverse_sample_count.saturating_add(1);
        } else {
            active.reverse_sample_count = 0;
        }
        if active.turnaround_confirmed_at_ms.is_none()
            && sample.timestamp_ms > active.peak.timestamp_ms
            && active.reverse_sample_count >= TURNAROUND_CONFIRM_SAMPLES
            && active.peak.position - sample.position >= self.thresholds.turnaround_confirm_delta
        {
            active.turnaround_confirmed_at_ms = Some(sample.timestamp_ms);
            self.phase = RepPhase::Return;
        }
        active.previous_position = sample.position;
        let duration_ms = sample
            .timestamp_ms
            .saturating_sub(active.start.timestamp_ms);
        let returned = active.turnaround_confirmed_at_ms.is_some()
            && sample.position <= baseline + self.thresholds.return_delta;
        let timed_out = duration_ms > self.thresholds.maximum_effort_duration_ms;
        if returned {
            let pending = active
                .pending_return
                .get_or_insert_with(|| PendingBarbellReturn {
                    since_ms: sample.timestamp_ms,
                    best: sample,
                    ready_samples: VecDeque::new(),
                });
            pending.ready_samples.push_back(sample);
            while pending.ready_samples.len() > MAXIMUM_READY_HISTORY {
                pending.ready_samples.pop_front();
            }
            if sample.position <= pending.best.position + self.thresholds.reverse_step_epsilon {
                pending.best = sample;
            }
            if sample.timestamp_ms.saturating_sub(pending.since_ms) < READY_ENDPOINT_DWELL_MS {
                return None;
            }
        } else if !timed_out {
            active.pending_return = None;
            return None;
        }
        let end = active
            .pending_return
            .as_ref()
            .map_or(sample, |pending| pending.best);
        let amplitude = active.peak.position - baseline;
        let valid = active.pending_return.is_some()
            && end.timestamp_ms.saturating_sub(active.start.timestamp_ms)
                >= self.thresholds.minimum_effort_duration_ms
            && amplitude >= self.thresholds.minimum_amplitude
            && (end.position - baseline).abs() <= self.thresholds.maximum_endpoint_drift;
        let active = self.active.take().expect("active barbell rep disappeared");
        self.phase = RepPhase::Ready;
        self.ready_history = active
            .pending_return
            .as_ref()
            .map(|pending| pending.ready_samples.clone())
            .unwrap_or_else(|| VecDeque::from([end]));
        self.baseline = Some(end.position);
        if !valid {
            self.partial_attempts = self.partial_attempts.saturating_add(1);
            return None;
        }
        let reported_peak = turnaround_plateau_midpoint(&active.samples, active.peak);
        let start_coordinate = active.start_coordinate;
        let peak_coordinate =
            nearest_coordinate(&active.coordinate_history, reported_peak.timestamp_ms);
        let end_coordinate = nearest_coordinate(&active.coordinate_history, end.timestamp_ms)
            .or_else(|| local_coordinate.cloned());
        let equipment_coverage =
            1.0 - active.missed_samples as f32 / active.total_samples.max(1) as f32;
        let local_trajectory_channel_conflict =
            start_coordinate.as_ref().is_some_and(|coordinate| {
                coordinate.channel_agreement == crate::LocalChannelAgreement::Conflict
            }) || active.coordinate_history.iter().any(|coordinate| {
                coordinate.channel_agreement == crate::LocalChannelAgreement::Conflict
            });
        Some(BarbellRepCandidate {
            rep_id: active.rep_id,
            start_frame_id: active.reported_start.frame_id,
            start_timestamp_ms: active.reported_start.timestamp_ms,
            activation_frame_id: active.activation.frame_id,
            activation_timestamp_ms: active.activation.timestamp_ms,
            peak_frame_id: reported_peak.frame_id,
            peak_timestamp_ms: reported_peak.timestamp_ms,
            turnaround_confirmed_timestamp_ms: active
                .turnaround_confirmed_at_ms
                .unwrap_or(end.timestamp_ms)
                .max(reported_peak.timestamp_ms),
            end_frame_id: end.frame_id,
            end_timestamp_ms: end.timestamp_ms,
            equipment_coverage,
            amplitude,
            signature_duration_ms: end.timestamp_ms.saturating_sub(active.start.timestamp_ms),
            pose_peak_timestamp_ms: active.pose_extreme.map(|extreme| extreme.timestamp_ms),
            local_trajectory_channel_conflict,
            path_hash: active.hash,
            disposition: if equipment_coverage < LOW_EQUIPMENT_COVERAGE
                || (self.use_local_coordinate
                    && start_coordinate.as_ref().is_some_and(|coordinate| {
                        coordinate.state != crate::LocalCoordinateState::Frozen
                    })) {
                RepDisposition::NeedsReview
            } else {
                RepDisposition::Confirmed
            },
            normalized_endpoints: match (start_coordinate, peak_coordinate, end_coordinate) {
                (Some(start_anchor), Some(primary_turnaround), Some(end_return)) => {
                    Some(NormalizedRepEndpointEvidence {
                        coordinate_frame_id: start_anchor.coordinate_frame_id,
                        start_anchor,
                        primary_turnaround,
                        end_return,
                        anatomical_left_turnaround_timestamp_ms: None,
                        anatomical_right_turnaround_timestamp_ms: None,
                    })
                }
                _ => None,
            },
        })
    }

    fn selected_position(
        &self,
        equipment: &EquipmentFrameEvidence,
        profile_signal: Option<SignalMeasurement>,
    ) -> Option<(f32, f32)> {
        if !self.use_local_coordinate {
            return selected_bar_position(equipment);
        }
        equipment
            .tracks
            .iter()
            .any(rigid_bar_track_supports_turnaround)
            .then_some(())?;
        let measurement = profile_signal?;
        let mut position = measurement.value;
        if self.local_direction == MovementDirection::Decreasing {
            position = -position;
        }
        Some((position, measurement.confidence))
    }

    fn accept_candidate(
        &mut self,
        mut candidate: BarbellRepCandidate,
        _emitted_at_ms: u64,
    ) -> Vec<BarbellRepCandidate> {
        let gap_ms = self.last_candidate_end_ms.map_or(0, |end_ms| {
            candidate.start_timestamp_ms.saturating_sub(end_ms)
        });
        if let Some(previous_end_ms) = self.last_candidate_end_ms
            && gap_ms <= SLOW_ONSET_MAXIMUM_PREVIOUS_ENDPOINT_GAP_MS
            && candidate
                .activation_timestamp_ms
                .saturating_sub(previous_end_ms)
                >= SLOW_ONSET_MINIMUM_CONFIRMATION_LAG_MS
        {
            // The prior return endpoint and 5%-of-frame confirmation bound a
            // gradual next onset. Their causal midpoint minimizes worst-case
            // boundary error without consulting future frames or labels.
            let interval_ms = candidate
                .activation_timestamp_ms
                .saturating_sub(previous_end_ms);
            let target_ms = previous_end_ms.saturating_add(interval_ms / 2);
            if let Some(sample) = nearest_sample(&self.boundary_history, target_ms) {
                candidate.start_frame_id = sample.frame_id;
                candidate.start_timestamp_ms = sample.timestamp_ms;
            } else {
                candidate.start_frame_id = candidate.activation_frame_id;
                candidate.start_timestamp_ms = candidate.activation_timestamp_ms;
            }
        } else if let Some(previous_end_ms) = self.last_candidate_end_ms
            && (START_UNCERTAINTY_MIN_MS..=START_UNCERTAINTY_MAX_MS).contains(&gap_ms)
        {
            // The prior return endpoint and the threshold-confirmed descent
            // bound the causal onset. With no future or label evidence, the
            // midpoint minimizes the maximum timestamp error. Snap to an
            // actually observed frame so frame/timestamp lineage stays real.
            let target_ms = previous_end_ms.saturating_add(gap_ms / 2);
            if let Some(sample) = nearest_sample(&self.boundary_history, target_ms) {
                candidate.start_frame_id = sample.frame_id;
                candidate.start_timestamp_ms = sample.timestamp_ms;
            }
        } else if let Some(previous_end_ms) = self.last_candidate_end_ms
            && gap_ms <= CONSECUTIVE_REP_BOUNDARY_SEPARATION_MS
        {
            // The previous ready endpoint may be reused as the next start by
            // boundary backtracking. Preserve a distinct causal cycle edge by
            // advancing to the first observed frame at least 100 ms later.
            let target_ms = previous_end_ms.saturating_add(CONSECUTIVE_REP_BOUNDARY_SEPARATION_MS);
            if let Some(sample) = nearest_sample(&self.boundary_history, target_ms) {
                candidate.start_frame_id = sample.frame_id;
                candidate.start_timestamp_ms = sample.timestamp_ms;
            }
        } else if self.last_candidate_end_ms.is_none() {
            // A preset set begins while the bar is already stable at lockout.
            // The first 5%-of-frame displacement is only a causal confirmation
            // that eccentric motion started, not its onset. Report a bounded
            // 400 ms lookback from an actually observed frame. Later reps use
            // the prior return endpoint as their stronger causal boundary.
            let target_ms = candidate
                .start_timestamp_ms
                .saturating_sub(FIRST_CANDIDATE_ONSET_LOOKBACK_MS);
            if let Some(sample) = nearest_sample(&self.boundary_history, target_ms) {
                candidate.start_frame_id = sample.frame_id;
                candidate.start_timestamp_ms = sample.timestamp_ms;
            }
        }
        self.last_candidate_end_ms = Some(candidate.end_timestamp_ms);
        if let Some(signature) = self.set_signature {
            let mut candidate = candidate;
            if signature_matches(signature, &candidate) {
                self.set_signature = Some(update_signature(signature, &candidate));
            } else if gap_ms > SIGNATURE_MAX_GAP_MS {
                // A long break followed by a different path starts a new
                // candidate group. This allows another real cluster after a
                // rest, while a lone post-set rack motion stays unconfirmed.
                self.set_signature = None;
                self.pending_signature_candidate = Some(candidate);
                return Vec::new();
            } else {
                candidate.disposition = RepDisposition::Rejected;
            }
            return vec![candidate];
        }

        if candidate.signature_duration_ms < SIGNATURE_MIN_ESTABLISH_DURATION_MS {
            let mut candidate = candidate;
            candidate.disposition = RepDisposition::Rejected;
            return vec![candidate];
        }

        let Some(mut pending) = self.pending_signature_candidate.take() else {
            self.pending_signature_candidate = Some(candidate);
            return Vec::new();
        };
        if gap_ms <= SIGNATURE_MAX_GAP_MS && signature_matches(signature_from(&pending), &candidate)
        {
            let signature = update_signature(signature_from(&pending), &candidate);
            self.set_signature = Some(signature);
            self.confirmed_group_established = true;
            vec![pending, candidate]
        } else {
            pending.disposition = RepDisposition::Rejected;
            self.pending_signature_candidate = Some(candidate);
            vec![pending]
        }
    }
}

fn signature_from(candidate: &BarbellRepCandidate) -> BarbellSetSignature {
    BarbellSetSignature {
        amplitude: candidate.amplitude,
        duration_ms: candidate.signature_duration_ms,
    }
}

fn signature_matches(signature: BarbellSetSignature, candidate: &BarbellRepCandidate) -> bool {
    let candidate_signature = signature_from(candidate);
    candidate_signature.amplitude >= signature.amplitude * SIGNATURE_MIN_SCALE_RATIO
        && candidate_signature.amplitude <= signature.amplitude * SIGNATURE_MAX_AMPLITUDE_RATIO
        && scale_ratio(
            signature.duration_ms as f32,
            candidate_signature.duration_ms as f32,
        ) >= SIGNATURE_MIN_DURATION_RATIO
}

fn update_signature(
    signature: BarbellSetSignature,
    candidate: &BarbellRepCandidate,
) -> BarbellSetSignature {
    let candidate = signature_from(candidate);
    BarbellSetSignature {
        // Keep adaptation deliberately slow. Fatigue may change tempo, while
        // a rack/unrack path should not redefine a signature in one sample.
        amplitude: signature.amplitude * 0.80 + candidate.amplitude * 0.20,
        duration_ms: ((signature.duration_ms as f32 * 0.80) + (candidate.duration_ms as f32 * 0.20))
            .round() as u64,
    }
}

fn scale_ratio(left: f32, right: f32) -> f32 {
    let maximum = left.max(right);
    if maximum <= f32::EPSILON {
        0.0
    } else {
        left.min(right) / maximum
    }
}

fn nearest_sample(
    history: &VecDeque<BarbellFrameSample>,
    target_ms: u64,
) -> Option<BarbellFrameSample> {
    history
        .iter()
        .copied()
        .min_by_key(|sample| sample.timestamp_ms.abs_diff(target_ms))
}

fn nearest_coordinate(
    history: &VecDeque<LocalMotionCoordinateEvidence>,
    target_ms: u64,
) -> Option<LocalMotionCoordinateEvidence> {
    history
        .iter()
        .filter_map(|coordinate| {
            coordinate
                .source_timestamp_ms
                .map(|timestamp_ms| (timestamp_ms.abs_diff(target_ms), coordinate))
        })
        .min_by_key(|(distance, _)| *distance)
        .map(|(_, coordinate)| coordinate.clone())
}

fn turnaround_plateau_midpoint(
    samples: &VecDeque<BarbellFrameSample>,
    measured_peak: BarbellFrameSample,
) -> BarbellFrameSample {
    let Some(peak_index) = samples
        .iter()
        .position(|sample| sample.frame_id == measured_peak.frame_id)
    else {
        return measured_peak;
    };
    let mut start = peak_index;
    while start > 0 {
        let current = samples[start];
        let previous = samples[start - 1];
        if measured_peak.position - previous.position > TURNAROUND_PLATEAU_BAND
            || current.timestamp_ms.saturating_sub(previous.timestamp_ms)
                > TURNAROUND_PLATEAU_MAX_GAP_MS
        {
            break;
        }
        start -= 1;
    }
    let mut end = peak_index;
    while end + 1 < samples.len() {
        let current = samples[end];
        let next = samples[end + 1];
        if measured_peak.position - next.position > TURNAROUND_PLATEAU_BAND
            || next.timestamp_ms.saturating_sub(current.timestamp_ms)
                > TURNAROUND_PLATEAU_MAX_GAP_MS
        {
            break;
        }
        end += 1;
    }
    samples[(start + end) / 2]
}

fn selected_bar_position(equipment: &EquipmentFrameEvidence) -> Option<(f32, f32)> {
    equipment
        .tracks
        .iter()
        .filter(|track| rigid_bar_track_supports_turnaround(track))
        .max_by(|left, right| {
            (left.observation_score * left.association_confidence)
                .total_cmp(&(right.observation_score * right.association_confidence))
        })
        .map(|track| (track.center_y, track.observation_score))
}

fn selected_bar_position_for_priming(equipment: &EquipmentFrameEvidence) -> Option<(f32, f32)> {
    equipment
        .tracks
        .iter()
        .filter(|track| {
            track.kind == EquipmentKind::BarbellShaft
                && track.source != EquipmentSource::Predicted
                && track.held_by == crate::EquipmentHand::Both
                && matches!(
                    track.association_stage,
                    crate::EquipmentAssociationStage::ContactCandidate
                        | crate::EquipmentAssociationStage::GripEstablished
                )
        })
        .max_by(|left, right| {
            (left.observation_score * left.association_confidence)
                .total_cmp(&(right.observation_score * right.association_confidence))
        })
        .map(|track| (track.center_y, track.observation_score))
}

fn update_pose_extreme(
    extreme: &mut Option<PoseExtreme>,
    timestamp_ms: u64,
    value: f32,
    direction: MovementDirection,
) {
    let replace = extreme.is_none_or(|current| match direction {
        MovementDirection::Increasing => value > current.value,
        MovementDirection::Decreasing => value < current.value,
        MovementDirection::Auto => false,
    });
    if replace {
        *extreme = Some(PoseExtreme {
            timestamp_ms,
            value,
        });
    }
}

fn backtracked_ready_start(
    history: &VecDeque<BarbellFrameSample>,
    activation_ms: u64,
    baseline: f32,
    enter_delta: f32,
) -> Option<BarbellFrameSample> {
    let ready_band = (enter_delta * 0.10).max(0.002);
    history
        .iter()
        .rev()
        .copied()
        .take_while(|sample| activation_ms.saturating_sub(sample.timestamp_ms) <= START_LOOKBACK_MS)
        .find(|sample| sample.position <= baseline + ready_band)
}

fn median(values: &[f32]) -> Option<f32> {
    let length = values.len();
    if length == 0 {
        None
    } else if length % 2 == 0 {
        Some((values[length / 2 - 1] + values[length / 2]) * 0.5)
    } else {
        Some(values[length / 2])
    }
}

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

fn hash_bar_sample(mut hash: u64, sample: BarbellFrameSample) -> u64 {
    for byte in sample
        .frame_id
        .to_le_bytes()
        .into_iter()
        .chain(sample.timestamp_ms.to_le_bytes())
        .chain(sample.position.to_bits().to_le_bytes())
        .chain(sample.confidence.to_bits().to_le_bytes())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}
