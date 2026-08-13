import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { AppDock, FocusSurface, type FocusSurfaceAnchor } from "../ui-kit";
import { CoachApplication } from "../../coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../coach/ledger";
import { colors, radius } from "./theme";
import { RecordFocus } from "./RecordFocus";

type PreviewRoute = "today" | "calendar" | "plan" | "profile";
type PreviewFocus = "coach" | "record" | undefined;

/**
 * A development-only mobile viewport lab. It uses the production dock and
 * FocusSurface directly, but needs neither cloud auth nor personal data. This
 * gives design work a deterministic browser target while native flows remain
 * wired to the single deployed API endpoint.
 */
export function WebInteractionPreview() {
  const [route, setRoute] = useState<PreviewRoute>("today");
  const [focus, setFocus] = useState<PreviewFocus>();
  const [coachAnchor, setCoachAnchor] = useState<FocusSurfaceAnchor>();
  const [recordAnchor, setRecordAnchor] = useState<FocusSurfaceAnchor>();
  const [coachMessage, setCoachMessage] = useState("");
  const [voiceMode, setVoiceMode] = useState(false);
  const coachInput = useRef<TextInput>(null);
  const application = useRef<CoachApplication | undefined>(undefined);

  if (!application.current) {
    let sequence = 0;
    application.current = new CoachApplication(new InMemoryCoachLedger(), {
      now: () => new Date().toISOString(),
      nextId: (prefix) => `web-preview:${prefix}:${++sequence}`,
    });
  }

  useEffect(() => {
    if (focus !== "coach" || voiceMode) return;
    const frame = requestAnimationFrame(() => coachInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focus, voiceMode]);

  useEffect(() => {
    void application.current!.executeDomainCommand({
      type: "user.bootstrap",
      meta: {
        userId: "web-preview",
        actor: { kind: "user", id: "web-preview" },
        deviceId: "web-preview",
        occurredAt: "2026-08-11T09:00:00.000+08:00",
        timezoneOffsetMinutes: 480,
        idempotencyKey: "web-preview-bootstrap",
      },
      profile: { id: "web-preview-profile", trainingExperience: "intermediate", locale: "zh-CN" },
      goalContract: {
        id: "web-preview-goal",
        primaryGoal: "hypertrophy",
        horizon: { startDate: "2026-08-01", endDate: "2026-12-01" },
      },
      mandate: { id: "web-preview-mandate", mode: "collaborative" },
    });
  }, []);

  const openCoach = (voice = false) => {
    setVoiceMode(voice);
    setFocus("coach");
  };

  return <View style={styles.page}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.kicker}>TODAY / 周二</Text>
      <View style={styles.dateRow}><Text style={styles.date}>8 月 11 日</Text><Text style={styles.calendarMark}>日历</Text></View>
      <View style={styles.hero}>
        <View style={styles.heroHeader}><Text style={styles.heroKicker}>今日训练</Text><View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>恢复日</Text></View></View>
        <Text style={styles.heroTitle}>稳住节奏</Text>
        <Text style={styles.heroMeta}>轻量活动 · 充足恢复</Text>
        <View style={styles.metricRow}>
          <PreviewMetric value="30" label="活动分钟" />
          <PreviewMetric value="7.5" label="睡眠小时" />
          <PreviewMetric value="—" label="已记录" />
        </View>
      </View>
      <View style={styles.factCard}>
        <Text style={styles.factLabel}>{route === "today" ? "今天" : route === "calendar" ? "历史" : route === "plan" ? "计划" : "档案"}</Text>
        <Text style={styles.factTitle}>{route === "today" ? "把今天发生的事记下来" : route === "calendar" ? "只看已经发生的记录" : route === "plan" ? "目标、节奏与趋势" : "你的身体与偏好"}</Text>
      </View>
    </ScrollView>

    <AppDock
      current={route}
      destinations={[
        { id: "today", label: "今天", glyph: "⌂" },
        { id: "calendar", label: "日历", glyph: "▦" },
        { id: "plan", label: "计划", glyph: "↗" },
        { id: "profile", label: "我的", glyph: "○" },
      ]}
      onNavigate={(destination) => setRoute(destination as PreviewRoute)}
      onRecord={() => setFocus("record")}
      onCoach={() => openCoach(false)}
      onCoachVoice={() => openCoach(true)}
      onCoachAnchorChange={setCoachAnchor}
      onRecordAnchorChange={setRecordAnchor}
      coachExpanded={focus === "coach"}
    />

    <FocusSurface
      visible={focus === "coach"}
      anchor={coachAnchor}
      accessibilityLabel="收起 Coach"
      onDismiss={() => setFocus(undefined)}
    >
      <View style={styles.focusPanel}>
        <View style={styles.focusHeader}><View><Text style={styles.focusTitle}>Coach</Text><Text style={styles.focusContext}>今天</Text></View><Pressable accessibilityRole="button" accessibilityLabel="收起 Coach" onPress={() => setFocus(undefined)} style={styles.close}><Text style={styles.closeGlyph}>×</Text></Pressable></View>
        <View style={styles.coachBody}>
          <Text style={styles.coachPrompt}>从这里开始</Text>
          <Text style={styles.coachHint}>问训练、恢复或今天该怎么安排。</Text>
        </View>
        {voiceMode ? <View style={styles.voiceComposer}><Pressable accessibilityRole="button" accessibilityLabel="切换文字输入" onPress={() => setVoiceMode(false)} style={styles.iconAction}><Text style={styles.iconGlyph}>⌨</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="按住说话" style={styles.holdToTalk}><Text style={styles.holdToTalkText}>按住说话</Text></Pressable></View> : <View style={styles.composer}><Pressable accessibilityRole="button" accessibilityLabel="添加附件" style={styles.iconAction}><Text style={styles.iconGlyph}>＋</Text></Pressable><TextInput ref={coachInput} accessibilityLabel="发送给 Coach 的消息" value={coachMessage} onChangeText={setCoachMessage} placeholder="问 Coach" placeholderTextColor={colors.ink3} style={styles.composerInput} /><Pressable accessibilityRole="button" accessibilityLabel={coachMessage ? "发送" : "使用语音输入"} onPress={() => coachMessage ? setCoachMessage("") : setVoiceMode(true)} style={styles.composerSend}><Text style={styles.composerSendGlyph}>{coachMessage ? "↑" : "◖"}</Text></Pressable></View>}
      </View>
    </FocusSurface>

    <RecordFocus
      application={application.current!}
      userId="web-preview"
      visible={focus === "record"}
      anchor={recordAnchor}
      referenceWeightKg={70}
      onDismiss={() => setFocus(undefined)}
      onSaved={() => setFocus(undefined)}
      onAskCoach={(prompt) => {
        setCoachMessage(prompt);
        setVoiceMode(false);
        setFocus("coach");
      }}
      onEstimateMeal={(description) => {
        setCoachMessage(`请先估算并生成可编辑的餐食草稿：${description}`);
        setVoiceMode(false);
        setFocus("coach");
      }}
    />
  </View>;
}

function PreviewMetric({ value, label }: { value: string; label: string }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, paddingTop: 30, paddingBottom: 164, gap: 18 },
  kicker: { color: colors.limeInk, fontSize: 12, fontWeight: "900", letterSpacing: 1.4 },
  dateRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  date: { color: colors.ink, fontSize: 34, fontWeight: "900", letterSpacing: -1.2 },
  calendarMark: { color: colors.ink2, fontSize: 15, fontWeight: "800" },
  hero: { padding: 20, gap: 11, borderRadius: radius.card, backgroundColor: colors.dark },
  heroHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroKicker: { color: colors.lime, fontSize: 12, fontWeight: "900", letterSpacing: 1.2 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)" },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.lime },
  liveText: { color: "#E6E8E0", fontSize: 10, fontWeight: "800" },
  heroTitle: { color: colors.white, fontSize: 31, fontWeight: "900", letterSpacing: -0.8 },
  heroMeta: { color: "#B6B9B1", fontSize: 14 },
  metricRow: { flexDirection: "row", marginTop: 10, paddingTop: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.18)" },
  metric: { flex: 1, gap: 3 },
  metricValue: { color: colors.white, fontSize: 20, fontWeight: "900" },
  metricLabel: { color: "#999E95", fontSize: 10, fontWeight: "700" },
  factCard: { minHeight: 148, justifyContent: "center", padding: 20, gap: 8, borderRadius: radius.card, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  factLabel: { color: colors.limeInk, fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  factTitle: { color: colors.ink, fontSize: 22, lineHeight: 30, fontWeight: "900", letterSpacing: -0.4 },
  focusPanel: { flex: 1, minHeight: 0 },
  focusHeader: { minHeight: 61, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 17, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  focusTitle: { color: colors.ink, fontSize: 19, fontWeight: "900" },
  focusContext: { marginTop: 2, color: colors.ink3, fontSize: 11, fontWeight: "700" },
  close: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: colors.paper2 },
  closeGlyph: { marginTop: -3, color: colors.ink, fontSize: 25, lineHeight: 28, fontWeight: "500" },
  coachBody: { flex: 1, padding: 20, gap: 7 },
  coachPrompt: { color: colors.ink, fontSize: 27, fontWeight: "900", letterSpacing: -0.5 },
  coachHint: { color: colors.ink2, fontSize: 14, lineHeight: 21 },
  composer: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 8, margin: 12, padding: 5, paddingLeft: 7, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  iconAction: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: colors.paper2 },
  iconGlyph: { color: colors.ink, fontSize: 19, fontWeight: "800" },
  composerInput: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 15, paddingVertical: 8 },
  composerSend: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 15, backgroundColor: colors.dark },
  composerSendGlyph: { color: colors.lime, fontSize: 21, fontWeight: "900" },
  voiceComposer: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 8, margin: 12, padding: 5, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  holdToTalk: { flex: 1, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 15, backgroundColor: colors.dark },
  holdToTalkText: { color: colors.white, fontSize: 14, fontWeight: "900" },
  recordBody: { padding: 16, gap: 16 },
  capture: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 9, paddingLeft: 14, paddingRight: 5, borderRadius: 21, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  captureDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.limeDeep },
  captureInput: { flex: 1, minWidth: 0, maxHeight: 80, color: colors.ink, fontSize: 15, lineHeight: 20, paddingVertical: 12 },
  captureSend: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 15, backgroundColor: colors.dark },
  captureSendDisabled: { opacity: 0.28 },
  captureSendText: { color: colors.lime, fontSize: 22, fontWeight: "900" },
  recordModes: { flexDirection: "row", gap: 6 },
  recordMode: { flex: 1, minHeight: 58, alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 17, backgroundColor: colors.paper2 },
  recordModeIcon: { color: colors.ink2, fontSize: 17, fontWeight: "900" },
  recordModeLabel: { color: colors.ink2, fontSize: 10, fontWeight: "800" },
  manualCard: { padding: 18, gap: 12, borderRadius: radius.card, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  manualLabel: { color: colors.ink3, fontSize: 11, fontWeight: "900" },
  manualRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  manualValue: { color: colors.ink, fontSize: 23, fontWeight: "900" },
  manualUnit: { color: colors.ink2, fontSize: 14, fontWeight: "800" },
  manualEnergy: { color: colors.limeInk, fontSize: 15, fontWeight: "900" },
});

export function shouldShowWebInteractionPreview(): boolean {
  if (!__DEV__ || typeof window === "undefined") return false;
  return globalThis.location?.search.includes("preview=focus") === true;
}
