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
const MAXIMUM_RIGID_BAR_HAND_DISTANCE: f32 = 0.10;
const MINIMUM_CONTACT_FRAMES: u8 = 3;
const MINIMUM_COMMON_MOTION_FRAMES: u8 = 2;
const MINIMUM_COMMON_MOTION_SCALE_RATIO: f32 = 0.01;
const MAXIMUM_RELATIVE_MOTION_ERROR_SCALE_RATIO: f32 = 0.05;
const MAXIMUM_ESTABLISHED_HAND_GAP_FRAMES: u8 = 2;

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

/// Causal association lifecycle. Image geometry exists before subject contact;
/// only `GripEstablished` may authorize an equipment-backed Rep boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EquipmentAssociationStage {
    RawDetected,
    Unassociated,
    ContactCandidate,
    GripEstablished,
    Released,
    Conflict,
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
    /// At least one current, independently observed equipment track is usable.
    Observed,
    /// No current independent equipment observation is usable. Predictions
    /// belong to a separate display-continuity output and never appear here.
    CannotJudge(EquipmentCannotJudgeReason),
}

/// Canonical equipment evidence associated with the currently locked subject.
/// Coordinates remain normalized image coordinates; downstream action profiles
/// must still declare the supported view and equipment semantics. Predicted
/// display geometry is excluded from this canonical evidence type.
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
    pub association_stage: EquipmentAssociationStage,
    /// True only for a current non-predicted observation associated with the
    /// locked subject. It does not imply that pose or technique is judgeable.
    pub judgeable_path: bool,
}

/// One canonical eligibility rule for rigid-bar motion consumers. A track has
/// already passed the provider's minimum observation score, exact subject
/// association, bilateral hand-distance gate, and predicted-evidence refusal
/// before reaching this seam. Callers must not add a second arbitrary score
/// product that makes rendering and Rep turnaround consumption disagree.
pub fn rigid_bar_track_supports_turnaround(track: &EquipmentTrackEvidence) -> bool {
    track.kind == EquipmentKind::BarbellShaft
        && track.judgeable_path
        && track.source != EquipmentSource::Predicted
        && track.held_by == EquipmentHand::Both
        && track.association_stage == EquipmentAssociationStage::GripEstablished
        && track.center_y.is_finite()
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
    association_stage: EquipmentAssociationStage,
    /// Compact independent loads keep the anatomical side established by
    /// temporal contact. A later frame in which both wrists are nearby is
    /// ambiguous evidence, not permission to rewrite the track as `Both` or
    /// swap it with the contralateral load.
    held_by: EquipmentHand,
    contact_frames: u8,
    common_motion_frames: u8,
    last_hand_center: Option<(f32, f32)>,
    hand_gap_frames: u8,
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
            if observation.source == EquipmentSource::Predicted {
                rejected_low_confidence_or_invalid_count += 1;
                continue;
            }
            if !valid_observation(observation) {
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

        // Stronger observations claim old tracks first. Proposal ordering and
        // proposal ids therefore cannot change stable identity.
        accepted.sort_by(|left, right| right.0.score.total_cmp(&left.0.score));
        let mut claimed_tracks = HashSet::new();
        let mut output = Vec::with_capacity(accepted.len());
        for (observation, association_confidence, observed_held_by) in accepted {
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
                    let side_compatible =
                        compact_side_compatible(observation.kind, track.held_by, observed_held_by);
                    (distance <= MAXIMUM_TRACK_CENTER_DISTANCE && side_compatible)
                        .then_some((index, distance))
                })
                .min_by(|left, right| left.1.total_cmp(&right.1))
                .map(|(index, _)| index);
            let (track_id, held_by, association_stage) = if let Some(index) = track_index {
                claimed_tracks.insert(index);
                let track = &mut self.tracks[index];
                let (held_by, side_conflict) =
                    resolve_compact_track_hand(track.kind, track.held_by, observed_held_by);
                let hand_center = associated_hand_center(held_by, input.canonical);
                let association_stage = if side_conflict {
                    track.contact_frames = 0;
                    track.common_motion_frames = 0;
                    track.association_stage = EquipmentAssociationStage::Conflict;
                    track.association_stage
                } else {
                    update_association_stage(
                        track,
                        held_by,
                        hand_center,
                        (center_x, center_y),
                        observation.bbox.width.hypot(observation.bbox.height),
                    )
                };
                track.center_x = center_x;
                track.center_y = center_y;
                track.last_timestamp_ms = input.timestamp_ms;
                track.last_hand_center = hand_center;
                if held_by != EquipmentHand::Unknown {
                    track.held_by = held_by;
                }
                (track.track_id, track.held_by, association_stage)
            } else {
                let track_id = self.next_track_id;
                self.next_track_id = self.next_track_id.saturating_add(1);
                let association_stage =
                    initial_association_stage(observed_held_by, observation.kind);
                let hand_center = associated_hand_center(observed_held_by, input.canonical);
                self.tracks.push(PrivateTrack {
                    track_id,
                    kind: observation.kind,
                    center_x,
                    center_y,
                    last_timestamp_ms: input.timestamp_ms,
                    association_stage,
                    held_by: observed_held_by,
                    contact_frames: u8::from(
                        association_stage == EquipmentAssociationStage::ContactCandidate,
                    ),
                    common_motion_frames: 0,
                    last_hand_center: hand_center,
                    hand_gap_frames: 0,
                });
                claimed_tracks.insert(self.tracks.len() - 1);
                (track_id, observed_held_by, association_stage)
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
                association_stage,
                judgeable_path: association_stage == EquipmentAssociationStage::GripEstablished,
            });
        }

        if output.is_empty() {
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

fn compact_side_compatible(
    kind: EquipmentKind,
    track_hand: EquipmentHand,
    observed_hand: EquipmentHand,
) -> bool {
    if !matches!(kind, EquipmentKind::Dumbbell | EquipmentKind::MachineHandle) {
        return true;
    }
    !matches!(
        (track_hand, observed_hand),
        (EquipmentHand::Left, EquipmentHand::Right) | (EquipmentHand::Right, EquipmentHand::Left)
    )
}

fn resolve_compact_track_hand(
    kind: EquipmentKind,
    track_hand: EquipmentHand,
    observed_hand: EquipmentHand,
) -> (EquipmentHand, bool) {
    if !matches!(kind, EquipmentKind::Dumbbell | EquipmentKind::MachineHandle) {
        return (observed_hand, false);
    }
    match (track_hand, observed_hand) {
        (EquipmentHand::Left, EquipmentHand::Both)
        | (EquipmentHand::Left, EquipmentHand::Unknown) => (EquipmentHand::Left, false),
        (EquipmentHand::Right, EquipmentHand::Both)
        | (EquipmentHand::Right, EquipmentHand::Unknown) => (EquipmentHand::Right, false),
        (EquipmentHand::Left, EquipmentHand::Right)
        | (EquipmentHand::Right, EquipmentHand::Left) => (track_hand, true),
        (EquipmentHand::Both, EquipmentHand::Left | EquipmentHand::Right)
        | (EquipmentHand::Unknown, EquipmentHand::Left | EquipmentHand::Right) => {
            (observed_hand, false)
        }
        _ => (observed_hand, false),
    }
}

fn initial_association_stage(
    held_by: EquipmentHand,
    kind: EquipmentKind,
) -> EquipmentAssociationStage {
    if contact_hand_is_sufficient(kind, held_by) {
        EquipmentAssociationStage::ContactCandidate
    } else {
        EquipmentAssociationStage::Unassociated
    }
}

fn update_association_stage(
    track: &mut PrivateTrack,
    held_by: EquipmentHand,
    hand_center: Option<(f32, f32)>,
    equipment_center: (f32, f32),
    equipment_scale: f32,
) -> EquipmentAssociationStage {
    let was_established = track.association_stage == EquipmentAssociationStage::GripEstablished;
    if !contact_hand_is_sufficient(track.kind, held_by) {
        if was_established
            && hand_center.is_none()
            && track.hand_gap_frames < MAXIMUM_ESTABLISHED_HAND_GAP_FRAMES
        {
            track.hand_gap_frames = track.hand_gap_frames.saturating_add(1);
            return EquipmentAssociationStage::GripEstablished;
        }
        track.contact_frames = 0;
        track.common_motion_frames = 0;
        track.hand_gap_frames = 0;
        track.association_stage = if was_established {
            EquipmentAssociationStage::Released
        } else {
            EquipmentAssociationStage::Unassociated
        };
        return track.association_stage;
    }

    track.contact_frames = track.contact_frames.saturating_add(1);
    track.hand_gap_frames = 0;
    if let (Some(previous_hand), Some(current_hand)) = (track.last_hand_center, hand_center) {
        let equipment_delta = (
            equipment_center.0 - track.center_x,
            equipment_center.1 - track.center_y,
        );
        let hand_delta = (
            current_hand.0 - previous_hand.0,
            current_hand.1 - previous_hand.1,
        );
        let equipment_motion = equipment_delta.0.hypot(equipment_delta.1);
        let hand_motion = hand_delta.0.hypot(hand_delta.1);
        let common_motion_error =
            (equipment_delta.0 - hand_delta.0).hypot(equipment_delta.1 - hand_delta.1);
        let minimum_common_motion =
            (equipment_scale * MINIMUM_COMMON_MOTION_SCALE_RATIO).max(0.001);
        let maximum_relative_motion_error =
            (equipment_scale * MAXIMUM_RELATIVE_MOTION_ERROR_SCALE_RATIO).max(0.001);
        if was_established
            && equipment_motion >= minimum_common_motion
            && hand_motion >= minimum_common_motion
            && common_motion_error > maximum_relative_motion_error
        {
            track.contact_frames = 0;
            track.common_motion_frames = 0;
            track.association_stage = EquipmentAssociationStage::Conflict;
            return track.association_stage;
        }
        if equipment_motion >= minimum_common_motion
            && hand_motion >= minimum_common_motion
            && common_motion_error <= maximum_relative_motion_error
        {
            track.common_motion_frames = track.common_motion_frames.saturating_add(1);
        }
    }
    track.association_stage = if track.contact_frames >= MINIMUM_CONTACT_FRAMES
        && track.common_motion_frames >= MINIMUM_COMMON_MOTION_FRAMES
    {
        EquipmentAssociationStage::GripEstablished
    } else {
        EquipmentAssociationStage::ContactCandidate
    };
    track.association_stage
}

fn contact_hand_is_sufficient(kind: EquipmentKind, hand: EquipmentHand) -> bool {
    match kind {
        EquipmentKind::BarbellShaft => hand == EquipmentHand::Both,
        EquipmentKind::Dumbbell | EquipmentKind::MachineHandle => hand != EquipmentHand::Unknown,
        EquipmentKind::WeightPlate => false,
    }
}

fn associated_hand_center(
    held_by: EquipmentHand,
    canonical: &[CanonicalLandmark],
) -> Option<(f32, f32)> {
    let left = reliable_point(canonical.get(9));
    let right = reliable_point(canonical.get(10));
    match held_by {
        EquipmentHand::Left => left,
        EquipmentHand::Right => right,
        EquipmentHand::Both => {
            let (left, right) = (left?, right?);
            Some(((left.0 + right.0) * 0.5, (left.1 + right.1) * 0.5))
        }
        EquipmentHand::Unknown => None,
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
    let left = reliable_point(canonical.get(9));
    let right = reliable_point(canonical.get(10));
    let left_distance = left.map(|point| equipment_distance_to_point(observation, point));
    let right_distance = right.map(|point| equipment_distance_to_point(observation, point));
    let maximum_distance =
        if observation.kind == EquipmentKind::BarbellShaft && observation.axis.is_some() {
            MAXIMUM_RIGID_BAR_HAND_DISTANCE
        } else {
            MAXIMUM_HAND_DISTANCE
        };
    match (left_distance, right_distance) {
        (Some(left), Some(right)) if left <= maximum_distance && right <= maximum_distance => {
            EquipmentHand::Both
        }
        (Some(left), Some(right)) if left <= maximum_distance && left < right => {
            EquipmentHand::Left
        }
        (Some(_left), Some(right)) if right <= maximum_distance => EquipmentHand::Right,
        (Some(left), None) if left <= maximum_distance => EquipmentHand::Left,
        (None, Some(right)) if right <= maximum_distance => EquipmentHand::Right,
        _ => EquipmentHand::Unknown,
    }
}

fn equipment_distance_to_point(observation: EquipmentObservation, point: (f32, f32)) -> f32 {
    observation.axis.map_or_else(
        || {
            let (center_x, center_y) = observation.bbox.center();
            (point.0 - center_x).hypot(point.1 - center_y)
        },
        |axis| equipment_distance_to_axis(axis, point),
    )
}

fn equipment_distance_to_axis(axis: EquipmentAxis2d, point: (f32, f32)) -> f32 {
    let dx = axis.x2 - axis.x1;
    let dy = axis.y2 - axis.y1;
    let length_squared = dx * dx + dy * dy;
    if length_squared <= f32::EPSILON {
        return (point.0 - axis.x1).hypot(point.1 - axis.y1);
    }
    let projection =
        (((point.0 - axis.x1) * dx + (point.1 - axis.y1) * dy) / length_squared).clamp(0.0, 1.0);
    let closest_x = axis.x1 + projection * dx;
    let closest_y = axis.y1 + projection * dy;
    (point.0 - closest_x).hypot(point.1 - closest_y)
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
