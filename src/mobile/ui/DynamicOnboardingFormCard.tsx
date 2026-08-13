import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { DynamicFormCard } from "../../onboarding";
import type { OnboardingFieldDefinition } from "../../onboarding/FieldCatalog";
import {
  type DateRangeDraft,
  type DynamicOnboardingFormValue,
  type DynamicOnboardingFormValues,
  type FieldGroupDraft,
  type NumericWithUnitDraft,
} from "./dynamicOnboardingForm";
import { colors, radius } from "./theme";

export interface DynamicOnboardingFormCardProps {
  /** Already validated local catalog projection; this component accepts no schema from a model. */
  card: DynamicFormCard;
  value: DynamicOnboardingFormValues;
  onChange(fieldId: string, value: DynamicOnboardingFormValue): void;
  onExplicitUnknown(fieldId: string): void;
  onSubmit(values: DynamicOnboardingFormValues): void;
  disabled?: boolean;
}

/**
 * A controlled renderer for one Field Catalog card. It intentionally knows
 * neither the onboarding draft nor the Agent: the caller owns validation,
 * provenance, stale-card handling, and persistence.
 */
export function DynamicOnboardingFormCard({ card, value, onChange, onExplicitUnknown, onSubmit, disabled = false }: DynamicOnboardingFormCardProps) {
  return <View style={styles.card}>
    <View style={styles.heading}>
      <Text style={styles.title}>{topicLabel(card.topic)}</Text>
      <Text style={styles.hint}>{reasonLabel(card.requiredFor)}</Text>
    </View>
    {card.fields.map((field) => <DynamicField key={field.id} field={field} value={value[field.id]} disabled={disabled} onChange={(next) => onChange(field.id, next)} onExplicitUnknown={() => onExplicitUnknown(field.id)} />)}
    <Pressable accessibilityRole="button" accessibilityLabel="提交本组信息" accessibilityState={{ disabled }} disabled={disabled} onPress={() => onSubmit(value)} style={[styles.submit, disabled && styles.disabled]}>
      <Text style={styles.submitText}>继续</Text>
      <Text style={styles.submitArrow}>→</Text>
    </Pressable>
  </View>;
}

function DynamicField({ field, value, onChange, onExplicitUnknown, disabled }: {
  field: OnboardingFieldDefinition;
  value: DynamicOnboardingFormValue;
  onChange(value: DynamicOnboardingFormValue): void;
  onExplicitUnknown(): void;
  disabled: boolean;
}) {
  return <View style={styles.field}>
    <Text style={styles.label}>{field.label}</Text>
    <FieldControl field={field} value={value} onChange={onChange} disabled={disabled} />
    {field.acceptsExplicitUnknown ? <Pressable accessibilityRole="button" accessibilityLabel={`标记 ${field.label} 为不知道`} disabled={disabled} onPress={onExplicitUnknown} style={styles.unknown}><Text style={styles.unknownText}>不知道 / 暂不填写</Text></Pressable> : null}
  </View>;
}

function FieldControl({ field, value, onChange, disabled }: {
  field: OnboardingFieldDefinition;
  value: DynamicOnboardingFormValue;
  onChange(value: DynamicOnboardingFormValue): void;
  disabled: boolean;
}) {
  switch (field.control.kind) {
    case "single_line_text":
    case "multiline_text": return <TextInput accessibilityLabel={field.label} editable={!disabled} multiline={field.control.kind === "multiline_text"} numberOfLines={field.control.kind === "multiline_text" ? 4 : 1} onChangeText={onChange} placeholderTextColor={colors.ink3} style={[styles.input, field.control.kind === "multiline_text" && styles.multiline]} textAlignVertical={field.control.kind === "multiline_text" ? "top" : "center"} value={typeof value === "string" ? value : ""} />;
    case "numeric_with_unit": return <NumericWithUnit label={field.label} units={field.control.units} value={numericValue(value, field.control.units[0] ?? "")} onChange={onChange} disabled={disabled} />;
    case "single_select": return <SelectOptions field={field} selected={typeof value === "string" ? value : ""} onChange={onChange} disabled={disabled} />;
    case "multi_select": return <MultiSelectOptions field={field} selected={Array.isArray(value) ? value : []} onChange={onChange} disabled={disabled} />;
    case "date": return <DateInput label={field.label} value={typeof value === "string" ? value : ""} onChange={onChange} disabled={disabled} />;
    case "date_range": return <DateRangeInput label={field.label} value={dateRangeValue(value)} onChange={onChange} disabled={disabled} />;
    case "segmented_scale": return <SegmentedScale field={field} value={typeof value === "string" ? value : ""} onChange={onChange} disabled={disabled} />;
    case "field_group": return <FieldGroup fields={field.control.fields} value={fieldGroupValue(value)} onChange={onChange} disabled={disabled} />;
  }
}

function NumericWithUnit({ label, units, value, onChange, disabled }: { label: string; units: readonly string[]; value: NumericWithUnitDraft; onChange(value: NumericWithUnitDraft): void; disabled: boolean }) {
  return <View style={styles.quantityRow}>
    <TextInput accessibilityLabel={`${label} 数值`} editable={!disabled} keyboardType="decimal-pad" onChangeText={(amount) => onChange({ ...value, amount })} placeholder="—" placeholderTextColor={colors.ink3} style={[styles.input, styles.quantityInput]} value={value.amount} />
    <View style={styles.units}>{units.map((unit) => <Pressable key={unit} accessibilityRole="radio" accessibilityState={{ selected: value.unit === unit }} disabled={disabled} onPress={() => onChange({ ...value, unit })} style={[styles.unit, value.unit === unit && styles.unitSelected]}><Text style={[styles.unitText, value.unit === unit && styles.unitTextSelected]}>{unit}</Text></Pressable>)}</View>
  </View>;
}

function SelectOptions({ field, selected, onChange, disabled }: { field: OnboardingFieldDefinition; selected: string; onChange(value: string): void; disabled: boolean }) {
  if (field.control.kind !== "single_select") return null;
  return <View style={styles.options}>{field.control.options.map((option) => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ selected: selected === option.id }} disabled={disabled} onPress={() => onChange(option.id)} style={[styles.option, selected === option.id && styles.optionSelected]}><Text style={[styles.optionText, selected === option.id && styles.optionTextSelected]}>{option.label}</Text></Pressable>)}</View>;
}

function MultiSelectOptions({ field, selected, onChange, disabled }: { field: OnboardingFieldDefinition; selected: readonly string[]; onChange(value: readonly string[]): void; disabled: boolean }) {
  if (field.control.kind !== "multi_select") return null;
  return <View style={styles.options}>{field.control.options.map((option) => {
    const isSelected = selected.includes(option.id);
    return <Pressable key={option.id} accessibilityRole="checkbox" accessibilityState={{ checked: isSelected }} disabled={disabled} onPress={() => onChange(isSelected ? selected.filter((id) => id !== option.id) : [...selected, option.id])} style={[styles.option, isSelected && styles.optionSelected]}><Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>{option.label}</Text></Pressable>;
  })}</View>;
}

function DateInput({ label, value, onChange, disabled }: { label: string; value: string; onChange(value: string): void; disabled: boolean }) {
  return <TextInput accessibilityLabel={`${label} 日期`} editable={!disabled} onChangeText={onChange} placeholder="YYYY-MM-DD" placeholderTextColor={colors.ink3} style={styles.input} value={value} />;
}

function DateRangeInput({ label, value, onChange, disabled }: { label: string; value: DateRangeDraft; onChange(value: DateRangeDraft): void; disabled: boolean }) {
  return <View style={styles.dateRange}><DateInput label={`${label} 开始`} value={value.start} onChange={(start) => onChange({ ...value, start })} disabled={disabled} /><DateInput label={`${label} 结束`} value={value.end} onChange={(end) => onChange({ ...value, end })} disabled={disabled} /></View>;
}

function SegmentedScale({ field, value, onChange, disabled }: { field: OnboardingFieldDefinition; value: string; onChange(value: string): void; disabled: boolean }) {
  const control = field.control;
  if (control.kind !== "segmented_scale") return null;
  const choices = range(control.minimum, control.maximum, control.step);
  const selected = Number(value);
  const set = (next: number) => onChange(String(Math.max(control.minimum, Math.min(control.maximum, next))));
  return <View style={styles.scale}>
    <Text style={styles.scaleLabel}>{control.valueLabel}</Text>
    <View style={styles.scaleControls}><Pressable accessibilityRole="button" accessibilityLabel={`${field.label} 减少`} disabled={disabled || !Number.isFinite(selected) || selected <= control.minimum} onPress={() => set((Number.isFinite(selected) ? selected : control.minimum) - control.step)} style={styles.stepButton}><Text style={styles.stepText}>−</Text></Pressable><View style={styles.options}>{choices.map((choice) => <Pressable key={choice} accessibilityRole="radio" accessibilityState={{ selected: selected === choice }} disabled={disabled} onPress={() => set(choice)} style={[styles.option, selected === choice && styles.optionSelected]}><Text style={[styles.optionText, selected === choice && styles.optionTextSelected]}>{choice}</Text></Pressable>)}</View><Pressable accessibilityRole="button" accessibilityLabel={`${field.label} 增加`} disabled={disabled || !Number.isFinite(selected) || selected >= control.maximum} onPress={() => set((Number.isFinite(selected) ? selected : control.minimum) + control.step)} style={styles.stepButton}><Text style={styles.stepText}>＋</Text></Pressable></View>
  </View>;
}

function FieldGroup({ fields, value, onChange, disabled }: { fields: readonly string[]; value: FieldGroupDraft; onChange(value: FieldGroupDraft): void; disabled: boolean }) {
  return <View style={styles.group}>{fields.map((name) => name === "load" ? <View key={name}><Text style={styles.groupLabel}>{groupFieldLabel(name)}</Text><NumericWithUnit label={groupFieldLabel(name)} units={["kg"]} value={numericValue(value[name], "kg")} onChange={(next) => onChange({ ...value, [name]: next })} disabled={disabled} /></View> : name === "performed_on" ? <View key={name}><Text style={styles.groupLabel}>{groupFieldLabel(name)}</Text><DateInput label={groupFieldLabel(name)} value={typeof value[name] === "string" ? value[name] : ""} onChange={(next) => onChange({ ...value, [name]: next })} disabled={disabled} /></View> : <View key={name}><Text style={styles.groupLabel}>{groupFieldLabel(name)}</Text><TextInput accessibilityLabel={groupFieldLabel(name)} editable={!disabled} keyboardType={name === "reps" || name === "rir_or_rpe" || name === "days_per_week" || name === "minutes_per_session" ? "decimal-pad" : "default"} multiline={name === "conditions"} onChangeText={(next) => onChange({ ...value, [name]: next })} placeholderTextColor={colors.ink3} style={[styles.input, name === "conditions" && styles.multiline]} value={typeof value[name] === "string" ? value[name] : ""} /></View>)}</View>;
}

function numericValue(value: DynamicOnboardingFormValue, unit: string): NumericWithUnitDraft {
  return value && typeof value === "object" && !Array.isArray(value) && "amount" in value && "unit" in value ? value as NumericWithUnitDraft : { amount: "", unit };
}

function dateRangeValue(value: DynamicOnboardingFormValue): DateRangeDraft {
  return value && typeof value === "object" && !Array.isArray(value) && "start" in value && "end" in value ? value as DateRangeDraft : { start: "", end: "" };
}

function fieldGroupValue(value: DynamicOnboardingFormValue): FieldGroupDraft {
  return value && typeof value === "object" && !Array.isArray(value) ? value as FieldGroupDraft : {};
}

function range(minimum: number, maximum: number, step: number): readonly number[] {
  const result: number[] = [];
  for (let value = minimum; value <= maximum; value += step) result.push(value);
  return result;
}

function groupFieldLabel(name: string): string {
  return ({ exercise_variant: "动作变式", load: "重量", reps: "次数", rir_or_rpe: "RIR / RPE", performed_on: "训练日期", conditions: "当时情况", days_per_week: "每周可训练天数", minutes_per_session: "每次可训练分钟" } as Record<string, string>)[name] ?? name;
}

function reasonLabel(requiredFor: string): string {
  return ({ reliable_energy_target: "这会影响能量目标的可靠性。", dated_session_schedule: "这会影响训练日安排。", high_intensity_cardio: "这会影响高强度有氧是否适合安排。", exercise_selection: "这会影响动作选择。", comparable_strength_progression: "这会影响力量进阶的起点。", body_composition_trend: "这会影响体型变化的追踪。", managed_plan_changes: "这会影响计划调整的确认方式。", remote_coach_conversation: "这会影响对话能力是否可用。" } as Record<string, string>)[requiredFor] ?? "这会影响下一步的安排。";
}

function topicLabel(topic: string): string {
  return ({ energy_planning: "日常活动与饮食", strength_baseline: "近期训练表现", measurement_quality: "体型记录方式", schedule_feasibility: "训练时间安排", safety_check: "训练安全情况", goal_timing: "目标时间" } as Record<string, string>)[topic] ?? topic;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 22, padding: 17, gap: 16, borderWidth: 1, borderColor: colors.line },
  heading: { gap: 4 }, title: { color: colors.ink, fontSize: 17, fontWeight: "900" }, hint: { color: colors.ink3, fontSize: 12, lineHeight: 18 },
  field: { gap: 8 }, label: { color: colors.ink2, fontSize: 12, fontWeight: "900" }, groupLabel: { color: colors.ink2, fontSize: 11, fontWeight: "800", marginBottom: 5 },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, color: colors.ink, paddingHorizontal: 11, fontSize: 14, fontWeight: "600" }, multiline: { minHeight: 88, paddingTop: 11, textAlignVertical: "top" },
  quantityRow: { flexDirection: "row", gap: 8 }, quantityInput: { flex: 1 }, units: { flexDirection: "row", gap: 6, alignItems: "center" }, unit: { minHeight: 42, paddingHorizontal: 11, justifyContent: "center", borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line }, unitSelected: { backgroundColor: colors.lime, borderColor: colors.limeDeep }, unitText: { color: colors.ink2, fontSize: 12, fontWeight: "800" }, unitTextSelected: { color: colors.limeInk },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, option: { minHeight: 40, justifyContent: "center", paddingHorizontal: 12, borderWidth: 1, borderColor: colors.line, borderRadius: radius.chip, backgroundColor: colors.paper }, optionSelected: { backgroundColor: colors.lime, borderColor: colors.limeDeep }, optionText: { color: colors.ink2, fontSize: 12, fontWeight: "800" }, optionTextSelected: { color: colors.limeInk },
  unknown: { alignSelf: "flex-start", paddingVertical: 3 }, unknownText: { color: colors.ink3, fontSize: 12, fontWeight: "700", textDecorationLine: "underline" }, dateRange: { gap: 8 }, scale: { gap: 7 }, scaleLabel: { color: colors.ink3, fontSize: 11 }, scaleControls: { flexDirection: "row", alignItems: "center", gap: 7 }, stepButton: { width: 38, height: 38, justifyContent: "center", alignItems: "center", borderRadius: 19, backgroundColor: colors.paper2 }, stepText: { color: colors.ink, fontSize: 18, fontWeight: "800" }, group: { gap: 10 },
  submit: { minHeight: 52, borderRadius: radius.chip, backgroundColor: colors.dark, paddingHorizontal: 19, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, disabled: { opacity: 0.45 }, submitText: { color: colors.white, fontSize: 15, fontWeight: "900" }, submitArrow: { color: colors.lime, fontSize: 20, fontWeight: "800" },
});
