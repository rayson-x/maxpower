#ifndef FORM_COACH_MOTION_SDK_H
#define FORM_COACH_MOTION_SDK_H

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
};

int32_t motion_sdk_begin_sequence(uint32_t length);
int32_t motion_sdk_set_sequence_byte(uint32_t index, uint32_t value);
int32_t motion_sdk_commit_sequence(void);
int32_t motion_sdk_reset(uint32_t width, uint32_t height, uint32_t fusion);
int32_t motion_sdk_set_profile(uint32_t profile_code);
int32_t motion_sdk_begin_set(void);
int32_t motion_sdk_finish_set(void);
int32_t motion_sdk_begin_frame(uint32_t timestamp_low, uint32_t timestamp_high, uint32_t landmark_count);
int32_t motion_sdk_set_landmark(uint32_t index, float x, float y, float z, float visibility);
int32_t motion_sdk_process_frame(void);
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
