#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/** Thin Apple Adapter around the platform-neutral Rust Motion SDK C ABI. */
@interface MPMotionBridge : NSObject

- (int32_t)configureWidth:(uint32_t)width
                   height:(uint32_t)height
              profileJSON:(nullable NSString *)profileJSON
                   active:(BOOL)active;

- (int32_t)setProfileJSON:(nullable NSString *)profileJSON;
- (int32_t)setActive:(BOOL)active;
- (nullable NSData *)processObservations:(NSArray<NSDictionary<NSString *, id> *> *)candidates
                   equipmentObservations:(NSArray<NSDictionary<NSString *, id> *> *)equipmentObservations
                              visualLuma:(nullable NSData *)visualLuma
                             visualWidth:(uint32_t)visualWidth
                            visualHeight:(uint32_t)visualHeight
                              timestampMs:(int64_t)timestampMs;
- (nullable NSDictionary<NSString *, id> *)visualBarbellAxis;
- (BOOL)isCurrentFrameValid;
- (void)close;

@end

NS_ASSUME_NONNULL_END
