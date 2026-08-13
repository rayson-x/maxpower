#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * iOS visual-observation Adapter. The returned dictionaries contain raw
 * YOLOX people and RTMPose Halpe-26 points; they do not select the user or
 * infer phases/reps. Those responsibilities stay in Rust.
 */
@interface MPRtmposePipeline : NSObject

- (nullable instancetype)initWithDetectorModelPath:(NSString *)detectorModelPath
                                     poseModelPath:(NSString *)poseModelPath
                                              error:(NSError **)error;

- (nullable NSArray<NSDictionary<NSString *, id> *> *)estimatePixelBuffer:(CVPixelBufferRef)pixelBuffer
                                                               timestampMs:(int64_t)timestampMs
                                                                      error:(NSError **)error;

- (void)resetTracking;

@end

NS_ASSUME_NONNULL_END
