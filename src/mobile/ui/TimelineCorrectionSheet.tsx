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
import type { RecordModule } from "../../records";
import { buildTimelineCorrectionRequest, canCorrectTimelineEntry, timelineSummary } from "../../product";
import type { TimelineReadEvent } from "../../timeline";
import { colors, radius } from "./theme";
import { mobileT } from "../../i18n";


/**
 * Correction is a narrow, typed path for an already committed Timeline fact.
 * It intentionally has no destructive delete/edit affordance: submitting the
 * sheet calls the public CorrectionEvent facade and returns to a rebuilt
 * projection.
 */
export function TimelineCorrectionSheet({
  records,
  userId,
  entry,
  onDismiss,
  onSaved,
}: {
  records: RecordModule;
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
      await records.correctFact({
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
      <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.timelinecorrectionsheet.8b3b463ed6")} onPress={onDismiss} style={StyleSheet.absoluteFill} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <ScrollView bounces={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.eyebrow}>{mobileT("mobile.ui.timelinecorrectionsheet.b9e1cf9ed9")}</Text>
          <Text style={styles.title}>{timelineSummary(entry)}</Text>
          <Text style={styles.description}>{mobileT("mobile.ui.timelinecorrectionsheet.a6933fbfeb")}</Text>
          {supported ? <>
            <CorrectionFields fact={entry.fact} primary={primary} secondary={secondary} onPrimaryChange={setPrimary} onSecondaryChange={setSecondary} />
            <View style={styles.field}>
              <Text style={styles.label}>{mobileT("mobile.ui.timelinecorrectionsheet.3538bc24d3")}</Text>
              <TextInput
                accessibilityLabel={mobileT("mobile.ui.timelinecorrectionsheet.3538bc24d3")}
                value={reason}
                onChangeText={setReason}
                placeholder={mobileT("mobile.ui.timelinecorrectionsheet.bc1649ae87")}
                placeholderTextColor={colors.ink3}
                multiline
                style={[styles.input, styles.reasonInput]}
              />
            </View>
            {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.timelinecorrectionsheet.20180ad7e4")} disabled={saving} onPress={() => void save()} style={[styles.save, saving && styles.disabled]}>
              <Text style={styles.saveText}>{saving ? mobileT("mobile.ui.timelinecorrectionsheet.15127c2c4f") : mobileT("mobile.ui.timelinecorrectionsheet.20180ad7e4")}</Text>
            </Pressable>
          </> : <>
            <Text style={styles.unavailable}>{mobileT("mobile.ui.timelinecorrectionsheet.3894c05914")}</Text>
            <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.cancel}><Text style={styles.cancelText}>{mobileT("mobile.ui.timelinecorrectionsheet.33246f6a5e")}</Text></Pressable>
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
        <TextField label={mobileT("mobile.ui.timelinecorrectionsheet.b2548636f0")} value={primary} onChange={onPrimaryChange} />
        <TextField label={mobileT("mobile.ui.timelinecorrectionsheet.3ddf62cc1b")} value={secondary} keyboardType="decimal-pad" onChange={onSecondaryChange} />
      </>;
    case "nutrition":
      return <TextField label={mobileT("mobile.ui.timelinecorrectionsheet.4717c582b0")} value={primary} onChange={onPrimaryChange} />;
    case "sleep":
      return <TextField label={mobileT("mobile.ui.timelinecorrectionsheet.18def84508", { value0: fact.duration?.unit ?? mobileT("mobile.ui.timelinecorrectionsheet.28bf227b9b") })} value={primary} keyboardType="decimal-pad" onChange={onPrimaryChange} />;
    case "body":
      return <TextField label={`${bodyLabel(fact)}（${fact.measurement.quantity.unit}）`} value={primary} keyboardType="decimal-pad" onChange={onPrimaryChange} />;
    case "recovery":
      return <TextField label={mobileT("mobile.ui.timelinecorrectionsheet.5506dee33f")} value={primary} keyboardType="decimal-pad" onChange={onPrimaryChange} />;
    case "symptom":
      return <>
        <TextField label={mobileT("mobile.ui.timelinecorrectionsheet.60ea93f956")} value={primary} keyboardType="decimal-pad" onChange={onPrimaryChange} />
        <TextField label={mobileT("mobile.ui.timelinecorrectionsheet.161fce5b35")} value={secondary} onChange={onSecondaryChange} />
      </>;
    case "schedule":
      return <TextField label={mobileT("mobile.ui.timelinecorrectionsheet.3b29c579ea")} value={primary} onChange={onPrimaryChange} />;
    case "rest":
      return <TextField label={mobileT("mobile.ui.timelinecorrectionsheet.11b57dc3e8")} value={primary} onChange={onPrimaryChange} />;
    case "training":
    case "clinical_context":
      return null;
    case "subjective":
      return <TextField label={fact.metric} value={primary} keyboardType="decimal-pad" onChange={onPrimaryChange} />;
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
    case "clinical_context": return "";
    case "subjective": return String(fact.value);
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
      const activityType = requiredText(primary, mobileT("mobile.ui.timelinecorrectionsheet.e7346fd3ad"));
      const minutes = optionalNumber(secondary, mobileT("mobile.ui.timelinecorrectionsheet.76e449f92e"), 0);
      const { duration: _duration, ...rest } = fact;
      return { ...rest, activityType, ...(minutes === undefined ? {} : { duration: { value: minutes, unit: "minutes" } }) };
    }
    case "nutrition":
      return { ...fact, ...(primary.trim() ? { mealDescription: primary.trim() } : { mealDescription: undefined }) };
    case "sleep": {
      const duration = requiredNumber(primary, mobileT("mobile.ui.timelinecorrectionsheet.e39f2bbcb1"), 0.01);
      return { ...fact, duration: { value: duration, unit: fact.duration?.unit ?? "minutes" } };
    }
    case "body": {
      const value = requiredNumber(primary, mobileT("mobile.ui.timelinecorrectionsheet.60109c7b4d"), 0.01, fact.measurement.metric === "body_fat_percentage" ? 100 : undefined);
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
      const perceivedRecovery = optionalNumber(primary, mobileT("mobile.ui.timelinecorrectionsheet.6b8637450c"), 1, 5);
      const { perceivedRecovery: _previous, ...rest } = fact;
      return { ...rest, ...(perceivedRecovery === undefined ? {} : { perceivedRecovery }) };
    }
    case "symptom": {
      const severity = optionalNumber(primary, mobileT("mobile.ui.timelinecorrectionsheet.f29a9b6d29"), 1, 5);
      const { severity: _previousSeverity, note: _previousNote, ...rest } = fact;
      return { ...rest, ...(severity === undefined ? {} : { severity }), ...(secondary.trim() ? { note: secondary.trim() } : {}) };
    }
    case "schedule":
      return { ...fact, ...(primary.trim() ? { note: primary.trim() } : { note: undefined }) };
    case "rest":
      return { ...fact, ...(primary.trim() ? { note: primary.trim() } : { note: undefined }) };
    case "training":
      throw new Error("timeline_training_correction_requires_workout_summary");
    case "clinical_context":
      return fact;
    case "subjective":
      return { ...fact, value: requiredNumber(primary, fact.metric, 0) };
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
  return fact.measurement.metric === "body_weight" ? mobileT("mobile.ui.timelinecorrectionsheet.3193595c29") : fact.measurement.metric === "body_fat_percentage" ? mobileT("mobile.ui.timelinecorrectionsheet.71e062f5f8") : fact.measurement.site;
}

function correctionErrorCopy(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "";
  if (message === "correction_reason_required") return mobileT("mobile.ui.timelinecorrectionsheet.3fe5545ff7");
  if (message === "timeline_correction_target_not_active") return mobileT("mobile.ui.timelinecorrectionsheet.5ec0122939");
  if (message === "timeline_fact_not_found") return mobileT("mobile.ui.timelinecorrectionsheet.936c404212");
  return message || mobileT("mobile.ui.timelinecorrectionsheet.c865c745a0");
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
