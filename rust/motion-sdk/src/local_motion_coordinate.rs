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
const FREEZE_MINIMUM_PROGRESS: f32 = 0.012;
const LONG_GAP_MS: u64 = 1_000;
const CHANNEL_AGREEMENT_TOLERANCE: f32 = 0.20;

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
pub enum EndpointOrderMapping {
    /// The detector's ordered image endpoints are preserved, but no anatomical
    /// side is asserted until view and mirroring metadata provide that map.
    ScreenOrderedAnatomyUnknown,
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
    pub endpoint_order_mapping: EndpointOrderMapping,
    pub equipment: Option<LocalTrajectoryChannel>,
    pub pose: Option<LocalTrajectoryChannel>,
    pub channel_agreement: LocalChannelAgreement,
    /// Progress of raw ordered shaft endpoint `(x1, y1)`. This is deliberately
    /// not labelled anatomical left/right without an explicit mirror/view map.
    pub endpoint_one_progress: Option<f32>,
    /// Progress of raw ordered shaft endpoint `(x2, y2)`.
    pub endpoint_two_progress: Option<f32>,
    pub raw_bar_angle_radians: Option<f32>,
    pub baseline_corrected_bar_angle_radians: Option<f32>,
    pub confidence: f32,
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
            endpoint_order_mapping: EndpointOrderMapping::ScreenOrderedAnatomyUnknown,
            equipment: None,
            pose: None,
            channel_agreement: LocalChannelAgreement::CannotJudge,
            endpoint_one_progress: None,
            endpoint_two_progress: None,
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
    state: LocalCoordinateState,
    subject_candidate_id: Option<u64>,
    last_timestamp_ms: Option<u64>,
    axes: Vec<EquipmentAxis2d>,
    centers: Vec<[f32; 2]>,
    pose_origins: Vec<[f32; 2]>,
    frozen_primary: Option<[f32; 2]>,
    frozen_cross: Option<[f32; 2]>,
    frozen_origin: Option<[f32; 2]>,
    frozen_pose_origin: Option<[f32; 2]>,
    frozen_scale: Option<f32>,
    baseline_axis_angle: Option<f32>,
    baseline_endpoints: Option<EquipmentAxis2d>,
    observed_frames: u32,
    equipment_samples: u32,
    pose_samples: u32,
    latest: LocalMotionCoordinateEvidence,
}

impl LocalMotionCoordinateEstimator {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn begin_set(&mut self) {
        let next_id = self.coordinate_frame_id.saturating_add(1).max(1);
        *self = Self {
            active: true,
            coordinate_frame_id: next_id,
            state: LocalCoordinateState::Uninitialized,
            latest: LocalMotionCoordinateEvidence {
                coordinate_frame_id: next_id,
                reason: Some(LocalCoordinateReason::InsufficientPreparation),
                ..LocalMotionCoordinateEvidence::default()
            },
            ..Self::default()
        };
    }

    pub(crate) fn finish_set(&mut self) {
        self.active = false;
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
        let mut primary = [-cross[1], cross[0]];
        if primary[1] < 0.0 {
            primary = [-primary[0], -primary[1]];
        }

        if self.frozen_primary.is_none() {
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
            let progress = dot(sub(center, preparation_origin), primary).abs();
            if self.axes.len() >= FREEZE_MINIMUM_SAMPLES && progress >= FREEZE_MINIMUM_PROGRESS {
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
                let mut frozen_primary = [-frozen_cross[1], frozen_cross[0]];
                if dot(sub(center, preparation_origin), frozen_primary) < 0.0 {
                    frozen_primary = [-frozen_primary[0], -frozen_primary[1]];
                }
                self.frozen_cross = Some(frozen_cross);
                self.frozen_primary = Some(frozen_primary);
                self.frozen_origin = Some(preparation_origin);
                let preparation_pose_count = self.pose_origins.len().saturating_sub(1);
                self.frozen_pose_origin =
                    median_point(&self.pose_origins[..preparation_pose_count]);
                self.frozen_scale = Some(scale);
                self.baseline_axis_angle = Some(baseline_axis.image_angle_radians());
                self.baseline_endpoints = Some(baseline_axis);
                self.state = LocalCoordinateState::Frozen;
            }
        }

        let (primary_axis, cross_axis, origin, scale) = match (
            self.frozen_primary,
            self.frozen_cross,
            self.frozen_origin,
            self.frozen_scale,
        ) {
            (Some(primary), Some(cross), Some(origin), Some(scale)) => {
                (primary, cross, origin, scale)
            }
            _ => (
                primary,
                cross,
                median_point(&self.centers).unwrap_or(center),
                length,
            ),
        };
        let equipment_confidence =
            (track.observation_score * track.association_confidence).clamp(0.0, 1.0);
        let equipment_channel = trajectory_channel(
            center,
            origin,
            primary_axis,
            cross_axis,
            scale,
            equipment_confidence,
            self.channel_coverage(self.equipment_samples),
            1.0 - equipment_confidence,
            LocalChannelProvenance::EquipmentMeasured,
        );
        let pose_confidence = measured_wrist_confidence(independent_pose);
        let pose_channel = pose_center.and_then(|pose_center| {
            trajectory_channel(
                pose_center,
                self.frozen_pose_origin.unwrap_or(pose_center),
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
        let baseline = self.baseline_endpoints.unwrap_or(axis);
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
            endpoint_order_mapping: EndpointOrderMapping::ScreenOrderedAnatomyUnknown,
            equipment: equipment_channel,
            pose: pose_channel,
            channel_agreement: agreement,
            endpoint_one_progress: Some(
                dot([axis.x1 - baseline.x1, axis.y1 - baseline.y1], primary_axis) / scale,
            ),
            endpoint_two_progress: Some(
                dot([axis.x2 - baseline.x2, axis.y2 - baseline.y2], primary_axis) / scale,
            ),
            raw_bar_angle_radians: Some(axis.image_angle_radians()),
            baseline_corrected_bar_angle_radians: self
                .baseline_axis_angle
                .map(|baseline| axis.image_angle_radians() - baseline),
            confidence: if self.state == LocalCoordinateState::Frozen {
                equipment_confidence
            } else {
                (equipment_confidence * 0.6).clamp(0.0, 1.0)
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
        let frozen = self
            .frozen_primary
            .zip(self.frozen_cross)
            .zip(self.frozen_pose_origin)
            .zip(self.frozen_scale);
        let Some((((primary, cross), pose_origin), scale)) = frozen else {
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
                primary,
                cross,
                scale,
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
        self.latest.confidence = pose.map_or(0.0, |channel| channel.confidence);
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
        self.latest.raw_bar_angle_radians = None;
        self.latest.baseline_corrected_bar_angle_radians = None;
        self.latest.confidence = 0.0;
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

fn channel_agreement(
    equipment: Option<LocalTrajectoryChannel>,
    pose: Option<LocalTrajectoryChannel>,
) -> LocalChannelAgreement {
    match (equipment, pose) {
        (Some(equipment), Some(pose)) => {
            if (equipment.along_axis_progress - pose.along_axis_progress).abs()
                <= CHANNEL_AGREEMENT_TOLERANCE
            {
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

fn dot(left: [f32; 2], right: [f32; 2]) -> f32 {
    left[0] * right[0] + left[1] * right[1]
}

fn sub(left: [f32; 2], right: [f32; 2]) -> [f32; 2] {
    [left[0] - right[0], left[1] - right[1]]
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
