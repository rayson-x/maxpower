import { getT, MOTION_COPY } from "../i18n";

/**
 * 入框动态校验：按当前姿态 schema 的关键点判断"全身是否在画面内"，
 * 不合格时给出人往哪个方向调整 / 手机怎么挪的提示。
 *
 * 纯函数，输入为归一化关键点（x/y ∈ [0,1]，visibility ∈ [0,1]）。
 * hint 是结构化 code；hintText 由 i18n 资源表按 locale 渲染。
 */

export interface FramingLandmark {
  x: number | null;
  y: number | null;
  visibility: number;
}

export type FramingHint =
  | "move_farther" // 整体太大或贴边：后退 / 手机挪远
  | "raise_camera" // 脚部缺失：抬高手机或后退
  | "lower_camera" // 头部缺失
  | "center_body" // 左右偏出画面
  | "low_confidence" // 整体可见度差（光线/遮挡）
  | null;

export interface FramingAssessment {
  ok: boolean;
  visibleCount: number;
  hint: FramingHint;
  hintText: string | null;
}

const VISIBILITY_THRESHOLD = 0.5;
const BLAZEPOSE33_HEAD_INDICES = [0, 1, 2, 3, 4, 7, 8];
const BLAZEPOSE33_FOOT_INDICES = [27, 28, 29, 30, 31, 32];
const HALPE26_HEAD_INDICES = [0, 1, 2, 3, 4, 17, 18];
const HALPE26_FOOT_INDICES = [15, 16, 20, 21, 22, 23, 24, 25];
const EDGE_MARGIN = 0.04;

function isVisible(landmark: FramingLandmark | undefined): boolean {
  return (
    !!landmark &&
    landmark.x !== null &&
    landmark.y !== null &&
    Number.isFinite(landmark.x) &&
    Number.isFinite(landmark.y) &&
    landmark.visibility >= VISIBILITY_THRESHOLD
  );
}

const HINT_KEYS: Record<NonNullable<FramingHint>, string> = {
  move_farther: "framing.hint.moveFarther",
  raise_camera: "framing.hint.raiseCamera",
  lower_camera: "framing.hint.lowerCamera",
  center_body: "framing.hint.centerBody",
  low_confidence: "framing.hint.lowConfidence",
};

export function assessFraming(
  landmarks: readonly FramingLandmark[],
  poseSchema?: "blazepose33" | "halpe26",
  locale?: string,
): FramingAssessment {
  const halpe26 = poseSchema === "halpe26" || (!poseSchema && landmarks.length === 26);
  const requiredVisible = halpe26 ? 20 : 25;
  const headIndices = halpe26 ? HALPE26_HEAD_INDICES : BLAZEPOSE33_HEAD_INDICES;
  const footIndices = halpe26 ? HALPE26_FOOT_INDICES : BLAZEPOSE33_FOOT_INDICES;
  const visibleCount = landmarks.filter(isVisible).length;
  const anyVisible = (indices: number[]) => indices.some((i) => isVisible(landmarks[i]));

  const headOk = anyVisible(headIndices);
  const feetOk = anyVisible(footIndices);

  let hint: FramingHint = null;
  if (visibleCount < 12) hint = "low_confidence";
  else if (!feetOk) hint = "raise_camera";
  else if (!headOk) hint = "lower_camera";
  else if (visibleCount < requiredVisible) hint = "move_farther";
  else {
    // 全部基本要求满足后，检查可见点是否贴边（人快出画了）
    const xs = landmarks.filter(isVisible).map((l) => l.x as number);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    if (minX < EDGE_MARGIN || maxX > 1 - EDGE_MARGIN) hint = "center_body";
  }

  const hintText = hint === null ? null : getT(MOTION_COPY, locale)(HINT_KEYS[hint]);

  return { ok: hint === null, visibleCount, hint, hintText };
}
