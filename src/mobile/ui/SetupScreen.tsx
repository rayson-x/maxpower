import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Svg, { Circle, Line, Rect, Text as SvgText } from "react-native-svg";

import { EXERCISE_REGISTRY } from "../../pose/exerciseRegistry";
import {
  CAPTURE_POSITIONS,
  recommendCapturePosition,
  type CapturePosition,
} from "../../pose/viewGating";
import {
  defaultLensFacing,
  resolveMotionRuntimeCapability,
  resolveRecognitionCapability,
  type LensFacing,
  type RecognitionCapability,
} from "../exerciseRecognition";
import { colors } from "./theme";

export interface SessionConfig {
  exerciseId: string;
  capturePosition: CapturePosition;
  lensFacing: LensFacing;
  recognition: RecognitionCapability;
}

/** 八向机位在俯视圆上的角度（度，0 = 正前，顺时针）。 */
const POSITION_ANGLES: Record<CapturePosition, number> = {
  front: 0,
  frontLeft45: 45,
  left: 90,
  rearLeft45: 135,
  rear: 180,
  rearRight45: 235,
  right: 270,
  frontRight45: 315,
};

/** 机位引导页：俯视八向图 + 推荐理由 + 前后置双模式。 */
export function SetupScreen(props: {
  exerciseId: string;
  onBack: () => void;
  onStart: (config: SessionConfig) => void;
}) {
  const exercise = EXERCISE_REGISTRY.require(props.exerciseId);
  const recommendation = recommendCapturePosition(props.exerciseId);
  const [position, setPosition] = useState<CapturePosition>(
    recommendation?.position ?? "front",
  );
  const [lens, setLens] = useState<LensFacing>(defaultLensFacing(props.exerciseId));

  const recognition = resolveRecognitionCapability(props.exerciseId, position);
  const runtimeCapability = resolveMotionRuntimeCapability({
    exerciseVariantId: props.exerciseId,
    capturePosition: position,
    lensFacing: lens,
    platform: "android",
  });
  const positionMeta = useMemo(
    () => CAPTURE_POSITIONS.find((p) => p.id === position),
    [position],
  );

  return (
    <View style={styles.page}>
      <ScrollView style={styles.scrollFlex} contentContainerStyle={styles.scroll}>
        <View style={styles.backBar}>
          <TouchableOpacity style={styles.backBtn} onPress={props.onBack}>
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.backTitle}>{exercise.nameZh} · 准备</Text>
        </View>

        <Text style={styles.hero}>{exercise.nameZh}</Text>
        <Text style={styles.heroEn}>{exercise.nameEn.toUpperCase()}</Text>
        <View style={styles.tags}>
          {runtimeCapability.trajectoryComparison === "available" ? (
            <View style={[styles.chip, styles.chipLime]}>
              <Text style={styles.chipLimeText}>已验证分析</Text>
            </View>
          ) : recognition.canRunRustRecognition ? (
            <View style={[styles.chip, styles.chipOut]}>
              <Text style={styles.chipOutText}>仅计次 / 节奏 · 分析未验证</Text>
            </View>
          ) : (
            <View style={[styles.chip, styles.chipOut]}>
              <Text style={styles.chipOutText}>此机位暂无识别 profile</Text>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>拍摄模式</Text>
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeOpt, lens === "front" && styles.modeOptOn]}
              onPress={() => setLens("front")}
            >
              <Text style={styles.modeTitle}>🤳 前置 · 识别</Text>
              <Text style={styles.modeDesc}>看着屏幕做，实时计数 + 相位提示</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeOpt, lens === "back" && styles.modeOptOn]}
              onPress={() => setLens("back")}
            >
              <Text style={styles.modeTitle}>📷 后置 · 观察</Text>
              <Text style={styles.modeDesc}>手机架好后离开，组后看建议报告</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.card, styles.camCard]}>
          <Svg width={130} height={130} viewBox="0 0 130 130">
            <Circle cx={65} cy={65} r={56} fill="none" stroke="#E4E2DA" strokeWidth={1.5} strokeDasharray="3 4" />
            <Circle cx={65} cy={65} r={10} fill={colors.ink} />
            <SvgText x={65} y={69} fontSize={9} fill={colors.lime} textAnchor="middle">你</SvgText>
            {CAPTURE_POSITIONS.map((p) => {
              const angle = ((POSITION_ANGLES[p.id] - 90) * Math.PI) / 180;
              const cx = 65 + 56 * Math.cos(angle);
              const cy = 65 + 56 * Math.sin(angle);
              const selected = p.id === position;
              const recommended = p.id === recommendation?.position;
              return (
                <React.Fragment key={p.id}>
                  {(selected || recommended) && (
                    <Line x1={65} y1={65} x2={cx} y2={cy} stroke={colors.lime} strokeWidth={2} strokeDasharray="4 3" />
                  )}
                  <Rect
                    x={cx - 10}
                    y={cy - 7}
                    width={20}
                    height={14}
                    rx={4}
                    fill={selected ? colors.ink : recommended ? colors.limeDeep : "#C9C7BE"}
                    onPress={() => setPosition(p.id)}
                  />
                  <Circle cx={cx} cy={cy} r={3.5} fill={selected ? colors.lime : colors.white} />
                </React.Fragment>
              );
            })}
          </Svg>
          <View style={styles.camInfo}>
            <Text style={styles.camTitle}>
              {positionMeta?.label ?? ""}
              {position === recommendation?.position ? " · 推荐" : ""}
            </Text>
            <Text style={styles.camDesc}>
              {position === recommendation?.position
                ? recommendation.reason
                : positionMeta?.guidance ?? ""}
            </Text>
            {!recognition.canRunRustRecognition && (
              <Text style={styles.camWarn}>此动作与机位组合暂无可执行 profile</Text>
            )}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.checkItem}>
            <View style={styles.checkOk}><Text style={styles.checkMark}>✓</Text></View>
            <Text style={styles.checkText}>全身关键点在画面内</Text>
          </View>
          <View style={styles.checkItem}>
            <View style={styles.checkOk}><Text style={styles.checkMark}>✓</Text></View>
            <Text style={styles.checkText}>镜头稳定，距离 2 米左右</Text>
          </View>
          <View style={[styles.checkItem, styles.checkLast]}>
            <View style={styles.checkWait}><Text style={styles.checkWaitText}>…</Text></View>
            <Text style={styles.checkText}>入框校验将在开拍后实时检测</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.ctaWrap}>
        <TouchableOpacity
          style={styles.cta}
          activeOpacity={0.85}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() =>
            props.onStart({
              exerciseId: props.exerciseId,
              capturePosition: position,
              lensFacing: lens,
              recognition,
            })
          }
        >
          <Text style={styles.ctaText}>开始识别 · 录制</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.paper },
  scrollFlex: { flex: 1 },
  scroll: { paddingHorizontal: 24, paddingBottom: 16 },
  backBar: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  backBtn: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: colors.white,
    alignItems: "center", justifyContent: "center",
  },
  backBtnText: { fontSize: 16, color: colors.ink },
  backTitle: { fontSize: 13, color: colors.ink2, fontWeight: "700" },
  hero: { fontSize: 34, fontWeight: "900", color: colors.ink, letterSpacing: 2, marginTop: 14 },
  heroEn: { fontSize: 11, color: colors.ink3, letterSpacing: 1, marginTop: 2, fontFamily: "monospace" },
  tags: { flexDirection: "row", gap: 8, marginTop: 12 },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  chipLime: { backgroundColor: colors.lime },
  chipLimeText: { fontSize: 11, fontWeight: "700", color: colors.limeInk },
  chipOut: { borderWidth: 1.5, borderColor: colors.ink3 },
  chipOutText: { fontSize: 11, fontWeight: "700", color: colors.ink2 },
  card: {
    backgroundColor: colors.white, borderRadius: 18, padding: 16, marginTop: 14,
  },
  cardTitle: { fontSize: 12, fontWeight: "900", color: colors.ink2, letterSpacing: 1, marginBottom: 10 },
  modeRow: { flexDirection: "row", gap: 10 },
  modeOpt: {
    flex: 1, borderWidth: 2, borderColor: colors.paper2, borderRadius: 14, padding: 12,
  },
  modeOptOn: { borderColor: colors.limeDeep, backgroundColor: "rgba(198,241,53,0.12)" },
  modeTitle: { fontSize: 14, fontWeight: "900", color: colors.ink },
  modeDesc: { fontSize: 11, color: colors.ink2, marginTop: 4, lineHeight: 16 },
  camCard: { flexDirection: "row", alignItems: "center", gap: 14 },
  camInfo: { flex: 1 },
  camTitle: { fontSize: 15, fontWeight: "900", color: colors.ink, marginBottom: 4 },
  camDesc: { fontSize: 12, color: colors.ink2, lineHeight: 18 },
  camWarn: { fontSize: 11, color: colors.terra, marginTop: 6, fontWeight: "700" },
  checkItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.line },
  checkLast: { borderBottomWidth: 0 },
  checkOk: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.lime, alignItems: "center", justifyContent: "center" },
  checkMark: { fontSize: 11, fontWeight: "900", color: colors.limeInk },
  checkWait: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.paper2, alignItems: "center", justifyContent: "center" },
  checkWaitText: { fontSize: 11, color: colors.ink3 },
  checkText: { fontSize: 13, color: colors.ink },
  ctaWrap: {
    paddingHorizontal: 24, paddingBottom: 40, paddingTop: 8,
    backgroundColor: colors.paper,
  },
  cta: {
    height: 56, borderRadius: 18, backgroundColor: colors.lime,
    alignItems: "center", justifyContent: "center",
  },
  ctaText: { fontSize: 16, fontWeight: "900", color: colors.limeInk, letterSpacing: 2 },
});
