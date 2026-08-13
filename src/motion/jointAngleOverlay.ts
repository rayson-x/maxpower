import type {
  DecodedJointAngle,
  MotionBodySide,
  MotionJointAngleKind,
} from "./motionPacket";

export interface JointAnglePoint {
  x: number;
  y: number;
}

export interface JointAngleArcPresentation {
  readonly key: string;
  readonly path: string;
  readonly label: JointAnglePoint;
  readonly valueText: string;
  readonly accessibleLabel: string;
}

const LANDMARK_TRIPLETS: Record<
  `${MotionJointAngleKind}:${MotionBodySide}`,
  readonly [number, number, number]
> = {
  "elbow:left": [11, 13, 15],
  "elbow:right": [12, 14, 16],
  "shoulder:left": [23, 11, 13],
  "shoulder:right": [24, 12, 14],
  "hip:left": [11, 23, 25],
  "hip:right": [12, 24, 26],
  "knee:left": [23, 25, 27],
  "knee:right": [24, 26, 28],
};

const JOINT_LABELS: Record<MotionJointAngleKind, string> = {
  elbow: "肘",
  shoulder: "肩",
  hip: "髋",
  knee: "膝",
};

const SIDE_LABELS: Record<MotionBodySide, string> = {
  left: "左",
  right: "右",
};

/**
 * Converts a Rust-authored angle snapshot into SVG geometry. The value is not
 * recalculated here: clients use the canonical landmarks only to position the
 * arc around the same joint that Rust measured.
 */
export function buildJointAngleArc(
  angle: Readonly<DecodedJointAngle>,
  pointAt: (index: number) => JointAnglePoint | null,
  preferredRadius: number,
): JointAngleArcPresentation | null {
  if (!angle.judgeable || angle.valueDeg === null || !Number.isFinite(angle.valueDeg)) return null;
  const [firstIndex, jointIndex, thirdIndex] = LANDMARK_TRIPLETS[`${angle.kind}:${angle.side}`];
  const first = pointAt(firstIndex);
  const joint = pointAt(jointIndex);
  const third = pointAt(thirdIndex);
  if (!first || !joint || !third) return null;

  const firstLength = Math.hypot(first.x - joint.x, first.y - joint.y);
  const thirdLength = Math.hypot(third.x - joint.x, third.y - joint.y);
  const radius = Math.min(preferredRadius, firstLength * 0.42, thirdLength * 0.42);
  if (!Number.isFinite(radius) || radius < preferredRadius * 0.22) return null;

  let startAngle = Math.atan2(first.y - joint.y, first.x - joint.x);
  let endAngle = Math.atan2(third.y - joint.y, third.x - joint.x);
  let sweep = normalizeRadians(endAngle - startAngle);
  if (sweep > Math.PI) {
    [startAngle, endAngle] = [endAngle, startAngle];
    sweep = normalizeRadians(endAngle - startAngle);
  }

  const start = polarPoint(joint, radius, startAngle);
  const end = polarPoint(joint, radius, endAngle);
  const label = polarPoint(joint, radius + preferredRadius * 0.48, startAngle + sweep / 2);
  const valueText = `${Math.round(angle.valueDeg)}°`;
  return {
    key: `${angle.kind}:${angle.side}`,
    path: [
      `M ${fixed(joint.x)} ${fixed(joint.y)}`,
      `L ${fixed(start.x)} ${fixed(start.y)}`,
      `A ${fixed(radius)} ${fixed(radius)} 0 0 1 ${fixed(end.x)} ${fixed(end.y)}`,
      "Z",
    ].join(" "),
    label,
    valueText,
    accessibleLabel: `${SIDE_LABELS[angle.side]}${JOINT_LABELS[angle.kind]} ${valueText}`,
  };
}

function normalizeRadians(value: number): number {
  const fullTurn = Math.PI * 2;
  return ((value % fullTurn) + fullTurn) % fullTurn;
}

function polarPoint(origin: JointAnglePoint, radius: number, angle: number): JointAnglePoint {
  return {
    x: origin.x + Math.cos(angle) * radius,
    y: origin.y + Math.sin(angle) * radius,
  };
}

function fixed(value: number): string {
  return value.toFixed(3);
}
