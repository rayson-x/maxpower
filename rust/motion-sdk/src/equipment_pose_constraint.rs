//! Equipment-conditioned canonical pose repair.
//!
//! The phase recognizer and this repair module consume independent pose and
//! equipment observations.  Repair happens only after equipment association,
//! and must never be fed back as independent pose evidence for phase fusion.

use std::collections::HashMap;

use crate::{
    CanonicalLandmark, ContinuityReason, EquipmentFrameEvidence, EquipmentKind,
    EquipmentTrackEvidence, LandmarkSource, PoseSchemaId,
};

const MAX_BASELINE_AGE_MS: u64 = 1_200;
const SHAFT_X_TOLERANCE: f32 = 0.08;
const MAX_BASELINE_OFFSET_Y: f32 = 0.12;
const MIN_RELIABLE_POSE_CONFIDENCE: f32 = 0.50;

#[derive(Clone, Copy, Debug)]
struct WristBaseline {
    x: f32,
    z: f32,
    shaft_offset_y: f32,
    timestamp_ms: u64,
}

/// Stateful seam that learns only from current reliable pose measurements and
/// uses current subject-associated equipment to repair a later unreliable
/// wrist.  It cannot invent an elbow or bootstrap a body from equipment alone.
pub(crate) struct EquipmentPoseConstraintEngine {
    wrists: HashMap<usize, WristBaseline>,
}

impl Default for EquipmentPoseConstraintEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl EquipmentPoseConstraintEngine {
    pub(crate) fn new() -> Self {
        Self {
            wrists: HashMap::new(),
        }
    }

    pub(crate) fn reset(&mut self) {
        self.wrists.clear();
    }

    pub(crate) fn process_barbell(
        &mut self,
        schema: PoseSchemaId,
        timestamp_ms: u64,
        canonical: &mut [CanonicalLandmark],
        equipment: &EquipmentFrameEvidence,
    ) {
        let Some(shaft) = selected_shaft(equipment) else {
            return;
        };
        for wrist_index in wrist_indices(schema) {
            let Some(wrist) = canonical.get_mut(wrist_index) else {
                continue;
            };
            if reliable_measurement(wrist) {
                if let (Some(x), Some(y), Some(z)) = (wrist.x, wrist.y, wrist.z)
                    && inside_shaft_span(x, shaft)
                {
                    let offset = y - shaft.center_y;
                    if offset.abs() <= MAX_BASELINE_OFFSET_Y {
                        self.wrists.insert(
                            wrist_index,
                            WristBaseline {
                                x,
                                z,
                                shaft_offset_y: offset,
                                timestamp_ms,
                            },
                        );
                    }
                }
                continue;
            }

            let Some(baseline) = self.wrists.get(&wrist_index).copied() else {
                continue;
            };
            let age_ms = timestamp_ms.saturating_sub(baseline.timestamp_ms);
            if age_ms > MAX_BASELINE_AGE_MS {
                self.wrists.remove(&wrist_index);
                continue;
            }
            let x = wrist
                .x
                .filter(|x| x.is_finite() && inside_shaft_span(*x, shaft))
                .unwrap_or(baseline.x);
            if !inside_shaft_span(x, shaft) {
                continue;
            }
            let z = wrist.z.filter(|z| z.is_finite()).unwrap_or(baseline.z);
            let y = (shaft.center_y + baseline.shaft_offset_y).clamp(0.0, 1.0);
            let equipment_confidence =
                (shaft.observation_score * shaft.association_confidence).clamp(0.0, 1.0);
            let age_confidence = 1.0 - age_ms as f32 / (MAX_BASELINE_AGE_MS + 1) as f32;
            let confidence =
                (equipment_confidence * (0.65 + 0.35 * age_confidence)).clamp(0.35, 0.79);
            *wrist = CanonicalLandmark {
                x: Some(x),
                y: Some(y),
                z: Some(z),
                observation_score: wrist.observation_score,
                canonical_confidence: confidence,
                uncertainty: Some(
                    wrist
                        .uncertainty
                        .unwrap_or(0.02)
                        .max(shaft.uncertainty_px.unwrap_or(0.0) / 1_000.0),
                ),
                // The coordinate is constrained by the equipment path.  It
                // stays predicted so quality fusion cannot count the same
                // bar observation as an independent pose measurement.
                source: LandmarkSource::Predicted,
                renderable: confidence >= MIN_RELIABLE_POSE_CONFIDENCE,
                reason: Some(ContinuityReason::EquipmentPathConstraint),
            };
        }
    }
}

fn selected_shaft(equipment: &EquipmentFrameEvidence) -> Option<&EquipmentTrackEvidence> {
    equipment
        .tracks
        .iter()
        .filter(|track| track.kind == EquipmentKind::BarbellShaft && track.judgeable_path)
        .max_by(|left, right| {
            (left.observation_score * left.association_confidence)
                .total_cmp(&(right.observation_score * right.association_confidence))
        })
}

fn wrist_indices(schema: PoseSchemaId) -> [usize; 2] {
    match schema {
        PoseSchemaId::BlazePose33 => [15, 16],
        PoseSchemaId::Halpe26 => [9, 10],
    }
}

fn reliable_measurement(landmark: &CanonicalLandmark) -> bool {
    landmark.source == LandmarkSource::Measured
        && landmark.renderable
        && landmark.canonical_confidence >= MIN_RELIABLE_POSE_CONFIDENCE
        && landmark.x.is_some_and(f32::is_finite)
        && landmark.y.is_some_and(f32::is_finite)
        && landmark.z.is_some_and(f32::is_finite)
}

fn inside_shaft_span(x: f32, shaft: &EquipmentTrackEvidence) -> bool {
    x >= shaft.bbox.x - SHAFT_X_TOLERANCE
        && x <= shaft.bbox.x + shaft.bbox.width + SHAFT_X_TOLERANCE
}
