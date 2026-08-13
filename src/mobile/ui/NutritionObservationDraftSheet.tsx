import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { getT, NUTRITION_COPY, resolveLocale, useT, type Locale } from "../../i18n";
import type { NutritionObservationDraftArtifact } from "../../coach/model";
import type { NutrientEstimate, NutritionObservationDraftEdits } from "../../nutrition";
import { nutritionDraftDisclosure, nutritionDraftRequiresUserEdit } from "./nutritionObservationDraftModel";
import { colors, radius } from "./theme";

interface EditableCandidate {
  foodName: string;
  portionAssumption: string;
  energyMin: string;
  energyMax: string;
  proteinMin: string;
  proteinMax: string;
  fatMin: string;
  fatMax: string;
  carbohydrateMin: string;
  carbohydrateMax: string;
  assumptions: string;
  confidence: NutrientEstimate["confidence"];
}

export interface NutritionObservationDraftSheetProps {
  artifact: NutritionObservationDraftArtifact;
  onDismiss: () => void;
  onConfirm: (edits?: NutritionObservationDraftEdits) => void;
  onReject: () => void;
  busy?: boolean;
  /** From profile.locale; falls back to English when unknown. */
  locale?: string;
}

/**
 * A client-side review surface for an immutable NutritionObservationDraft.
 * It never calls an LLM, uploads media, or writes Timeline facts itself. The
 * parent has to invoke the typed confirmation/rejection facade after the user
 * explicitly chooses one of those actions.
 */
export function NutritionObservationDraftSheet({
  artifact,
  onDismiss,
  onConfirm,
  onReject,
  busy = false,
  locale,
}: NutritionObservationDraftSheetProps) {
  const { draft } = artifact;
  const t = useT(NUTRITION_COPY, locale);
  const disclosure = useMemo(() => nutritionDraftDisclosure(draft, locale), [draft, locale]);
  const [description, setDescription] = useState(draft.observation.description ?? "");
  const [candidates, setCandidates] = useState<EditableCandidate[]>(() => draft.estimates.map(editableCandidate));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const requiresEdit = nutritionDraftRequiresUserEdit(draft);

  const updateCandidate = (index: number, changes: Partial<EditableCandidate>) => {
    setDirty(true);
    setCandidates((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, ...changes } : candidate));
  };
  const removeCandidate = (index: number) => {
    setDirty(true);
    setCandidates((current) => current.filter((_, candidateIndex) => candidateIndex !== index));
  };
  const addCandidate = () => {
    setDirty(true);
    setCandidates((current) => [...current, emptyCandidate()]);
  };
  const confirm = () => {
    if (requiresEdit && !dirty) {
      setError(t("sheet.error.needsEdit"));
      return;
    }
    try {
      const edits = dirty
        ? normalizeEdits({ description, candidates, originalDescription: draft.observation.description ?? "", locale })
        : undefined;
      onConfirm(edits);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("sheet.error.checkValues"));
    }
  };

  return (
    <View accessibilityViewIsModal style={styles.scrim}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("sheet.closeA11y")} onPress={onDismiss} style={StyleSheet.absoluteFill} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{t("sheet.eyebrow")}</Text>
            <Text style={styles.title}>{t("sheet.title")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("sheet.closeA11y")} onPress={onDismiss} style={styles.close}><Text style={styles.closeText}>{t("sheet.close")}</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>{disclosure.remoteProcessing ? t("sheet.notice.generatedBy", { provider: disclosure.providerLabel ?? "" }) : t("sheet.notice.localOnly")}</Text>
            <Text style={styles.noticeText}>{disclosure.mediaPolicy}</Text>
            {disclosure.sentInputs.length ? <Text style={styles.noticeMeta}>{t("sheet.notice.processed", { inputs: disclosure.sentInputs.join(" · ") })}</Text> : null}
            {disclosure.privacyNotice ? <Text style={styles.noticeMeta}>{disclosure.privacyNotice}</Text> : null}
          </View>
          <Text style={styles.boundary}>{t("sheet.boundary")}</Text>
          <Field label={t("sheet.field.description")} value={description} onChangeText={(value) => { setDirty(true); setDescription(value); }} placeholder={t("sheet.field.descriptionPlaceholder")} locale={locale} />
          <View style={styles.sectionTop}>
            <View><Text style={styles.sectionTitle}>{t("sheet.section.foods")}</Text><Text style={styles.sectionSub}>{t("sheet.section.foodsSub")}</Text></View>
            <Pressable accessibilityRole="button" disabled={busy} onPress={addCandidate} style={styles.addButton}><Text style={styles.addButtonText}>{t("sheet.action.add")}</Text></Pressable>
          </View>
          {candidates.length ? candidates.map((candidate, index) => (
            <CandidateEditor
              key={`${index}:${candidate.foodName}`}
              candidate={candidate}
              index={index}
              canRemove={candidates.length > 1 || draft.estimates.length === 0}
              onChange={(changes) => updateCandidate(index, changes)}
              onRemove={() => removeCandidate(index)}
              locale={locale}
            />
          )) : <Text style={styles.empty}>{t("sheet.empty")}</Text>}
          {draft.missing?.length ? <View style={styles.missing}><Text style={styles.missingTitle}>{t("sheet.missing.title")}</Text><Text style={styles.missingText}>{draft.missing.join(" · ")}</Text></View> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={onReject} style={styles.reject}><Text style={styles.rejectText}>{t("sheet.action.reject")}</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={confirm} style={[styles.confirm, busy && styles.disabled]}><Text style={styles.confirmText}>{t(busy ? "sheet.action.saving" : "sheet.action.confirm")}</Text></Pressable>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function CandidateEditor({ candidate, index, canRemove, onChange, onRemove, locale }: {
  candidate: EditableCandidate;
  index: number;
  canRemove: boolean;
  onChange: (changes: Partial<EditableCandidate>) => void;
  onRemove: () => void;
  locale?: string;
}) {
  const t = useT(NUTRITION_COPY, locale);
  return <View style={styles.candidate}>
    <View style={styles.candidateHeader}><Text style={styles.candidateTitle}>{t("sheet.food.ordinal", { index: index + 1 })}</Text>{canRemove ? <Pressable accessibilityRole="button" onPress={onRemove}><Text style={styles.removeText}>{t("sheet.food.remove")}</Text></Pressable> : null}</View>
    <Field label={t("sheet.field.foodName")} value={candidate.foodName} onChangeText={(foodName) => onChange({ foodName })} placeholder={t("sheet.field.foodNamePlaceholder")} locale={locale} />
    <Field label={t("sheet.field.portion")} value={candidate.portionAssumption} onChangeText={(portionAssumption) => onChange({ portionAssumption })} placeholder={t("sheet.field.portionPlaceholder")} locale={locale} />
    <RangeFields label={t("sheet.field.energy")} min={candidate.energyMin} max={candidate.energyMax} onMin={(energyMin) => onChange({ energyMin })} onMax={(energyMax) => onChange({ energyMax })} locale={locale} />
    <RangeFields label={t("sheet.field.protein")} min={candidate.proteinMin} max={candidate.proteinMax} onMin={(proteinMin) => onChange({ proteinMin })} onMax={(proteinMax) => onChange({ proteinMax })} locale={locale} />
    <RangeFields label={t("sheet.field.fat")} min={candidate.fatMin} max={candidate.fatMax} onMin={(fatMin) => onChange({ fatMin })} onMax={(fatMax) => onChange({ fatMax })} locale={locale} />
    <RangeFields label={t("sheet.field.carbohydrate")} min={candidate.carbohydrateMin} max={candidate.carbohydrateMax} onMin={(carbohydrateMin) => onChange({ carbohydrateMin })} onMax={(carbohydrateMax) => onChange({ carbohydrateMax })} locale={locale} />
    <Field label={t("sheet.field.assumptions")} value={candidate.assumptions} onChangeText={(assumptions) => onChange({ assumptions })} placeholder={t("sheet.field.assumptionsPlaceholder")} locale={locale} />
    <Text style={styles.fieldLabel}>{t("sheet.field.confidence")}</Text>
    <View style={styles.confidenceRow}>{(["low", "medium", "high"] as const).map((confidence) => <Pressable key={confidence} accessibilityRole="radio" accessibilityState={{ selected: candidate.confidence === confidence }} onPress={() => onChange({ confidence })} style={[styles.chip, candidate.confidence === confidence && styles.chipSelected]}><Text style={[styles.chipText, candidate.confidence === confidence && styles.chipTextSelected]}>{t(confidence === "low" ? "sheet.confidence.low" : confidence === "medium" ? "sheet.confidence.medium" : "sheet.confidence.high")}</Text></Pressable>)}</View>
  </View>;
}

function Field({ label, value, onChangeText, placeholder }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; locale?: string }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.ink3} style={styles.input} /></View>;
}

/** 范围输入之间的连接符属于排版规则（不是文案），按 locale 选择。 */
const RANGE_DIVIDER: Record<Locale, string> = { en: "to", zh: "至" };

function RangeFields({ label, min, max, onMin, onMax, locale }: { label: string; min: string; max: string; onMin: (value: string) => void; onMax: (value: string) => void; locale?: string }) {
  const t = useT(NUTRITION_COPY, locale);
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><View style={styles.rangeRow}><TextInput accessibilityLabel={t("sheet.range.minA11y", { label })} keyboardType="decimal-pad" value={min} onChangeText={onMin} placeholder={t("sheet.range.min")} placeholderTextColor={colors.ink3} style={styles.rangeInput} /><Text style={styles.rangeDivider}>{RANGE_DIVIDER[resolveLocale(locale)]}</Text><TextInput accessibilityLabel={t("sheet.range.maxA11y", { label })} keyboardType="decimal-pad" value={max} onChangeText={onMax} placeholder={t("sheet.range.max")} placeholderTextColor={colors.ink3} style={styles.rangeInput} /></View></View>;
}

function editableCandidate(candidate: NutrientEstimate): EditableCandidate {
  return {
    foodName: candidate.foodName,
    portionAssumption: candidate.portionAssumption,
    energyMin: candidate.energyRange ? String(candidate.energyRange.min.value) : "",
    energyMax: candidate.energyRange ? String(candidate.energyRange.max.value) : "",
    proteinMin: candidate.proteinGramsRange ? String(candidate.proteinGramsRange.min) : "",
    proteinMax: candidate.proteinGramsRange ? String(candidate.proteinGramsRange.max) : "",
    fatMin: candidate.fatGramsRange ? String(candidate.fatGramsRange.min) : "",
    fatMax: candidate.fatGramsRange ? String(candidate.fatGramsRange.max) : "",
    carbohydrateMin: candidate.carbohydrateGramsRange ? String(candidate.carbohydrateGramsRange.min) : "",
    carbohydrateMax: candidate.carbohydrateGramsRange ? String(candidate.carbohydrateGramsRange.max) : "",
    assumptions: candidate.assumptions.join("；"),
    confidence: candidate.confidence,
  };
}

function emptyCandidate(): EditableCandidate {
  return { foodName: "", portionAssumption: "", energyMin: "", energyMax: "", proteinMin: "", proteinMax: "", fatMin: "", fatMax: "", carbohydrateMin: "", carbohydrateMax: "", assumptions: "", confidence: "low" };
}

function normalizeEdits(input: { description: string; originalDescription: string; candidates: readonly EditableCandidate[]; locale?: string }): NutritionObservationDraftEdits {
  const t = getT(NUTRITION_COPY, input.locale);
  const description = input.description.trim();
  const estimates = input.candidates.map((candidate) => nutrientEstimateFromEditable(candidate, input.locale));
  if (!description && estimates.length === 0) throw new Error(t("sheet.error.needDescriptionOrFood"));
  return {
    ...(description && description !== input.originalDescription ? { description } : {}),
    ...(estimates.length ? { estimates } : {}),
  };
}

function nutrientEstimateFromEditable(candidate: EditableCandidate, locale?: string): NutrientEstimate {
  const t = getT(NUTRITION_COPY, locale);
  const foodName = candidate.foodName.trim();
  const portionAssumption = candidate.portionAssumption.trim();
  const assumptions = candidate.assumptions.split(/[；;\n]/).map((item) => item.trim()).filter(Boolean);
  if (!foodName || !portionAssumption || !assumptions.length) throw new Error(t("sheet.error.incompleteFood"));
  const energyRange = energyRangeFromEditable(candidate.energyMin, candidate.energyMax, locale);
  const proteinGramsRange = numericRange(candidate.proteinMin, candidate.proteinMax, locale);
  const fatGramsRange = numericRange(candidate.fatMin, candidate.fatMax, locale);
  const carbohydrateGramsRange = numericRange(candidate.carbohydrateMin, candidate.carbohydrateMax, locale);
  if (!energyRange && !proteinGramsRange && !fatGramsRange && !carbohydrateGramsRange) {
    throw new Error(t("sheet.error.needOneRange"));
  }
  return {
    foodName,
    portionAssumption,
    ...(energyRange ? { energyRange } : {}),
    ...(proteinGramsRange ? { proteinGramsRange } : {}),
    ...(fatGramsRange ? { fatGramsRange } : {}),
    ...(carbohydrateGramsRange ? { carbohydrateGramsRange } : {}),
    assumptions,
    confidence: candidate.confidence,
  };
}

function numericRange(minimum: string, maximum: string, locale?: string): { min: number; max: number } | undefined {
  if (!minimum.trim() && !maximum.trim()) return undefined;
  const min = Number(minimum);
  const max = Number(maximum);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) {
    throw new Error(getT(NUTRITION_COPY, locale)("sheet.error.invalidRange"));
  }
  return { min, max };
}

function energyRangeFromEditable(minimum: string, maximum: string, locale?: string): NutrientEstimate["energyRange"] {
  const value = numericRange(minimum, maximum, locale);
  return value
    ? { min: { value: value.min, unit: "kcal" }, max: { value: value.max, unit: "kcal" } }
    : undefined;
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, zIndex: 40, backgroundColor: "rgba(10,12,10,0.4)", justifyContent: "flex-end" },
  sheet: { maxHeight: "91%", backgroundColor: colors.paper, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, overflow: "hidden" },
  handle: { alignSelf: "center", width: 42, height: 5, borderRadius: 3, marginTop: 10, backgroundColor: colors.line },
  header: { minHeight: 74, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  headerCopy: { flex: 1 }, eyebrow: { color: colors.terra, fontSize: 11, fontWeight: "900", letterSpacing: 0.7 }, title: { marginTop: 4, color: colors.ink, fontSize: 22, fontWeight: "900" },
  close: { minHeight: 36, paddingHorizontal: 12, justifyContent: "center", borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line }, closeText: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  content: { padding: 18, paddingBottom: 32, gap: 14 },
  notice: { padding: 14, borderRadius: radius.row, backgroundColor: "#EFF5DE" }, noticeTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" }, noticeText: { marginTop: 5, color: colors.ink2, fontSize: 12, lineHeight: 17 }, noticeMeta: { marginTop: 7, color: colors.ink3, fontSize: 11, lineHeight: 16 },
  boundary: { color: colors.ink3, fontSize: 11, lineHeight: 16 },
  sectionTop: { marginTop: 4, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }, sectionTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" }, sectionSub: { marginTop: 3, flex: 1, color: colors.ink3, fontSize: 11, lineHeight: 16 },
  addButton: { minHeight: 34, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: radius.chip, backgroundColor: colors.dark }, addButtonText: { color: colors.lime, fontSize: 12, fontWeight: "900" },
  candidate: { padding: 14, borderRadius: radius.row, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, candidateHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }, candidateTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" }, removeText: { color: colors.terra, fontSize: 12, fontWeight: "800" },
  field: { marginTop: 10 }, fieldLabel: { color: colors.ink2, fontSize: 11, fontWeight: "800", marginBottom: 5 }, input: { minHeight: 42, borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 11, color: colors.ink, fontSize: 13, backgroundColor: colors.paper },
  rangeRow: { flexDirection: "row", alignItems: "center", gap: 7 }, rangeInput: { flex: 1, minWidth: 0, minHeight: 40, borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 10, color: colors.ink, fontSize: 13, backgroundColor: colors.paper }, rangeDivider: { color: colors.ink3, fontSize: 12 },
  confidenceRow: { flexDirection: "row", gap: 7 }, chip: { minWidth: 42, minHeight: 34, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line }, chipSelected: { backgroundColor: colors.dark, borderColor: colors.dark }, chipText: { color: colors.ink2, fontSize: 12, fontWeight: "800" }, chipTextSelected: { color: colors.lime },
  missing: { padding: 12, borderRadius: radius.row, backgroundColor: colors.terraSoft }, missingTitle: { color: colors.terra, fontSize: 11, fontWeight: "900" }, missingText: { marginTop: 4, color: colors.ink2, fontSize: 12, lineHeight: 17 }, empty: { padding: 14, borderRadius: radius.row, backgroundColor: colors.white, color: colors.ink3, fontSize: 12 }, error: { color: colors.terra, fontSize: 12, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 }, reject: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, rejectText: { color: colors.ink, fontSize: 14, fontWeight: "900" }, confirm: { flex: 1.4, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.chip, backgroundColor: colors.dark }, confirmText: { color: colors.lime, fontSize: 14, fontWeight: "900" }, disabled: { opacity: 0.55 },
});
