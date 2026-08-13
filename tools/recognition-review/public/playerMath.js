(function attachReviewPlayerMath(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ReviewPlayerMath = api;
})(typeof globalThis === "object" ? globalThis : this, function createReviewPlayerMath() {
  "use strict";

  function nearestFrameWithinAge(frames, timestampMs, maximumAgeMs) {
    if (!Array.isArray(frames) || frames.length === 0) return null;
    let low = 0;
    let high = frames.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (frames[middle].timestampMs < timestampMs) low = middle + 1;
      else high = middle;
    }
    const nearest = low > 0
      && Math.abs(frames[low - 1].timestampMs - timestampMs) < Math.abs(frames[low].timestampMs - timestampMs)
      ? frames[low - 1]
      : frames[low];
    return Math.abs(nearest.timestampMs - timestampMs) <= maximumAgeMs ? nearest : null;
  }

  function nextFrameTimestamp(frames, timestampMs, clipEndMs) {
    if (!Array.isArray(frames)) return clipEndMs;
    const next = frames.find((frame) => frame.timestampMs > timestampMs + 0.5);
    return next ? Math.min(next.timestampMs, clipEndMs) : clipEndMs;
  }

  return { nearestFrameWithinAge, nextFrameTimestamp };
});
