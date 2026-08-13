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
    /// Only image-measured geometry is an independent equipment observation.
    /// Pose-derived fusion and prediction remain private continuity/display
    /// state so one pose source cannot be counted twice as pose + equipment.
    pub fn equipment_observation(self) -> Option<EquipmentObservation> {
        (self.source == BarbellAxisSource::Measured).then(|| EquipmentObservation {
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
            source: EquipmentSource::Geometry,
            attributes: EquipmentAttributes {
                is_reflection_candidate: false,
                is_static_rack_candidate: false,
                occlusion: EquipmentOcclusion::None,
                truncated: false,
            },
        })
    }
}

#[derive(Clone, Copy, Debug)]
struct ShaftCandidate {
    x1: f32,
    x2: f32,
    center_y: f32,
    slope: f32,
    score: f32,
    wrist_axis_support: f32,
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
    missed: u8,
    wrist_offset_y: f32,
    calibration_samples: u16,
    calibration_min_y: f32,
    calibration_max_y: f32,
    wrist_fusion_ready: bool,
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
        Ok(self.process_halpe26(luma, width, height, timestamp_ms, subjects))
    }

    fn process_halpe26(
        &mut self,
        luma: &[u8],
        width: usize,
        height: usize,
        timestamp_ms: u64,
        subjects: &[PoseCandidate],
    ) -> Option<BarbellAxisObservation> {
        if width < 8 || height < 8 || luma.len() != width.saturating_mul(height) {
            self.reset();
            return None;
        }
        if self.width != width || self.height != height {
            self.reset();
            self.width = width;
            self.height = height;
        }
        if self.background.is_empty() {
            self.background = luma.iter().map(|value| f32::from(*value)).collect();
        }
        let mut candidates = if subjects.is_empty() {
            Vec::new()
        } else {
            detect_shaft_candidates(luma, &self.background, width, height, subjects)
        };
        if self.wrist_fusion_ready
            && let Some(fused) = calibrated_wrist_shaft(
                subjects,
                width,
                height,
                self.wrist_offset_y,
                self.initialized.then_some(self.y_center + self.velocity_y),
            )
        {
            candidates.push(fused);
        }
        let result = self.update(timestamp_ms, &candidates);
        if let Some(axis) = result.filter(|axis| axis.source == BarbellAxisSource::Measured) {
            self.update_wrist_calibration(subjects, axis);
        }
        for (background, value) in self.background.iter_mut().zip(luma) {
            *background = *background * 0.99 + f32::from(*value) * 0.01;
        }
        result
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
            uncertainty_px: ((1.0 - self.confidence) * 12.0).max(1.0),
        }
    }

    fn update_wrist_calibration(
        &mut self,
        subjects: &[PoseCandidate],
        measured: BarbellAxisObservation,
    ) {
        let Some(wrist_axis) = closest_bilateral_wrist_axis(
            subjects,
            self.width,
            self.height,
            measured.center_y * self.height as f32,
        ) else {
            return;
        };
        let measured_y = measured.center_y * self.height as f32;
        let offset = measured_y - wrist_axis.center_y;
        if offset.abs() > self.height as f32 * 0.16 {
            return;
        }
        if self.calibration_samples == 0 {
            self.wrist_offset_y = offset;
            self.calibration_min_y = measured_y;
            self.calibration_max_y = measured_y;
            self.calibration_samples = 1;
            return;
        }
        if (offset - self.wrist_offset_y).abs() > self.height as f32 * 0.075 {
            return;
        }
        self.wrist_offset_y = self.wrist_offset_y * 0.82 + offset * 0.18;
        self.calibration_min_y = self.calibration_min_y.min(measured_y);
        self.calibration_max_y = self.calibration_max_y.max(measured_y);
        self.calibration_samples = self.calibration_samples.saturating_add(1);
        self.wrist_fusion_ready = self.calibration_samples >= 3
            && self.calibration_max_y - self.calibration_min_y >= self.height as f32 * 0.10;
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
    let wrist_xs = reliable_wrist_xs(subjects);
    let wrist_pairs = reliable_wrist_pairs(subjects);
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
            let wrist_support = interval_wrist_support(&merged, &wrist_xs, width);
            let wrist_axis_support =
                line_wrist_axis_support(center_y as f32, slope, &wrist_pairs, width, height);
            let score = 0.20 * (coverage / 0.56).clamp(0.0, 1.0)
                + 0.12 * (span / 0.78).clamp(0.0, 1.0)
                + 0.14 * motion
                + 0.10 * edge_strength
                + 0.08 * cohesion
                + 0.08 * wrist_support
                + 0.28 * wrist_axis_support;
            candidates.push(ShaftCandidate {
                x1: x1 as f32,
                x2: x2 as f32,
                center_y: center_y as f32,
                slope,
                score,
                wrist_axis_support,
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
    (
        ((minimum - 0.38).clamp(0.0, 1.0) * height as f32).round() as usize,
        ((maximum + 0.20).clamp(0.0, 1.0) * height as f32).round() as usize,
    )
}

fn reliable_wrist_xs(subjects: &[PoseCandidate]) -> Vec<f32> {
    subjects
        .iter()
        .flat_map(|subject| [subject.observations.get(9), subject.observations.get(10)])
        .flatten()
        .filter(|point| point.visibility >= 0.12 && point.x.is_finite())
        .map(|point| point.x)
        .collect()
}

#[derive(Clone, Copy, Debug)]
struct WristPoint {
    x: f32,
    y: f32,
    confidence: f32,
}

#[derive(Clone, Copy, Debug)]
struct WristPair {
    left: Option<WristPoint>,
    right: Option<WristPoint>,
}

fn reliable_wrist_pairs(subjects: &[PoseCandidate]) -> Vec<WristPair> {
    subjects
        .iter()
        .filter_map(|subject| {
            let point = |index: usize| {
                subject.observations.get(index).and_then(|point| {
                    (point.visibility >= 0.12 && point.x.is_finite() && point.y.is_finite())
                        .then_some(WristPoint {
                            x: point.x,
                            y: point.y,
                            confidence: point.visibility,
                        })
                })
            };
            let pair = WristPair {
                left: point(9),
                right: point(10),
            };
            (pair.left.is_some() || pair.right.is_some()).then_some(pair)
        })
        .collect()
}

#[derive(Clone, Copy, Debug)]
struct BilateralWristAxis {
    left_x: f32,
    right_x: f32,
    center_y: f32,
    slope: f32,
    confidence: f32,
}

fn bilateral_wrist_axes(
    subjects: &[PoseCandidate],
    width: usize,
    height: usize,
) -> Vec<BilateralWristAxis> {
    reliable_wrist_pairs(subjects)
        .into_iter()
        .filter_map(|pair| {
            let (left, right) = (pair.left?, pair.right?);
            let confidence = left.confidence.min(right.confidence);
            let left_x = left.x * width as f32;
            let right_x = right.x * width as f32;
            let dx = right_x - left_x;
            if confidence < 0.50 || dx.abs() < width as f32 * 0.16 {
                return None;
            }
            let left_y = left.y * height as f32;
            let right_y = right.y * height as f32;
            Some(BilateralWristAxis {
                left_x,
                right_x,
                center_y: (left_y + right_y) * 0.5,
                slope: ((right_y - left_y) / dx).clamp(-0.15, 0.15),
                confidence,
            })
        })
        .collect()
}

fn closest_bilateral_wrist_axis(
    subjects: &[PoseCandidate],
    width: usize,
    height: usize,
    target_y: f32,
) -> Option<BilateralWristAxis> {
    bilateral_wrist_axes(subjects, width, height)
        .into_iter()
        .min_by(|left, right| {
            (left.center_y - target_y)
                .abs()
                .total_cmp(&(right.center_y - target_y).abs())
        })
}

fn calibrated_wrist_shaft(
    subjects: &[PoseCandidate],
    width: usize,
    height: usize,
    wrist_offset_y: f32,
    predicted_y: Option<f32>,
) -> Option<ShaftCandidate> {
    bilateral_wrist_axes(subjects, width, height)
        .into_iter()
        .map(|axis| {
            let center_y = axis.center_y + wrist_offset_y;
            let extension = (axis.right_x - axis.left_x).abs() * 0.32;
            let continuity = predicted_y.map_or(0.65, |predicted| {
                gaussian((center_y - predicted).abs() / height as f32, 0.11)
            });
            ShaftCandidate {
                x1: axis.left_x.min(axis.right_x) - extension,
                x2: axis.left_x.max(axis.right_x) + extension,
                center_y,
                slope: axis.slope,
                score: (0.52 + axis.confidence * 0.12 + continuity * 0.08).clamp(0.0, 0.72),
                wrist_axis_support: 1.0,
                source: BarbellAxisSource::Fused,
            }
        })
        .max_by(|left, right| left.score.total_cmp(&right.score))
}

fn line_wrist_axis_support(
    center_y: f32,
    slope: f32,
    pairs: &[WristPair],
    width: usize,
    height: usize,
) -> f32 {
    if pairs.is_empty() {
        return 0.45;
    }
    pairs
        .iter()
        .map(|pair| {
            let residual = |point: WristPoint| {
                let x = point.x * width as f32;
                let line_y = center_y + slope * (x - width as f32 * 0.5);
                (point.y * height as f32 - line_y).abs() / height as f32
            };
            match (pair.left, pair.right) {
                (Some(left), Some(right)) => {
                    // A held shaft should pass close to both hands. Scoring by
                    // the worse hand prevents a rack or mirror line that only
                    // intersects one arm from winning.
                    gaussian(residual(left).max(residual(right)), 0.075)
                }
                (Some(point), None) | (None, Some(point)) => {
                    gaussian(residual(point), 0.060) * 0.72
                }
                (None, None) => 0.0,
            }
        })
        .fold(0.0, f32::max)
}

fn interval_wrist_support(intervals: &[Interval], wrist_xs: &[f32], width: usize) -> f32 {
    if wrist_xs.is_empty() {
        return 0.5;
    }
    let tolerance = width as f32 * 0.055;
    let supported = wrist_xs
        .iter()
        .filter(|normalized_x| {
            let x = **normalized_x * width as f32;
            intervals.iter().any(|interval| {
                x >= interval.start as f32 - tolerance && x <= interval.end as f32 + tolerance
            })
        })
        .count();
    supported as f32 / wrist_xs.len() as f32
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
