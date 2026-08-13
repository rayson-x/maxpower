use maxpower_motion_sdk::web_abi::{
    motion_sdk_add_equipment_observation, motion_sdk_begin_candidate, motion_sdk_begin_multi,
    motion_sdk_begin_sequence, motion_sdk_close, motion_sdk_commit_candidate,
    motion_sdk_commit_sequence, motion_sdk_copy_packet, motion_sdk_current_frame_valid,
    motion_sdk_packet_len, motion_sdk_process_multi, motion_sdk_reset, motion_sdk_set_landmark,
    motion_sdk_set_pose_schema, motion_sdk_set_profile, motion_sdk_set_sequence_byte,
};
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: String,
    source: Source,
    bridge_config: BridgeConfig,
    frames: Vec<FixtureFrame>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Source {
    capture_id: String,
    video_sha256: String,
    width_px: u32,
    height_px: u32,
    start_ms: u64,
    end_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeConfig {
    sequence_id: String,
    fusion_code: u32,
    pose_schema_code: u32,
    profile_code: u32,
    active: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureFrame {
    source_frame_number: u64,
    timestamp_ms: u64,
    candidates: Vec<FixtureCandidate>,
    #[serde(default)]
    equipment_observations: Vec<FixtureEquipmentObservation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureCandidate {
    candidate_id: u64,
    bbox: [f32; 4],
    torso_color: [f32; 3],
    landmarks: Vec<[f32; 4]>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureEquipmentObservation {
    proposal_id: u64,
    kind: String,
    bbox: [f32; 4],
    score: f32,
    uncertainty_px: Option<f32>,
    source: String,
    attributes: FixtureEquipmentAttributes,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureEquipmentAttributes {
    reflection_candidate: bool,
    static_rack_candidate: bool,
    occlusion: String,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Oracle {
    schema_version: &'static str,
    generated_by: &'static str,
    fixture_identity: FixtureIdentity,
    frames: Vec<OracleFrame>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureIdentity {
    fixture_schema_version: String,
    capture_id: String,
    video_sha256: String,
    width_px: u32,
    height_px: u32,
    start_ms: u64,
    end_ms: u64,
    frame_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OracleFrame {
    source_frame_number: u64,
    timestamp_ms: u64,
    candidate_ids: Vec<u64>,
    packet_length: usize,
    packet_hex: String,
    current_frame_valid: bool,
}

fn require_status(label: &str, status: i32) -> Result<(), String> {
    if status == 0 {
        Ok(())
    } else {
        Err(format!("{label} failed ({status})"))
    }
}

fn configure(fixture: &Fixture) -> Result<(), String> {
    let config = &fixture.bridge_config;
    if config.active {
        return Err("oracle only accepts inactive research replay fixtures".into());
    }
    require_status("close", motion_sdk_close())?;
    require_status(
        "reset",
        motion_sdk_reset(
            fixture.source.width_px,
            fixture.source.height_px,
            config.fusion_code,
        ),
    )?;
    require_status(
        "pose schema",
        motion_sdk_set_pose_schema(config.pose_schema_code),
    )?;
    let sequence = config.sequence_id.as_bytes();
    require_status(
        "begin sequence",
        motion_sdk_begin_sequence(sequence.len() as u32),
    )?;
    for (index, value) in sequence.iter().enumerate() {
        require_status(
            "set sequence byte",
            motion_sdk_set_sequence_byte(index as u32, u32::from(*value)),
        )?;
    }
    require_status("commit sequence", motion_sdk_commit_sequence())?;
    require_status("profile", motion_sdk_set_profile(config.profile_code))
}

fn replay(fixture: &Fixture) -> Result<Oracle, String> {
    configure(fixture)?;
    let mut oracle_frames = Vec::with_capacity(fixture.frames.len());
    for frame in &fixture.frames {
        require_status(
            "begin multi",
            motion_sdk_begin_multi(frame.timestamp_ms as u32, (frame.timestamp_ms >> 32) as u32),
        )?;
        for candidate in &frame.candidates {
            if candidate.landmarks.len() != 26 {
                return Err(format!(
                    "frame {} candidate {} is not Halpe-26",
                    frame.source_frame_number, candidate.candidate_id
                ));
            }
            require_status(
                "begin candidate",
                motion_sdk_begin_candidate(
                    candidate.candidate_id as u32,
                    (candidate.candidate_id >> 32) as u32,
                    candidate.bbox[0],
                    candidate.bbox[1],
                    candidate.bbox[2],
                    candidate.bbox[3],
                    candidate.torso_color[0],
                    candidate.torso_color[1],
                    candidate.torso_color[2],
                    candidate.landmarks.len() as u32,
                ),
            )?;
            for (index, point) in candidate.landmarks.iter().enumerate() {
                if !point.iter().all(|value| value.is_finite()) {
                    return Err(format!(
                        "frame {} candidate {} contains a non-finite point",
                        frame.source_frame_number, candidate.candidate_id
                    ));
                }
                require_status(
                    "set landmark",
                    motion_sdk_set_landmark(index as u32, point[0], point[1], point[2], point[3]),
                )?;
            }
            require_status("commit candidate", motion_sdk_commit_candidate())?;
        }
        for observation in &frame.equipment_observations {
            let kind = match observation.kind.as_str() {
                "weight_plate" => 0,
                "barbell_shaft" => 1,
                "dumbbell" => 2,
                "machine_handle" => 3,
                unknown => return Err(format!("unknown equipment kind: {unknown}")),
            };
            let source = match observation.source.as_str() {
                "detector" => 0,
                "optical_flow" => 1,
                "geometry" => 2,
                "predicted" => 3,
                unknown => return Err(format!("unknown equipment source: {unknown}")),
            };
            let mut flags = 0;
            if observation.attributes.reflection_candidate {
                flags |= 1;
            }
            if observation.attributes.static_rack_candidate {
                flags |= 1 << 1;
            }
            flags |= match observation.attributes.occlusion.as_str() {
                "none" => 0,
                "partial" => 1 << 2,
                "heavy" => 1 << 3,
                unknown => return Err(format!("unknown equipment occlusion: {unknown}")),
            };
            if observation.attributes.truncated {
                flags |= 1 << 4;
            }
            require_status(
                "add equipment observation",
                motion_sdk_add_equipment_observation(
                    observation.proposal_id as u32,
                    (observation.proposal_id >> 32) as u32,
                    kind,
                    observation.bbox[0],
                    observation.bbox[1],
                    observation.bbox[2],
                    observation.bbox[3],
                    observation.score,
                    observation.uncertainty_px.unwrap_or(-1.0),
                    source,
                    flags,
                ),
            )?;
        }
        require_status("process multi", motion_sdk_process_multi())?;
        let mut packet = vec![0_u8; motion_sdk_packet_len() as usize];
        // SAFETY: packet is writable for the exact length passed to the C ABI.
        let copied = unsafe { motion_sdk_copy_packet(packet.as_mut_ptr(), packet.len()) };
        if copied != packet.len() as isize {
            return Err(format!(
                "copy packet returned {copied}, expected {}",
                packet.len()
            ));
        }
        oracle_frames.push(OracleFrame {
            source_frame_number: frame.source_frame_number,
            timestamp_ms: frame.timestamp_ms,
            candidate_ids: frame
                .candidates
                .iter()
                .map(|candidate| candidate.candidate_id)
                .collect(),
            packet_length: packet.len(),
            packet_hex: packet.iter().map(|byte| format!("{byte:02x}")).collect(),
            current_frame_valid: motion_sdk_current_frame_valid() == 1,
        });
    }
    require_status("close", motion_sdk_close())?;
    Ok(Oracle {
        schema_version: "maxpower-rust-halpe26-bridge-oracle/v1",
        generated_by: "maxpower-motion-sdk real_halpe26_bridge_oracle",
        fixture_identity: FixtureIdentity {
            fixture_schema_version: fixture.schema_version.clone(),
            capture_id: fixture.source.capture_id.clone(),
            video_sha256: fixture.source.video_sha256.clone(),
            width_px: fixture.source.width_px,
            height_px: fixture.source.height_px,
            start_ms: fixture.source.start_ms,
            end_ms: fixture.source.end_ms,
            frame_count: fixture.frames.len(),
        },
        frames: oracle_frames,
    })
}

fn parse_paths() -> Result<(PathBuf, PathBuf), String> {
    let mut args = env::args_os().skip(1);
    let mut fixture = None;
    let mut output = None;
    while let Some(argument) = args.next() {
        match argument.to_string_lossy().as_ref() {
            "--fixture" => fixture = args.next().map(PathBuf::from),
            "--output" => output = args.next().map(PathBuf::from),
            unknown => return Err(format!("unknown argument: {unknown}")),
        }
    }
    match (fixture, output) {
        (Some(fixture), Some(output)) => Ok((fixture, output)),
        _ => Err("usage: real_halpe26_bridge_oracle --fixture PATH --output PATH".into()),
    }
}

fn read_fixture(path: &Path) -> Result<Fixture, String> {
    let bytes = fs::read(path).map_err(|error| format!("read {}: {error}", path.display()))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("parse {}: {error}", path.display()))
}

fn run() -> Result<(), String> {
    let (fixture_path, output_path) = parse_paths()?;
    let fixture = read_fixture(&fixture_path)?;
    let oracle = replay(&fixture)?;
    let mut bytes = serde_json::to_vec_pretty(&oracle).map_err(|error| error.to_string())?;
    bytes.push(b'\n');
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create {}: {error}", parent.display()))?;
    }
    fs::write(&output_path, bytes)
        .map_err(|error| format!("write {}: {error}", output_path.display()))?;
    println!(
        "wrote {} Rust packet oracles to {}",
        oracle.frames.len(),
        output_path.display()
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
