#import "MotionBridge.h"

#import "motion_sdk.h"

#include <cmath>
#include <cstdint>
#include <limits>
#include <string>
#include <vector>

namespace {

constexpr NSUInteger kProfileArgumentCount = 24;

bool AsU32(NSNumber *number, uint32_t *output) {
  const double value = number.doubleValue;
  if (!std::isfinite(value) || value < 0 || value > std::numeric_limits<uint32_t>::max()
      || std::floor(value) != value) return false;
  *output = static_cast<uint32_t>(value);
  return true;
}

int32_t SetSequence() {
  const std::string sequence = "mobile-native";
  if (motion_sdk_begin_sequence(static_cast<uint32_t>(sequence.size())) != 0) return -3;
  for (size_t index = 0; index < sequence.size(); ++index) {
    if (motion_sdk_set_sequence_byte(static_cast<uint32_t>(index),
                                     static_cast<uint8_t>(sequence[index])) != 0) return -4;
  }
  return motion_sdk_commit_sequence() == 0 ? 0 : -5;
}

NSDictionary<NSString *, id> *ParseProfile(NSString *profileJSON) {
  if (!profileJSON.length) return @{@"mode": @"none", @"profileCode": @0};
  NSData *data = [profileJSON dataUsingEncoding:NSUTF8StringEncoding];
  id value = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  if (![value isKindOfClass:NSDictionary.class]) return nil;
  NSDictionary<NSString *, id> *profile = value;
  if (![profile[@"schemaVersion"] isEqual:@"maxpower-native-recognition-profile/v1"]) return nil;
  return profile;
}

int32_t InstallProfile(NSDictionary<NSString *, id> *profile) {
  NSString *mode = profile[@"mode"];
  NSNumber *profileCode = profile[@"profileCode"];
  if ([mode isEqualToString:@"none"] || [mode isEqualToString:@"built_in"]) {
    uint32_t code = 0;
    if (!profileCode || !AsU32(profileCode, &code) || code > 115
        || (code > 8 && code < 101)) return -10;
    return motion_sdk_set_profile(code);
  }
  if (![mode isEqualToString:@"data"]) return -11;
  NSString *identity = profile[@"identity"];
  NSArray<NSNumber *> *arguments = profile[@"abiArguments"];
  if (![identity isKindOfClass:NSString.class] || identity.length == 0 || identity.length > 512
      || ![arguments isKindOfClass:NSArray.class] || arguments.count != kProfileArgumentCount) return -12;
  NSData *identityBytes = [identity dataUsingEncoding:NSUTF8StringEncoding];
  if (motion_sdk_set_profile(0) != 0
      || motion_sdk_begin_profile_identity(static_cast<uint32_t>(identityBytes.length)) != 0) return -13;
  const uint8_t *bytes = static_cast<const uint8_t *>(identityBytes.bytes);
  for (NSUInteger index = 0; index < identityBytes.length; ++index) {
    if (motion_sdk_set_profile_identity_byte(static_cast<uint32_t>(index), bytes[index]) != 0) return -14;
  }
  uint32_t integers[19];
  constexpr size_t integerIndexes[19] = {
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 21, 22, 23
  };
  for (size_t index = 0; index < 19; ++index) {
    if (!AsU32(arguments[integerIndexes[index]], &integers[index])) return -15;
  }
  for (NSUInteger index = 16; index <= 20; ++index) {
    if (!std::isfinite(arguments[index].doubleValue)) return -16;
  }
  return motion_sdk_install_profile(
      integers[0], integers[1], integers[2], integers[3], integers[4], integers[5],
      integers[6], integers[7], integers[8], integers[9], integers[10], integers[11],
      integers[12], integers[13], integers[14], integers[15],
      arguments[16].floatValue, arguments[17].floatValue, arguments[18].floatValue,
      arguments[19].floatValue, arguments[20].floatValue,
      integers[16], integers[17], integers[18]);
}

NSData *CopyPacket() {
  const uint32_t length = motion_sdk_packet_len();
  std::vector<uint8_t> packet(length);
  if (motion_sdk_copy_packet(packet.data(), packet.size()) != static_cast<ptrdiff_t>(packet.size())) return nil;
  return [NSData dataWithBytes:packet.data() length:packet.size()];
}

}  // namespace

@implementation MPMotionBridge

+ (uint32_t)runtimeContractMajor {
  return motion_sdk_contract_major();
}

- (int32_t)configureWidth:(uint32_t)width
                   height:(uint32_t)height
              profileJSON:(nullable NSString *)profileJSON
                   active:(BOOL)active {
  if (motion_sdk_reset(width, height, 1) != 0) return -1;
  if (motion_sdk_set_pose_schema(1) != 0) return -2;
  const int32_t sequenceStatus = SetSequence();
  if (sequenceStatus != 0) return sequenceStatus;
  NSDictionary<NSString *, id> *profile = ParseProfile(profileJSON ?: @"");
  if (!profile) return -6;
  const int32_t profileStatus = InstallProfile(profile);
  if (profileStatus != 0) return profileStatus;
  return active && motion_sdk_begin_set() != 0 ? -7 : 0;
}

- (int32_t)setProfileJSON:(nullable NSString *)profileJSON {
  NSDictionary<NSString *, id> *profile = ParseProfile(profileJSON ?: @"");
  return profile ? InstallProfile(profile) : -6;
}

- (int32_t)setActive:(BOOL)active {
  return active ? motion_sdk_begin_set() : motion_sdk_finish_set();
}

- (int32_t)pauseSet {
  return motion_sdk_pause_set();
}

- (int32_t)resumeSet {
  return motion_sdk_resume_set();
}

- (nullable NSData *)processObservations:(NSArray<NSDictionary<NSString *, id> *> *)candidates
                   equipmentObservations:(NSArray<NSDictionary<NSString *, id> *> *)equipmentObservations
                              visualLuma:(nullable NSData *)visualLuma
                             visualWidth:(uint32_t)visualWidth
                            visualHeight:(uint32_t)visualHeight
                              timestampMs:(int64_t)timestampMs {
  if (timestampMs < 0) return nil;
  const uint64_t timestamp = static_cast<uint64_t>(timestampMs);
  if (motion_sdk_begin_multi(static_cast<uint32_t>(timestamp),
                             static_cast<uint32_t>(timestamp >> 32)) != 0) return nil;
  for (NSDictionary<NSString *, id> *candidate in candidates) {
    NSNumber *candidateId = candidate[@"candidateId"];
    NSArray<NSNumber *> *bbox = candidate[@"bbox"];
    NSArray<NSNumber *> *color = candidate[@"torsoColor"];
    NSArray<NSArray<NSNumber *> *> *landmarks = candidate[@"landmarks"];
    if (![candidateId isKindOfClass:NSNumber.class]
        || ![bbox isKindOfClass:NSArray.class] || bbox.count != 4
        || ![color isKindOfClass:NSArray.class] || color.count != 3
        || ![landmarks isKindOfClass:NSArray.class] || landmarks.count != 26) return nil;
    const uint64_t identifier = candidateId.unsignedLongLongValue;
    if (motion_sdk_begin_candidate(
            static_cast<uint32_t>(identifier), static_cast<uint32_t>(identifier >> 32),
            bbox[0].floatValue, bbox[1].floatValue, bbox[2].floatValue, bbox[3].floatValue,
            color[0].floatValue, color[1].floatValue, color[2].floatValue,
            static_cast<uint32_t>(landmarks.count)) != 0) return nil;
    for (NSUInteger index = 0; index < landmarks.count; ++index) {
      NSArray<NSNumber *> *point = landmarks[index];
      if (![point isKindOfClass:NSArray.class] || point.count != 4) return nil;
      for (NSNumber *component in point) if (!std::isfinite(component.doubleValue)) return nil;
      if (motion_sdk_set_landmark(static_cast<uint32_t>(index),
                                  point[0].floatValue, point[1].floatValue,
                                  point[2].floatValue, point[3].floatValue) != 0) return nil;
    }
    if (motion_sdk_commit_candidate() != 0) return nil;
  }
  if (visualLuma != nil) {
    const uint64_t expectedLength = static_cast<uint64_t>(visualWidth)
        * static_cast<uint64_t>(visualHeight);
    if (visualWidth < 8 || visualHeight < 8 || expectedLength != visualLuma.length
        || expectedLength > std::numeric_limits<uint32_t>::max()
        || motion_sdk_begin_visual_equipment_frame(
               visualWidth, visualHeight, static_cast<uint32_t>(expectedLength)) != 0
        || motion_sdk_copy_visual_equipment_luma(
               static_cast<const uint8_t *>(visualLuma.bytes), visualLuma.length) != 0
        || motion_sdk_detect_barbell_axis() != 0) return nil;
  }
  NSDictionary<NSString *, NSNumber *> *kindCodes = @{
    @"weight_plate": @0,
    @"barbell_shaft": @1,
    @"dumbbell": @2,
    @"machine_handle": @3,
  };
  NSDictionary<NSString *, NSNumber *> *sourceCodes = @{
    @"detector": @0,
    @"optical_flow": @1,
    @"geometry": @2,
    @"predicted": @3,
  };
  for (NSDictionary<NSString *, id> *observation in equipmentObservations) {
    NSNumber *proposalId = observation[@"proposalId"];
    NSNumber *kind = kindCodes[observation[@"kind"]];
    NSArray<NSNumber *> *bbox = observation[@"bbox"];
    NSNumber *score = observation[@"score"];
    id uncertaintyValue = observation[@"uncertaintyPx"];
    NSNumber *source = sourceCodes[observation[@"source"]];
    NSDictionary<NSString *, id> *attributes = observation[@"attributes"];
    id axisValue = observation[@"axis"];
    NSArray<NSNumber *> *axis = nil;
    if (![proposalId isKindOfClass:NSNumber.class]
        || ![kind isKindOfClass:NSNumber.class]
        || ![bbox isKindOfClass:NSArray.class] || bbox.count != 4
        || ![score isKindOfClass:NSNumber.class]
        || ![source isKindOfClass:NSNumber.class]
        || ![attributes isKindOfClass:NSDictionary.class]) return nil;
    if (axisValue != nil && axisValue != NSNull.null) {
      if (![axisValue isKindOfClass:NSArray.class]
          || [axisValue count] != 4) return nil;
      axis = axisValue;
      for (NSNumber *component in axis) {
        if (![component isKindOfClass:NSNumber.class]
            || !std::isfinite(component.doubleValue)) return nil;
      }
    }
    for (NSNumber *component in bbox) {
      if (![component isKindOfClass:NSNumber.class] || !std::isfinite(component.doubleValue)) {
        return nil;
      }
    }
    if (!std::isfinite(score.doubleValue)) return nil;
    float uncertainty = -1.0f;
    if (uncertaintyValue != NSNull.null) {
      if (![uncertaintyValue isKindOfClass:NSNumber.class]
          || !std::isfinite([uncertaintyValue doubleValue])) return nil;
      uncertainty = [uncertaintyValue floatValue];
    }
    uint32_t flags = 0;
    if ([attributes[@"reflectionCandidate"] boolValue]) flags |= 1;
    if ([attributes[@"staticRackCandidate"] boolValue]) flags |= 1 << 1;
    NSString *occlusion = attributes[@"occlusion"];
    if ([occlusion isEqual:@"partial"]) {
      flags |= 1 << 2;
    } else if ([occlusion isEqual:@"heavy"]) {
      flags |= 1 << 3;
    } else if (![occlusion isEqual:@"none"]) {
      return nil;
    }
    if ([attributes[@"truncated"] boolValue]) flags |= 1 << 4;
    const uint64_t identifier = proposalId.unsignedLongLongValue;
    const int32_t equipmentStatus = axis
        ? motion_sdk_add_equipment_axis_observation(
            static_cast<uint32_t>(identifier), static_cast<uint32_t>(identifier >> 32),
            kind.unsignedIntValue,
            bbox[0].floatValue, bbox[1].floatValue,
            bbox[2].floatValue, bbox[3].floatValue,
            axis[0].floatValue, axis[1].floatValue,
            axis[2].floatValue, axis[3].floatValue,
            score.floatValue, uncertainty, source.unsignedIntValue, flags)
        : motion_sdk_add_equipment_observation(
            static_cast<uint32_t>(identifier), static_cast<uint32_t>(identifier >> 32),
            kind.unsignedIntValue,
            bbox[0].floatValue, bbox[1].floatValue,
            bbox[2].floatValue, bbox[3].floatValue,
            score.floatValue, uncertainty, source.unsignedIntValue, flags);
    if (equipmentStatus != 0) return nil;
  }
  if (motion_sdk_process_multi() != 0) return nil;
  return CopyPacket();
}

- (nullable NSDictionary<NSString *, id> *)visualBarbellAxis {
  const uint32_t source = motion_sdk_visual_barbell_axis_source();
  if (source == 0 || source > 3) return nil;
  float values[7];
  for (uint32_t field = 0; field < 7; ++field) {
    values[field] = motion_sdk_visual_barbell_axis_number(field);
    if (!std::isfinite(values[field])) return nil;
  }
  return @{
    @"kind": @"barbell_shaft",
    @"source": source == 1 ? @"measured" : source == 3 ? @"fused" : @"predicted",
    @"x1": @(values[0]),
    @"y1": @(values[1]),
    @"x2": @(values[2]),
    @"y2": @(values[3]),
    @"centerY": @(values[4]),
    @"confidence": @(values[5]),
    @"uncertaintyPx": @(values[6]),
    @"submittedToRust": @(source == 1 || source == 3),
  };
}

- (BOOL)isCurrentFrameValid {
  return motion_sdk_current_frame_valid() == 1;
}

- (void)close {
  motion_sdk_close();
}

- (void)dealloc {
  [self close];
}

@end
