//! Confidence-aware subject/equipment association.
//!
//! Detector proposal ids are frame-local observations. This module owns stable
//! equipment track ids, rejects declared reflections/static-rack candidates,
//! and deliberately publishes no extrapolated equipment position on a missing
//! frame. Pose landmarks are read only for optional hand association; this
//! module never mutates or fabricates canonical joints.

use std::collections::HashSet;

use crate::{CanonicalLandmark, LandmarkSource, NormalizedRect, PoseCandidate};

const MINIMUM_OBSERVATION_SCORE: f32 = 0.50;
const MAXIMUM_TRACK_GAP_MS: u64 = 500;
const MAXIMUM_TRACK_CENTER_DISTANCE: f32 = 0.18;
const MAXIMUM_HAND_DISTANCE: f32 = 0.22;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum EquipmentKind {
    WeightPlate,
    BarbellShaft,
    Dumbbell,
    MachineHandle,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EquipmentSource {
    Detector,
    OpticalFlow,
    Geometry,
    Predicted,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum EquipmentOcclusion {
    #[default]
    None,
    Partial,
    Heavy,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct EquipmentAttributes {
    pub is_reflection_candidate: bool,
    pub is_static_rack_candidate: bool,
    pub occlusion: EquipmentOcclusion,
    pub truncated: bool,
}

/// Ordered camera-plane endpoints for a rigid equipment axis. The order is
/// stable tracking geometry only; it is not anatomical left/right until the
/// selected action/view context supplies that mapping.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EquipmentAxis2d {
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
}

impl EquipmentAxis2d {
    pub fn image_angle_radians(self) -> f32 {
        (self.y2 - self.y1).atan2(self.x2 - self.x1)
    }

    pub fn projected_length(self) -> f32 {
        (self.x2 - self.x1).hypot(self.y2 - self.y1)
    }

    fn is_valid(self) -> bool {
        [self.x1, self.y1, self.x2, self.y2]
            .into_iter()
            .all(|value| value.is_finite() && (0.0..=1.0).contains(&value))
            && self.projected_length() > 0.0
    }
}

/// One frame-local detector/tracker observation. `proposal_id` is retained for
/// diagnostics only and is never used as the stable Rust track identity.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EquipmentObservation {
    pub proposal_id: u64,
    pub kind: EquipmentKind,
    pub bbox: NormalizedRect,
    /// Full ordered shaft geometry when the detector measured a rigid axis.
    /// Generic detectors may leave this absent without fabricating endpoints.
    pub axis: Option<EquipmentAxis2d>,
    pub score: f32,
    pub uncertainty_px: Option<f32>,
    pub source: EquipmentSource,
    pub attributes: EquipmentAttributes,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EquipmentHand {
    Left,
    Right,
    Both,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EquipmentCannotJudgeReason {
    NoLockedSubject,
    NoEquipmentObservation,
    TimestampNotMonotonic,
    LowConfidenceOrInvalid,
    ReflectionOrStaticOnly,
    OutsideLockedSubject,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EquipmentFrameStatus {
    Observed,
    CannotJudge(EquipmentCannotJudgeReason),
}

/// Canonical equipment evidence associated with the currently locked subject.
/// Coordinates remain normalized image coordinates; downstream action profiles
/// must still declare the supported view and equipment semantics.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EquipmentTrackEvidence {
    pub track_id: u64,
    pub proposal_id: u64,
    pub subject_candidate_id: u64,
    pub kind: EquipmentKind,
    pub bbox: NormalizedRect,
    pub axis: Option<EquipmentAxis2d>,
    pub center_x: f32,
    pub center_y: f32,
    pub observation_score: f32,
    pub association_confidence: f32,
    pub uncertainty_px: Option<f32>,
    pub source: EquipmentSource,
    pub held_by: EquipmentHand,
    /// True only for a current non-predicted observation associated with the
    /// locked subject. It does not imply that pose or technique is judgeable.
    pub judgeable_path: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EquipmentFrameEvidence {
    pub timestamp_ms: u64,
    pub subject_candidate_id: Option<u64>,
    pub status: EquipmentFrameStatus,
    pub tracks: Vec<EquipmentTrackEvidence>,
    pub rejected_reflection_count: u32,
    pub rejected_static_count: u32,
    pub rejected_low_confidence_or_invalid_count: u32,
    pub rejected_outside_subject_count: u32,
}

impl EquipmentFrameEvidence {
    pub fn cannot_judge(
        timestamp_ms: u64,
        subject_candidate_id: Option<u64>,
        reason: EquipmentCannotJudgeReason,
    ) -> Self {
        Self {
            timestamp_ms,
            subject_candidate_id,
            status: EquipmentFrameStatus::CannotJudge(reason),
            tracks: Vec::new(),
            rejected_reflection_count: 0,
            rejected_static_count: 0,
            rejected_low_confidence_or_invalid_count: 0,
            rejected_outside_subject_count: 0,
        }
    }
}

pub struct EquipmentFrameInput<'a> {
    pub timestamp_ms: u64,
    pub selected_subject: Option<&'a PoseCandidate>,
    pub canonical: &'a [CanonicalLandmark],
    pub equipment: &'a [EquipmentObservation],
}

#[derive(Clone, Copy, Debug)]
struct PrivateTrack {
    track_id: u64,
    kind: EquipmentKind,
    center_x: f32,
    center_y: f32,
    last_timestamp_ms: u64,
}

/// Stateful deep module for detector-independent equipment association.
///
/// Callers provide only the selected subject, its canonical pose, and raw
/// equipment observations. The implementation owns validation, mirror/static
/// rejection, hand proximity, stable track identity, and safe degradation.
pub struct EquipmentFusionEngine {
    next_track_id: u64,
    tracks: Vec<PrivateTrack>,
    subject_candidate_id: Option<u64>,
    last_timestamp_ms: Option<u64>,
}

impl Default for EquipmentFusionEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl EquipmentFusionEngine {
    pub const fn new() -> Self {
        Self {
            next_track_id: 1,
            tracks: Vec::new(),
            subject_candidate_id: None,
            last_timestamp_ms: None,
        }
    }

    pub fn process(&mut self, input: EquipmentFrameInput<'_>) -> EquipmentFrameEvidence {
        if self
            .last_timestamp_ms
            .is_some_and(|previous| input.timestamp_ms <= previous)
        {
            return cannot_judge(
                input.timestamp_ms,
                input.selected_subject.map(|subject| subject.id),
                EquipmentCannotJudgeReason::TimestampNotMonotonic,
            );
        }
        self.last_timestamp_ms = Some(input.timestamp_ms);

        let Some(subject) = input.selected_subject else {
            self.subject_candidate_id = None;
            self.tracks.clear();
            return cannot_judge(
                input.timestamp_ms,
                None,
                EquipmentCannotJudgeReason::NoLockedSubject,
            );
        };
        if self.subject_candidate_id != Some(subject.id) {
            self.tracks.clear();
            self.subject_candidate_id = Some(subject.id);
        }
        self.tracks.retain(|track| {
            input.timestamp_ms.saturating_sub(track.last_timestamp_ms) <= MAXIMUM_TRACK_GAP_MS
        });
        if input.equipment.is_empty() {
            return cannot_judge(
                input.timestamp_ms,
                Some(subject.id),
                EquipmentCannotJudgeReason::NoEquipmentObservation,
            );
        }

        let mut rejected_reflection_count = 0;
        let mut rejected_static_count = 0;
        let mut rejected_low_confidence_or_invalid_count = 0;
        let mut rejected_outside_subject_count = 0;
        let mut accepted: Vec<(EquipmentObservation, f32, EquipmentHand)> = Vec::new();

        for observation in input.equipment.iter().copied() {
            if observation.attributes.is_reflection_candidate {
                rejected_reflection_count += 1;
                continue;
            }
            if observation.attributes.is_static_rack_candidate {
                rejected_static_count += 1;
                continue;
            }
            if !valid_observation(observation) || observation.source == EquipmentSource::Predicted {
                rejected_low_confidence_or_invalid_count += 1;
                continue;
            }
            let Some(association_confidence) = subject_association_confidence(subject, observation)
            else {
                rejected_outside_subject_count += 1;
                continue;
            };
            accepted.push((
                observation,
                association_confidence,
                hand_association(observation, input.canonical),
            ));
        }

        if accepted.is_empty() {
            let reason = if rejected_reflection_count + rejected_static_count
                == input.equipment.len() as u32
            {
                EquipmentCannotJudgeReason::ReflectionOrStaticOnly
            } else if rejected_outside_subject_count > 0
                && rejected_outside_subject_count
                    + rejected_reflection_count
                    + rejected_static_count
                    == input.equipment.len() as u32
            {
                EquipmentCannotJudgeReason::OutsideLockedSubject
            } else {
                EquipmentCannotJudgeReason::LowConfidenceOrInvalid
            };
            return EquipmentFrameEvidence {
                timestamp_ms: input.timestamp_ms,
                subject_candidate_id: Some(subject.id),
                status: EquipmentFrameStatus::CannotJudge(reason),
                tracks: Vec::new(),
                rejected_reflection_count,
                rejected_static_count,
                rejected_low_confidence_or_invalid_count,
                rejected_outside_subject_count,
            };
        }

        // Stronger observations claim old tracks first. Proposal ordering and
        // proposal ids therefore cannot change stable identity.
        accepted.sort_by(|left, right| right.0.score.total_cmp(&left.0.score));
        let mut claimed_tracks = HashSet::new();
        let mut output = Vec::with_capacity(accepted.len());
        for (observation, association_confidence, held_by) in accepted {
            let (center_x, center_y) = observation.bbox.center();
            let track_index = self
                .tracks
                .iter()
                .enumerate()
                .filter(|(index, track)| {
                    !claimed_tracks.contains(index) && track.kind == observation.kind
                })
                .filter_map(|(index, track)| {
                    let distance = (track.center_x - center_x).hypot(track.center_y - center_y);
                    (distance <= MAXIMUM_TRACK_CENTER_DISTANCE).then_some((index, distance))
                })
                .min_by(|left, right| left.1.total_cmp(&right.1))
                .map(|(index, _)| index);
            let track_id = if let Some(index) = track_index {
                claimed_tracks.insert(index);
                let track = &mut self.tracks[index];
                track.center_x = center_x;
                track.center_y = center_y;
                track.last_timestamp_ms = input.timestamp_ms;
                track.track_id
            } else {
                let track_id = self.next_track_id;
                self.next_track_id = self.next_track_id.saturating_add(1);
                self.tracks.push(PrivateTrack {
                    track_id,
                    kind: observation.kind,
                    center_x,
                    center_y,
                    last_timestamp_ms: input.timestamp_ms,
                });
                claimed_tracks.insert(self.tracks.len() - 1);
                track_id
            };
            output.push(EquipmentTrackEvidence {
                track_id,
                proposal_id: observation.proposal_id,
                subject_candidate_id: subject.id,
                kind: observation.kind,
                bbox: observation.bbox,
                axis: observation.axis,
                center_x,
                center_y,
                observation_score: observation.score,
                association_confidence,
                uncertainty_px: observation.uncertainty_px,
                source: observation.source,
                held_by,
                judgeable_path: true,
            });
        }
        output.sort_by_key(|track| track.track_id);
        EquipmentFrameEvidence {
            timestamp_ms: input.timestamp_ms,
            subject_candidate_id: Some(subject.id),
            status: EquipmentFrameStatus::Observed,
            tracks: output,
            rejected_reflection_count,
            rejected_static_count,
            rejected_low_confidence_or_invalid_count,
            rejected_outside_subject_count,
        }
    }
}

fn cannot_judge(
    timestamp_ms: u64,
    subject_candidate_id: Option<u64>,
    reason: EquipmentCannotJudgeReason,
) -> EquipmentFrameEvidence {
    EquipmentFrameEvidence::cannot_judge(timestamp_ms, subject_candidate_id, reason)
}

fn valid_observation(observation: EquipmentObservation) -> bool {
    observation.score.is_finite()
        && observation.score >= MINIMUM_OBSERVATION_SCORE
        && observation
            .uncertainty_px
            .is_none_or(|value| value.is_finite() && value >= 0.0)
        && valid_rect(observation.bbox)
        && observation.axis.is_none_or(EquipmentAxis2d::is_valid)
}

fn valid_rect(rect: NormalizedRect) -> bool {
    rect.x.is_finite()
        && rect.y.is_finite()
        && rect.width.is_finite()
        && rect.height.is_finite()
        && rect.width > 0.0
        && rect.height > 0.0
        && rect.x >= 0.0
        && rect.y >= 0.0
        && rect.x + rect.width <= 1.0
        && rect.y + rect.height <= 1.0
}

fn subject_association_confidence(
    subject: &PoseCandidate,
    observation: EquipmentObservation,
) -> Option<f32> {
    let (center_x, center_y) = observation.bbox.center();
    let margin_x = subject.bbox.width * 0.25;
    let margin_y = subject.bbox.height * 0.20;
    let inside_expanded = center_x >= subject.bbox.x - margin_x
        && center_x <= subject.bbox.x + subject.bbox.width + margin_x
        && center_y >= subject.bbox.y - margin_y
        && center_y <= subject.bbox.y + subject.bbox.height + margin_y;
    if !inside_expanded {
        return None;
    }
    let (subject_x, subject_y) = subject.bbox.center();
    let diagonal = subject.bbox.width.hypot(subject.bbox.height).max(1e-6);
    let normalized_distance = (center_x - subject_x).hypot(center_y - subject_y) / diagonal;
    let spatial_confidence = (1.0 - normalized_distance).clamp(0.0, 1.0);
    Some((observation.score * 0.55 + spatial_confidence * 0.45).clamp(0.0, 1.0))
}

fn hand_association(
    observation: EquipmentObservation,
    canonical: &[CanonicalLandmark],
) -> EquipmentHand {
    let (center_x, center_y) = observation.bbox.center();
    let left = reliable_point(canonical.get(9));
    let right = reliable_point(canonical.get(10));
    let left_distance = left.map(|(x, y)| (x - center_x).hypot(y - center_y));
    let right_distance = right.map(|(x, y)| (x - center_x).hypot(y - center_y));
    match (left_distance, right_distance) {
        (Some(left), Some(right))
            if left <= MAXIMUM_HAND_DISTANCE && right <= MAXIMUM_HAND_DISTANCE =>
        {
            EquipmentHand::Both
        }
        (Some(left), Some(right)) if left <= MAXIMUM_HAND_DISTANCE && left < right => {
            EquipmentHand::Left
        }
        (Some(_left), Some(right)) if right <= MAXIMUM_HAND_DISTANCE => EquipmentHand::Right,
        (Some(left), None) if left <= MAXIMUM_HAND_DISTANCE => EquipmentHand::Left,
        (None, Some(right)) if right <= MAXIMUM_HAND_DISTANCE => EquipmentHand::Right,
        _ => EquipmentHand::Unknown,
    }
}

fn reliable_point(landmark: Option<&CanonicalLandmark>) -> Option<(f32, f32)> {
    let landmark = landmark?;
    if !landmark.renderable
        || !matches!(
            landmark.source,
            LandmarkSource::Measured | LandmarkSource::Fused
        )
    {
        return None;
    }
    Some((landmark.x?, landmark.y?))
}
