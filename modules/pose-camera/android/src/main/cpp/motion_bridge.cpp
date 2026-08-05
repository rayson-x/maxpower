#include <jni.h>
#include <stdint.h>
#include <string>
#include <vector>

#include "motion_sdk.h"

namespace {

jint configure(uint32_t width, uint32_t height, uint32_t profile_code, bool active) {
  if (motion_sdk_reset(width, height, 1) != 0) return -1;
  const std::string sequence = "mobile-native";
  if (motion_sdk_begin_sequence(static_cast<uint32_t>(sequence.size())) != 0) return -2;
  for (size_t index = 0; index < sequence.size(); ++index) {
    if (motion_sdk_set_sequence_byte(static_cast<uint32_t>(index), static_cast<uint8_t>(sequence[index])) != 0) {
      return -3;
    }
  }
  if (motion_sdk_commit_sequence() != 0) return -4;
  if (motion_sdk_set_profile(profile_code) != 0) return -5;
  return active && motion_sdk_begin_set() != 0 ? -6 : 0;
}

}  // namespace

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_posecamera_MotionNative_nativeConfigure(
    JNIEnv *, jobject, jint width, jint height, jint profile_code, jboolean active) {
  return configure(static_cast<uint32_t>(width), static_cast<uint32_t>(height),
                   static_cast<uint32_t>(profile_code), active == JNI_TRUE);
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_posecamera_MotionNative_nativeSetProfile(
    JNIEnv *, jobject, jint profile_code) {
  return motion_sdk_set_profile(static_cast<uint32_t>(profile_code));
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_posecamera_MotionNative_nativeSetActive(
    JNIEnv *, jobject, jboolean active) {
  return active == JNI_TRUE ? motion_sdk_begin_set() : motion_sdk_finish_set();
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
  const uint32_t packet_length = motion_sdk_packet_len();
  std::vector<uint8_t> packet(packet_length);
  if (motion_sdk_copy_packet(packet.data(), packet.size()) != static_cast<ptrdiff_t>(packet.size())) {
    return nullptr;
  }
  jbyteArray output = env->NewByteArray(static_cast<jsize>(packet.size()));
  env->SetByteArrayRegion(output, 0, static_cast<jsize>(packet.size()),
                          reinterpret_cast<const jbyte *>(packet.data()));
  return output;
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
