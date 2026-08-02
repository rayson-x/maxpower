/**
 * Filters display landmarks without losing the source model's joint indices.
 * Skeleton topologies always refer to those source indices.
 */
export function selectLandmarksByOriginalIndex<T>(
  landmarks: readonly T[],
  predicate: (landmark: T) => boolean,
): Map<number, T> {
  const selected = new Map<number, T>();
  landmarks.forEach((landmark, index) => {
    if (predicate(landmark)) selected.set(index, landmark);
  });
  return selected;
}
