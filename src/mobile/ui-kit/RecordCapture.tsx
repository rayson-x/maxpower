import React, { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { uiColors, uiRadius, uiSpace, uiType } from "./tokens";
import { ProfessionalTermText } from "./ProfessionalTermText";

/** A capture is deliberately not a persisted Timeline record. */
export type RecordIntent = "training" | "nutrition" | "activity" | "check_in";

export interface RecordIntentOption {
  id: RecordIntent;
  label: string;
  detail: string;
  glyph: string;
}

export function RecordCaptureComposer({
  value,
  onChangeText,
  onSubmit,
  disabled = false,
}: {
  value: string;
  onChangeText(value: string): void;
  onSubmit(): void;
  disabled?: boolean;
}) {
  return <View style={styles.composer}>
    <View style={styles.composerSignal} />
    <TextInput
      accessibilityLabel="描述要记录的内容"
      value={value}
      onChangeText={onChangeText}
      multiline
      placeholder="说说刚发生了什么"
      placeholderTextColor={uiColors.inkFaint}
      style={styles.composerInput}
    />
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="交给 Coach 整理为记录草稿"
      disabled={disabled || !value.trim()}
      onPress={onSubmit}
      style={({ pressed }) => [styles.composerSubmit, (!value.trim() || disabled) && styles.composerSubmitDisabled, pressed && styles.pressed]}
    ><Text style={styles.composerSubmitText}>↗</Text></Pressable>
  </View>;
}

export function RecordIntentGrid({
  value,
  options,
  onChange,
}: {
  value: RecordIntent;
  options: readonly RecordIntentOption[];
  onChange(value: RecordIntent): void;
}) {
  return <View accessibilityRole="tablist" style={styles.intentGrid}>
    {options.map((option) => {
      const selected = option.id === value;
      return <Pressable
        key={option.id}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        onPress={() => onChange(option.id)}
        style={({ pressed }) => [
          styles.intent,
          options.length === 3 && styles.intentThird,
          selected && styles.intentSelected,
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.intentGlyph, selected && styles.intentGlyphSelected]}>{option.glyph}</Text>
        <View style={styles.intentCopy}>
          <Text style={[styles.intentLabel, selected && styles.intentLabelSelected]}>{option.label}</Text>
          <Text style={[styles.intentDetail, selected && styles.intentDetailSelected]}>{option.detail}</Text>
        </View>
      </Pressable>;
    })}
  </View>;
}

export function RecordSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <View style={styles.section}>
    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text>{action}</View>
    {children}
  </View>;
}

export function RecordField({ label, unit, style, ...props }: {
  label: string;
  unit?: string;
  style?: TextInputProps["style"];
} & Omit<TextInputProps, "style" | "accessibilityLabel" | "placeholderTextColor">) {
  return <View style={styles.field}>
    <ProfessionalTermText text={label} style={styles.fieldLabel} />
    <View style={styles.fieldValue}>
      <TextInput
        accessibilityLabel={label}
        placeholder="—"
        placeholderTextColor={uiColors.inkFaint}
        style={[styles.fieldInput, style]}
        {...props}
      />
      {unit ? <Text style={styles.fieldUnit}>{unit}</Text> : null}
    </View>
  </View>;
}

export function RecordPills<T extends string>({
  value,
  options,
  onChange,
  compact = false,
}: {
  value: T;
  options: readonly { id: T; label: string }[];
  onChange(value: T): void;
  compact?: boolean;
}) {
  return <View style={[styles.pills, compact && styles.pillsCompact]}>
    {options.map((option) => {
      const selected = option.id === value;
      return <Pressable
        key={option.id}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        onPress={() => onChange(option.id)}
        style={({ pressed }) => [styles.pill, compact && styles.pillCompact, selected && styles.pillSelected, pressed && styles.pressed]}
      ><Text style={[styles.pillText, selected && styles.pillTextSelected]}>{option.label}</Text></Pressable>;
    })}
  </View>;
}

export function RecordConfirmationBar({
  label,
  onConfirm,
  busy = false,
}: {
  label: string;
  onConfirm(): void;
  busy?: boolean;
}) {
  return <Pressable
    accessibilityRole="button"
    disabled={busy}
    onPress={onConfirm}
    style={({ pressed }) => [styles.confirm, busy && styles.confirmDisabled, pressed && styles.pressed]}
  >
    <Text style={styles.confirmText}>{busy ? "保存中" : label}</Text>
    <View style={styles.confirmArrow}><Text style={styles.confirmArrowText}>↑</Text></View>
  </Pressable>;
}

const styles = StyleSheet.create({
  composer: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 15, paddingRight: 7, borderWidth: 1, borderColor: uiColors.line, borderRadius: uiRadius.large, backgroundColor: uiColors.paper },
  composerSignal: { width: 8, height: 8, borderRadius: 4, backgroundColor: uiColors.limeDeep },
  composerInput: { flex: 1, minWidth: 0, maxHeight: 88, paddingVertical: 13, color: uiColors.ink, fontFamily: uiType.body, fontSize: 15, lineHeight: 21 },
  composerSubmit: { width: 46, height: 46, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: uiColors.ink },
  composerSubmitDisabled: { opacity: 0.28 },
  composerSubmitText: { marginTop: -2, color: uiColors.lime, fontFamily: uiType.body, fontSize: 22, fontWeight: "900" },
  intentGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  intent: { width: "48.8%", minHeight: 74, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderRadius: uiRadius.medium, borderWidth: 1, borderColor: uiColors.line, backgroundColor: uiColors.paper },
  intentThird: { width: "30%", flexGrow: 1, minHeight: 82, flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 5, paddingHorizontal: 10 },
  intentSelected: { borderColor: uiColors.ink, backgroundColor: uiColors.ink },
  intentGlyph: { width: 25, color: uiColors.inkMuted, fontFamily: uiType.mono, fontSize: 20, fontWeight: "900", textAlign: "center" },
  intentGlyphSelected: { color: uiColors.lime },
  intentCopy: { flex: 1, minWidth: 0 },
  intentLabel: { color: uiColors.ink, fontFamily: uiType.body, fontSize: 14, fontWeight: "900" },
  intentLabelSelected: { color: uiColors.white },
  intentDetail: { marginTop: 2, color: uiColors.inkFaint, fontFamily: uiType.body, fontSize: 10, fontWeight: "700" },
  intentDetailSelected: { color: "#A7ACA2" },
  section: { gap: 11 },
  sectionHeading: { minHeight: 26, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  sectionTitle: { color: uiColors.ink, fontFamily: uiType.display, fontSize: 22, fontWeight: "900", letterSpacing: -0.25 },
  field: { flex: 1, minWidth: 0, minHeight: 76, justifyContent: "space-between", padding: uiSpace.compact, borderRadius: uiRadius.medium, backgroundColor: "#ECE9E1" },
  fieldLabel: { color: uiColors.inkMuted, fontFamily: uiType.body, fontSize: 11, fontWeight: "800" },
  fieldValue: { flexDirection: "row", alignItems: "baseline", gap: 5 },
  fieldInput: { flex: 1, minWidth: 0, padding: 0, color: uiColors.ink, fontFamily: uiType.mono, fontSize: 22, fontWeight: "900" },
  fieldUnit: { color: uiColors.inkFaint, fontFamily: uiType.body, fontSize: 10, fontWeight: "800" },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  pillsCompact: { gap: 6 },
  pill: { minHeight: 40, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: uiRadius.pill, backgroundColor: "#ECE9E1" },
  pillCompact: { minHeight: 34, paddingHorizontal: 12 },
  pillSelected: { backgroundColor: uiColors.ink },
  pillText: { color: uiColors.inkMuted, fontFamily: uiType.body, fontSize: 12, fontWeight: "800" },
  pillTextSelected: { color: uiColors.white },
  confirm: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 19, paddingRight: 7, borderRadius: uiRadius.pill, backgroundColor: uiColors.ink },
  confirmDisabled: { opacity: 0.48 },
  confirmText: { color: uiColors.white, fontFamily: uiType.body, fontSize: 16, fontWeight: "900" },
  confirmArrow: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: uiColors.lime },
  confirmArrowText: { marginTop: -2, color: uiColors.ink, fontFamily: uiType.body, fontSize: 22, fontWeight: "900" },
  pressed: { opacity: 0.74, transform: [{ scale: 0.985 }] },
});
