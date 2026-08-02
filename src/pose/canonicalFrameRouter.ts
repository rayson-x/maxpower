import type { CanonicalPoseFrame } from "./canonicalPose";

export interface CanonicalFrameConsumers {
  render(frame: CanonicalPoseFrame): void;
  count(frame: CanonicalPoseFrame): void;
  record(frame: CanonicalPoseFrame): void;
  analyze(frame: CanonicalPoseFrame): void;
}

/** Publishes one decoded frame instance to every product-data consumer. */
export function routeCanonicalFrame(
  frame: CanonicalPoseFrame,
  consumers: CanonicalFrameConsumers,
): void {
  consumers.render(frame);
  consumers.count(frame);
  consumers.record(frame);
  consumers.analyze(frame);
}
