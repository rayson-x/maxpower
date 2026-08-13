import { getT, MOTION_COPY, resolveLocale, type Locale } from "../i18n";
import type { DecodedMotionPacket, MotionRepDisposition } from "../motion/motionPacket";
import { mapFinding, type FindingCopy } from "./findingsCopy";

/**
 * 组后报告组装：packet 流 → 报告模型。纯函数，UI 只读结果。
 *
 * rep 幅度是通用启发式：取 rep 时间窗内行程最大的关键点的纵向行程，
 * 按组内中位数归一。不区分动作 —— 只用于"相对不足的 rep"可视化，
 * 不构成任何评分。
 */

export interface ReportRep {
  repKey: string;
  disposition: MotionRepDisposition;
  /** 组内归一幅度；无法计算时为 null。 */
  amplitudeRatio: number | null;
  /** 相对不足（< 0.8）时 true，UI 标橙。 */
  belowGroupMedian: boolean;
  findings: FindingCopy[];
}

export interface SetReport {
  confirmedCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  durationMs: number;
  processedFrames: number;
  validFrames: number;
  processedFps: number;
  reps: ReportRep[];
  /** 教练便签正文；无异常时为肯定陈述。 */
  coachNote: string;
}

export interface ReportTelemetry {
  processedFrames: number;
  validFrames: number;
  processedFps: number;
}

const LOW_AMPLITUDE_RATIO = 0.8;

export function assembleSetReport(
  packets: readonly DecodedMotionPacket[],
  telemetry: ReportTelemetry,
  locale?: string,
): SetReport {
  // 同一 rep 可能随 revision 更新，保留最高 revision
  const repByKey = new Map<string, { packet: DecodedMotionPacket; index: number }>();
  packets.forEach((packet, index) => {
    for (const rep of packet.completedReps) {
      const key = `${packet.subjectEpoch}:${rep.repId}`;
      const existing = repByKey.get(key);
      const existingRep = existing
        ? existing.packet.completedReps.find((r) => `${r.repId}` === `${rep.repId}`)
        : undefined;
      if (!existing || (existingRep && rep.revision > existingRep.revision)) {
        repByKey.set(key, { packet, index });
      }
    }
  });

  const entries = [...repByKey.entries()].map(([repKey, { packet }]) => {
    const rep = packet.completedReps.find((r) => `${packet.subjectEpoch}:${r.repId}` === repKey);
    return { repKey, packet, rep: rep! };
  });

  const amplitudes = entries.map(({ packet, rep }) =>
    repAmplitude(packets, packet, Number(rep.startTimestampMs), Number(rep.endTimestampMs)),
  );
  const validAmplitudes = amplitudes.filter((a): a is number => a !== null && a > 0);
  const median = validAmplitudes.length > 0 ? medianOf(validAmplitudes) : null;

  const reps: ReportRep[] = entries.map(({ repKey, rep }, i) => {
    const ratio =
      median && amplitudes[i] !== null ? Math.round((amplitudes[i]! / median) * 100) / 100 : null;
    return {
      repKey,
      disposition: rep.disposition,
      amplitudeRatio: ratio,
      belowGroupMedian: ratio !== null && ratio < LOW_AMPLITUDE_RATIO,
      findings: rep.observationFindings.map((finding) => mapFinding(finding, locale)),
    };
  });

  const confirmed = reps.filter((r) => r.disposition === "confirmed");
  const needsReview = reps.filter((r) => r.disposition === "needs_review");
  const rejected = reps.filter((r) => r.disposition === "rejected");

  const first = packets[0];
  const last = packets[packets.length - 1];
  const durationMs = first && last ? Number(last.sourceTimestampMs - first.sourceTimestampMs) : 0;

  return {
    confirmedCount: confirmed.length,
    needsReviewCount: needsReview.length,
    rejectedCount: rejected.length,
    durationMs,
    processedFrames: telemetry.processedFrames,
    validFrames: telemetry.validFrames,
    processedFps: telemetry.processedFps,
    reps,
    coachNote: buildCoachNote(confirmed.length, needsReview.length, rejected.length, reps, locale),
  };
}

/** rep 时间窗内行程最大关键点的纵向行程（归一化坐标差）。 */
function repAmplitude(
  packets: readonly DecodedMotionPacket[],
  anchor: DecodedMotionPacket,
  startMs: number,
  endMs: number,
): number | null {
  let best: number | null = null;
  const landmarkCount = anchor.canonical.length;
  for (let index = 0; index < landmarkCount; index += 1) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const packet of packets) {
      const t = Number(packet.sourceTimestampMs);
      if (t < startMs || t > endMs) continue;
      const y = packet.canonical[index]?.y;
      if (y === null || y === undefined || !Number.isFinite(y)) continue;
      if (y < min) min = y;
      if (y > max) max = y;
    }
    if (min <= max) {
      const range = max - min;
      if (best === null || range > best) best = range;
    }
  }
  return best;
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** 列表与句子的连接符属于排版规则（不是文案），按 locale 选择。 */
const LIST_SEPARATOR: Record<Locale, string> = { en: ", ", zh: "、" };
const SENTENCE_SEPARATOR: Record<Locale, string> = { en: " ", zh: "" };

function buildCoachNote(
  confirmed: number,
  needsReview: number,
  rejected: number,
  reps: readonly ReportRep[],
  locale?: string,
): string {
  const resolved = resolveLocale(locale);
  const t = getT(MOTION_COPY, resolved);
  if (confirmed === 0 && needsReview === 0) {
    return t("setReport.note.nothingConfirmed");
  }
  const parts: string[] = [];
  parts.push(
    needsReview === 0 && rejected === 0
      ? t("setReport.note.allConfirmed", { confirmed })
      : t("setReport.note.mixed", {
          confirmed,
          review: needsReview > 0 ? t("setReport.note.reviewPart", { count: needsReview }) : "",
          rejected: rejected > 0 ? t("setReport.note.rejectedPart", { count: rejected }) : "",
        }),
  );
  const lowReps = reps
    .map((rep, index) => ({ rep, index: index + 1 }))
    .filter(({ rep }) => rep.disposition === "confirmed" && rep.belowGroupMedian)
    .map(({ index }) => t("setReport.note.repOrdinal", { index }));
  if (lowReps.length > 0) {
    parts.push(t("setReport.note.lowAmplitude", { reps: lowReps.join(LIST_SEPARATOR[resolved]) }));
  }
  const warnFindings = new Set(
    reps.flatMap((rep) => rep.findings.filter((f) => f.level === "warn").map((f) => f.title)),
  );
  for (const title of warnFindings) parts.push(t("setReport.note.findingSentence", { title }));
  if (lowReps.length === 0 && warnFindings.size === 0) {
    parts.push(t("setReport.note.steady"));
  }
  return parts.join(SENTENCE_SEPARATOR[resolved]);
}
