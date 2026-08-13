import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  BASELINE_INTAKE_FIELDS,
  isBaselineIntakeComplete,
  type BaselineIntakeField,
  type BaselineIntakeFieldId,
  type BaselineIntakeValues,
} from "./baselineIntake";
import { colors, radius } from "./theme";

export interface BaselineIntakeCardProps {
  value: BaselineIntakeValues;
  onChange(field: BaselineIntakeFieldId, value: string): void;
  onContinue(values: BaselineIntakeValues): void;
  disabled?: boolean;
}

/**
 * Initial, controlled form card for the only four fixed onboarding inputs.
 * It intentionally has no knowledge of a draft or a persistence target.
 */
export function BaselineIntakeCard({ value, onChange, onContinue, disabled = false }: BaselineIntakeCardProps) {
  const complete = isBaselineIntakeComplete(value);
  return <View style={styles.card}>
    <View style={styles.heading}>
      <Text style={styles.step}>01</Text>
      <View style={styles.headingBody}>
        <Text style={styles.title}>先认识一下你。</Text>
        <Text style={styles.hint}>这四项够我们开始聊；其他资料等需要时再问。</Text>
      </View>
    </View>
    <View style={styles.numericFields}>
      {BASELINE_INTAKE_FIELDS.slice(0, 3).map((field) => <Field key={field.id} field={field} value={value[field.id]} onChange={onChange} disabled={disabled} />)}
    </View>
    <Field field={BASELINE_INTAKE_FIELDS[3]} value={value.goalNarrative} onChange={onChange} disabled={disabled} />
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="继续建立档案"
      accessibilityState={{ disabled: disabled || !complete }}
      disabled={disabled || !complete}
      onPress={() => onContinue(value)}
      style={[styles.button, (disabled || !complete) && styles.buttonDisabled]}
    >
      <Text style={styles.buttonText}>继续</Text>
      <Text style={styles.buttonArrow}>→</Text>
    </Pressable>
  </View>;
}

function Field({ field, value, onChange, disabled }: {
  field: BaselineIntakeField;
  value: string;
  onChange(field: BaselineIntakeFieldId, value: string): void;
  disabled: boolean;
}) {
  const multiline = field.control === "multiline_text";
  return <View style={[styles.field, multiline && styles.goalField]}>
    <Text style={styles.label}>{field.label}{field.unit ? <Text style={styles.unit}> · {field.unit}</Text> : null}</Text>
    <TextInput
      accessibilityLabel={field.label}
      editable={!disabled}
      keyboardType={field.control === "integer" ? "number-pad" : field.control === "decimal" ? "decimal-pad" : "default"}
      multiline={multiline}
      numberOfLines={multiline ? 4 : 1}
      onChangeText={(next) => onChange(field.id, next)}
      placeholder={field.placeholder}
      placeholderTextColor={colors.ink3}
      style={[styles.input, multiline && styles.goalInput]}
      textAlignVertical={multiline ? "top" : "center"}
      value={value}
    />
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 22, padding: 17, gap: 14, borderWidth: 1, borderColor: "rgba(22,24,29,0.055)" },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  step: { width: 28, color: colors.limeInk, fontSize: 11, fontFamily: "monospace", fontWeight: "900", paddingTop: 3 },
  headingBody: { flex: 1 },
  title: { color: colors.ink, fontSize: 17, fontWeight: "900", letterSpacing: -0.25 },
  hint: { color: colors.ink3, fontSize: 11, lineHeight: 16, marginTop: 4 },
  numericFields: { flexDirection: "row", gap: 8 },
  field: { flex: 1, gap: 6 },
  goalField: { flexBasis: "100%" },
  label: { color: colors.ink2, fontSize: 11, fontWeight: "900" },
  unit: { color: colors.ink3, fontWeight: "700" },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, color: colors.ink, paddingHorizontal: 10, fontSize: 14, fontWeight: "700" },
  goalInput: { minHeight: 106, paddingTop: 12, paddingBottom: 12, fontWeight: "500", lineHeight: 20 },
  button: { minHeight: 52, borderRadius: radius.chip, backgroundColor: colors.dark, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 19 },
  buttonDisabled: { backgroundColor: "#B8BBB2" },
  buttonText: { color: colors.white, fontSize: 15, fontWeight: "900" },
  buttonArrow: { color: colors.lime, fontSize: 20, fontWeight: "700" },
});
