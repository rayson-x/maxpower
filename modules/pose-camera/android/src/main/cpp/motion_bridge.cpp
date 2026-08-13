#include <jni.h>
#include <cmath>
#include <limits>
#include <stdint.h>
#include <string>
#include <vector>

#include "motion_sdk.h"

namespace {

jint configure(
    uint32_t width,
    uint32_t height,
    uint32_t profile_code,
    uint32_t pose_schema,
    bool active,
    uint32_t canonical_feed_mirroring) {
  if (motion_sdk_reset(width, height, 1) != 0) return -1;
  if (motion_sdk_set_pose_schema(pose_schema) != 0) return -2;
  const std::string sequence = "mobile-native";
  if (motion_sdk_begin_sequence(static_cast<uint32_t>(sequence.size())) != 0) return -3;
  for (size_t index = 0; index < sequence.size(); ++index) {
    if (motion_sdk_set_sequence_byte(static_cast<uint32_t>(index), static_cast<uint8_t>(sequence[index])) != 0) {
      return -4;
    }
  }
  if (motion_sdk_commit_sequence() != 0) return -5;
  if (motion_sdk_set_profile(profile_code) != 0) return -6;
  // CameraX analysis buffers are unmirrored. Imported replay files may already
  // contain a horizontal flip, so callers pass unknown unless metadata says.
  if (motion_sdk_set_canonical_feed_mirroring(canonical_feed_mirroring) != 0) return -7;
  return active && motion_sdk_begin_set() != 0 ? -8 : 0;
}

bool as_u32(double value, uint32_t *output) {
  if (!std::isfinite(value) || value < 0.0 || value > std::numeric_limits<uint32_t>::max()
      || std::floor(value) != value) {
    return false;
  }
  *output = static_cast<uint32_t>(value);
  return true;
}

jbyteArray copy_packet(JNIEnv *env) {
  const uint32_t packet_length = motion_sdk_packet_len();
  std::vector<uint8_t> packet(packet_length);
  if (motion_sdk_copy_packet(packet.data(), packet.size()) != static_cast<ptrdiff_t>(packet.size())) {
    return nullptr;
  }
  jbyteArray output = env->NewByteArray(static_cast<jsize>(packet.size()));
  if (output == nullptr) return nullptr;
  env->SetByteArrayRegion(output, 0, static_cast<jsize>(packet.size()),
                          reinterpret_cast<const jbyte *>(packet.data()));
  return env->ExceptionCheck() ? nullptr : output;
}

}  // namespace

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_posecamera_MotionNative_nativeContractMajor(
    JNIEnv *, jobject) {
  return static_cast<jint>(motion_sdk_contract_major());
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_posecamera_MotionNative_nativeConfigure(
    JNIEnv *, jobject, jint width, jint height, jint profile_code, jint pose_schema,
    jboolean active, jint canonical_feed_mirroring) {
  return configure(static_cast<uint32_t>(width), static_cast<uint32_t>(height),
                   static_cast<uint32_t>(profile_code), static_cast<uint32_t>(pose_schema),
                   active == JNI_TRUE, static_cast<uint32_t>(canonical_feed_mirroring));
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_posecamera_MotionNative_nativeSetProfile(
    JNIEnv *, jobject, jint profile_code) {
  return motion_sdk_set_profile(static_cast<uint32_t>(profile_code));
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_posecamera_MotionNative_nativeInstallProfile(
    JNIEnv *env, jobject, jstring identity, jdoubleArray abi_arguments) {
  if (identity == nullptr || abi_arguments == nullptr) return -10;
  constexpr jsize kArgumentCount = 24;
  if (env->GetArrayLength(abi_arguments) != kArgumentCount) return -11;

  const jsize identity_length = env->GetStringUTFLength(identity);
  if (identity_length <= 0 || identity_length > 512) return -12;
  const char *identity_chars = env->GetStringUTFChars(identity, nullptr);
  if (identity_chars == nullptr) return -13;
  const std::string profile_identity(identity_chars, static_cast<size_t>(identity_length));
  env->ReleaseStringUTFChars(identity, identity_chars);

  std::vector<jdouble> values(static_cast<size_t>(kArgumentCount));
  env->GetDoubleArrayRegion(abi_arguments, 0, kArgumentCount, values.data());
  if (env->ExceptionCheck()) return -14;

  uint32_t integers[19];
  constexpr size_t kIntegerArgumentIndexes[19] = {
      0, 1, 2, 3, 4, 5, 6, 7,
      8, 9, 10, 11, 12, 13, 14, 15,
      21, 22, 23,
  };
  for (size_t index = 0; index < 19; ++index) {
    if (!as_u32(values[kIntegerArgumentIndexes[index]], &integers[index])) return -15;
  }
  for (size_t index = 16; index <= 20; ++index) {
    if (!std::isfinite(values[index])) return -16;
  }

  if (motion_sdk_begin_profile_identity(static_cast<uint32_t>(profile_identity.size())) != 0) {
    return -17;
  }
  for (size_t index = 0; index < profile_identity.size(); ++index) {
    if (motion_sdk_set_profile_identity_byte(
            static_cast<uint32_t>(index),
            static_cast<uint8_t>(profile_identity[index])) != 0) {
      return -18;
    }
  }
  return motion_sdk_install_profile(
      integers[0], integers[1], integers[2], integers[3], integers[4], integers[5],
      integers[6], integers[7], integers[8], integers[9], integers[10], integers[11],
      integers[12], integers[13], integers[14], integers[15],
      static_cast<float>(values[16]), static_cast<float>(values[17]),
      static_cast<float>(values[18]), static_cast<float>(values[19]),
      static_cast<float>(values[20]), integers[16], integers[17], integers[18]);
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_posecamera_MotionNative_nativeSetActive(
    JNIEnv *, jobject, jboolean active) {
  return active == JNI_TRUE ? motion_sdk_begin_set() : motion_sdk_finish_set();
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_posecamera_MotionNative_nativePauseSet(JNIEnv *, jobject) {
  return motion_sdk_pause_set();
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_posecamera_MotionNative_nativeResumeSet(JNIEnv *, jobject) {
  return motion_sdk_resume_set();
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_expo_modules_posecamera_MotionNative_nativeProcessFrame(
    JNIEnv *env, jobject, jlong timestamp_ms, jdoubleArray flat_landmarks) {
  if (timestamp_ms < 0) return nullptr;
  const jsize length = env->GetArrayLength(flat_landmarks);
  if (length % 4 != 0) return nullptr;
  std::vector<jdouble> values(static_cast<size_t>(length));
  env->GetDoubleArrayRegion(flat_landmarks, 0, length, values.data());
  const uint64_t timestamp = static_cast<uint64_t>(timestamp_ms);
  const uint32_t count = static_cast<uint32_t>(length / 4);
  if (motion_sdk_begin_frame(static_cast<uint32_t>(timestamp),
                             static_cast<uint32_t>(timestamp >> 32), count) != 0) {
    return nullptr;
  }
  for (uint32_t index = 0; index < count; ++index) {
    const size_t offset = static_cast<size_t>(index) * 4;
    if (motion_sdk_set_landmark(index,
                                static_cast<float>(values[offset]),
                                static_cast<float>(values[offset + 1]),
                                static_cast<float>(values[offset + 2]),
                                static_cast<float>(values[offset + 3])) != 0) {
      return nullptr;
    }
  }
  if (motion_sdk_process_frame() != 0) return nullptr;
  return copy_packet(env);
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_expo_modules_posecamera_MotionNative_nativeProcessObservations(
    JNIEnv *env,
    jobject,
    jlong timestamp_ms,
    jlongArray candidate_ids,
    jdoubleArray candidate_metadata,
    jdoubleArray flat_landmarks,
    jint landmark_count,
    jlongArray equipment_ids,
    jdoubleArray equipment_metadata,
    jbyteArray visual_luma,
    jint visual_width,
    jint visual_height) {
  if (timestamp_ms < 0 || candidate_ids == nullptr || candidate_metadata == nullptr
      || flat_landmarks == nullptr || equipment_ids == nullptr || equipment_metadata == nullptr
      || landmark_count < 0 || landmark_count > 256) {
    return nullptr;
  }
  const jsize candidate_count = env->GetArrayLength(candidate_ids);
  const jsize equipment_count = env->GetArrayLength(equipment_ids);
  const int64_t expected_metadata = static_cast<int64_t>(candidate_count) * 7;
  const int64_t expected_landmarks = static_cast<int64_t>(candidate_count)
      * static_cast<int64_t>(landmark_count) * 4;
  const int64_t legacy_equipment_metadata = static_cast<int64_t>(equipment_count) * 9;
  const int64_t axis_equipment_metadata = static_cast<int64_t>(equipment_count) * 14;
  const jsize equipment_metadata_length = env->GetArrayLength(equipment_metadata);
  size_t equipment_metadata_stride = 9;
  int64_t expected_equipment_metadata = legacy_equipment_metadata;
  if (equipment_count > 0
      && axis_equipment_metadata <= std::numeric_limits<jsize>::max()
      && equipment_metadata_length == static_cast<jsize>(axis_equipment_metadata)) {
    equipment_metadata_stride = 14;
    expected_equipment_metadata = axis_equipment_metadata;
  }
  if (expected_metadata > std::numeric_limits<jsize>::max()
      || expected_landmarks > std::numeric_limits<jsize>::max()
      || legacy_equipment_metadata > std::numeric_limits<jsize>::max()
      || axis_equipment_metadata > std::numeric_limits<jsize>::max()
      || env->GetArrayLength(candidate_metadata) != static_cast<jsize>(expected_metadata)
      || env->GetArrayLength(flat_landmarks) != static_cast<jsize>(expected_landmarks)
      || equipment_metadata_length != static_cast<jsize>(expected_equipment_metadata)) {
    return nullptr;
  }

  std::vector<jlong> ids(static_cast<size_t>(candidate_count));
  std::vector<jdouble> metadata(static_cast<size_t>(expected_metadata));
  std::vector<jdouble> landmarks(static_cast<size_t>(expected_landmarks));
  std::vector<jlong> equipment_ids_buffer(static_cast<size_t>(equipment_count));
  std::vector<jdouble> equipment_metadata_buffer(
      static_cast<size_t>(expected_equipment_metadata));
  env->GetLongArrayRegion(candidate_ids, 0, candidate_count, ids.data());
  env->GetDoubleArrayRegion(candidate_metadata, 0, static_cast<jsize>(expected_metadata), metadata.data());
  env->GetDoubleArrayRegion(flat_landmarks, 0, static_cast<jsize>(expected_landmarks), landmarks.data());
  env->GetLongArrayRegion(equipment_ids, 0, equipment_count, equipment_ids_buffer.data());
  env->GetDoubleArrayRegion(
      equipment_metadata, 0, static_cast<jsize>(expected_equipment_metadata),
      equipment_metadata_buffer.data());
  if (env->ExceptionCheck()) return nullptr;

  const uint64_t timestamp = static_cast<uint64_t>(timestamp_ms);
  if (motion_sdk_begin_multi(static_cast<uint32_t>(timestamp),
                             static_cast<uint32_t>(timestamp >> 32)) != 0) {
    return nullptr;
  }
  for (jsize candidate = 0; candidate < candidate_count; ++candidate) {
    const size_t metadata_offset = static_cast<size_t>(candidate) * 7;
    for (size_t index = 0; index < 7; ++index) {
      if (!std::isfinite(metadata[metadata_offset + index])) return nullptr;
    }
    const uint64_t id = static_cast<uint64_t>(ids[static_cast<size_t>(candidate)]);
    if (motion_sdk_begin_candidate(
            static_cast<uint32_t>(id),
            static_cast<uint32_t>(id >> 32),
            static_cast<float>(metadata[metadata_offset]),
            static_cast<float>(metadata[metadata_offset + 1]),
            static_cast<float>(metadata[metadata_offset + 2]),
            static_cast<float>(metadata[metadata_offset + 3]),
            static_cast<float>(metadata[metadata_offset + 4]),
            static_cast<float>(metadata[metadata_offset + 5]),
            static_cast<float>(metadata[metadata_offset + 6]),
            static_cast<uint32_t>(landmark_count)) != 0) {
      return nullptr;
    }
    for (jint index = 0; index < landmark_count; ++index) {
      const size_t offset = (
          static_cast<size_t>(candidate) * static_cast<size_t>(landmark_count)
          + static_cast<size_t>(index)) * 4;
      for (size_t component = 0; component < 4; ++component) {
        if (!std::isfinite(landmarks[offset + component])) return nullptr;
      }
      if (motion_sdk_set_landmark(
              static_cast<uint32_t>(index),
              static_cast<float>(landmarks[offset]),
              static_cast<float>(landmarks[offset + 1]),
              static_cast<float>(landmarks[offset + 2]),
              static_cast<float>(landmarks[offset + 3])) != 0) {
        return nullptr;
      }
    }
    if (motion_sdk_commit_candidate() != 0) return nullptr;
  }
  if (visual_luma != nullptr) {
    if (visual_width < 8 || visual_height < 8) return nullptr;
    const int64_t expected_luma = static_cast<int64_t>(visual_width)
        * static_cast<int64_t>(visual_height);
    if (expected_luma <= 0 || expected_luma > std::numeric_limits<jsize>::max()
        || env->GetArrayLength(visual_luma) != static_cast<jsize>(expected_luma)) {
      return nullptr;
    }
    std::vector<jbyte> luma(static_cast<size_t>(expected_luma));
    env->GetByteArrayRegion(
        visual_luma, 0, static_cast<jsize>(expected_luma), luma.data());
    if (env->ExceptionCheck()
        || motion_sdk_begin_visual_equipment_frame(
               static_cast<uint32_t>(visual_width),
               static_cast<uint32_t>(visual_height),
               static_cast<uint32_t>(expected_luma)) != 0
        || motion_sdk_copy_visual_equipment_luma(
               reinterpret_cast<const uint8_t *>(luma.data()), luma.size()) != 0
        || motion_sdk_detect_barbell_axis() != 0) {
      return nullptr;
    }
  }
  for (jsize equipment = 0; equipment < equipment_count; ++equipment) {
    const size_t offset = static_cast<size_t>(equipment) * equipment_metadata_stride;
    for (size_t component = 0; component < equipment_metadata_stride; ++component) {
      if (!std::isfinite(equipment_metadata_buffer[offset + component])) return nullptr;
    }
    uint32_t kind = 0;
    uint32_t source = 0;
    uint32_t flags = 0;
    if (!as_u32(equipment_metadata_buffer[offset], &kind)
        || !as_u32(equipment_metadata_buffer[offset + 7], &source)
        || !as_u32(equipment_metadata_buffer[offset + 8], &flags)) {
      return nullptr;
    }
    uint32_t axis_present = 0;
    if (equipment_metadata_stride == 14
        && (!as_u32(equipment_metadata_buffer[offset + 9], &axis_present)
            || axis_present > 1)) {
      return nullptr;
    }
    const uint64_t id = static_cast<uint64_t>(
        equipment_ids_buffer[static_cast<size_t>(equipment)]);
    const int32_t equipment_status = axis_present == 1
        ? motion_sdk_add_equipment_axis_observation(
            static_cast<uint32_t>(id),
            static_cast<uint32_t>(id >> 32),
            kind,
            static_cast<float>(equipment_metadata_buffer[offset + 1]),
            static_cast<float>(equipment_metadata_buffer[offset + 2]),
            static_cast<float>(equipment_metadata_buffer[offset + 3]),
            static_cast<float>(equipment_metadata_buffer[offset + 4]),
            static_cast<float>(equipment_metadata_buffer[offset + 10]),
            static_cast<float>(equipment_metadata_buffer[offset + 11]),
            static_cast<float>(equipment_metadata_buffer[offset + 12]),
            static_cast<float>(equipment_metadata_buffer[offset + 13]),
            static_cast<float>(equipment_metadata_buffer[offset + 5]),
            static_cast<float>(equipment_metadata_buffer[offset + 6]),
            source,
            flags)
        : motion_sdk_add_equipment_observation(
            static_cast<uint32_t>(id),
            static_cast<uint32_t>(id >> 32),
            kind,
            static_cast<float>(equipment_metadata_buffer[offset + 1]),
            static_cast<float>(equipment_metadata_buffer[offset + 2]),
            static_cast<float>(equipment_metadata_buffer[offset + 3]),
            static_cast<float>(equipment_metadata_buffer[offset + 4]),
            static_cast<float>(equipment_metadata_buffer[offset + 5]),
            static_cast<float>(equipment_metadata_buffer[offset + 6]),
            source,
            flags);
    if (equipment_status != 0) {
      return nullptr;
    }
  }
  if (motion_sdk_process_multi() != 0) return nullptr;
  return copy_packet(env);
}

extern "C" JNIEXPORT jdoubleArray JNICALL
Java_expo_modules_posecamera_MotionNative_nativeVisualBarbellAxis(
    JNIEnv *env, jobject) {
  const uint32_t source = motion_sdk_visual_barbell_axis_source();
  if (source == 0) return nullptr;
  if (source > 3) return nullptr;
  jdouble values[8] = {static_cast<jdouble>(source)};
  for (uint32_t field = 0; field < 7; ++field) {
    const float value = motion_sdk_visual_barbell_axis_number(field);
    if (!std::isfinite(value)) return nullptr;
    values[field + 1] = static_cast<jdouble>(value);
  }
  jdoubleArray output = env->NewDoubleArray(8);
  if (output == nullptr) return nullptr;
  env->SetDoubleArrayRegion(output, 0, 8, values);
  return env->ExceptionCheck() ? nullptr : output;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_posecamera_MotionNative_nativeIsCurrentFrameValid(
    JNIEnv *, jobject) {
  return motion_sdk_current_frame_valid() == 1 ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_posecamera_MotionNative_nativeClose(JNIEnv *, jobject) {
  motion_sdk_close();
}
