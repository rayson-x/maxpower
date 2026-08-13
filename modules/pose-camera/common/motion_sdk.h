#ifndef MAXPOWER_MOTION_SDK_H
#define MAXPOWER_MOTION_SDK_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum MotionSdkProfileCode {
  MOTION_SDK_PROFILE_NONE = 0,
  MOTION_SDK_PROFILE_MARCH_IN_PLACE = 5,
  MOTION_SDK_PROFILE_SIDE_STEP_TOUCH = 6,
  MOTION_SDK_PROFILE_ALTERNATING_KNEE_RAISE = 7,
  MOTION_SDK_PROFILE_STEP_JACK = 8,
  MOTION_SDK_PROFILE_BARBELL_BENCH_PRESS_LOCAL_FRONT = 109,
  MOTION_SDK_PROFILE_BARBELL_BENCH_PRESS_LOCAL_FRONT_LEFT = 110,
  MOTION_SDK_PROFILE_BARBELL_BENCH_PRESS_LOCAL_FRONT_RIGHT = 111,
  MOTION_SDK_PROFILE_SEATED_BARBELL_SHOULDER_PRESS_LOCAL_FRONT = 112,
  MOTION_SDK_PROFILE_SEATED_BARBELL_SHOULDER_PRESS_LOCAL_FRONT_LEFT = 113,
  MOTION_SDK_PROFILE_SEATED_BARBELL_SHOULDER_PRESS_LOCAL_FRONT_RIGHT = 114,
  MOTION_SDK_PROFILE_DUMBBELL_SHOULDER_PRESS_FRONT = 115,
};

int32_t motion_sdk_begin_sequence(uint32_t length);
int32_t motion_sdk_set_sequence_byte(uint32_t index, uint32_t value);
int32_t motion_sdk_commit_sequence(void);
int32_t motion_sdk_reset(uint32_t width, uint32_t height, uint32_t fusion);
int32_t motion_sdk_set_pose_schema(uint32_t schema);
int32_t motion_sdk_set_profile(uint32_t profile_code);
int32_t motion_sdk_set_canonical_feed_mirroring(uint32_t mirrored);
int32_t motion_sdk_begin_profile_identity(uint32_t length);
int32_t motion_sdk_set_profile_identity_byte(uint32_t index, uint32_t value);
int32_t motion_sdk_install_profile(
    uint32_t hash_low,
    uint32_t hash_high,
    uint32_t maturity,
    uint32_t schema,
    uint32_t coordinate_unit,
    uint32_t state_machine,
    uint32_t required_capabilities,
    uint32_t direction,
    uint32_t primary_kind,
    uint32_t primary_0,
    uint32_t primary_1,
    uint32_t primary_2,
    uint32_t secondary_kind,
    uint32_t secondary_0,
    uint32_t secondary_1,
    uint32_t secondary_2,
    float start_amplitude,
    float min_primary_amplitude,
    float min_secondary_amplitude,
    float return_hysteresis,
    float ready_tolerance,
    uint32_t max_gap_ms,
    uint32_t min_rep_duration_ms,
    uint32_t max_rep_duration_ms);
int32_t motion_sdk_begin_set(void);
int32_t motion_sdk_finish_set(void);
int32_t motion_sdk_pause_set(void);
int32_t motion_sdk_resume_set(void);
int32_t motion_sdk_begin_frame(uint32_t timestamp_low, uint32_t timestamp_high, uint32_t landmark_count);
int32_t motion_sdk_set_landmark(uint32_t index, float x, float y, float z, float visibility);
int32_t motion_sdk_process_frame(void);
int32_t motion_sdk_begin_multi(uint32_t timestamp_low, uint32_t timestamp_high);
int32_t motion_sdk_begin_candidate(
    uint32_t id_low,
    uint32_t id_high,
    float x,
    float y,
    float width,
    float height,
    float red,
    float green,
    float blue,
    uint32_t landmark_count);
int32_t motion_sdk_commit_candidate(void);
int32_t motion_sdk_add_equipment_observation(
    uint32_t id_low,
    uint32_t id_high,
    uint32_t kind,
    float x,
    float y,
    float width,
    float height,
    float score,
    float uncertainty_px,
    uint32_t source,
    uint32_t flags);
int32_t motion_sdk_add_equipment_axis_observation(
    uint32_t id_low,
    uint32_t id_high,
    uint32_t kind,
    float x,
    float y,
    float width,
    float height,
    float x1,
    float y1,
    float x2,
    float y2,
    float score,
    float uncertainty_px,
    uint32_t source,
    uint32_t flags);
int32_t motion_sdk_begin_visual_equipment_frame(
    uint32_t width,
    uint32_t height,
    uint32_t length);
int32_t motion_sdk_copy_visual_equipment_luma(const uint8_t *input, size_t length);
int32_t motion_sdk_detect_barbell_axis(void);
uint32_t motion_sdk_visual_barbell_axis_source(void);
float motion_sdk_visual_barbell_axis_number(uint32_t field);
int32_t motion_sdk_process_multi(void);
int32_t motion_sdk_current_frame_valid(void);
uint32_t motion_sdk_packet_len(void);
ptrdiff_t motion_sdk_copy_packet(uint8_t *output, size_t capacity);
uint32_t motion_sdk_contract_major(void);
uint32_t motion_sdk_contract_minor(void);
int32_t motion_sdk_close(void);

#ifdef __cplusplus
}
#endif

#endif
