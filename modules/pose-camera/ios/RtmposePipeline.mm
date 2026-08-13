#import "RtmposePipeline.h"

#import <CommonCrypto/CommonDigest.h>
#import "onnxruntime.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <string>
#include <vector>

namespace {

constexpr int kDetectorInputSize = 416;
constexpr int kPoseInputWidth = 192;
constexpr int kPoseInputHeight = 256;
constexpr int kSimccBinsX = kPoseInputWidth * 2;
constexpr int kSimccBinsY = kPoseInputHeight * 2;
constexpr int kHalpeKeypointCount = 26;
constexpr float kMinPersonScore = 0.15f;
constexpr size_t kMaxPersonCandidates = 4;
constexpr int64_t kCandidateIdentityMemoryMs = 1500;
constexpr float kBboxPadding = 1.25f;
constexpr float kPoseMean[3] = {123.675f, 116.28f, 103.53f};
constexpr float kPoseStd[3] = {58.395f, 57.12f, 57.375f};

NSString *const kDetectorSha256 = @"1450966de24902b18aada1a78913d7efd8fc8dcd51bd4d0d5591476bd4a38821";
NSString *const kPoseSha256 = @"26f3a19e61304a600dfb82d1001d41d24343b89fc70a33ffc84657e0b0bf2ecf";

struct Detection {
  float x1;
  float y1;
  float x2;
  float y2;
  float score;
  uint64_t candidateId;
};

struct Crop {
  float x;
  float y;
  float width;
  float height;
};

NSError *PipelineError(NSString *message) {
  return [NSError errorWithDomain:@"com.maxpower.pose-camera.rtmpose"
                             code:1
                         userInfo:@{NSLocalizedDescriptionKey: message}];
}

NSString *Sha256(NSString *path) {
  NSInputStream *stream = [NSInputStream inputStreamWithFileAtPath:path];
  [stream open];
  CC_SHA256_CTX context;
  CC_SHA256_Init(&context);
  uint8_t block[1024 * 1024];
  while (true) {
    NSInteger count = [stream read:block maxLength:sizeof(block)];
    if (count <= 0) break;
    CC_SHA256_Update(&context, block, static_cast<CC_LONG>(count));
  }
  [stream close];
  uint8_t digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(digest, &context);
  NSMutableString *hex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
  for (uint8_t byte : digest) [hex appendFormat:@"%02x", byte];
  return hex;
}

float Clamp(float value, float minimum, float maximum) {
  return std::min(maximum, std::max(minimum, value));
}

float Area(const Detection &value) {
  return std::max(0.0f, value.x2 - value.x1) * std::max(0.0f, value.y2 - value.y1);
}

float Iou(const Detection &left, const Detection &right) {
  const float width = std::max(0.0f, std::min(left.x2, right.x2) - std::max(left.x1, right.x1));
  const float height = std::max(0.0f, std::min(left.y2, right.y2) - std::max(left.y1, right.y1));
  const float intersection = width * height;
  const float unionArea = Area(left) + Area(right) - intersection;
  return unionArea > 0 ? intersection / unionArea : 0;
}

float CenterDistance(
    const Detection &left,
    const Detection &right,
    float diagonal) {
  const float leftX = (left.x1 + left.x2) / 2;
  const float leftY = (left.y1 + left.y2) / 2;
  const float rightX = (right.x1 + right.x2) / 2;
  const float rightY = (right.y1 + right.y2) / 2;
  return std::hypot(leftX - rightX, leftY - rightY) / diagonal;
}

bool SelectDominantContinuousPerson(
    const std::vector<Detection> &detections,
    const Detection *previous,
    size_t width,
    size_t height,
    Detection &selected) {
  if (detections.empty()) return false;
  const float frameArea = static_cast<float>(width * height);
  const float diagonal = std::hypot(static_cast<float>(width), static_cast<float>(height));
  const Detection centerBox = {
    width * 0.45f, height * 0.45f, width * 0.55f, height * 0.55f, 1, 0
  };
  const auto dominant = std::max_element(detections.begin(), detections.end(), [](const Detection &left, const Detection &right) {
    return Area(left) < Area(right);
  });
  const float largestArea = Area(*dominant);
  if (previous) {
    const float previousArea = std::max(1.0f, Area(*previous));
    const float dominantArea = Area(*dominant);
    if (previousArea < frameArea * 0.05f
        && dominantArea >= std::max(previousArea * 3, frameArea * 0.08f)
        && CenterDistance(*dominant, centerBox, diagonal) <= 0.35f) {
      selected = *dominant;
      return true;
    }
  }
  float bestScore = -std::numeric_limits<float>::infinity();
  float bestContinuity = 0;
  for (const Detection &candidate : detections) {
    const float area = Area(candidate);
    const float areaRelative = largestArea > 0 ? area / largestArea : 0;
    const float frameAreaRatio = std::min(1.0f, area / std::max(frameArea * 0.35f, 1.0f));
    const float imageCenter = 1 - std::min(1.0f, CenterDistance(candidate, centerBox, diagonal));
    const float continuity = previous ? Iou(candidate, *previous) : 0;
    const float centerContinuity = previous
        ? 1 - std::min(1.0f, CenterDistance(candidate, *previous, diagonal) * 3)
        : 0;
    const float score = previous
        ? continuity * 0.58f + centerContinuity * 0.25f + areaRelative * 0.12f + imageCenter * 0.05f
        : areaRelative * 0.55f + frameAreaRatio * 0.20f + imageCenter * 0.25f;
    if (score > bestScore) {
      bestScore = score;
      bestContinuity = continuity;
      selected = candidate;
    }
  }
  if (previous) {
    const float sizeRatio = Area(selected) / std::max(1.0f, Area(*previous));
    const float centerJump = CenterDistance(selected, *previous, diagonal);
    if ((bestContinuity < 0.12f && centerJump > 0.10f)
        || (bestContinuity < 0.05f && !(sizeRatio >= 0.45f && sizeRatio <= 2.5f))) {
      return false;
    }
  }
  return true;
}

std::vector<Detection> AssociateCandidateIds(
    const std::vector<Detection> &current,
    const std::vector<Detection> &previous,
    size_t width,
    size_t height,
    uint64_t &nextCandidateId) {
  const float diagonal = std::max(1.0f, std::hypot(static_cast<float>(width), static_cast<float>(height)));
  std::vector<bool> available(previous.size(), true);
  std::vector<Detection> associated;
  associated.reserve(current.size());
  for (Detection detection : current) {
    size_t bestIndex = previous.size();
    float bestCost = std::numeric_limits<float>::infinity();
    float bestIou = 0;
    float bestCenter = std::numeric_limits<float>::infinity();
    for (size_t index = 0; index < previous.size(); ++index) {
      if (!available[index]) continue;
      const float iou = Iou(detection, previous[index]);
      const float center = CenterDistance(detection, previous[index], diagonal);
      const float scale = std::abs(std::log(
          std::max(1.0f, Area(detection)) / std::max(1.0f, Area(previous[index]))));
      const float cost = (1 - iou) * 0.65f + center * 2.5f + scale * 0.10f;
      if (cost < bestCost) {
        bestIndex = index;
        bestCost = cost;
        bestIou = iou;
        bestCenter = center;
      }
    }
    if (bestIndex < previous.size() && (bestIou >= 0.05f || bestCenter <= 0.12f)) {
      detection.candidateId = previous[bestIndex].candidateId;
      available[bestIndex] = false;
    } else {
      detection.candidateId = nextCandidateId++;
    }
    associated.push_back(detection);
  }
  return associated;
}

Crop PaddedCrop(const Detection &bbox) {
  const float centerX = (bbox.x1 + bbox.x2) / 2;
  const float centerY = (bbox.y1 + bbox.y2) / 2;
  float width = (bbox.x2 - bbox.x1) * kBboxPadding;
  float height = (bbox.y2 - bbox.y1) * kBboxPadding;
  constexpr float inputAspect = static_cast<float>(kPoseInputWidth) / kPoseInputHeight;
  if (width > height * inputAspect) height = width / inputAspect;
  else width = height * inputAspect;
  return {centerX - width / 2, centerY - height / 2, width, height};
}

void SampleBilinear(
    const uint8_t *base,
    size_t width,
    size_t height,
    size_t bytesPerRow,
    float x,
    float y,
    float &red,
    float &green,
    float &blue) {
  if (x < 0 || y < 0 || x > static_cast<float>(width - 1) || y > static_cast<float>(height - 1)) {
    red = green = blue = 0;
    return;
  }
  const int x0 = static_cast<int>(std::floor(x));
  const int y0 = static_cast<int>(std::floor(y));
  const int x1 = std::min(x0 + 1, static_cast<int>(width - 1));
  const int y1 = std::min(y0 + 1, static_cast<int>(height - 1));
  const float wx = x - x0;
  const float wy = y - y0;
  const uint8_t *p00 = base + y0 * bytesPerRow + x0 * 4;
  const uint8_t *p10 = base + y0 * bytesPerRow + x1 * 4;
  const uint8_t *p01 = base + y1 * bytesPerRow + x0 * 4;
  const uint8_t *p11 = base + y1 * bytesPerRow + x1 * 4;
  auto channel = [&](int offset) {
    const float top = p00[offset] * (1 - wx) + p10[offset] * wx;
    const float bottom = p01[offset] * (1 - wx) + p11[offset] * wx;
    return top * (1 - wy) + bottom * wy;
  };
  // Camera output is 32BGRA.
  blue = channel(0);
  green = channel(1);
  red = channel(2);
}

std::pair<int, float> Argmax(const float *data, size_t offset, size_t length) {
  int best = 0;
  float maximum = -std::numeric_limits<float>::infinity();
  for (size_t index = 0; index < length; ++index) {
    const float value = data[offset + index];
    if (value > maximum) {
      maximum = value;
      best = static_cast<int>(index);
    }
  }
  return {best, maximum};
}

NSMutableData *FloatData(const std::vector<float> &values) {
  return [NSMutableData dataWithBytes:values.data() length:values.size() * sizeof(float)];
}

}  // namespace

@interface MPRtmposePipeline ()
@property(nonatomic, strong) ORTEnv *environment;
@property(nonatomic, strong) ORTSession *detectorSession;
@property(nonatomic, strong) ORTSession *poseSession;
@end

@implementation MPRtmposePipeline {
  std::vector<Detection> _trackedDetections;
  int64_t _lastDetectorObservationMs;
  bool _hasLastDetectorObservation;
  uint64_t _nextCandidateId;
}

- (nullable instancetype)initWithDetectorModelPath:(NSString *)detectorModelPath
                                     poseModelPath:(NSString *)poseModelPath
                                              error:(NSError **)error {
  self = [super init];
  if (!self) return nil;
  if (![Sha256(detectorModelPath) isEqualToString:kDetectorSha256]
      || ![Sha256(poseModelPath) isEqualToString:kPoseSha256]) {
    if (error) *error = PipelineError(@"pose model integrity mismatch");
    return nil;
  }
  NSError *ortError = nil;
  _environment = [[ORTEnv alloc] initWithLoggingLevel:ORTLoggingLevelWarning error:&ortError];
  ORTSessionOptions *options = [[ORTSessionOptions alloc] initWithError:&ortError];
  [options setGraphOptimizationLevel:ORTGraphOptimizationLevelAll error:&ortError];
  [options setIntraOpNumThreads:2 error:&ortError];
  _detectorSession = [[ORTSession alloc] initWithEnv:_environment
                                          modelPath:detectorModelPath
                                     sessionOptions:options
                                              error:&ortError];
  _poseSession = [[ORTSession alloc] initWithEnv:_environment
                                      modelPath:poseModelPath
                                 sessionOptions:options
                                          error:&ortError];
  if (!_environment || !_detectorSession || !_poseSession || ortError) {
    if (error) *error = ortError ?: PipelineError(@"could not initialize ONNX Runtime sessions");
    return nil;
  }
  NSArray<NSString *> *detectorInputs = [_detectorSession inputNamesWithError:&ortError];
  NSArray<NSString *> *detectorOutputs = [_detectorSession outputNamesWithError:&ortError];
  NSArray<NSString *> *poseInputs = [_poseSession inputNamesWithError:&ortError];
  NSArray<NSString *> *poseOutputs = [_poseSession outputNamesWithError:&ortError];
  if (![detectorInputs containsObject:@"input"]
      || ![detectorOutputs containsObject:@"dets"]
      || ![detectorOutputs containsObject:@"labels"]
      || ![poseInputs containsObject:@"input"]
      || ![poseOutputs containsObject:@"simcc_x"]
      || ![poseOutputs containsObject:@"simcc_y"]
      || ortError) {
    if (error) *error = ortError ?: PipelineError(@"pose model I/O contract mismatch");
    return nil;
  }
  [self resetTracking];
  return self;
}

- (nullable NSArray<NSDictionary<NSString *, id> *> *)estimatePixelBuffer:(CVPixelBufferRef)pixelBuffer
                                                               timestampMs:(int64_t)timestampMs
                                                                      error:(NSError **)error {
  if (CVPixelBufferGetPixelFormatType(pixelBuffer) != kCVPixelFormatType_32BGRA) {
    if (error) *error = PipelineError(@"camera frame must be 32BGRA");
    return nil;
  }
  CVPixelBufferLockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
  const uint8_t *base = static_cast<const uint8_t *>(CVPixelBufferGetBaseAddress(pixelBuffer));
  const size_t width = CVPixelBufferGetWidth(pixelBuffer);
  const size_t height = CVPixelBufferGetHeight(pixelBuffer);
  const size_t bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer);
  NSArray<NSDictionary<NSString *, id> *> *result = nil;
  @try {
    std::vector<Detection> detections;
    const size_t detectorPlane = kDetectorInputSize * kDetectorInputSize;
    std::vector<float> detectorInput(detectorPlane * 3, 114.0f);
    const float ratio = std::min(
        static_cast<float>(kDetectorInputSize) / width,
        static_cast<float>(kDetectorInputSize) / height);
    const int drawWidth = std::max(1, static_cast<int>(std::round(width * ratio)));
    const int drawHeight = std::max(1, static_cast<int>(std::round(height * ratio)));
    for (int y = 0; y < drawHeight; ++y) {
      for (int x = 0; x < drawWidth; ++x) {
        float red, green, blue;
        SampleBilinear(base, width, height, bytesPerRow,
                       (x + 0.5f) / ratio - 0.5f,
                       (y + 0.5f) / ratio - 0.5f,
                       red, green, blue);
        const size_t index = static_cast<size_t>(y) * kDetectorInputSize + x;
        detectorInput[index] = blue;
        detectorInput[detectorPlane + index] = green;
        detectorInput[detectorPlane * 2 + index] = red;
      }
    }
    NSError *ortError = nil;
    ORTValue *detectorTensor = [[ORTValue alloc]
        initWithTensorData:FloatData(detectorInput)
               elementType:ORTTensorElementDataTypeFloat
                     shape:@[@1, @3, @416, @416]
                     error:&ortError];
    NSDictionary<NSString *, ORTValue *> *detectorOutputs = [_detectorSession
        runWithInputs:@{@"input": detectorTensor}
          outputNames:[NSSet setWithArray:@[@"dets", @"labels"]]
           runOptions:nil
                error:&ortError];
    NSData *detData = [detectorOutputs[@"dets"] tensorDataWithError:&ortError];
    NSData *labelData = [detectorOutputs[@"labels"] tensorDataWithError:&ortError];
    if (!detectorTensor || !detectorOutputs || !detData || !labelData || ortError) {
      if (error) *error = ortError ?: PipelineError(@"YOLOX inference failed");
      return nil;
    }
    const float *detValues = static_cast<const float *>(detData.bytes);
    const int64_t *labelValues = static_cast<const int64_t *>(labelData.bytes);
    const size_t count = std::min(labelData.length / sizeof(int64_t), detData.length / (5 * sizeof(float)));
    for (size_t index = 0; index < count; ++index) {
      const float score = detValues[index * 5 + 4];
      if (labelValues[index] != 0 || score < kMinPersonScore) continue;
      const float x1 = Clamp(detValues[index * 5] / ratio, 0, width - 1);
      const float y1 = Clamp(detValues[index * 5 + 1] / ratio, 0, height - 1);
      const float x2 = Clamp(detValues[index * 5 + 2] / ratio, x1 + 1, width);
      const float y2 = Clamp(detValues[index * 5 + 3] / ratio, y1 + 1, height);
      detections.push_back({x1, y1, x2, y2, score, 0});
    }
    std::sort(detections.begin(), detections.end(), [](const Detection &left, const Detection &right) {
      return left.score > right.score;
    });
    if (detections.size() > kMaxPersonCandidates) detections.resize(kMaxPersonCandidates);
    if (detections.empty()) return @[];
    if (_hasLastDetectorObservation
        && timestampMs - _lastDetectorObservationMs > kCandidateIdentityMemoryMs) {
      _trackedDetections.clear();
    }
    detections = AssociateCandidateIds(detections, _trackedDetections, width, height, _nextCandidateId);
    _trackedDetections = detections;
    _lastDetectorObservationMs = timestampMs;
    _hasLastDetectorObservation = true;

    const size_t posePlane = kPoseInputWidth * kPoseInputHeight;
    std::vector<float> poseInput(detections.size() * 3 * posePlane);
    std::vector<Crop> crops;
    crops.reserve(detections.size());
    for (size_t batch = 0; batch < detections.size(); ++batch) {
      const Crop crop = PaddedCrop(detections[batch]);
      crops.push_back(crop);
      const size_t batchOffset = batch * 3 * posePlane;
      for (int y = 0; y < kPoseInputHeight; ++y) {
        for (int x = 0; x < kPoseInputWidth; ++x) {
          float red, green, blue;
          SampleBilinear(base, width, height, bytesPerRow,
                         crop.x + (x + 0.5f) / kPoseInputWidth * crop.width - 0.5f,
                         crop.y + (y + 0.5f) / kPoseInputHeight * crop.height - 0.5f,
                         red, green, blue);
          const size_t index = static_cast<size_t>(y) * kPoseInputWidth + x;
          poseInput[batchOffset + index] = (blue - kPoseMean[0]) / kPoseStd[0];
          poseInput[batchOffset + posePlane + index] = (green - kPoseMean[1]) / kPoseStd[1];
          poseInput[batchOffset + posePlane * 2 + index] = (red - kPoseMean[2]) / kPoseStd[2];
        }
      }
    }
    ORTValue *poseTensor = [[ORTValue alloc]
        initWithTensorData:FloatData(poseInput)
               elementType:ORTTensorElementDataTypeFloat
                     shape:@[@(detections.size()), @3, @256, @192]
                     error:&ortError];
    NSDictionary<NSString *, ORTValue *> *poseOutputs = [_poseSession
        runWithInputs:@{@"input": poseTensor}
          outputNames:[NSSet setWithArray:@[@"simcc_x", @"simcc_y"]]
           runOptions:nil
                error:&ortError];
    NSData *xData = [poseOutputs[@"simcc_x"] tensorDataWithError:&ortError];
    NSData *yData = [poseOutputs[@"simcc_y"] tensorDataWithError:&ortError];
    if (!poseTensor || !poseOutputs || !xData || !yData || ortError) {
      if (error) *error = ortError ?: PipelineError(@"RTMPose inference failed");
      return nil;
    }
    const float *simccX = static_cast<const float *>(xData.bytes);
    const float *simccY = static_cast<const float *>(yData.bytes);
    NSMutableArray<NSDictionary<NSString *, id> *> *candidates = [NSMutableArray arrayWithCapacity:detections.size()];
    for (size_t batch = 0; batch < detections.size(); ++batch) {
      const Detection &detection = detections[batch];
      const Crop &crop = crops[batch];
      NSMutableArray<NSArray<NSNumber *> *> *landmarks = [NSMutableArray arrayWithCapacity:kHalpeKeypointCount];
      for (int keypoint = 0; keypoint < kHalpeKeypointCount; ++keypoint) {
        const size_t pointOffset = batch * kHalpeKeypointCount + keypoint;
        const auto [xIndex, xScore] = Argmax(simccX, pointOffset * kSimccBinsX, kSimccBinsX);
        const auto [yIndex, yScore] = Argmax(simccY, pointOffset * kSimccBinsY, kSimccBinsY);
        const float x = (crop.x + (xIndex / 2.0f / kPoseInputWidth) * crop.width) / width;
        const float y = (crop.y + (yIndex / 2.0f / kPoseInputHeight) * crop.height) / height;
        const float score = Clamp((xScore + yScore) / 2, 0, 1);
        [landmarks addObject:@[@(x), @(y), @0.0, @(score)]];
      }
      const int torsoIndices[4] = {5, 6, 11, 12};
      bool torsoVisible = true;
      float left = width - 1, right = 0, top = height - 1, bottom = 0;
      for (int index : torsoIndices) {
        NSArray<NSNumber *> *landmark = landmarks[index];
        if (landmark[3].floatValue < 0.2f) torsoVisible = false;
        left = std::min(left, landmark[0].floatValue * width);
        right = std::max(right, landmark[0].floatValue * width);
        top = std::min(top, landmark[1].floatValue * height);
        bottom = std::max(bottom, landmark[1].floatValue * height);
      }
      double red = 0, green = 0, blue = 0;
      size_t colorCount = 0;
      if (torsoVisible) {
        const int x1 = static_cast<int>(Clamp(std::floor(left), 0, width - 1));
        const int x2 = static_cast<int>(Clamp(std::ceil(right), x1 + 1, width));
        const int y1 = static_cast<int>(Clamp(std::floor(top), 0, height - 1));
        const int y2 = static_cast<int>(Clamp(std::ceil(bottom), y1 + 1, height));
        const int stride = std::max(1, static_cast<int>(std::sqrt(((x2 - x1) * (y2 - y1)) / 4096.0)));
        for (int y = y1; y < y2; y += stride) {
          for (int x = x1; x < x2; x += stride) {
            const uint8_t *pixel = base + y * bytesPerRow + x * 4;
            blue += pixel[0];
            green += pixel[1];
            red += pixel[2];
            ++colorCount;
          }
        }
      }
      NSArray<NSNumber *> *torsoColor = colorCount > 0
          ? @[@(red / colorCount / 255.0), @(green / colorCount / 255.0), @(blue / colorCount / 255.0)]
          : @[@0.0, @0.0, @0.0];
      [candidates addObject:@{
        @"candidateId": @(detection.candidateId),
        @"bbox": @[
          @(detection.x1 / width), @(detection.y1 / height),
          @((detection.x2 - detection.x1) / width), @((detection.y2 - detection.y1) / height)
        ],
        @"torsoColor": torsoColor,
        @"landmarks": landmarks
      }];
    }
    result = candidates;
  } @finally {
    CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
  }
  return result;
}

- (void)resetTracking {
  _trackedDetections.clear();
  _lastDetectorObservationMs = 0;
  _hasLastDetectorObservation = false;
  _nextCandidateId = 0;
}

@end
