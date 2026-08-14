//! Per-set causal camera-plane coordinates for view-normalized motion facts.
//!
//! This module never replaces raw pose/equipment observations and never
//! claims world-space geometry. It freezes one image-plane frame for a set so
//! screen rotation, crop and scale do not redefine the exercise signal.

use serde::{Deserialize, Serialize};

use crate::{
    CanonicalLandmark, EquipmentAxis2d, EquipmentFrameEvidence, EquipmentKind, EquipmentSource,
    LandmarkSource,
};

const FREEZE_MINIMUM_SAMPLES: usize = 3;
const FREEZE_MINIMUM_NORMALIZED_PROGRESS: f32 = 0.024;
const LONG_GAP_MS: u64 = 1_000;
const CHANNEL_AGREEMENT_TOLERANCE: f32 = 0.20;
const CHANNEL_MINIMUM_CONFIDENCE: f32 = 0.50;
const CHANNEL_MINIMUM_COVERAGE: f32 = 0.20;
const CHANNEL_MAXIMUM_UNCERTAINTY: f32 = 0.50;
const GEOMETRY_SCALE_RATIO_MINIMUM: f32 = 0.55;
const GEOMETRY_SCALE_RATIO_MAXIMUM: f32 = 1.80;
const GEOMETRY_AXIS_ALIGNMENT_MINIMUM: f32 = 0.70;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalCoordinateState {
    #[default]
    Uninitialized,
    Provisional,
    Learning,
    Frozen,
    Degraded,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalCoordinateReason {
    NoSet,
    NoLockedSubject,
    NoMeasuredBarAxis,
    InsufficientPreparation,
    SubjectChanged,
    ObservationGap,
    InvalidGeometry,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalScaleSource {
    ProjectedBarLength,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalChannelProvenance {
    EquipmentMeasured,
    PoseMeasured,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalCoarseView {
    Front,
    FrontObliqueLeft,
    FrontObliqueRight,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum LocalActionAxisPrior {
    #[default]
    PreparationToEffortDown,
    PreparationToEffortUp,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EndpointOrderMapping {
    /// The detector's ordered image endpoints are preserved, but no anatomical
    /// side is asserted until view and mirroring metadata provide that map.
    ScreenOrderedAnatomyUnknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnatomicalSideMapping {
    Unknown,
    /// Raw ordered endpoint one maps to the athlete's anatomical left side;
    /// endpoint two therefore maps to anatomical right.
    EndpointOneAnatomicalLeft,
    /// Raw ordered endpoint one maps to the athlete's anatomical right side;
    /// endpoint two therefore maps to anatomical left.
    EndpointOneAnatomicalRight,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTrajectoryChannel {
    pub along_axis_progress: f32,
    pub cross_axis_displacement: f32,
    pub confidence: f32,
    /// Fraction of subject-locked set observations measured by this channel.
    pub coverage: f32,
    /// Unitless observation uncertainty in `[0, 1]`; it is not pixel error.
    pub uncertainty: f32,
    pub provenance: LocalChannelProvenance,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalChannelAgreement {
    Agreement,
    EquipmentOnly,
    PoseOnly,
    Conflict,
    CannotJudge,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMotionCoordinateEvidence {
    pub schema_version: String,
    pub coordinate_frame_id: u64,
    pub source_timestamp_ms: Option<u64>,
    pub state: LocalCoordinateState,
    pub reason: Option<LocalCoordinateReason>,
    pub primary_axis: Option<[f32; 2]>,
    pub cross_axis: Option<[f32; 2]>,
    pub origin: Option<[f32; 2]>,
    pub scale: Option<f32>,
    pub scale_source: Option<LocalScaleSource>,
    pub equipment_track_id: Option<u64>,
    /// The measured ordered shaft endpoints that produced the normalized
    /// equipment channel. Endpoint order is screen geometry, not anatomy.
    pub raw_bar_axis: Option<[f32; 4]>,
    /// Exact coarse front-view bucket supplied by the installed action
    /// context. This is never inferred from image geometry.
    pub coarse_view: Option<LocalCoarseView>,
    /// Whether the canonical coordinate feed itself is horizontally mirrored.
    /// Preview-only mirroring does not set this value.
    pub canonical_feed_mirrored: Option<bool>,
    /// Additive anatomical interpretation of the legacy screen-order field.
    /// Keeping it separate lets older decoders preserve endpoint order without
    /// rejecting new anatomical enum values.
    pub anatomical_side_mapping: AnatomicalSideMapping,
    pub endpoint_order_mapping: EndpointOrderMapping,
    pub equipment: Option<LocalTrajectoryChannel>,
    pub pose: Option<LocalTrajectoryChannel>,
    pub channel_agreement: LocalChannelAgreement,
    /// Progress of raw ordered shaft endpoint `(x1, y1)`. This is deliberately
    /// not labelled anatomical left/right without an explicit mirror/view map.
    pub endpoint_one_progress: Option<f32>,
    /// Progress of raw ordered shaft endpoint `(x2, y2)`.
    pub endpoint_two_progress: Option<f32>,
    /// Anatomical projection is emitted only when ordered endpoints, coarse
    /// view and canonical-feed mirroring jointly establish the mapping.
    pub anatomical_left_endpoint_progress: Option<f32>,
    pub anatomical_right_endpoint_progress: Option<f32>,
    pub raw_bar_angle_radians: Option<f32>,
    pub baseline_corrected_bar_angle_radians: Option<f32>,
    pub confidence: f32,
}

#[derive(Clone, Copy, Debug)]
struct FrozenLocalCoordinateFrame {
    primary: [f32; 2],
    cross: [f32; 2],
    preparation_bar_axis: [f32; 2],
    equipment_origin: [f32; 2],
    pose_origin: Option<[f32; 2]>,
    scale: f32,
    equipment_scale_px: f32,
}

impl Default for LocalMotionCoordinateEvidence {
    fn default() -> Self {
        Self {
            schema_version: "maxpower-local-motion-coordinate/v1".into(),
            coordinate_frame_id: 0,
            source_timestamp_ms: None,
            state: LocalCoordinateState::Uninitialized,
            reason: Some(LocalCoordinateReason::NoSet),
            primary_axis: None,
            cross_axis: None,
            origin: None,
            scale: None,
            scale_source: None,
            equipment_track_id: None,
            raw_bar_axis: None,
            coarse_view: None,
            canonical_feed_mirrored: None,
            anatomical_side_mapping: AnatomicalSideMapping::Unknown,
            endpoint_order_mapping: EndpointOrderMapping::ScreenOrderedAnatomyUnknown,
            equipment: None,
            pose: None,
            channel_agreement: LocalChannelAgreement::CannotJudge,
            endpoint_one_progress: None,
            endpoint_two_progress: None,
            anatomical_left_endpoint_progress: None,
            anatomical_right_endpoint_progress: None,
            raw_bar_angle_radians: None,
            baseline_corrected_bar_angle_radians: None,
            confidence: 0.0,
        }
    }
}

#[derive(Default)]
pub(crate) struct LocalMotionCoordinateEstimator {
    active: bool,
    paused: bool,
    coordinate_frame_id: u64,
    action_axis_prior: LocalActionAxisPrior,
    coarse_view: Option<LocalCoarseView>,
    canonical_feed_mirrored: Option<bool>,
    image_width_px: u32,
    image_height_px: u32,
    state: LocalCoordinateState,
    subject_candidate_id: Option<u64>,
    last_timestamp_ms: Option<u64>,
    axes: Vec<EquipmentAxis2d>,
    centers: Vec<[f32; 2]>,
    pose_origins: Vec<[f32; 2]>,
    frozen_frame: Option<FrozenLocalCoordinateFrame>,
    baseline_axis_angle: Option<f32>,
    baseline_endpoints: Option<EquipmentAxis2d>,
    observed_frames: u32,
    equipment_samples: u32,
    pose_samples: u32,
    latest: LocalMotionCoordinateEvidence,
}

impl LocalMotionCoordinateEstimator {
    pub(crate) fn new(image_width_px: u32, image_height_px: u32) -> Self {
        Self {
            image_width_px,
            image_height_px,
            ..Self::default()
        }
    }

    pub(crate) fn begin_set(&mut self) {
        let next_id = self.coordinate_frame_id.saturating_add(1).max(1);
        let coarse_view = self.coarse_view;
        let canonical_feed_mirrored = self.canonical_feed_mirrored;
        let action_axis_prior = self.action_axis_prior;
        let image_width_px = self.image_width_px;
        let image_height_px = self.image_height_px;
        *self = Self {
            active: true,
            coordinate_frame_id: next_id,
            coarse_view,
            canonical_feed_mirrored,
            action_axis_prior,
            image_width_px,
            image_height_px,
            state: LocalCoordinateState::Uninitialized,
            latest: LocalMotionCoordinateEvidence {
                coordinate_frame_id: next_id,
                reason: Some(LocalCoordinateReason::InsufficientPreparation),
                coarse_view,
                canonical_feed_mirrored,
                ..LocalMotionCoordinateEvidence::default()
            },
            ..Self::default()
        };
    }

    pub(crate) fn finish_set(&mut self) {
        self.active = false;
    }

    pub(crate) fn set_profile_identity(&mut self, identity: Option<&str>) {
        self.coarse_view = identity.and_then(coarse_view_from_profile_identity);
        self.action_axis_prior = identity
            .map(action_axis_prior_from_profile_identity)
            .unwrap_or_default();
        self.latest.coarse_view = self.coarse_view;
        self.refresh_endpoint_mapping();
    }

    pub(crate) fn set_canonical_feed_mirroring(&mut self, mirrored: Option<bool>) {
        self.canonical_feed_mirrored = mirrored;
        self.latest.canonical_feed_mirrored = mirrored;
        self.refresh_endpoint_mapping();
    }

    pub(crate) fn pause_set(&mut self) {
        if self.active {
            self.paused = true;
        }
    }

    pub(crate) fn resume_set(&mut self) {
        self.paused = false;
    }

    pub(crate) fn reset_for_discontinuity(&mut self, reason: LocalCoordinateReason) {
        if !self.active {
            return;
        }
        self.state = LocalCoordinateState::Degraded;
        self.latest.state = LocalCoordinateState::Degraded;
        self.latest.reason = Some(reason);
        self.latest.equipment = None;
        self.latest.pose = None;
        self.latest.channel_agreement = LocalChannelAgreement::CannotJudge;
        self.latest.confidence = 0.0;
    }

    pub(crate) fn observe(
        &mut self,
        timestamp_ms: u64,
        subject_candidate_id: Option<u64>,
        independent_pose: &[CanonicalLandmark],
        equipment: &EquipmentFrameEvidence,
    ) -> LocalMotionCoordinateEvidence {
        if !self.active {
            return LocalMotionCoordinateEvidence::default();
        }
        if self.paused {
            return self.latest.clone();
        }
        // A coordinate frame cannot silently recover after its camera/subject
        // geometry is invalidated. The remainder of this set stays
        // fail-closed; an explicit next begin_set establishes a new identity.
        if self.state == LocalCoordinateState::Degraded {
            self.latest.source_timestamp_ms = Some(timestamp_ms);
            return self.latest.clone();
        }
        if self
            .last_timestamp_ms
            .is_some_and(|previous| timestamp_ms.saturating_sub(previous) > LONG_GAP_MS)
        {
            self.reset_for_discontinuity(LocalCoordinateReason::ObservationGap);
            self.last_timestamp_ms = Some(timestamp_ms);
            return self.latest.clone();
        }
        self.last_timestamp_ms = Some(timestamp_ms);
        let Some(subject_id) = subject_candidate_id else {
            self.clear_frame_observations(LocalCoordinateReason::NoLockedSubject);
            return self.latest.clone();
        };
        if self
            .subject_candidate_id
            .is_some_and(|previous| previous != subject_id)
        {
            self.reset_for_discontinuity(LocalCoordinateReason::SubjectChanged);
            return self.latest.clone();
        }
        self.subject_candidate_id = Some(subject_id);
        self.observed_frames = self.observed_frames.saturating_add(1);
        let pose_center = measured_wrist_midpoint(independent_pose);

        let measured_track = equipment
            .tracks
            .iter()
            .filter(|track| {
                track.kind == EquipmentKind::BarbellShaft
                    && track.judgeable_path
                    && track.source != EquipmentSource::Predicted
                    && track.axis.is_some()
            })
            .max_by(|left, right| {
                (left.observation_score * left.association_confidence)
                    .total_cmp(&(right.observation_score * right.association_confidence))
            });
        let Some(track) = measured_track else {
            return self.observe_pose_without_current_equipment(
                timestamp_ms,
                independent_pose,
                pose_center,
            );
        };
        self.equipment_samples = self.equipment_samples.saturating_add(1);
        if pose_center.is_some() {
            self.pose_samples = self.pose_samples.saturating_add(1);
        }
        let axis = track.axis.expect("filtered measured bar axis disappeared");
        let length = axis.projected_length();
        if !length.is_finite() || length <= f32::EPSILON {
            self.reset_for_discontinuity(LocalCoordinateReason::InvalidGeometry);
            return self.latest.clone();
        }
        let center = [(axis.x1 + axis.x2) * 0.5, (axis.y1 + axis.y2) * 0.5];
        let cross = [(axis.x2 - axis.x1) / length, (axis.y2 - axis.y1) / length];
        if self.frozen_frame.is_some_and(|frame| {
            let scale_ratio = length / frame.scale;
            let axis_alignment = dot(cross, frame.preparation_bar_axis).abs();
            scale_ratio < GEOMETRY_SCALE_RATIO_MINIMUM
                || scale_ratio > GEOMETRY_SCALE_RATIO_MAXIMUM
                || axis_alignment < GEOMETRY_AXIS_ALIGNMENT_MINIMUM
        }) {
            self.reset_for_discontinuity(LocalCoordinateReason::InvalidGeometry);
            return self.latest.clone();
        }
        let primary = orient_axis_to_action_prior([-cross[1], cross[0]], self.action_axis_prior);

        if self.frozen_frame.is_none() {
            self.axes.push(axis);
            self.centers.push(center);
            if let Some(pose_center) = pose_center {
                self.pose_origins.push(pose_center);
            }
            self.state = if self.axes.len() == 1 {
                LocalCoordinateState::Provisional
            } else {
                LocalCoordinateState::Learning
            };
            let preparation_origin =
                median_point(&self.centers[..self.centers.len() - 1]).unwrap_or(self.centers[0]);
            let preparation_scale = median(
                &self.axes[..self.axes.len().saturating_sub(1)]
                    .iter()
                    .map(|sample| sample.projected_length())
                    .collect::<Vec<_>>(),
            )
            .unwrap_or(length);
            let normalized_progress =
                dot(sub(center, preparation_origin), primary).abs() / preparation_scale;
            if self.axes.len() >= FREEZE_MINIMUM_SAMPLES
                && normalized_progress >= FREEZE_MINIMUM_NORMALIZED_PROGRESS
            {
                let baseline_axes = &self.axes[..self.axes.len() - 1];
                let baseline_axis = median_axis(baseline_axes);
                let scale = median(
                    &baseline_axes
                        .iter()
                        .map(|sample| sample.projected_length())
                        .collect::<Vec<_>>(),
                )
                .unwrap_or(length);
                let frozen_cross = normalized([
                    baseline_axis.x2 - baseline_axis.x1,
                    baseline_axis.y2 - baseline_axis.y1,
                ])
                .unwrap_or(cross);
                let preparation_pose_count = self.pose_origins.len().saturating_sub(1);
                let preparation_pose_origin =
                    median_point(&self.pose_origins[..preparation_pose_count]);
                let prior_primary = orient_axis_to_action_prior(
                    [-frozen_cross[1], frozen_cross[0]],
                    self.action_axis_prior,
                );
                let equipment_path =
                    robust_path_direction(&self.centers, preparation_origin, prior_primary, scale);
                let pose_path = preparation_pose_origin.and_then(|origin| {
                    robust_path_direction(&self.pose_origins, origin, prior_primary, scale)
                });
                let frozen_primary = combined_motion_axis(prior_primary, equipment_path, pose_path);
                let mut motion_cross = [frozen_primary[1], -frozen_primary[0]];
                if dot(motion_cross, frozen_cross) < 0.0 {
                    motion_cross = [-motion_cross[0], -motion_cross[1]];
                }
                self.frozen_frame = Some(FrozenLocalCoordinateFrame {
                    primary: frozen_primary,
                    cross: motion_cross,
                    preparation_bar_axis: frozen_cross,
                    equipment_origin: preparation_origin,
                    pose_origin: preparation_pose_origin,
                    scale,
                    equipment_scale_px: axis_projected_length_px(
                        baseline_axis,
                        self.image_width_px,
                        self.image_height_px,
                    ),
                });
                self.baseline_axis_angle = Some(baseline_axis.image_angle_radians());
                self.baseline_endpoints = Some(baseline_axis);
                self.state = LocalCoordinateState::Frozen;
            }
        }

        let (primary_axis, cross_axis, origin, scale) = match self.frozen_frame {
            Some(frame) => (
                frame.primary,
                frame.cross,
                frame.equipment_origin,
                frame.scale,
            ),
            _ => (
                primary,
                cross,
                median_point(&self.centers).unwrap_or(center),
                length,
            ),
        };
        let equipment_confidence =
            (track.observation_score * track.association_confidence).clamp(0.0, 1.0);
        let equipment_scale_px = self.frozen_frame.map_or_else(
            || axis_projected_length_px(axis, self.image_width_px, self.image_height_px),
            |frame| frame.equipment_scale_px,
        );
        let equipment_uncertainty = track
            .uncertainty_px
            .map_or(1.0 - equipment_confidence, |uncertainty_px| {
                uncertainty_px / equipment_scale_px.max(f32::EPSILON)
            });
        let equipment_channel = trajectory_channel(
            center,
            origin,
            primary_axis,
            cross_axis,
            scale,
            equipment_confidence,
            self.channel_coverage(self.equipment_samples),
            equipment_uncertainty,
            LocalChannelProvenance::EquipmentMeasured,
        );
        let pose_confidence = measured_wrist_confidence(independent_pose);
        let pose_channel = pose_center.and_then(|pose_center| {
            trajectory_channel(
                pose_center,
                self.frozen_frame
                    .and_then(|frame| frame.pose_origin)
                    .unwrap_or(pose_center),
                primary_axis,
                cross_axis,
                scale,
                pose_confidence,
                self.channel_coverage(self.pose_samples),
                measured_wrist_uncertainty(independent_pose, pose_confidence),
                LocalChannelProvenance::PoseMeasured,
            )
        });
        let agreement = channel_agreement(equipment_channel, pose_channel);
        let equipment_reliability =
            equipment_channel.map_or(0.0, |channel| channel_reliability_for_phase_claim(&channel));
        let baseline = self.baseline_endpoints.unwrap_or(axis);
        let endpoint_one_progress =
            dot([axis.x1 - baseline.x1, axis.y1 - baseline.y1], primary_axis) / scale;
        let endpoint_two_progress =
            dot([axis.x2 - baseline.x2, axis.y2 - baseline.y2], primary_axis) / scale;
        let anatomical_side_mapping =
            endpoint_order_mapping(axis, self.coarse_view, self.canonical_feed_mirrored);
        let (anatomical_left_endpoint_progress, anatomical_right_endpoint_progress) =
            anatomical_endpoint_progress(
                anatomical_side_mapping,
                endpoint_one_progress,
                endpoint_two_progress,
            );
        self.latest = LocalMotionCoordinateEvidence {
            coordinate_frame_id: self.coordinate_frame_id,
            source_timestamp_ms: Some(timestamp_ms),
            state: self.state,
            reason: (self.state != LocalCoordinateState::Frozen)
                .then_some(LocalCoordinateReason::InsufficientPreparation),
            primary_axis: Some(primary_axis),
            cross_axis: Some(cross_axis),
            origin: Some(origin),
            scale: Some(scale),
            scale_source: Some(LocalScaleSource::ProjectedBarLength),
            equipment_track_id: Some(track.track_id),
            raw_bar_axis: Some([axis.x1, axis.y1, axis.x2, axis.y2]),
            coarse_view: self.coarse_view,
            canonical_feed_mirrored: self.canonical_feed_mirrored,
            anatomical_side_mapping,
            endpoint_order_mapping: EndpointOrderMapping::ScreenOrderedAnatomyUnknown,
            equipment: equipment_channel,
            pose: pose_channel,
            channel_agreement: agreement,
            endpoint_one_progress: Some(endpoint_one_progress),
            endpoint_two_progress: Some(endpoint_two_progress),
            anatomical_left_endpoint_progress,
            anatomical_right_endpoint_progress,
            raw_bar_angle_radians: Some(axis.image_angle_radians()),
            baseline_corrected_bar_angle_radians: self
                .baseline_axis_angle
                .map(|baseline| axis.image_angle_radians() - baseline),
            confidence: if self.state == LocalCoordinateState::Frozen {
                equipment_reliability
            } else {
                (equipment_reliability * 0.6).clamp(0.0, 1.0)
            },
            ..LocalMotionCoordinateEvidence::default()
        };
        self.latest.clone()
    }

    pub(crate) fn snapshot(&self) -> LocalMotionCoordinateEvidence {
        self.latest.clone()
    }

    fn observe_pose_without_current_equipment(
        &mut self,
        timestamp_ms: u64,
        independent_pose: &[CanonicalLandmark],
        pose_center: Option<[f32; 2]>,
    ) -> LocalMotionCoordinateEvidence {
        let Some(frame) = self.frozen_frame else {
            self.clear_frame_observations(LocalCoordinateReason::NoMeasuredBarAxis);
            return self.latest.clone();
        };
        let Some(pose_origin) = frame.pose_origin else {
            self.clear_frame_observations(LocalCoordinateReason::NoMeasuredBarAxis);
            return self.latest.clone();
        };
        if pose_center.is_some() {
            self.pose_samples = self.pose_samples.saturating_add(1);
        }
        let pose_confidence = measured_wrist_confidence(independent_pose);
        let pose = pose_center.and_then(|center| {
            trajectory_channel(
                center,
                pose_origin,
                frame.primary,
                frame.cross,
                frame.scale,
                pose_confidence,
                self.channel_coverage(self.pose_samples),
                measured_wrist_uncertainty(independent_pose, pose_confidence),
                LocalChannelProvenance::PoseMeasured,
            )
        });
        self.clear_frame_observations(LocalCoordinateReason::NoMeasuredBarAxis);
        self.latest.source_timestamp_ms = Some(timestamp_ms);
        self.latest.pose = pose;
        self.latest.channel_agreement = if pose.is_some() {
            LocalChannelAgreement::PoseOnly
        } else {
            LocalChannelAgreement::CannotJudge
        };
        self.latest.confidence =
            pose.map_or(0.0, |channel| channel_reliability_for_phase_claim(&channel));
        self.latest.clone()
    }

    fn channel_coverage(&self, samples: u32) -> f32 {
        if self.observed_frames == 0 {
            0.0
        } else {
            samples as f32 / self.observed_frames as f32
        }
    }

    fn clear_frame_observations(&mut self, reason: LocalCoordinateReason) {
        self.latest.source_timestamp_ms = self.last_timestamp_ms;
        self.latest.reason = Some(reason);
        self.latest.equipment_track_id = None;
        self.latest.raw_bar_axis = None;
        self.latest.equipment = None;
        self.latest.pose = None;
        self.latest.channel_agreement = LocalChannelAgreement::CannotJudge;
        self.latest.endpoint_one_progress = None;
        self.latest.endpoint_two_progress = None;
        self.latest.endpoint_order_mapping = EndpointOrderMapping::ScreenOrderedAnatomyUnknown;
        self.latest.anatomical_side_mapping = AnatomicalSideMapping::Unknown;
        self.latest.anatomical_left_endpoint_progress = None;
        self.latest.anatomical_right_endpoint_progress = None;
        self.latest.raw_bar_angle_radians = None;
        self.latest.baseline_corrected_bar_angle_radians = None;
        self.latest.confidence = 0.0;
    }

    fn refresh_endpoint_mapping(&mut self) {
        let Some([x1, y1, x2, y2]) = self.latest.raw_bar_axis else {
            self.latest.endpoint_order_mapping = EndpointOrderMapping::ScreenOrderedAnatomyUnknown;
            self.latest.anatomical_side_mapping = AnatomicalSideMapping::Unknown;
            self.latest.anatomical_left_endpoint_progress = None;
            self.latest.anatomical_right_endpoint_progress = None;
            return;
        };
        let mapping = endpoint_order_mapping(
            EquipmentAxis2d { x1, y1, x2, y2 },
            self.coarse_view,
            self.canonical_feed_mirrored,
        );
        self.latest.endpoint_order_mapping = EndpointOrderMapping::ScreenOrderedAnatomyUnknown;
        self.latest.anatomical_side_mapping = mapping;
        let (left, right) = match (
            self.latest.endpoint_one_progress,
            self.latest.endpoint_two_progress,
        ) {
            (Some(one), Some(two)) => anatomical_endpoint_progress(mapping, one, two),
            _ => (None, None),
        };
        self.latest.anatomical_left_endpoint_progress = left;
        self.latest.anatomical_right_endpoint_progress = right;
    }
}

fn coarse_view_from_profile_identity(identity: &str) -> Option<LocalCoarseView> {
    let normalized = identity.to_ascii_lowercase();
    if normalized.contains("/front-left-45/")
        || normalized.contains("/frontleft45/")
        || normalized.contains("/front_oblique_left/")
    {
        return Some(LocalCoarseView::FrontObliqueLeft);
    }
    if normalized.contains("/front-right-45/")
        || normalized.contains("/frontright45/")
        || normalized.contains("/front_oblique_right/")
    {
        return Some(LocalCoarseView::FrontObliqueRight);
    }
    (normalized.contains("/front/")).then_some(LocalCoarseView::Front)
}

fn action_axis_prior_from_profile_identity(identity: &str) -> LocalActionAxisPrior {
    let normalized = identity.to_ascii_lowercase();
    if normalized.contains("shoulder-press") || normalized.contains("shoulder_press") {
        LocalActionAxisPrior::PreparationToEffortUp
    } else {
        LocalActionAxisPrior::PreparationToEffortDown
    }
}

fn orient_axis_to_action_prior(mut axis: [f32; 2], prior: LocalActionAxisPrior) -> [f32; 2] {
    let wants_positive_image_y = prior == LocalActionAxisPrior::PreparationToEffortDown;
    if (axis[1] >= 0.0) != wants_positive_image_y {
        axis = [-axis[0], -axis[1]];
    }
    axis
}

/// Detector endpoint order is stable but may run in either image direction.
/// The selected coarse front-view bucket establishes that bilateral evidence
/// is observable; the actual endpoint x-order plus explicit canonical-feed
/// mirroring establishes which ordered endpoint maps to anatomical left.
fn endpoint_order_mapping(
    axis: EquipmentAxis2d,
    coarse_view: Option<LocalCoarseView>,
    canonical_feed_mirrored: Option<bool>,
) -> AnatomicalSideMapping {
    let (Some(_view), Some(mirrored)) = (coarse_view, canonical_feed_mirrored) else {
        return AnatomicalSideMapping::Unknown;
    };
    if !axis.x1.is_finite() || !axis.x2.is_finite() || (axis.x1 - axis.x2).abs() <= f32::EPSILON {
        return AnatomicalSideMapping::Unknown;
    }
    // For an unmirrored front-facing image, the athlete's anatomical right is
    // image-left. Horizontal feed mirroring reverses that deterministic map.
    let endpoint_one_is_image_left = axis.x1 < axis.x2;
    let endpoint_one_is_anatomical_left = endpoint_one_is_image_left == mirrored;
    if endpoint_one_is_anatomical_left {
        AnatomicalSideMapping::EndpointOneAnatomicalLeft
    } else {
        AnatomicalSideMapping::EndpointOneAnatomicalRight
    }
}

fn anatomical_endpoint_progress(
    mapping: AnatomicalSideMapping,
    endpoint_one: f32,
    endpoint_two: f32,
) -> (Option<f32>, Option<f32>) {
    match mapping {
        AnatomicalSideMapping::EndpointOneAnatomicalLeft => {
            (Some(endpoint_one), Some(endpoint_two))
        }
        AnatomicalSideMapping::EndpointOneAnatomicalRight => {
            (Some(endpoint_two), Some(endpoint_one))
        }
        AnatomicalSideMapping::Unknown => (None, None),
    }
}

fn measured_wrist_midpoint(canonical: &[CanonicalLandmark]) -> Option<[f32; 2]> {
    let left = canonical.get(9)?;
    let right = canonical.get(10)?;
    if !independent_measured(left) || !independent_measured(right) {
        return None;
    }
    Some([(left.x? + right.x?) * 0.5, (left.y? + right.y?) * 0.5])
}

fn measured_wrist_confidence(canonical: &[CanonicalLandmark]) -> f32 {
    canonical
        .get(9)
        .zip(canonical.get(10))
        .map_or(0.0, |(left, right)| {
            left.canonical_confidence.min(right.canonical_confidence)
        })
}

fn measured_wrist_uncertainty(canonical: &[CanonicalLandmark], confidence: f32) -> f32 {
    canonical
        .get(9)
        .zip(canonical.get(10))
        .and_then(|(left, right)| left.uncertainty.zip(right.uncertainty))
        .map_or(1.0 - confidence, |(left, right)| left.max(right))
        .clamp(0.0, 1.0)
}

fn independent_measured(landmark: &CanonicalLandmark) -> bool {
    landmark.source == LandmarkSource::Measured
        && landmark.renderable
        && landmark.canonical_confidence >= 0.50
        && landmark.x.is_some()
        && landmark.y.is_some()
}

fn trajectory_channel(
    point: [f32; 2],
    origin: [f32; 2],
    primary: [f32; 2],
    cross: [f32; 2],
    scale: f32,
    confidence: f32,
    coverage: f32,
    uncertainty: f32,
    provenance: LocalChannelProvenance,
) -> Option<LocalTrajectoryChannel> {
    (scale.is_finite() && scale > f32::EPSILON).then(|| {
        let offset = sub(point, origin);
        LocalTrajectoryChannel {
            along_axis_progress: dot(offset, primary) / scale,
            cross_axis_displacement: dot(offset, cross) / scale,
            confidence: confidence.clamp(0.0, 1.0),
            coverage: coverage.clamp(0.0, 1.0),
            uncertainty: uncertainty.clamp(0.0, 1.0),
            provenance,
        }
    })
}

fn axis_projected_length_px(axis: EquipmentAxis2d, width_px: u32, height_px: u32) -> f32 {
    ((axis.x2 - axis.x1) * width_px as f32).hypot((axis.y2 - axis.y1) * height_px as f32)
}

fn channel_agreement(
    equipment: Option<LocalTrajectoryChannel>,
    pose: Option<LocalTrajectoryChannel>,
) -> LocalChannelAgreement {
    let equipment = equipment.filter(channel_is_reliable_for_phase_claim);
    let pose = pose.filter(channel_is_reliable_for_phase_claim);
    match (equipment, pose) {
        (Some(equipment), Some(pose)) => {
            let propagated_uncertainty = equipment.uncertainty + pose.uncertainty;
            let tolerance = CHANNEL_AGREEMENT_TOLERANCE + propagated_uncertainty * 0.25;
            if (equipment.along_axis_progress - pose.along_axis_progress).abs() <= tolerance {
                LocalChannelAgreement::Agreement
            } else {
                LocalChannelAgreement::Conflict
            }
        }
        (Some(_), None) => LocalChannelAgreement::EquipmentOnly,
        (None, Some(_)) => LocalChannelAgreement::PoseOnly,
        (None, None) => LocalChannelAgreement::CannotJudge,
    }
}

/// Phase agreement is a claim-specific late-fusion gate. A channel remains in
/// the packet even when it is too uncertain for this claim, but it cannot
/// create agreement or conflict until it is sufficiently observed.
fn channel_is_reliable_for_phase_claim(channel: &LocalTrajectoryChannel) -> bool {
    channel.confidence >= CHANNEL_MINIMUM_CONFIDENCE
        && channel.coverage >= CHANNEL_MINIMUM_COVERAGE
        && channel.uncertainty <= CHANNEL_MAXIMUM_UNCERTAINTY
}

fn channel_reliability_for_phase_claim(channel: &LocalTrajectoryChannel) -> f32 {
    channel
        .confidence
        .min(channel.coverage)
        .min(1.0 - channel.uncertainty.clamp(0.0, 1.0))
        .clamp(0.0, 1.0)
}

fn dot(left: [f32; 2], right: [f32; 2]) -> f32 {
    left[0] * right[0] + left[1] * right[1]
}

fn sub(left: [f32; 2], right: [f32; 2]) -> [f32; 2] {
    [left[0] - right[0], left[1] - right[1]]
}

/// Estimate the first causal excursion without allowing preparation jitter to
/// dictate the direction. The preparation-normal prior only fixes the sign;
/// the returned vector retains the observed image-plane path.
fn robust_path_direction(
    samples: &[[f32; 2]],
    origin: [f32; 2],
    sign_prior: [f32; 2],
    scale: f32,
) -> Option<[f32; 2]> {
    if !scale.is_finite() || scale <= f32::EPSILON {
        return None;
    }
    let excursions = samples
        .iter()
        .copied()
        .map(|sample| sub(sample, origin))
        .filter(|offset| offset[0].is_finite() && offset[1].is_finite())
        .filter(|offset| offset[0].hypot(offset[1]) / scale >= FREEZE_MINIMUM_NORMALIZED_PROGRESS)
        .collect::<Vec<_>>();
    if excursions.is_empty() {
        return None;
    }
    let mut direction = median_point(&excursions)?;
    if dot(direction, sign_prior) < 0.0 {
        direction = [-direction[0], -direction[1]];
    }
    normalized(direction)
}

/// Blend the action prior with independently observed equipment and pose
/// paths. Equipment has the strongest weight for barbell phase, while pose is
/// only allowed to corroborate the direction; neither channel is copied into
/// the other channel's evidence.
fn combined_motion_axis(
    prior: [f32; 2],
    equipment_path: Option<[f32; 2]>,
    pose_path: Option<[f32; 2]>,
) -> [f32; 2] {
    let mut estimate = [prior[0] * 0.30, prior[1] * 0.30];
    if let Some(path) = equipment_path {
        estimate[0] += path[0] * 0.55;
        estimate[1] += path[1] * 0.55;
    }
    if let Some(path) = pose_path.filter(|path| dot(*path, prior) > 0.0) {
        estimate[0] += path[0] * 0.15;
        estimate[1] += path[1] * 0.15;
    }
    let mut axis = normalized(estimate).unwrap_or(prior);
    if dot(axis, prior) < 0.0 {
        axis = [-axis[0], -axis[1]];
    }
    axis
}

fn normalized(vector: [f32; 2]) -> Option<[f32; 2]> {
    let length = vector[0].hypot(vector[1]);
    (length.is_finite() && length > f32::EPSILON)
        .then_some([vector[0] / length, vector[1] / length])
}

fn median(values: &[f32]) -> Option<f32> {
    let mut ordered = values
        .iter()
        .copied()
        .filter(|value| value.is_finite())
        .collect::<Vec<_>>();
    ordered.sort_by(f32::total_cmp);
    (!ordered.is_empty()).then(|| ordered[ordered.len() / 2])
}

fn median_axis(axes: &[EquipmentAxis2d]) -> EquipmentAxis2d {
    let values = |select: fn(EquipmentAxis2d) -> f32| {
        median(&axes.iter().copied().map(select).collect::<Vec<_>>()).unwrap_or(0.0)
    };
    EquipmentAxis2d {
        x1: values(|axis| axis.x1),
        y1: values(|axis| axis.y1),
        x2: values(|axis| axis.x2),
        y2: values(|axis| axis.y2),
    }
}

fn median_point(points: &[[f32; 2]]) -> Option<[f32; 2]> {
    Some([
        median(&points.iter().map(|point| point[0]).collect::<Vec<_>>())?,
        median(&points.iter().map(|point| point[1]).collect::<Vec<_>>())?,
    ])
}

#[cfg(test)]
mod tests {
    use super::{
        LocalActionAxisPrior, LocalChannelAgreement, LocalChannelProvenance, LocalCoarseView,
        LocalTrajectoryChannel, action_axis_prior_from_profile_identity, channel_agreement,
        coarse_view_from_profile_identity, combined_motion_axis, orient_axis_to_action_prior,
        robust_path_direction,
    };

    fn channel(
        progress: f32,
        confidence: f32,
        coverage: f32,
        uncertainty: f32,
    ) -> LocalTrajectoryChannel {
        LocalTrajectoryChannel {
            along_axis_progress: progress,
            cross_axis_displacement: 0.0,
            confidence,
            coverage,
            uncertainty,
            provenance: LocalChannelProvenance::EquipmentMeasured,
        }
    }

    #[test]
    fn profile_identity_preserves_coarse_view_alias_handedness() {
        assert_eq!(
            coarse_view_from_profile_identity(
                "barbell-bench-press/front-left-45/bilateral/barbell/local-v1"
            ),
            Some(LocalCoarseView::FrontObliqueLeft),
        );
        assert_eq!(
            coarse_view_from_profile_identity(
                "barbell_bench_press/frontRight45/bilateral/barbell/touched-v1"
            ),
            Some(LocalCoarseView::FrontObliqueRight),
        );
        assert_eq!(
            coarse_view_from_profile_identity(
                "barbell_bench_press/front_oblique_left/bilateral/barbell/v1"
            ),
            Some(LocalCoarseView::FrontObliqueLeft),
        );
        assert_eq!(
            coarse_view_from_profile_identity("unsupported/rear/v1"),
            None
        );
    }

    #[test]
    fn shoulder_press_owns_an_upward_preparation_to_effort_prior() {
        let shoulder = action_axis_prior_from_profile_identity(
            "seated-shoulder-press/front/bilateral/barbell/local-v1",
        );
        let bench = action_axis_prior_from_profile_identity(
            "barbell-bench-press/front/bilateral/barbell/local-v1",
        );
        assert_eq!(shoulder, LocalActionAxisPrior::PreparationToEffortUp);
        assert_eq!(bench, LocalActionAxisPrior::PreparationToEffortDown);
        assert!(orient_axis_to_action_prior([0.0, 1.0], shoulder)[1] < 0.0);
        assert!(orient_axis_to_action_prior([0.0, -1.0], bench)[1] > 0.0);
    }

    #[test]
    fn low_reliability_channels_cannot_create_agreement_or_conflict() {
        let reliable = channel(0.1, 0.9, 0.8, 0.1);
        let low_confidence = channel(0.9, 0.3, 0.8, 0.1);
        let high_uncertainty = channel(0.9, 0.9, 0.8, 0.8);
        assert_eq!(
            channel_agreement(Some(reliable), Some(low_confidence)),
            LocalChannelAgreement::EquipmentOnly,
        );
        assert_eq!(
            channel_agreement(Some(high_uncertainty), Some(low_confidence)),
            LocalChannelAgreement::CannotJudge,
        );
        assert_eq!(
            channel_agreement(Some(reliable), Some(channel(0.9, 0.9, 0.8, 0.1))),
            LocalChannelAgreement::Conflict,
        );
    }

    #[test]
    fn early_equipment_path_refines_the_preparation_normal_prior() {
        let path = [[0.0, 0.0], [0.01, 0.0], [0.06, 0.03], [0.12, 0.06]];
        let observed = robust_path_direction(&path, [0.0, 0.0], [1.0, 0.0], 1.0).unwrap();
        let axis = combined_motion_axis([1.0, 0.0], Some(observed), None);
        assert!(axis[0] > 0.85);
        assert!(
            axis[1] > 0.15,
            "observed path must refine, not merely sign, the prior"
        );
    }

    #[test]
    fn pose_path_can_corroborate_but_cannot_reverse_the_equipment_axis() {
        let axis = combined_motion_axis([1.0, 0.0], Some([0.98, 0.20]), Some([-1.0, 0.0]));
        assert!(axis[0] > 0.0);
        assert!(axis[1] > 0.0);
    }
}
