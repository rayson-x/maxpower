#import <Foundation/Foundation.h>

#import "MotionBridge.h"

static id ReadJSON(NSString *path, NSError **error) {
  NSData *data = [NSData dataWithContentsOfFile:path options:0 error:error];
  return data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:error] : nil;
}

static NSData *DecodeHex(NSString *value) {
  if (value.length % 2 != 0) return nil;
  NSMutableData *data = [NSMutableData dataWithCapacity:value.length / 2];
  for (NSUInteger index = 0; index < value.length; index += 2) {
    unsigned int byte = 0;
    NSString *pair = [value substringWithRange:NSMakeRange(index, 2)];
    NSScanner *scanner = [NSScanner scannerWithString:pair];
    if (![scanner scanHexInt:&byte] || !scanner.isAtEnd) return nil;
    uint8_t valueByte = (uint8_t)byte;
    [data appendBytes:&valueByte length:1];
  }
  return data;
}

static bool HasRustQualityEnvelope(NSData *packet) {
  if (packet.length < 20) return false;
  const uint8_t *bytes = static_cast<const uint8_t *>(packet.bytes);
  if (memcmp(bytes, "MOTN", 4) != 0) return false;
  const uint16_t major = static_cast<uint16_t>(bytes[4] | (bytes[5] << 8));
  const uint16_t minor = static_cast<uint16_t>(bytes[6] | (bytes[7] << 8));
  const uint32_t declaredLength = static_cast<uint32_t>(bytes[8])
      | (static_cast<uint32_t>(bytes[9]) << 8)
      | (static_cast<uint32_t>(bytes[10]) << 16)
      | (static_cast<uint32_t>(bytes[11]) << 24);
  if (major != 1 || minor < 8 || declaredLength != packet.length) return false;
  for (NSUInteger offset = 12; offset + 8 <= packet.length; ++offset) {
    if (memcmp(bytes + offset, "QLT1", 4) != 0) continue;
    const uint32_t payloadLength = static_cast<uint32_t>(bytes[offset + 4])
        | (static_cast<uint32_t>(bytes[offset + 5]) << 8)
        | (static_cast<uint32_t>(bytes[offset + 6]) << 16)
        | (static_cast<uint32_t>(bytes[offset + 7]) << 24);
    // QLT1 is an additive evidence section, not a terminal trailer. Newer
    // packet minors append AXI1/LMC1 after it, so parity must accept a valid
    // bounded quality payload without assuming it is the final section.
    if (payloadLength <= packet.length - offset - 8) return true;
  }
  return false;
}

static int Run(NSString *fixturePath, NSString *oraclePath) {
  NSError *error = nil;
  NSDictionary *fixture = ReadJSON(fixturePath, &error);
  if (![fixture isKindOfClass:NSDictionary.class]) {
    fprintf(stderr, "fixture read failed: %s\n", error.localizedDescription.UTF8String);
    return 2;
  }
  NSDictionary *oracle = ReadJSON(oraclePath, &error);
  if (![oracle isKindOfClass:NSDictionary.class]) {
    fprintf(stderr, "oracle read failed: %s\n", error.localizedDescription.UTF8String);
    return 3;
  }
  NSDictionary *source = fixture[@"source"];
  NSDictionary *config = fixture[@"bridgeConfig"];
  NSArray *frames = fixture[@"frames"];
  NSArray *expectedFrames = oracle[@"frames"];
  if (![config[@"poseSchema"] isEqual:@"halpe26"]
      || [config[@"active"] boolValue]
      || frames.count != expectedFrames.count) {
    fprintf(stderr, "fixture contract mismatch\n");
    return 4;
  }

  MPMotionBridge *bridge = [MPMotionBridge new];
  const int32_t configureStatus = [bridge configureWidth:[source[@"widthPx"] unsignedIntValue]
                                                   height:[source[@"heightPx"] unsignedIntValue]
                                              profileJSON:@""
                                                   active:NO];
  if (configureStatus != 0) {
    fprintf(stderr, "configure failed: %d\n", configureStatus);
    return 5;
  }
  for (NSUInteger index = 0; index < frames.count; ++index) {
    NSDictionary *frame = frames[index];
    NSDictionary *expected = expectedFrames[index];
    const int64_t timestampMs = [frame[@"timestampMs"] longLongValue];
    if (timestampMs != [expected[@"timestampMs"] longLongValue]) {
      fprintf(stderr, "timestamp mismatch at fixture index %lu\n", (unsigned long)index);
      return 6;
    }
    NSData *packet = [bridge processObservations:frame[@"candidates"]
                          equipmentObservations:frame[@"equipmentObservations"]
                                     visualLuma:nil
                                    visualWidth:0
                                   visualHeight:0
                                     timestampMs:timestampMs];
    NSData *expectedPacket = DecodeHex(expected[@"packetHex"]);
    if (!packet || !expectedPacket || ![packet isEqualToData:expectedPacket]) {
      NSUInteger firstDifference = NSNotFound;
      const NSUInteger comparable = MIN(packet.length, expectedPacket.length);
      const uint8_t *actualBytes = static_cast<const uint8_t *>(packet.bytes);
      const uint8_t *expectedBytes = static_cast<const uint8_t *>(expectedPacket.bytes);
      for (NSUInteger byte = 0; byte < comparable; ++byte) {
        if (actualBytes[byte] != expectedBytes[byte]) {
          firstDifference = byte;
          break;
        }
      }
      fprintf(
          stderr,
          "packet drift at source frame %lld (actual=%lu expected=%lu firstDifference=%ld)\n",
          [frame[@"sourceFrameNumber"] longLongValue],
          (unsigned long)packet.length,
          (unsigned long)expectedPacket.length,
          (long)firstDifference);
      return 7;
    }
    if (!HasRustQualityEnvelope(packet)) {
      fprintf(stderr, "missing terminal Rust QLT1 envelope at fixture index %lu\n",
              (unsigned long)index);
      return 8;
    }
    if (bridge.isCurrentFrameValid != [expected[@"currentFrameValid"] boolValue]) {
      fprintf(stderr, "frame-valid drift at fixture index %lu\n", (unsigned long)index);
      return 9;
    }
  }
  [bridge close];
  printf("PASS ios-simulator real Halpe-26 bridge parity: %lu/%lu frames\n",
         (unsigned long)frames.count, (unsigned long)expectedFrames.count);
  return 0;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 3) {
      fprintf(stderr, "usage: RealHalpe26BridgeParity FIXTURE ORACLE\n");
      return 64;
    }
    return Run([NSString stringWithUTF8String:argv[1]], [NSString stringWithUTF8String:argv[2]]);
  }
}
