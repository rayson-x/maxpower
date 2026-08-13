import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { TimelineFact } from "../../coach/domain";
import type { CoachApplication } from "../../coach/createCoachApplication";
import { buildTimelineCorrectionRequest, canCorrectTimelineEntry, timelineSummary } from "../../product";
import type { TimelineReadEvent } from "../../timeline";
import { colors, radius } from "./theme";

/**
 * Correction is a narrow, typed path for an already committed Timeline fact.
 * It intentionally has no destructive delete/edit affordance: submitting the
 * sheet calls the public CorrectionEvent facade and returns to a rebuilt
 * projection.
 */
export function TimelineCorrectionSheet({
  application,
  userId,
  entry,
  onDismiss,
  onSaved,
}: {
  application: CoachApplication;
  userId: string;
  entry: TimelineReadEvent;
  onDismiss: () => void;
  onSaved: () => void;
}) {
  const [primary, setPrimary] = useState(initialPrimaryValue(entry.fact));
  const [secondary, setSecondary] = useState(initialSecondaryValue(entry.fact));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const supported = canCorrectTimelineEntry(entry) && entry.fact.kind !== "training";

  const save = async () => {
    if (!supported) return;
    setSaving(true);
    try {
      const fact = correctedFact(entry.fact, primary, secondary);
      const now = new Date().toISOString();
      const request = buildTimelineCorrectionRequest({
        entry,
        reason,
        actor: { kind: "user", id: userId },
        recordedAt: now,
        fact,
      });
      await application.correctTimelineFact({
        userId,
        idempotencyKey: `mobile-timeline-correction:${entry.eventId}:${Date.now().toString(36)}`,
        ...request,
      });
      onSaved();
    } catch (cause) {
      setError(correctionErrorCopy(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View accessibilityViewIsModal style={styles.scrim}>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭记录更正" onPress={onDismiss} style={StyleSheet.absoluteFill} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <ScrollView bounces={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.eyebrow}>记录更正</Text>
          <Text style={styles.title}>{timelineSummary(entry)}</Text>
          <Text style={styles.description}>原记录会保留。这次提交会新增一条更正记录。</Text>
          {supported ? <>
            <CorrectionFields fact={entry.fact} primary={primary} secondary={secondary} onPrimaryChange={setPrimary} onSecondaryChange={setSecondary} />
            <View style={styles.field}>
              <Text style={styles.label}>更正原因</Text>
              <TextInput
                accessibilityLabel="更正原因"
                value={reason}
                onChangeText={setReason}
                placeholder="例如：刚才填少了时长"
                placeholderTextColor={colors.ink3}
                multiline
                style={[styles.input, styles.reasonInput]}
              />
            </View>
            {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="保存更正" disabled={saving} onPress={() => void save()} style={[styles.save, saving && styles.disabled]}>
              <Text style={styles.saveText}>{saving ? "正在保存" : "保存更正"}</Text>
            </Pressable>
          </> : <>
            <Text style={styles.unavailable}>这条训练结果需要在训练日报中更正，以保留组级执行与 Session 的关联。</Text>
            <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.cancel}><Text style={styles.cancelText}>完成</Text></Pressable>
          </>}
        </ScrollView>
      </View>
    </View>
  );
}

function CorrectionFields({
  fact,
  primary,
  secondary,
  onPrimaryChange,
  onSecondaryChange,
}: {
  fact: TimelineFact;
  primary: string;
  secondary: string;
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
}) {
  switch (fact.kind) {
    case "activity":
      return <>
        <TextField label="活动" value={primary} onChange={onPrimaryChange} />
        <TextField label="时长（分钟，可留空）" value={secondary} keyboardType="decimal-pad" onChange={onSecondaryChange} />
      </>;
    case "nutrition":
      return <TextField label="餐食描述（可留空）" value={primary} onChange={onPrimaryChange} />;
    case "sleep":
      return <TextField label={`睡眠时长（${fact.duration?.unit ?? "分钟"}）`} value={primary} keyboardType="decimal-pad" onChange={onPrimaryChange} />;
    case "body":
      return <TextField label={`${bodyLabel(fact)}（${fact.measurement.quantity.unit}）`} value={primary} keyboardType="decimal-pad" onChange={onPrimaryChange} />;
    case "recovery":
      return <TextField label="主观恢复（1–5）" value={primary} keyboardType="decimal-pad" onChange={onPrimaryChange} />;
    case "symptom":
      return <>
        <TextField label="程度（1–5，可留空）" value={primary} keyboardType="decimal-pad" onChange={onPrimaryChange} />
        <TextField label="补充说明（可留空）" value={secondary} onChange={onSecondaryChange} />
      </>;
    case "schedule":
      return <TextField label="日程说明（可留空）" value={primary} onChange={onPrimaryChange} />;
    case "rest":
      return <TextField label="休息说明（可留空）" value={primary} onChange={onPrimaryChange} />;
    case "training":
      return null;
  }
}

function TextField({ label, value, keyboardType, onChange }: { label: string; value: string; keyboardType?: "default" | "decimal-pad"; onChange: (value: string) => void }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} keyboardType={keyboardType} onChangeText={onChange} placeholder="—" placeholderTextColor={colors.ink3} style={styles.input} /></View>;
}

function initialPrimaryValue(fact: TimelineFact): string {
  switch (fact.kind) {
    case "activity": return fact.activityType;
    case "nutrition": return fact.mealDescription ?? "";
    case "sleep": return fact.duration ? String(fact.duration.value) : "";
    case "body": return String(fact.measurement.quantity.value);
    case "recovery": return fact.perceivedRecovery === undefined ? "" : String(fact.perceivedRecovery);
    case "symptom": return fact.severity === undefined ? "" : String(fact.severity);
    case "schedule": return fact.note ?? "";
    case "rest": return fact.note ?? "";
    case "training": return "";
  }
}

function initialSecondaryValue(fact: TimelineFact): string {
  if (fact.kind === "activity") return fact.duration ? String(durationInMinutes(fact.duration.value, fact.duration.unit)) : "";
  if (fact.kind === "symptom") return fact.note ?? "";
  return "";
}

function correctedFact(fact: TimelineFact, primary: string, secondary: string): TimelineFact {
  switch (fact.kind) {
    case "activity": {
      const activityType = requiredText(primary, "请填写活动内容。");
      const minutes = optionalNumber(secondary, "活动时长需要是非负数字。", 0);
      const { duration: _duration, ...rest } = fact;
      return { ...rest, activityType, ...(minutes === undefined ? {} : { duration: { value: minutes, unit: "minutes" } }) };
    }
    case "nutrition":
      return { ...fact, ...(primary.trim() ? { mealDescription: primary.trim() } : { mealDescription: undefined }) };
    case "sleep": {
      const duration = requiredNumber(primary, "请填写睡眠时长。", 0.01);
      return { ...fact, duration: { value: duration, unit: fact.duration?.unit ?? "minutes" } };
    }
    case "body": {
      const value = requiredNumber(primary, "请填写身体测量值。", 0.01, fact.measurement.metric === "body_fat_percentage" ? 100 : undefined);
      switch (fact.measurement.metric) {
        case "body_weight":
          return { ...fact, measurement: { ...fact.measurement, quantity: { ...fact.measurement.quantity, value } } };
        case "body_fat_percentage":
          return { ...fact, measurement: { ...fact.measurement, quantity: { ...fact.measurement.quantity, value } } };
        case "circumference":
          return { ...fact, measurement: { ...fact.measurement, quantity: { ...fact.measurement.quantity, value } } };
      }
    }
    case "recovery": {
      const perceivedRecovery = optionalNumber(primary, "主观恢复需要在 1 到 5 之间。", 1, 5);
      const { perceivedRecovery: _previous, ...rest } = fact;
      return { ...rest, ...(perceivedRecovery === undefined ? {} : { perceivedRecovery }) };
    }
    case "symptom": {
      const severity = optionalNumber(primary, "程度需要在 1 到 5 之间。", 1, 5);
      const { severity: _previousSeverity, note: _previousNote, ...rest } = fact;
      return { ...rest, ...(severity === undefined ? {} : { severity }), ...(secondary.trim() ? { note: secondary.trim() } : {}) };
    }
    case "schedule":
      return { ...fact, ...(primary.trim() ? { note: primary.trim() } : { note: undefined }) };
    case "rest":
      return { ...fact, ...(primary.trim() ? { note: primary.trim() } : { note: undefined }) };
    case "training":
      throw new Error("timeline_training_correction_requires_workout_summary");
  }
}

function requiredText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function requiredNumber(value: string, message: string, min: number, max?: number): number {
  if (!value.trim()) throw new Error(message);
  return optionalNumber(value, message, min, max)!;
}

function optionalNumber(value: string, message: string, min: number, max?: number): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || (max !== undefined && parsed > max)) throw new Error(message);
  return parsed;
}

function durationInMinutes(value: number, unit: "seconds" | "minutes" | "hours"): number {
  return unit === "seconds" ? value / 60 : unit === "hours" ? value * 60 : value;
}

function bodyLabel(fact: Extract<TimelineFact, { kind: "body" }>): string {
  return fact.measurement.metric === "body_weight" ? "体重" : fact.measurement.metric === "body_fat_percentage" ? "体脂率" : fact.measurement.site;
}

function correctionErrorCopy(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "";
  if (message === "correction_reason_required") return "请说明这次更正的原因。";
  if (message === "timeline_correction_target_not_active") return "这条记录已经被更正，请刷新后查看最新版本。";
  if (message === "timeline_fact_not_found") return "这条记录已不可用，请刷新后重试。";
  return message || "暂时无法保存更正。";
}

const styles = StyleSheet.create({
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 45, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" },
  sheet: { maxHeight: "82%", backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: "hidden" },
  handle: { width: 42, height: 5, alignSelf: "center", borderRadius: 3, marginTop: 10, backgroundColor: "#D4D2CA" },
  content: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 38, gap: 12 },
  eyebrow: { color: colors.terra, fontSize: 12, fontWeight: "800" },
  title: { color: colors.ink, fontSize: 24, fontWeight: "900" },
  description: { color: colors.ink2, fontSize: 13, lineHeight: 19 },
  field: { gap: 6 },
  label: { color: colors.ink2, fontSize: 13, fontWeight: "700" },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.ink, paddingHorizontal: 13, fontSize: 14 },
  reasonInput: { minHeight: 72, paddingTop: 12, textAlignVertical: "top" },
  error: { color: colors.terra, fontSize: 12 },
  unavailable: { color: colors.ink2, fontSize: 14, lineHeight: 20, backgroundColor: colors.white, borderRadius: radius.row, padding: 14 },
  save: { minHeight: 48, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", marginTop: 2 },
  saveText: { color: colors.lime, fontSize: 16, fontWeight: "900" },
  cancel: { minHeight: 48, borderRadius: radius.chip, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  cancelText: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.55 },
});
