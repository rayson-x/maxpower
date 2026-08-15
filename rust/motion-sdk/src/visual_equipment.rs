//! Cross-platform causal visual equipment observations.
//!
//! Web/WASM, Android and iOS provide a same-frame luma plane plus all raw
//! YOLOX/RTMPose person candidates. This module owns the image algorithm and
//! trajectory state so platform adapters cannot silently diverge.

use crate::{
    EquipmentAttributes, EquipmentAxis2d, EquipmentKind, EquipmentObservation, EquipmentOcclusion,
    EquipmentSource, NormalizedRect, PoseCandidate, PoseSchemaId,
};

const EDGE_THRESHOLD: i16 = 26;
const SEARCH_SLOPES: [f32; 7] = [-0.15, -0.10, -0.05, 0.0, 0.05, 0.10, 0.15];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BarbellAxisSource {
    Measured,
    Fused,
    Predicted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VisualEquipmentError {
    UnsupportedPoseSchema,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BarbellAxisObservation {
    pub proposal_id: u64,
    pub source: BarbellAxisSource,
    pub confidence: f32,
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
    pub center_y: f32,
    pub uncertainty_px: f32,
}

impl BarbellAxisObservation {
    /// Only an independent current image measurement is canonical equipment.
    /// Prediction and pose bridges are display continuity and cannot enter
    /// subject association, Rep, Rule, Reference, or accuracy evidence.
    pub fn equipment_observation(self) -> Option<EquipmentObservation> {
        let source = match self.source {
            BarbellAxisSource::Measured => EquipmentSource::Geometry,
            BarbellAxisSource::Predicted | BarbellAxisSource::Fused => return None,
        };
        Some(EquipmentObservation {
            proposal_id: self.proposal_id,
            kind: EquipmentKind::BarbellShaft,
            bbox: NormalizedRect::new(
                self.x1.min(self.x2).clamp(0.0, 1.0),
                self.y1.min(self.y2).clamp(0.0, 1.0),
                (self.x2 - self.x1).abs().clamp(0.0, 1.0),
                (self.y2 - self.y1).abs().max(2.0 / 360.0).clamp(0.0, 1.0),
            ),
            axis: Some(EquipmentAxis2d {
                x1: self.x1,
                y1: self.y1,
                x2: self.x2,
                y2: self.y2,
            }),
            score: self.confidence,
            uncertainty_px: Some(self.uncertainty_px),
            source,
            attributes: EquipmentAttributes {
                is_reflection_candidate: false,
                is_static_rack_candidate: false,
                occlusion: EquipmentOcclusion::None,
                truncated: false,
            },
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct BarbellAxisFrameEvidence {
    /// Best bounded visual/display track for rendering only.
    pub display_axis: Option<BarbellAxisObservation>,
    /// All independent same-frame image candidates. Association consumes this
    /// set so wrists can select among geometry without changing that geometry.
    pub raw_observations: Vec<EquipmentObservation>,
}

#[derive(Clone, Copy, Debug)]
struct ShaftCandidate {
    x1: f32,
    x2: f32,
    center_y: f32,
    slope: f32,
    score: f32,
    wrist_axis_support: f32,
    uncertainty_px: f32,
    source: BarbellAxisSource,
}

#[derive(Clone, Copy, Debug)]
struct Interval {
    start: usize,
    end: usize,
}

#[derive(Default)]
pub struct BarbellAxisVisualTracker {
    width: usize,
    height: usize,
    background: Vec<f32>,
    initialized: bool,
    y_center: f32,
    velocity_y: f32,
    slope: f32,
    x1: f32,
    x2: f32,
    confidence: f32,
    uncertainty_px: f32,
    missed: u8,
}

impl BarbellAxisVisualTracker {
    pub fn process(
        &mut self,
        schema: PoseSchemaId,
        luma: &[u8],
        width: usize,
        height: usize,
        timestamp_ms: u64,
        subjects: &[PoseCandidate],
    ) -> Result<Option<BarbellAxisObservation>, VisualEquipmentError> {
        if schema != PoseSchemaId::Halpe26 {
            return Err(VisualEquipmentError::UnsupportedPoseSchema);
        }
        Ok(self
            .process_frame_halpe26(luma, width, height, timestamp_ms, subjects)
            .display_axis)
    }

    pub fn process_frame(
        &mut self,
        schema: PoseSchemaId,
        luma: &[u8],
        width: usize,
        height: usize,
        timestamp_ms: u64,
        subjects: &[PoseCandidate],
    ) -> Result<BarbellAxisFrameEvidence, VisualEquipmentError> {
        if schema != PoseSchemaId::Halpe26 {
            return Err(VisualEquipmentError::UnsupportedPoseSchema);
        }
        Ok(self.process_frame_halpe26(luma, width, height, timestamp_ms, subjects))
    }

    fn process_frame_halpe26(
        &mut self,
        luma: &[u8],
        width: usize,
        height: usize,
        timestamp_ms: u64,
        subjects: &[PoseCandidate],
    ) -> BarbellAxisFrameEvidence {
        if width < 8 || height < 8 || luma.len() != width.saturating_mul(height) {
            self.reset();
            return BarbellAxisFrameEvidence {
                display_axis: None,
                raw_observations: Vec::new(),
            };
        }
        if self.width != width || self.height != height {
            self.reset();
            self.width = width;
            self.height = height;
        }
        if self.background.is_empty() {
            self.background = luma.iter().map(|value| f32::from(*value)).collect();
        }
        // Raw shaft geometry is an image measurement. Pose may define a broad
        // person search region, but wrists never create, reject, rotate, or
        // crop the measured segment. Contact is evaluated later by the
        // EquipmentFusionEngine's temporal association lifecycle.
        let candidates = detect_shaft_candidates(luma, &self.background, width, height, subjects);
        let raw_observations = candidates
            .iter()
            .enumerate()
            .filter_map(|(index, candidate)| {
                candidate_observation(
                    timestamp_ms.saturating_mul(16).saturating_add(index as u64),
                    *candidate,
                    width,
                    height,
                )
                .equipment_observation()
            })
            .collect();
        let result = self.update(timestamp_ms, &candidates);
        for (background, value) in self.background.iter_mut().zip(luma) {
            *background = *background * 0.99 + f32::from(*value) * 0.01;
        }
        BarbellAxisFrameEvidence {
            display_axis: result,
            raw_observations,
        }
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }

    fn update(
        &mut self,
        timestamp_ms: u64,
        candidates: &[ShaftCandidate],
    ) -> Option<BarbellAxisObservation> {
        if candidates.is_empty() {
            return self.predict(timestamp_ms);
        }
        let predicted_y = self.initialized.then_some(self.y_center + self.velocity_y);
        let mut scored = candidates
            .iter()
            .map(|candidate| {
                let continuity = predicted_y.map_or(0.5, |predicted| {
                    gaussian(
                        (candidate.center_y - predicted).abs() / self.height as f32,
                        0.075,
                    )
                });
                let continuity_weight = if candidate.wrist_axis_support >= 0.60 {
                    0.12
                } else {
                    0.34
                };
                let combined = predicted_y.map_or(candidate.score, |_| {
                    candidate.score * (1.0 - continuity_weight) + continuity * continuity_weight
                });
                (combined, *candidate)
            })
            .collect::<Vec<_>>();
        scored.sort_by(|left, right| right.0.total_cmp(&left.0));
        let (combined, selected) = scored[0];
        let second = scored.get(1).map_or(0.0, |value| value.0);
        let margin = ((combined - second + 0.06) / 0.22).clamp(0.0, 1.0);
        let measurement_confidence = (selected.score * 0.72 + margin * 0.28).clamp(0.0, 1.0);
        if combined < 0.27 {
            return self.predict(timestamp_ms);
        }
        if let Some(predicted) = predicted_y {
            let distance = (selected.center_y - predicted).abs() / self.height as f32;
            if distance > 0.16 && selected.score < 0.68 && selected.wrist_axis_support < 0.60 {
                return self.predict(timestamp_ms);
            }
        }
        let previous_y = if self.initialized {
            self.y_center
        } else {
            selected.center_y
        };
        let expected_y = predicted_y.unwrap_or(selected.center_y);
        self.y_center = expected_y + 0.74 * (selected.center_y - expected_y);
        self.velocity_y = self.velocity_y * 0.68 + (selected.center_y - previous_y) * 0.32;
        if self.initialized {
            self.slope = self.slope * 0.7 + selected.slope * 0.3;
            self.x1 = self.x1 * 0.7 + selected.x1 * 0.3;
            self.x2 = self.x2 * 0.7 + selected.x2 * 0.3;
        } else {
            self.slope = selected.slope;
            self.x1 = selected.x1;
            self.x2 = selected.x2;
        }
        self.initialized = true;
        self.confidence = measurement_confidence;
        self.uncertainty_px = selected
            .uncertainty_px
            .max(((1.0 - measurement_confidence) * 12.0).max(1.0));
        self.missed = 0;
        Some(self.observation(timestamp_ms, selected.source))
    }

    fn predict(&mut self, timestamp_ms: u64) -> Option<BarbellAxisObservation> {
        if !self.initialized || self.missed >= 4 {
            self.confidence = 0.0;
            return None;
        }
        self.y_center += self.velocity_y;
        self.velocity_y *= 0.85;
        self.confidence *= 0.72;
        self.uncertainty_px = (self.uncertainty_px * 1.35 + 1.0).min(32.0);
        self.missed += 1;
        (self.confidence >= 0.16)
            .then(|| self.observation(timestamp_ms, BarbellAxisSource::Predicted))
    }

    fn observation(&self, timestamp_ms: u64, source: BarbellAxisSource) -> BarbellAxisObservation {
        let bounded_x1 = self.x1.clamp(0.0, self.width.saturating_sub(1) as f32);
        let bounded_x2 = self
            .x2
            .clamp(bounded_x1 + 1.0, self.width.saturating_sub(1) as f32);
        let y1 = self.y_center + self.slope * (bounded_x1 - self.width as f32 * 0.5);
        let y2 = self.y_center + self.slope * (bounded_x2 - self.width as f32 * 0.5);
        BarbellAxisObservation {
            proposal_id: timestamp_ms,
            source,
            confidence: self.confidence,
            x1: bounded_x1 / self.width as f32,
            y1: y1 / self.height as f32,
            x2: bounded_x2 / self.width as f32,
            y2: y2 / self.height as f32,
            center_y: self.y_center / self.height as f32,
            uncertainty_px: self.uncertainty_px.max(1.0),
        }
    }
}

fn candidate_observation(
    proposal_id: u64,
    candidate: ShaftCandidate,
    width: usize,
    height: usize,
) -> BarbellAxisObservation {
    let normalized_x1 = (candidate.x1 / width as f32).clamp(0.0, 1.0);
    let normalized_x2 = (candidate.x2 / width as f32).clamp(0.0, 1.0);
    let normalized_center_y = (candidate.center_y / height as f32).clamp(0.0, 1.0);
    let y1 = (normalized_center_y + candidate.slope * (normalized_x1 - 0.5)).clamp(0.0, 1.0);
    let y2 = (normalized_center_y + candidate.slope * (normalized_x2 - 0.5)).clamp(0.0, 1.0);
    BarbellAxisObservation {
        proposal_id,
        source: candidate.source,
        confidence: candidate.score.clamp(0.0, 1.0),
        x1: normalized_x1,
        y1,
        x2: normalized_x2,
        y2,
        center_y: normalized_center_y,
        uncertainty_px: candidate.uncertainty_px,
    }
}

fn detect_shaft_candidates(
    luma: &[u8],
    background: &[f32],
    width: usize,
    height: usize,
    subjects: &[PoseCandidate],
) -> Vec<ShaftCandidate> {
    let (search_top, search_bottom) = pose_search_context(subjects, height);
    let x_step = if width >= 480 { 2 } else { 1 };
    let maximum_gap = ((width as f32 * 0.012).round() as usize).max(6);
    let mut candidates = Vec::new();
    for slope in SEARCH_SLOPES {
        for center_y in (search_top..=search_bottom).step_by(2) {
            let mut intervals = Vec::new();
            let mut interval_start = None;
            let mut last_supported_x = None;
            let mut support_count = 0usize;
            let mut edge_total = 0.0f32;
            let mut motion_total = 0.0f32;
            for x in (2..width.saturating_sub(2)).step_by(x_step) {
                let y =
                    (center_y as f32 + slope * (x as f32 - width as f32 * 0.5)).round() as isize;
                if y < 3 || y >= height as isize - 3 {
                    continue;
                }
                let y = y as usize;
                let edge = (i16::from(luma[(y - 2) * width + x])
                    - i16::from(luma[(y + 2) * width + x]))
                .abs();
                if edge >= EDGE_THRESHOLD {
                    interval_start.get_or_insert(x);
                    last_supported_x = Some(x);
                    support_count += 1;
                    edge_total += f32::from(edge);
                    motion_total +=
                        (f32::from(luma[y * width + x]) - background[y * width + x]).abs();
                } else if let (Some(start), Some(last)) = (interval_start, last_supported_x)
                    && x.saturating_sub(last) > maximum_gap
                {
                    if last.saturating_sub(start) as f32 >= width as f32 * 0.026 {
                        intervals.push(Interval { start, end: last });
                    }
                    interval_start = None;
                    last_supported_x = None;
                }
            }
            if let (Some(start), Some(last)) = (interval_start, last_supported_x)
                && last.saturating_sub(start) as f32 >= width as f32 * 0.026
            {
                intervals.push(Interval { start, end: last });
            }
            if intervals.is_empty() || support_count == 0 {
                continue;
            }
            let merged = merge_intervals(&intervals, ((width as f32 * 0.006) as usize).max(3));
            let x1 = merged
                .iter()
                .map(|interval| interval.start)
                .min()
                .unwrap_or(0);
            let x2 = merged
                .iter()
                .map(|interval| interval.end)
                .max()
                .unwrap_or(0);
            let span = x2.saturating_sub(x1) as f32 / width as f32;
            let coverage = merged
                .iter()
                .map(|interval| interval.end.saturating_sub(interval.start))
                .sum::<usize>() as f32
                / width as f32;
            if span < 0.20 || coverage < 0.075 {
                continue;
            }
            let cohesion = (coverage / span.max(f32::EPSILON)).clamp(0.0, 1.0);
            let edge_strength = (edge_total / support_count as f32 / 145.0).clamp(0.0, 1.0);
            let motion = (motion_total / support_count as f32 / 30.0).clamp(0.0, 1.0);
            let score = 0.30 * (coverage / 0.56).clamp(0.0, 1.0)
                + 0.20 * (span / 0.78).clamp(0.0, 1.0)
                + 0.22 * motion
                + 0.16 * edge_strength
                + 0.12 * cohesion;
            candidates.push(ShaftCandidate {
                x1: x1 as f32,
                x2: x2 as f32,
                center_y: center_y as f32,
                slope,
                score,
                wrist_axis_support: 0.0,
                uncertainty_px: 2.0 + (1.0 - cohesion) * 8.0,
                source: BarbellAxisSource::Measured,
            });
        }
    }
    candidates.sort_by(|left, right| right.score.total_cmp(&left.score));
    let mut kept: Vec<ShaftCandidate> = Vec::new();
    for candidate in candidates {
        if kept.iter().any(|prior| {
            (prior.center_y - candidate.center_y).abs() <= 4.0
                && (prior.slope - candidate.slope).abs() <= 0.051
        }) {
            continue;
        }
        kept.push(candidate);
        if kept.len() >= 12 {
            break;
        }
    }
    kept
}

fn pose_search_context(subjects: &[PoseCandidate], height: usize) -> (usize, usize) {
    let shoulder_y = subjects
        .iter()
        .flat_map(|subject| [subject.observations.get(5), subject.observations.get(6)])
        .flatten()
        .filter(|point| point.visibility >= 0.2 && point.y.is_finite())
        .map(|point| point.y)
        .collect::<Vec<_>>();
    if shoulder_y.is_empty() {
        return (
            (height as f32 * 0.10) as usize,
            (height as f32 * 0.68) as usize,
        );
    }
    let minimum = shoulder_y.iter().copied().fold(f32::INFINITY, f32::min);
    let maximum = shoulder_y.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let top = minimum - 0.38;
    let body_bottom = subjects
        .iter()
        .map(|subject| subject.bbox.y + subject.bbox.height)
        .fold(0.68, f32::max);
    let bottom = (maximum + 0.20).max(body_bottom);
    (
        (top.clamp(0.0, 1.0) * height as f32).round() as usize,
        (bottom.clamp(0.0, 1.0) * height as f32).round() as usize,
    )
}

fn merge_intervals(intervals: &[Interval], maximum_gap: usize) -> Vec<Interval> {
    let mut ordered = intervals.to_vec();
    ordered.sort_by_key(|interval| interval.start);
    let Some(first) = ordered.first().copied() else {
        return Vec::new();
    };
    let mut output = Vec::new();
    let mut current = first;
    for interval in ordered.into_iter().skip(1) {
        if interval.start <= current.end.saturating_add(maximum_gap) {
            current.end = current.end.max(interval.end);
        } else {
            output.push(current);
            current = interval;
        }
    }
    output.push(current);
    output
}

fn gaussian(distance: f32, sigma: f32) -> f32 {
    let normalized = distance / sigma;
    (-0.5 * normalized * normalized).exp()
}
