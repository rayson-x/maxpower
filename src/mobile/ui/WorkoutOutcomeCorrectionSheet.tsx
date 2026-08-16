import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { SetOutcomeCorrectionPatch, SetOutcomeData, WorkoutProjection } from "../../coach/domain";
import type { LocalProductKernel } from "../../coach/LocalProductKernel";
import { ProfessionalTermText } from "../ui-kit";
import { colors, radius } from "./theme";
import { mobileT } from "../../i18n";


/**
 * A bounded editor for a sealed WorkoutSession.  It only calls the public
 * correction facade; it never mutates a projected outcome or a local store.
 */
export function WorkoutOutcomeCorrectionSheet({
  application,
  userId,
  workoutId,
  onDismiss,
  onSaved,
}: {
  application: LocalProductKernel;
  userId: string;
  workoutId: string;
  onDismiss: () => void;
  onSaved: () => void;
}) {
  const [workout, setWorkout] = useState<WorkoutProjection>();
  const [selectedOutcomeId, setSelectedOutcomeId] = useState<string>();
  const [load, setLoad] = useState("");
  const [reps, setReps] = useState("");
  const [rir, setRir] = useState("");
  const [duration, setDuration] = useState("");
  const [distance, setDistance] = useState("");
  const [feedback, setFeedback] = useState<"easy" | "appropriate" | "hard">();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const selected = useMemo(
    () => workout?.setOutcomes.find((outcome) => outcome.id === selectedOutcomeId),
    [selectedOutcomeId, workout],
  );

  useEffect(() => {
    void (async () => {
      try {
        const projection = await application.readDomainProjection({ userId });
        const next = projection.workouts.find((item) => item.id === workoutId);
        if (!next?.outcome) throw new Error("workout_outcome_not_found");
        setWorkout(next);
        selectOutcome(next.setOutcomes[0], setSelectedOutcomeId, setLoad, setReps, setRir, setDuration, setDistance);
      } catch (cause) {
        setError(messageFor(cause));
      }
    })();
  }, [application, userId, workoutId]);

  const select = (outcome: SetOutcomeData) => {
    selectOutcome(outcome, setSelectedOutcomeId, setLoad, setReps, setRir, setDuration, setDistance);
    setError(undefined);
  };

  const saveSet = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const patch = setPatch(selected, { load, reps, rir, duration, distance });
      const key = `mobile-workout-set-correction:${workoutId}:${selected.id}:${Date.now().toString(36)}`;
      await application.correctRecordedSet({
        userId, workoutId, outcomeId: selected.id, patch, reason, idempotencyKey: key,
      });
      onSaved();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setSaving(false);
    }
  };

  const saveFeedback = async () => {
    if (!workout?.outcome || !feedback) return;
    setSaving(true);
    try {
      const key = `mobile-workout-outcome-correction:${workoutId}:${Date.now().toString(36)}`;
      await application.correctWorkoutSessionOutcome({
        userId, workoutId, patch: { subjectiveFeedback: feedback }, reason, idempotencyKey: key,
      });
      onSaved();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View accessibilityViewIsModal style={styles.scrim}>
      <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.workoutoutcomecorrectionsheet.ae0ae4efd4")} onPress={onDismiss} style={StyleSheet.absoluteFill} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <ScrollView bounces={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.eyebrow}>{mobileT("mobile.ui.workoutoutcomecorrectionsheet.fd91ccd57f")}</Text>
          <Text style={styles.title}>{mobileT("mobile.ui.workoutoutcomecorrectionsheet.06c64a3303")}</Text>
          <Text style={styles.description}>{mobileT("mobile.ui.workoutoutcomecorrectionsheet.7870dcb91e")}</Text>
          {!workout ? <ActivityIndicator color={colors.limeInk} /> : <>
            <Text style={styles.label}>{mobileT("mobile.ui.workoutoutcomecorrectionsheet.86f961a5d7")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.setChooser}>
              {workout.setOutcomes.map((outcome, index) => <Pressable key={outcome.id} accessibilityRole="button" accessibilityState={{ selected: outcome.id === selectedOutcomeId }} onPress={() => select(outcome)} style={[styles.setChip, outcome.id === selectedOutcomeId && styles.setChipSelected]}><Text style={[styles.setChipText, outcome.id === selectedOutcomeId && styles.setChipTextSelected]}>{mobileT("mobile.ui.workoutoutcomecorrectionsheet.dae828fe4f")}{index + 1} {mobileT("mobile.ui.workoutoutcomecorrectionsheet.726ff2fac5")}</Text></Pressable>)}
            </ScrollView>
            {selected ? <>
              <View style={styles.metrics}>
                <Field label={mobileT("mobile.ui.workoutoutcomecorrectionsheet.86ca84840b", { value0: selected.actualLoad ? `（${selected.actualLoad.unit}）` : "" })} value={load} onChange={setLoad} />
                <Field label={mobileT("mobile.ui.workoutoutcomecorrectionsheet.d4a97e7577")} value={reps} onChange={setReps} />
                <Field label="RIR" value={rir} onChange={setRir} />
              </View>
              {selected.actualDuration ? <Field label={mobileT("mobile.ui.workoutoutcomecorrectionsheet.6dce422732", { value0: selected.actualDuration.unit })} value={duration} onChange={setDuration} /> : null}
              {selected.actualDistance ? <Field label={mobileT("mobile.ui.workoutoutcomecorrectionsheet.6472ebd4ac", { value0: selected.actualDistance.unit })} value={distance} onChange={setDistance} /> : null}
              <Pressable accessibilityRole="button" disabled={saving} onPress={() => void saveSet()} style={[styles.secondaryButton, saving && styles.disabled]}><Text style={styles.secondaryButtonText}>{mobileT("mobile.ui.workoutoutcomecorrectionsheet.45c35661da")}</Text></Pressable>
            </> : null}
            <Text style={styles.label}>{mobileT("mobile.ui.workoutoutcomecorrectionsheet.e524ddf945")}</Text>
            <View style={styles.feedbackRow}>
              {(["easy", "appropriate", "hard"] as const).map((value) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: feedback === value }} onPress={() => setFeedback(value)} style={[styles.feedback, feedback === value && styles.feedbackSelected]}><Text style={[styles.feedbackText, feedback === value && styles.feedbackTextSelected]}>{feedbackLabel(value)}</Text></Pressable>)}
            </View>
            <Pressable accessibilityRole="button" disabled={!feedback || saving} onPress={() => void saveFeedback()} style={[styles.secondaryButton, (!feedback || saving) && styles.disabled]}><Text style={styles.secondaryButtonText}>{mobileT("mobile.ui.workoutoutcomecorrectionsheet.4615c9fc07")}</Text></Pressable>
            <View style={styles.field}>
              <Text style={styles.label}>{mobileT("mobile.ui.workoutoutcomecorrectionsheet.3538bc24d3")}</Text>
              <TextInput accessibilityLabel={mobileT("mobile.ui.workoutoutcomecorrectionsheet.268a468f9f")} value={reason} onChangeText={setReason} placeholder={mobileT("mobile.ui.workoutoutcomecorrectionsheet.7734e8e0c6")} placeholderTextColor={colors.ink3} multiline style={[styles.input, styles.reason]} />
            </View>
          </>}
          {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.dismiss}><Text style={styles.dismissText}>{mobileT("mobile.ui.workoutoutcomecorrectionsheet.aa8a990bc2")}</Text></Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

function selectOutcome(
  outcome: SetOutcomeData | undefined,
  setId: (value: string | undefined) => void,
  setLoad: (value: string) => void,
  setReps: (value: string) => void,
  setRir: (value: string) => void,
  setDuration: (value: string) => void,
  setDistance: (value: string) => void,
) {
  setId(outcome?.id);
  setLoad(outcome?.actualLoad ? String(outcome.actualLoad.value) : "");
  setReps(outcome?.actualReps === undefined ? "" : String(outcome.actualReps));
  setRir(outcome?.actualRir === undefined ? "" : String(outcome.actualRir));
  setDuration(outcome?.actualDuration === undefined ? "" : String(outcome.actualDuration.value));
  setDistance(outcome?.actualDistance === undefined ? "" : String(outcome.actualDistance.value));
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <View style={styles.metricField}><ProfessionalTermText text={label} style={styles.metricLabel} /><TextInput accessibilityLabel={label} value={value} keyboardType="decimal-pad" onChangeText={onChange} placeholder="—" placeholderTextColor={colors.ink3} style={styles.metricInput} /></View>;
}

function setPatch(outcome: SetOutcomeData, values: { load: string; reps: string; rir: string; duration: string; distance: string }) {
  const patch: SetOutcomeCorrectionPatch = {};
  const load = optionalNumber(values.load, mobileT("mobile.ui.workoutoutcomecorrectionsheet.eafb517630"), 0);
  if (load !== outcome.actualLoad?.value) {
    patch.actualLoad = load === undefined ? null : { value: load, unit: outcome.actualLoad?.unit ?? "kg" };
  }
  const reps = optionalNumber(values.reps, mobileT("mobile.ui.workoutoutcomecorrectionsheet.2172794d30"), 0, true);
  if (reps !== outcome.actualReps) patch.actualReps = reps ?? null;
  const rir = optionalNumber(values.rir, mobileT("mobile.ui.workoutoutcomecorrectionsheet.321399dc76"), 0, false, 10);
  if (rir !== outcome.actualRir) patch.actualRir = rir ?? null;
  const duration = optionalNumber(values.duration, mobileT("mobile.ui.workoutoutcomecorrectionsheet.8aa097598d"), 0);
  if (duration !== outcome.actualDuration?.value) {
    patch.actualDuration = duration === undefined ? null : { value: duration, unit: outcome.actualDuration?.unit ?? "seconds" };
  }
  const distance = optionalNumber(values.distance, mobileT("mobile.ui.workoutoutcomecorrectionsheet.b0e224ba4b"), 0);
  if (distance !== outcome.actualDistance?.value) {
    patch.actualDistance = distance === undefined ? null : { value: distance, unit: outcome.actualDistance?.unit ?? "m" };
  }
  if (!Object.keys(patch).length) throw new Error("set_outcome_correction_no_change");
  return patch;
}

function optionalNumber(value: string, message: string, min: number, integer = false, max?: number): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || (integer && !Number.isInteger(parsed)) || (max !== undefined && parsed > max)) throw new Error(message);
  return parsed;
}

function feedbackLabel(value: "easy" | "appropriate" | "hard") { return value === "easy" ? mobileT("mobile.ui.workoutoutcomecorrectionsheet.c9c4a72eeb") : value === "appropriate" ? mobileT("mobile.ui.workoutoutcomecorrectionsheet.e523b6ab39") : mobileT("mobile.ui.workoutoutcomecorrectionsheet.6ee6e775bb"); }

function messageFor(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : "";
  if (code === "correction_reason_required") return mobileT("mobile.ui.workoutoutcomecorrectionsheet.3fe5545ff7");
  if (code === "set_outcome_correction_no_change" || code === "workout_outcome_correction_no_change") return mobileT("mobile.ui.workoutoutcomecorrectionsheet.dbee701fbc");
  if (code === "workout_outcome_not_found" || code === "set_outcome_not_found") return mobileT("mobile.ui.workoutoutcomecorrectionsheet.936c404212");
  return code || mobileT("mobile.ui.workoutoutcomecorrectionsheet.c865c745a0");
}

const styles = StyleSheet.create({
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 46, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" },
  sheet: { maxHeight: "84%", backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: "hidden" },
  handle: { width: 42, height: 5, alignSelf: "center", borderRadius: 3, marginTop: 10, backgroundColor: "#D4D2CA" },
  content: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 38, gap: 12 },
  eyebrow: { color: colors.terra, fontSize: 12, fontWeight: "800" },
  title: { color: colors.ink, fontSize: 24, fontWeight: "900" },
  description: { color: colors.ink2, fontSize: 13, lineHeight: 19 },
  label: { color: colors.ink2, fontSize: 13, fontWeight: "800", marginTop: 3 },
  setChooser: { gap: 8 },
  setChip: { minHeight: 38, paddingHorizontal: 14, justifyContent: "center", borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  setChipSelected: { borderColor: colors.limeInk, backgroundColor: colors.lime },
  setChipText: { color: colors.ink2, fontSize: 13, fontWeight: "800" },
  setChipTextSelected: { color: colors.limeInk },
  metrics: { flexDirection: "row", gap: 8 },
  metricField: { flex: 1, gap: 6 },
  metricLabel: { color: colors.ink3, fontSize: 11, fontWeight: "700" },
  metricInput: { minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.ink, paddingHorizontal: 10, fontSize: 15, fontWeight: "800" },
  feedbackRow: { flexDirection: "row", gap: 8 },
  feedback: { flex: 1, minHeight: 42, justifyContent: "center", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  feedbackSelected: { borderColor: colors.limeInk, backgroundColor: colors.lime },
  feedbackText: { color: colors.ink2, fontSize: 13, fontWeight: "800" },
  feedbackTextSelected: { color: colors.limeInk },
  field: { gap: 6 },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.ink, paddingHorizontal: 13, fontSize: 14 },
  reason: { minHeight: 72, paddingTop: 12, textAlignVertical: "top" },
  secondaryButton: { minHeight: 46, justifyContent: "center", alignItems: "center", borderRadius: radius.chip, backgroundColor: colors.dark },
  secondaryButtonText: { color: colors.lime, fontSize: 14, fontWeight: "900" },
  dismiss: { minHeight: 46, justifyContent: "center", alignItems: "center", borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  dismissText: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  error: { color: colors.terra, fontSize: 12 },
  disabled: { opacity: 0.48 },
});
