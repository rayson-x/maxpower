use std::{env, fs};

use form_coach_motion_sdk::web_abi::{
    motion_sdk_begin_frame, motion_sdk_begin_replay_set, motion_sdk_begin_sequence,
    motion_sdk_close, motion_sdk_commit_sequence, motion_sdk_copy_packet, motion_sdk_packet_len,
    motion_sdk_process_frame, motion_sdk_reset, motion_sdk_set_landmark, motion_sdk_set_profile,
    motion_sdk_set_sequence_byte,
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema: String,
    sequence_id: String,
    profile_code: u32,
    image_width: u32,
    image_height: u32,
    frames: Vec<FixtureFrame>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureFrame {
    timestamp_ms: u64,
    left_knee_lift: f32,
    right_knee_lift: f32,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = env::args().nth(1).ok_or("fixture path is required")?;
    let fixture: Fixture = serde_json::from_slice(&fs::read(path)?)?;
    if fixture.schema != "blazepose33" {
        return Err("fixture schema must be blazepose33".into());
    }

    checked(motion_sdk_close(), "close")?;
    checked(
        motion_sdk_begin_sequence(fixture.sequence_id.len() as u32),
        "begin sequence",
    )?;
    for (index, value) in fixture.sequence_id.bytes().enumerate() {
        checked(
            motion_sdk_set_sequence_byte(index as u32, u32::from(value)),
            "sequence byte",
        )?;
    }
    checked(motion_sdk_commit_sequence(), "commit sequence")?;
    checked(
        motion_sdk_reset(fixture.image_width, fixture.image_height, 0),
        "reset",
    )?;
    checked(motion_sdk_set_profile(fixture.profile_code), "profile")?;
    checked(motion_sdk_begin_replay_set(), "begin replay set")?;

    let mut packets = Vec::with_capacity(fixture.frames.len());
    for frame in fixture.frames {
        let landmarks = standing_landmarks(frame.left_knee_lift, frame.right_knee_lift);
        checked(
            motion_sdk_begin_frame(
                frame.timestamp_ms as u32,
                (frame.timestamp_ms >> 32) as u32,
                landmarks.len() as u32,
            ),
            "begin frame",
        )?;
        for (index, [x, y, z, visibility]) in landmarks.into_iter().enumerate() {
            checked(
                motion_sdk_set_landmark(index as u32, x, y, z, visibility),
                "landmark",
            )?;
        }
        checked(motion_sdk_process_frame(), "process frame")?;
        let mut packet = vec![0_u8; motion_sdk_packet_len() as usize];
        // SAFETY: `packet` is writable for exactly the capacity passed to the ABI.
        let copied = unsafe { motion_sdk_copy_packet(packet.as_mut_ptr(), packet.len()) };
        if copied != packet.len() as isize {
            return Err(format!("packet copy failed ({copied})").into());
        }
        packets.push(to_hex(&packet));
    }
    checked(motion_sdk_close(), "close")?;
    println!("{}", serde_json::to_string(&packets)?);
    Ok(())
}

fn checked(status: i32, operation: &str) -> Result<(), Box<dyn std::error::Error>> {
    if status == 0 {
        Ok(())
    } else {
        Err(format!("{operation} failed ({status})").into())
    }
}

fn standing_landmarks(left_knee_lift: f32, right_knee_lift: f32) -> Vec<[f32; 4]> {
    let mut landmarks = vec![[0.5, 0.5, 0.0, 1.0]; 33];
    landmarks[11] = [0.44, 0.30, 0.0, 1.0];
    landmarks[12] = [0.56, 0.30, 0.0, 1.0];
    landmarks[23] = [0.44, 0.50, 0.0, 1.0];
    landmarks[24] = [0.56, 0.50, 0.0, 1.0];
    landmarks[25] = [0.44, 0.68 - left_knee_lift, 0.0, 1.0];
    landmarks[26] = [0.56, 0.68 - right_knee_lift, 0.0, 1.0];
    landmarks[27] = [0.44, 0.86 - left_knee_lift, 0.0, 1.0];
    landmarks[28] = [0.56, 0.86 - right_knee_lift, 0.0, 1.0];
    landmarks
}

fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}
