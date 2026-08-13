import type { PoseLandmark } from "./PoseEngine";

/**
 * RTMPose Halpe-26 contract.
 *
 * Indices 0..16 are the COCO-17 prefix in exactly the same order. Existing
 * COCO-indexed recognition profiles therefore remain index-compatible. The
 * final nine points are additive observations and must remain unknown when a
 * source dataset does not contain them.
 */
export const COCO17_KEYPOINT_NAMES = [
  "nose",
  "left_eye",
  "right_eye",
  "left_ear",
  "right_ear",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
] as const;

export const HALPE26_KEYPOINT_NAMES = [
  ...COCO17_KEYPOINT_NAMES,
  "head",
  "neck",
  "hip_center",
  "left_big_toe",
  "right_big_toe",
  "left_small_toe",
  "right_small_toe",
  "left_heel",
  "right_heel",
] as const;

export const COCO17_KEYPOINT_COUNT = COCO17_KEYPOINT_NAMES.length;
export const HALPE26_KEYPOINT_COUNT = HALPE26_KEYPOINT_NAMES.length;

export const BLAZEPOSE33_TO_COCO17 = [
  0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28,
] as const;

export const HALPE26_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, 2], [1, 3], [2, 4],
  [17, 0], [17, 18], [18, 5], [18, 6],
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 11], [6, 12], [11, 12], [11, 19], [12, 19],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [15, 20], [15, 22], [15, 24],
  [16, 21], [16, 23], [16, 25],
];

export function hasExactCoco17Prefix(): boolean {
  return COCO17_KEYPOINT_NAMES.every(
    (name, index) => HALPE26_KEYPOINT_NAMES[index] === name,
  );
}

/**
 * Converts the repository's MM-Fit BlazePose-shaped adapter into the Halpe
 * contract without inventing unavailable points. Slots 17..25 carry zero
 * visibility and no usable coordinate evidence.
 */
export function mappedMmFitBlazePose33ToHalpe26(
  landmarks: readonly PoseLandmark[],
): PoseLandmark[] {
  const cocoPrefix = BLAZEPOSE33_TO_COCO17.map((sourceIndex) => {
    const landmark = landmarks[sourceIndex];
    return landmark
      ? { ...landmark }
      : { x: 0, y: 0, z: 0, visibility: 0 };
  });
  const unavailable = Array.from(
    { length: HALPE26_KEYPOINT_COUNT - COCO17_KEYPOINT_COUNT },
    (): PoseLandmark => ({ x: 0, y: 0, z: 0, visibility: 0 }),
  );
  return [...cocoPrefix, ...unavailable];
}
