//! Research-only replay for phase-normalized personal temporal templates.
//!
//! This module deliberately stays separate from `ExerciseProfile`: learned
//! model artifacts and scalar runtime profiles have different lifecycle and
//! evidence contracts. It consumes a frozen Rust-canonical sequence artifact
//! and never installs or promotes a production profile.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

const PHASE_NODES: usize = 32;
const BLAZEPOSE33_LANDMARKS: [usize; 9] = [0, 11, 12, 13, 14, 15, 16, 23, 24];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Dataset {
    records: Vec<DatasetRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DatasetRecord {
    capture_id: String,
    source_capture_id: Option<String>,
    exercise_id: String,
    capture_position: String,
    expected_count: usize,
    evaluation_window: Option<EvaluationWindow>,
    #[serde(default)]
    segments: Vec<TruthSegment>,
    source: DatasetSource,
}

#[derive(Debug, Deserialize)]
struct DatasetSource {
    keypoints: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvaluationWindow {
    start_ms: f32,
    end_ms: f32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TruthSegment {
    start_ms: f32,
    peak_ms: f32,
    end_ms: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalArtifact {
    rust_wasm_sha256: String,
    captures: HashMap<String, CanonicalCapture>,
}

#[derive(Debug, Deserialize)]
struct CanonicalCapture {
    poses: Vec<CanonicalPose>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalPose {
    timestamp_ms: f32,
    landmarks: Vec<CanonicalPoint>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
struct CanonicalPoint {
    x: Option<f32>,
    y: Option<f32>,
    z: Option<f32>,
    visibility: Option<f32>,
    renderable: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemporalModel {
    schema_version: String,
    dataset_sha256: String,
    canonical_input: Option<CanonicalInput>,
    feature_contract: FeatureContract,
    buckets: BTreeMap<String, ModelBucket>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalInput {
    rust_wasm_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeatureContract {
    phase_nodes: usize,
    quantization: f32,
    pose_schema: Option<String>,
    landmark_indices: Option<Vec<usize>>,
}

#[derive(Debug, Deserialize)]
struct ModelBucket {
    mean: Vec<f32>,
    scale: Vec<f32>,
    templates: Vec<ModelTemplate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelTemplate {
    source_capture_id: String,
    duration_frames: usize,
    peak_ratio: f64,
    values: Vec<Vec<f32>>,
}

#[derive(Debug)]
struct Sequence<'a> {
    record: &'a DatasetRecord,
    source_capture_id: String,
    timestamps: Vec<f32>,
    features: Vec<Vec<f32>>,
}

#[derive(Clone, Debug)]
struct Candidate {
    start_index: usize,
    peak_index: usize,
    end_index: usize,
    score: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PredictedSegment {
    start_ms: f32,
    peak_ms: f32,
    end_ms: f32,
    score: f32,
    supervision: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentMatch {
    truth_index: usize,
    predicted_index: usize,
    start_offset_ms: f32,
    peak_offset_ms: f32,
    end_offset_ms: f32,
    iou: f32,
    aligned: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayRow {
    capture_id: String,
    source_capture_id: String,
    bucket: String,
    expected_set_count: usize,
    expected_count: usize,
    truth_count: usize,
    predicted_count: usize,
    matched_count: usize,
    aligned_count: usize,
    alignment_error_ms: f32,
    max_boundary_error_ms: f32,
    exact_set_count: bool,
    available_human_boundaries_exact: bool,
    exact: bool,
    weak_set_count_candidate_count: usize,
    evidence_reason_counts: BTreeMap<&'static str, usize>,
    predicted_segments: Vec<PredictedSegment>,
    segment_matches: Vec<SegmentMatch>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaySummary {
    evaluation_window_count: usize,
    source_capture_count: usize,
    expected_count: usize,
    truth_boundary_count: usize,
    predicted_count: usize,
    matched_count: usize,
    aligned_count: usize,
    exact_set_source_capture_count: usize,
    exact_set_and_available_boundary_source_capture_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaySection {
    mode: &'static str,
    pub summary: ReplaySummary,
    rows: Vec<ReplayRow>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemporalReplayReport {
    schema_version: &'static str,
    research_only: bool,
    production_promotion: bool,
    execution_backend: &'static str,
    rust_canonical_replay: bool,
    model_artifact: String,
    model_schema_version: String,
    dataset_sha256: String,
    rust_wasm_sha256: String,
    pub same_record: ReplaySection,
}

impl TemporalReplayReport {
    pub fn golden_exact(&self) -> bool {
        let summary = &self.same_record.summary;
        summary.predicted_count == summary.expected_count
            && summary.matched_count == summary.truth_boundary_count
            && summary.aligned_count == summary.truth_boundary_count
            && summary.exact_set_source_capture_count == summary.source_capture_count
            && summary.exact_set_and_available_boundary_source_capture_count
                == summary.source_capture_count
    }
}

pub fn replay_files(
    dataset_path: &Path,
    canonical_path: &Path,
    model_path: &Path,
) -> Result<TemporalReplayReport, String> {
    let dataset: Dataset = read_json(dataset_path)?;
    let canonical: CanonicalArtifact = read_json(canonical_path)?;
    let model: TemporalModel = read_json(model_path)?;
    if model.feature_contract.phase_nodes != PHASE_NODES {
        return Err(format!(
            "phase node mismatch: expected {PHASE_NODES}, got {}",
            model.feature_contract.phase_nodes
        ));
    }
    if !model.feature_contract.quantization.is_finite()
        || model.feature_contract.quantization <= 0.0
    {
        return Err("feature quantization must be finite and positive".into());
    }
    let landmark_indices = model
        .feature_contract
        .landmark_indices
        .as_deref()
        .unwrap_or(&BLAZEPOSE33_LANDMARKS);
    if landmark_indices.len() != 9 {
        return Err("temporal feature contract requires nine landmark indices".into());
    }
    if model.feature_contract.pose_schema.as_deref() == Some("halpe26")
        && landmark_indices != [0, 5, 6, 7, 8, 9, 10, 11, 12]
    {
        return Err("Halpe-26 temporal feature indices violate the COCO-17 prefix".into());
    }
    let model_wasm_hash = model
        .canonical_input
        .as_ref()
        .map(|input| input.rust_wasm_sha256.as_str())
        .ok_or("model has no Rust canonical input")?;
    if model_wasm_hash != canonical.rust_wasm_sha256 {
        return Err("model and canonical artifact Rust WASM hashes differ".into());
    }

    let sequences = build_sequences(&dataset, &canonical, &model)?;
    let rows = sequences
        .iter()
        .map(|sequence| evaluate_sequence(sequence, &model))
        .collect::<Result<Vec<_>, _>>()?;
    let summary = summarize(&rows);
    Ok(TemporalReplayReport {
        schema_version: "maxpower-personal-temporal-template-rust-replay/v1",
        research_only: true,
        production_promotion: false,
        execution_backend: "rust_reference_cli",
        rust_canonical_replay: true,
        model_artifact: model_path.display().to_string(),
        model_schema_version: model.schema_version,
        dataset_sha256: model.dataset_sha256,
        rust_wasm_sha256: canonical.rust_wasm_sha256,
        same_record: ReplaySection {
            mode: "same_source_golden_replay",
            summary,
            rows,
        },
    })
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
        .map_err(|error| format!("{}: {error}", path.display()))
}

fn build_sequences<'a>(
    dataset: &'a Dataset,
    canonical: &CanonicalArtifact,
    model: &TemporalModel,
) -> Result<Vec<Sequence<'a>>, String> {
    let landmark_indices = model
        .feature_contract
        .landmark_indices
        .as_deref()
        .unwrap_or(&BLAZEPOSE33_LANDMARKS);
    dataset
        .records
        .iter()
        .map(|record| {
            let capture = canonical
                .captures
                .get(&record.source.keypoints)
                .ok_or_else(|| format!("missing canonical capture {}", record.source.keypoints))?;
            let bucket_key = bucket_key(record);
            let bucket = model
                .buckets
                .get(&bucket_key)
                .ok_or_else(|| format!("missing model bucket {bucket_key}"))?;
            let mut previous: Option<Vec<f32>> = None;
            let mut timestamps = Vec::new();
            let mut features = Vec::new();
            for pose in &capture.poses {
                let position = frame_features(&pose.landmarks, landmark_indices);
                let velocity = previous
                    .as_ref()
                    .map(|old| {
                        position
                            .iter()
                            .zip(old)
                            .map(|(current, prior)| (current - prior).clamp(-3.0, 3.0))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_else(|| vec![0.0; position.len()]);
                previous = Some(position.clone());
                if record.evaluation_window.as_ref().is_some_and(|window| {
                    pose.timestamp_ms < window.start_ms || pose.timestamp_ms > window.end_ms
                }) {
                    continue;
                }
                let mut combined = position;
                combined.extend(velocity);
                if combined.len() != bucket.mean.len() || combined.len() != bucket.scale.len() {
                    return Err(format!("feature width mismatch for {bucket_key}"));
                }
                combined.iter_mut().enumerate().for_each(|(index, value)| {
                    *value = (*value - bucket.mean[index]) / bucket.scale[index];
                    *value = (*value / model.feature_contract.quantization).round_ties_even()
                        * model.feature_contract.quantization;
                });
                timestamps.push(pose.timestamp_ms);
                features.push(combined);
            }
            Ok(Sequence {
                record,
                source_capture_id: record
                    .source_capture_id
                    .clone()
                    .unwrap_or_else(|| record.capture_id.clone()),
                timestamps,
                features,
            })
        })
        .collect()
}

fn frame_features(landmarks: &[CanonicalPoint], landmark_indices: &[usize]) -> Vec<f32> {
    let points = landmark_indices
        .iter()
        .map(|index| landmarks.get(*index).copied().unwrap_or_default())
        .collect::<Vec<_>>();
    let left_shoulder = points[1];
    let right_shoulder = points[2];
    let left_hip = points[7];
    let right_hip = points[8];
    let torso_center_x =
        (value(left_shoulder.x) + value(right_shoulder.x) + value(left_hip.x) + value(right_hip.x))
            / 4.0;
    let torso_center_y =
        (value(left_shoulder.y) + value(right_shoulder.y) + value(left_hip.y) + value(right_hip.y))
            / 4.0;
    let torso_scale = 0.05_f32
        .max(distance(left_shoulder, right_shoulder))
        .max(distance(left_hip, right_hip))
        .max((distance(left_shoulder, left_hip) + distance(right_shoulder, right_hip)) / 2.0);
    let mut output = Vec::with_capacity(71);
    for point in &points {
        let x = value(point.x);
        let y = value(point.y);
        output.extend([
            x,
            y,
            value(point.z),
            value(point.visibility).clamp(0.0, 1.0),
            if point
                .renderable
                .unwrap_or(point.x.is_some() && point.y.is_some())
            {
                1.0
            } else {
                0.0
            },
            (x - torso_center_x) / torso_scale,
            (y - torso_center_y) / torso_scale,
        ]);
    }
    output.extend([
        angle(points[1], points[3], points[5]),
        angle(points[2], points[4], points[6]),
        angle(points[7], points[1], points[3]),
        angle(points[8], points[2], points[4]),
        distance(points[5], points[6]) / torso_scale,
        distance(points[3], points[4]) / torso_scale,
        distance(points[5], points[1]) / torso_scale,
        distance(points[6], points[2]) / torso_scale,
    ]);
    output
}

fn value(value: Option<f32>) -> f32 {
    value.filter(|number| number.is_finite()).unwrap_or(0.0)
}

fn distance(left: CanonicalPoint, right: CanonicalPoint) -> f32 {
    (value(left.x) - value(right.x)).hypot(value(left.y) - value(right.y))
}

fn angle(left: CanonicalPoint, center: CanonicalPoint, right: CanonicalPoint) -> f32 {
    let ux = value(left.x) - value(center.x);
    let uy = value(left.y) - value(center.y);
    let vx = value(right.x) - value(center.x);
    let vy = value(right.y) - value(center.y);
    let denominator = ux.hypot(uy) * vx.hypot(vy);
    if denominator <= 1e-8 {
        return 0.0;
    }
    ((ux * vx + uy * vy) / denominator).clamp(-1.0, 1.0).acos() / std::f32::consts::PI
}

fn bucket_key(record: &DatasetRecord) -> String {
    format!("{}|{}", record.exercise_id, record.capture_position)
}

fn sampled_indices(span: usize) -> [usize; PHASE_NODES] {
    std::array::from_fn(|index| {
        ((index as f64 * span as f64) / (PHASE_NODES - 1) as f64).round_ties_even() as usize
    })
}

fn evaluate_sequence(sequence: &Sequence<'_>, model: &TemporalModel) -> Result<ReplayRow, String> {
    let bucket_name = bucket_key(sequence.record);
    let bucket = model
        .buckets
        .get(&bucket_name)
        .ok_or_else(|| format!("missing model bucket {bucket_name}"))?;
    let mut candidates_by_template = Vec::new();
    for template in bucket
        .templates
        .iter()
        .filter(|template| template.source_capture_id == sequence.source_capture_id)
    {
        let duration = template.duration_frames;
        if duration == 0
            || duration >= sequence.timestamps.len()
            || template.values.len() != PHASE_NODES
        {
            continue;
        }
        let offsets = sampled_indices(duration);
        let mut frontier = (0..sequence.timestamps.len() - duration)
            .map(|start| {
                let mut squared_error = 0.0_f32;
                let mut value_count = 0_usize;
                for (node, offset) in offsets.iter().enumerate() {
                    let observed = &sequence.features[start + offset];
                    let expected = &template.values[node];
                    if observed.len() != expected.len() {
                        return Err("template feature width mismatch".to_string());
                    }
                    for (left, right) in observed.iter().zip(expected) {
                        squared_error += (left - right).powi(2);
                        value_count += 1;
                    }
                }
                Ok(Candidate {
                    start_index: start,
                    peak_index: (start as f64 + duration as f64 * template.peak_ratio)
                        .round_ties_even()
                        .clamp(start as f64, (start + duration) as f64)
                        as usize,
                    end_index: start + duration,
                    score: squared_error / value_count.max(1) as f32,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        frontier.sort_by(|left, right| {
            left.score
                .total_cmp(&right.score)
                .then(left.start_index.cmp(&right.start_index))
        });
        candidates_by_template.push(frontier.into_iter().take(256).collect::<Vec<_>>());
    }
    let cross_runtime_tolerance = model.feature_contract.quantization.powi(2);
    let threshold = if sequence.record.expected_count > sequence.record.segments.len() {
        f32::INFINITY
    } else {
        cross_runtime_tolerance
    };
    let selected = select_ordered_template_candidates(
        candidates_by_template,
        sequence.record.expected_count.max(1),
        threshold,
        cross_runtime_tolerance,
    );
    let predicted_segments = selected
        .iter()
        .map(|candidate| PredictedSegment {
            start_ms: sequence.timestamps[candidate.start_index],
            peak_ms: sequence.timestamps[candidate.peak_index],
            end_ms: sequence.timestamps[candidate.end_index],
            score: candidate.score,
            supervision: if candidate.score <= cross_runtime_tolerance {
                "human_phase_exact_replay"
            } else {
                "weak_set_count_candidate"
            },
        })
        .collect::<Vec<_>>();
    let segment_matches = match_segments(&sequence.record.segments, &predicted_segments);
    let matched_count = segment_matches.len();
    let aligned_count = segment_matches.iter().filter(|item| item.aligned).count();
    let offsets = segment_matches.iter().flat_map(|item| {
        [
            item.start_offset_ms.abs(),
            item.peak_offset_ms.abs(),
            item.end_offset_ms.abs(),
        ]
    });
    let boundary_offsets = offsets.collect::<Vec<_>>();
    let weak_count = predicted_segments
        .iter()
        .filter(|segment| segment.supervision == "weak_set_count_candidate")
        .count();
    let exact_set_count = predicted_segments.len() == sequence.record.expected_count;
    let available_boundaries_exact = aligned_count == sequence.record.segments.len();
    Ok(ReplayRow {
        capture_id: sequence.record.capture_id.clone(),
        source_capture_id: sequence.source_capture_id.clone(),
        bucket: bucket_name,
        expected_set_count: sequence.record.expected_count,
        expected_count: sequence.record.expected_count,
        truth_count: sequence.record.segments.len(),
        predicted_count: predicted_segments.len(),
        matched_count,
        aligned_count,
        alignment_error_ms: boundary_offsets.iter().sum(),
        max_boundary_error_ms: boundary_offsets.into_iter().fold(0.0, f32::max),
        exact_set_count,
        available_human_boundaries_exact: available_boundaries_exact,
        exact: exact_set_count && available_boundaries_exact,
        weak_set_count_candidate_count: weak_count,
        evidence_reason_counts: if weak_count > 0 {
            BTreeMap::from([("weak_set_count_candidate", weak_count)])
        } else {
            BTreeMap::new()
        },
        predicted_segments,
        segment_matches,
    })
}

fn select_non_overlapping(
    mut candidates: Vec<Candidate>,
    limit: usize,
    threshold: f32,
) -> Vec<Candidate> {
    candidates.sort_by(|left, right| {
        left.score
            .total_cmp(&right.score)
            .then(left.start_index.cmp(&right.start_index))
            .then(left.end_index.cmp(&right.end_index))
    });
    let mut selected: Vec<Candidate> = Vec::new();
    for candidate in candidates {
        if candidate.score > threshold {
            break;
        }
        let overlaps = selected.iter().any(|other| {
            let intersection = candidate
                .end_index
                .min(other.end_index)
                .saturating_sub(candidate.start_index.max(other.start_index));
            let minimum_duration = (candidate.end_index - candidate.start_index)
                .min(other.end_index - other.start_index)
                .max(1);
            intersection as f32 / minimum_duration as f32 >= 0.45
        });
        if !overlaps {
            selected.push(candidate);
        }
        if selected.len() >= limit {
            break;
        }
    }
    selected.sort_by_key(|candidate| candidate.start_index);
    selected
}

/// Same-source templates are stored in reviewed rep order. Preserve that
/// order when several quantized windows have indistinguishable scores; a
/// global floating-point sort can otherwise assign two templates to the same
/// human cycle and drop the later rep.
fn select_ordered_template_candidates(
    mut candidates_by_template: Vec<Vec<Candidate>>,
    limit: usize,
    threshold: f32,
    exact_tolerance: f32,
) -> Vec<Candidate> {
    let mut selected: Vec<Candidate> = Vec::new();
    for candidates in &mut candidates_by_template {
        candidates.sort_by(|left, right| {
            left.score
                .total_cmp(&right.score)
                .then(left.start_index.cmp(&right.start_index))
        });
        let previous_start = selected.last().map(|candidate| candidate.start_index);
        let candidate = candidates.iter().find(|candidate| {
            candidate.score <= threshold
                && previous_start.is_none_or(|start| candidate.start_index > start)
                && !overlaps_selected(candidate, &selected)
        });
        if let Some(candidate) = candidate {
            selected.push(candidate.clone());
        }
        if selected.len() >= limit {
            break;
        }
    }
    if selected.len() < limit && threshold.is_infinite() {
        let remaining = candidates_by_template
            .into_iter()
            .flatten()
            .filter(|candidate| {
                candidate.score > exact_tolerance && !overlaps_selected(candidate, &selected)
            });
        for candidate in
            select_non_overlapping(remaining.collect(), limit - selected.len(), threshold)
        {
            if !overlaps_selected(&candidate, &selected) {
                selected.push(candidate);
            }
            if selected.len() >= limit {
                break;
            }
        }
    }
    selected.sort_by_key(|candidate| candidate.start_index);
    selected
}

fn overlaps_selected(candidate: &Candidate, selected: &[Candidate]) -> bool {
    selected.iter().any(|other| {
        let intersection = candidate
            .end_index
            .min(other.end_index)
            .saturating_sub(candidate.start_index.max(other.start_index));
        let minimum_duration = (candidate.end_index - candidate.start_index)
            .min(other.end_index - other.start_index)
            .max(1);
        intersection as f32 / minimum_duration as f32 >= 0.45
    })
}

fn match_segments(truth: &[TruthSegment], predicted: &[PredictedSegment]) -> Vec<SegmentMatch> {
    let mut remaining = (0..predicted.len()).collect::<HashSet<_>>();
    let mut output = Vec::new();
    for (truth_index, truth_segment) in truth.iter().enumerate() {
        let Some(predicted_index) = remaining.iter().copied().min_by(|left, right| {
            (predicted[*left].peak_ms - truth_segment.peak_ms)
                .abs()
                .total_cmp(&(predicted[*right].peak_ms - truth_segment.peak_ms).abs())
        }) else {
            break;
        };
        let prediction = &predicted[predicted_index];
        if (prediction.peak_ms - truth_segment.peak_ms).abs() > 1_500.0 {
            continue;
        }
        remaining.remove(&predicted_index);
        let start_offset_ms = prediction.start_ms - truth_segment.start_ms;
        let peak_offset_ms = prediction.peak_ms - truth_segment.peak_ms;
        let end_offset_ms = prediction.end_ms - truth_segment.end_ms;
        let intersection = prediction
            .end_ms
            .min(truth_segment.end_ms)
            .max(prediction.start_ms.max(truth_segment.start_ms))
            - prediction.start_ms.max(truth_segment.start_ms);
        let union = prediction.end_ms.max(truth_segment.end_ms)
            - prediction.start_ms.min(truth_segment.start_ms);
        let iou = intersection.max(0.0) / union.max(f32::EPSILON);
        let aligned = start_offset_ms.abs() <= 500.0
            && peak_offset_ms.abs() <= 250.0
            && end_offset_ms.abs() <= 500.0
            && iou >= 0.6;
        output.push(SegmentMatch {
            truth_index,
            predicted_index,
            start_offset_ms,
            peak_offset_ms,
            end_offset_ms,
            iou,
            aligned,
        });
    }
    output
}

fn summarize(rows: &[ReplayRow]) -> ReplaySummary {
    let mut by_source: BTreeMap<&str, Vec<&ReplayRow>> = BTreeMap::new();
    for row in rows {
        by_source
            .entry(&row.source_capture_id)
            .or_default()
            .push(row);
    }
    let exact_set_source_capture_count = by_source
        .values()
        .filter(|parts| {
            parts.iter().map(|row| row.predicted_count).sum::<usize>()
                == parts.iter().map(|row| row.expected_count).sum::<usize>()
        })
        .count();
    let exact_set_and_available_boundary_source_capture_count = by_source
        .values()
        .filter(|parts| {
            parts.iter().map(|row| row.predicted_count).sum::<usize>()
                == parts.iter().map(|row| row.expected_count).sum::<usize>()
                && parts.iter().map(|row| row.aligned_count).sum::<usize>()
                    == parts.iter().map(|row| row.truth_count).sum::<usize>()
        })
        .count();
    ReplaySummary {
        evaluation_window_count: rows.len(),
        source_capture_count: by_source.len(),
        expected_count: rows.iter().map(|row| row.expected_count).sum(),
        truth_boundary_count: rows.iter().map(|row| row.truth_count).sum(),
        predicted_count: rows.iter().map(|row| row.predicted_count).sum(),
        matched_count: rows.iter().map(|row| row.matched_count).sum(),
        aligned_count: rows.iter().map(|row| row.aligned_count).sum(),
        exact_set_source_capture_count,
        exact_set_and_available_boundary_source_capture_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn count_exact_but_truncated_cycle_does_not_pass_timeline_alignment() {
        let truth = vec![TruthSegment {
            start_ms: 1_000.0,
            peak_ms: 2_000.0,
            end_ms: 3_000.0,
        }];
        let predicted = vec![PredictedSegment {
            start_ms: 1_700.0,
            peak_ms: 2_000.0,
            end_ms: 2_300.0,
            score: 0.0,
            supervision: "human_phase_exact_replay",
        }];
        let matches = match_segments(&truth, &predicted);
        assert_eq!(matches.len(), 1);
        assert!(!matches[0].aligned);
        assert_eq!(matches[0].start_offset_ms, 700.0);
        assert_eq!(matches[0].end_offset_ms, -700.0);
    }

    #[test]
    fn overlap_selection_keeps_distinct_cycles() {
        let selected = select_non_overlapping(
            vec![
                Candidate {
                    start_index: 0,
                    peak_index: 2,
                    end_index: 4,
                    score: 0.0,
                },
                Candidate {
                    start_index: 1,
                    peak_index: 3,
                    end_index: 5,
                    score: 0.0,
                },
                Candidate {
                    start_index: 6,
                    peak_index: 8,
                    end_index: 10,
                    score: 0.0,
                },
            ],
            3,
            1e-10,
        );
        assert_eq!(selected.len(), 2);
        assert_eq!(selected[0].start_index, 0);
        assert_eq!(selected[1].start_index, 6);
    }
}
