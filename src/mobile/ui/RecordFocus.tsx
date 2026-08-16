import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import type { RecordModule } from "../../records";
import { createManualMealObservation, type FoodEntryData } from "../../nutrition";
import {
  BottomDrawer,
  MovementLibraryPicker,
  RecordConfirmationBar,
  RecordField,
  RecordPills,
  RecordSection,
  type DailyMovementChoice,
  type RecordIntent,
} from "../ui-kit";
import { colors, radius } from "./theme";
import { userFacingError } from "../userFacingError";
import { mobileT } from "../../i18n";


/**
 * One daily-log surface. Strength and cardio deliberately share the user
 * entry point ("运动"), but retain their distinct actual-performance fields
 * when written to Timeline.
 */
export type RecordFocusMode = "training" | "activity" | "nutrition" | "sleep" | "recovery" | "body";
export type RecordFocusInitialMode = RecordFocusMode | "picker";

type CardioDraft = {
  id: string;
  activityType: string;
  durationMinutes: string;
  distanceKm: string;
  energyKcal: string;
  intensity?: "easy" | "moderate" | "hard";
  perceivedExertion: string;
};

type MealFoodDraft = {
  id: string;
  name: string;
  grams: string;
};

const RECORD_MODES: readonly { id: RecordFocusMode; labelKey: string; detailKey: string; glyph: string }[] = [
  { id: "training", labelKey: "mobile.record.drawer.mode.strength", detailKey: "mobile.record.drawer.mode.strengthDetail", glyph: "↗" },
  { id: "activity", labelKey: "mobile.record.drawer.mode.cardio", detailKey: "mobile.record.drawer.mode.cardioDetail", glyph: "≈" },
  { id: "nutrition", labelKey: "mobile.record.drawer.mode.nutrition", detailKey: "mobile.record.drawer.mode.nutritionDetail", glyph: "◇" },
  { id: "sleep", labelKey: "mobile.record.drawer.mode.sleep", detailKey: "mobile.record.drawer.mode.sleepDetail", glyph: "☾" },
  { id: "recovery", labelKey: "mobile.record.drawer.mode.recovery", detailKey: "mobile.record.drawer.mode.recoveryDetail", glyph: "○" },
  { id: "body", labelKey: "mobile.record.drawer.mode.body", detailKey: "mobile.record.drawer.mode.bodyDetail", glyph: "+" },
] as const;

/** Manual entry writes the same typed facts that Coach tools can write. */
export function RecordFocus({
  records,
  userId,
  initialMode = "picker",
  referenceWeightKg,
  syncedSleepMinutes,
  visible,
  onDismiss,
  onSaved,
  onStartFreestyleWorkout,
}: {
  records: RecordModule;
  userId: string;
  initialMode?: RecordFocusInitialMode;
  referenceWeightKg?: number;
  /** Latest confirmed sleep imported from an authorized health source for today. */
  syncedSleepMinutes?: number;
  visible: boolean;
  onDismiss(): void;
  onSaved(): void;
  onStartFreestyleWorkout(): void;
}) {
  const [entryMode, setEntryMode] = useState<RecordFocusMode>(initialMode === "picker" ? "training" : initialMode);
  const [showPicker, setShowPicker] = useState(initialMode === "picker");
  const [cardioEntries, setCardioEntries] = useState<CardioDraft[]>([]);
  const [movementPickerOpen, setMovementPickerOpen] = useState(false);
  const [mealSlot, setMealSlot] = useState<"breakfast" | "lunch" | "dinner" | "snack">();
  const [mealFoods, setMealFoods] = useState<MealFoodDraft[]>([]);
  const [customFood, setCustomFood] = useState("");
  const [mealDescription, setMealDescription] = useState("");
  const [dayCoverage, setDayCoverage] = useState<"partial" | "complete">("partial");
  const [showNutritionDetail, setShowNutritionDetail] = useState(false);
  const [energyKcal, setEnergyKcal] = useState("");
  const [proteinGrams, setProteinGrams] = useState("");
  const [fatGrams, setFatGrams] = useState("");
  const [carbohydrateGrams, setCarbohydrateGrams] = useState("");
  const [fiberGrams, setFiberGrams] = useState("");
  const [sodiumMg, setSodiumMg] = useState("");
  const [potassiumMg, setPotassiumMg] = useState("");
  const [calciumMg, setCalciumMg] = useState("");
  const [ironMg, setIronMg] = useState("");
  const [magnesiumMg, setMagnesiumMg] = useState("");
  const [vitaminCMg, setVitaminCMg] = useState("");
  const [sleepDuration, setSleepDuration] = useState("");
  const [sleepQuality, setSleepQuality] = useState("");
  const [manualSleep, setManualSleep] = useState(false);
  const [recoveryScore, setRecoveryScore] = useState("");
  const [painSeverity, setPainSeverity] = useState("");
  const [painArea, setPainArea] = useState("");
  const [clinicalContext, setClinicalContext] = useState<"diagnosed_condition" | "medication" | "pregnancy_or_postpartum" | "recent_surgery_or_acute_injury" | "eating_disorder_or_low_energy_risk" | "other">();
  const [bodyValue, setBodyValue] = useState("");
  const [bodyMetric, setBodyMetric] = useState<"body_weight" | "body_fat_percentage" | "waist_circumference" | "shoulder_circumference">("body_weight");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const wasVisible = useRef(visible);

  useEffect(() => {
    if (visible && !wasVisible.current) {
      setEntryMode(initialMode === "picker" ? "training" : initialMode);
      setShowPicker(initialMode === "picker");
      setCardioEntries([]);
      setMovementPickerOpen(false);
      setMealSlot(undefined);
      setMealFoods([]);
      setCustomFood("");
      setMealDescription("");
      setDayCoverage("partial");
      setShowNutritionDetail(false);
      setEnergyKcal("");
      setProteinGrams("");
      setFatGrams("");
      setCarbohydrateGrams("");
      setFiberGrams("");
      setSodiumMg("");
      setPotassiumMg("");
      setCalciumMg("");
      setIronMg("");
      setMagnesiumMg("");
      setVitaminCMg("");
      setSleepDuration("");
      setSleepQuality("");
      setError(undefined);
      setManualSleep(false);
      setRecoveryScore("");
      setPainSeverity("");
      setPainArea("");
      setClinicalContext(undefined);
      setBodyValue("");
      setBodyMetric("body_weight");
    }
    wasVisible.current = visible;
  }, [initialMode, visible]);

  const activeIntent: RecordIntent = entryMode === "nutrition"
    ? "nutrition"
    : entryMode === "sleep" || entryMode === "recovery" || entryMode === "body"
      ? "check_in"
      : "training";
  const mealPreview = useMemo(
    () => manualNutritionTotals({ energyKcal, proteinGrams, fatGrams, carbohydrateGrams, fiberGrams, sodiumMg, potassiumMg, calciumMg, ironMg, magnesiumMg, vitaminCMg }),
    [energyKcal, proteinGrams, fatGrams, carbohydrateGrams, fiberGrams, sodiumMg, potassiumMg, calciumMg, ironMg, magnesiumMg, vitaminCMg],
  );

  const addMovement = (choice: DailyMovementChoice) => {
    setError(undefined);
    setMovementPickerOpen(false);
    if (choice.kind === "cardio") {
      setCardioEntries((current) => [...current, newCardio(choice.name)]);
      return;
    }
    onDismiss();
    onStartFreestyleWorkout();
  };
  const addCustomMovement = ({ name, kind }: { name: string; kind: "strength" | "cardio" }) => {
    setError(undefined);
    setMovementPickerOpen(false);
    if (kind === "cardio") {
      setCardioEntries((current) => [...current, newCardio(name)]);
      return;
    }
    onDismiss();
    onStartFreestyleWorkout();
  };

  const updateCardio = (id: string, change: Partial<CardioDraft>) => {
    setCardioEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...change } : entry));
  };
  const addCustomFood = () => {
    const name = customFood.trim();
    if (!name) return;
    setMealFoods((current) => [...current, { id: `food:${nextId()}`, name, grams: "" }]);
    setCustomFood("");
  };
  const updateFood = (id: string, change: Partial<MealFoodDraft>) => {
    setMealFoods((current) => current.map((food) => food.id === id ? { ...food, ...change } : food));
  };

  const save = async () => {
    const now = new Date();
    const recoveryScoreValue = optionalFiniteNumber(recoveryScore);
    const painSeverityValue = optionalFiniteNumber(painSeverity);
    const sleepQualityValue = optionalFiniteNumber(sleepQuality);
    const bodyValueNumber = optionalFiniteNumber(bodyValue);
    const enteredNutrition = manualNutritionTotals({ energyKcal, proteinGrams, fatGrams, carbohydrateGrams, fiberGrams, sodiumMg, potassiumMg, calciumMg, ironMg, magnesiumMg, vitaminCMg });
    const nutritionTotals = enteredNutrition;
    const cardio = cardioFactsFromDraft(cardioEntries, referenceWeightKg);
    const isMovement = activeIntent === "training";
    if (isMovement && !cardio.length) {
      setError(mobileT("mobile.ui.recordfocus.6be3fbdc6c"));
      return;
    }
    if (isMovement && cardioEntries.length !== cardio.length) {
      setError(mobileT("mobile.ui.recordfocus.fbbf81efe5"));
      return;
    }
    if (entryMode === "nutrition" && !mealFoods.length && !mealDescription.trim() && !nutritionTotals.hasAny) {
      setError(mobileT("mobile.ui.recordfocus.7adea750f0"));
      return;
    }
    if (entryMode === "nutrition" && !mealSlot) {
      setError(mobileT("mobile.ui.recordfocus.c5c31bdebe"));
      return;
    }
    if (entryMode === "recovery" && recoveryScoreValue === undefined && painSeverityValue === undefined && !clinicalContext) {
      setError(mobileT("mobile.ui.recordfocus.8ceebaa0c2"));
      return;
    }
    if (entryMode === "recovery" && ((recoveryScoreValue !== undefined && (recoveryScoreValue < 1 || recoveryScoreValue > 5)) || (painSeverityValue !== undefined && (painSeverityValue < 0 || painSeverityValue > 10)))) {
      setError(mobileT("mobile.ui.recordfocus.8ceebaa0c2"));
      return;
    }
    if (entryMode === "sleep" && syncedSleepMinutes !== undefined && !manualSleep) {
      setError(mobileT("mobile.ui.recordfocus.b3952caba5"));
      return;
    }
    if (entryMode === "sleep" && (sleepQualityValue === undefined || sleepQualityValue < 1 || sleepQualityValue > 5 || optionalFiniteNumber(sleepDuration) === undefined || optionalFiniteNumber(sleepDuration)! <= 0)) {
      setError(mobileT("mobile.ui.recordfocus.f9ac3b5823"));
      return;
    }
    if (entryMode === "body" && (bodyValueNumber === undefined || bodyValueNumber <= 0 || (bodyMetric === "body_fat_percentage" && bodyValueNumber > 100))) {
      setError(bodyMetric === "body_weight" ? mobileT("mobile.ui.recordfocus.e700124e03") : mobileT("mobile.ui.recordfocus.a7feba185d"));
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      const confirmManualFact = (fact: import("../../coach/domain").TimelineFact, idempotencyKey: string) =>
        records.recordFact({ userId, idempotencyKey, fact, occurredAt: now.toISOString(), source: "manual_form" });
      if (entryMode === "nutrition") {
        const foods = foodEntriesFromDraft(mealFoods);
        const description = mealDescription.trim() || mealFoods.map((food) => food.name).join("、") || "手动营养数值";
        const nutrients = nutrientValuesFromManualTotals(nutritionTotals, `form:mobile-meal:${now.getTime()}`);
        const observation = createManualMealObservation({
          id: `manual-meal:${now.getTime()}`,
          occurredAt: now.toISOString(),
          description,
          mealSlot: mealSlot!,
          foods,
          mode: nutrients.length ? "structured" : "descriptive",
          provenance: "manual_form",
          dayCoverage,
          ...(nutrients.length ? { nutrients } : {}),
        });
        await records.recordNutrition({ userId, idempotencyKey: `mobile-meal:${now.getTime()}`, observation });
        onSaved();
        return;
      }

      if (isMovement) {
        for (const [index, fact] of cardio.entries()) {
          await confirmManualFact(fact, `mobile-movement:${now.getTime()}:cardio:${index}`);
        }
        onSaved();
        return;
      }

      if (entryMode === "recovery") {
        if (recoveryScoreValue !== undefined) await confirmManualFact({ kind: "recovery", perceivedRecovery: recoveryScoreValue, confidence: "confirmed" }, `mobile-recovery:${now.getTime()}`);
        if (painSeverityValue !== undefined) await confirmManualFact({ kind: "symptom", symptom: "pain", severity: painSeverityValue, ...(painArea.trim() ? { area: painArea.trim() } : {}), confidence: "confirmed" }, `mobile-pain:${now.getTime()}`);
        if (clinicalContext) await confirmManualFact({ kind: "clinical_context", context: clinicalContext, confidence: "confirmed" }, `mobile-clinical:${now.getTime()}`);
        onSaved();
        return;
      }

      await confirmManualFact(entryMode === "sleep"
          ? { kind: "sleep", duration: { value: optionalFiniteNumber(sleepDuration)!, unit: "minutes" }, quality: sleepQualityValue, confidence: "confirmed" }
          : {
                kind: "body",
                measurement: bodyMetric === "body_weight"
                  ? { metric: "body_weight", quantity: { value: bodyValueNumber!, unit: "kg" } }
                  : bodyMetric === "body_fat_percentage"
                    ? { metric: "body_fat_percentage", quantity: { value: bodyValueNumber!, unit: "percent" } }
                    : { metric: "circumference", site: bodyMetric === "waist_circumference" ? "waist" : "shoulder", quantity: { value: bodyValueNumber!, unit: "cm" }, condition: "manual_consistent_protocol" },
                confidence: "confirmed",
              }, `mobile-record:${now.getTime()}`);
      onSaved();
    } catch (cause) {
      setError(userFacingError(cause, mobileT("mobile.ui.recordfocus.4feadcc4da")));
    } finally {
      setSaving(false);
    }
  };

  const modeCopy = recordModeCopy(entryMode);
  return <BottomDrawer
    visible={visible}
    tall={!showPicker}
    title={showPicker ? mobileT("mobile.record.drawer.title") : modeCopy.label}
    subtitle={showPicker ? mobileT("mobile.record.drawer.subtitle") : modeCopy.detail}
    onDismiss={onDismiss}
    leadingAction={!showPicker ? <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.record.drawer.back")} onPress={() => setShowPicker(true)} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable> : undefined}
  >
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, showPicker && styles.pickerContent]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {showPicker ? <RecordModePicker onSelect={(mode) => {
        setError(undefined);
        if (mode === "training") {
          onDismiss();
          onStartFreestyleWorkout();
          return;
        }
        setEntryMode(mode);
        setShowPicker(false);
        if (mode === "activity") setMovementPickerOpen(true);
      }} /> : <>
        {activeIntent === "training" ? <MovementEntry
          cardioEntries={cardioEntries}
          pickerOpen={movementPickerOpen}
          referenceWeightKg={referenceWeightKg}
          onOpenPicker={() => setMovementPickerOpen((current) => !current)}
          onMovementSelected={addMovement}
          onCustomMovement={addCustomMovement}
          onCardioChange={updateCardio}
          onCardioRemove={(id) => setCardioEntries((current) => current.filter((entry) => entry.id !== id))}
        /> : null}

        {entryMode === "nutrition" ? <NutritionEntry
          mealSlot={mealSlot}
          foods={mealFoods}
          customFood={customFood}
          description={mealDescription}
          dayCoverage={dayCoverage}
          showDetail={showNutritionDetail}
          energy={energyKcal}
          protein={proteinGrams}
          fat={fatGrams}
          carbohydrate={carbohydrateGrams}
          fiber={fiberGrams}
          sodium={sodiumMg}
          potassium={potassiumMg}
          calcium={calciumMg}
          iron={ironMg}
          magnesium={magnesiumMg}
          vitaminC={vitaminCMg}
          preview={mealPreview}
          onSlotChange={setMealSlot}
          onFoodChange={updateFood}
          onFoodRemove={(id) => setMealFoods((current) => current.filter((food) => food.id !== id))}
          onCustomFoodChange={setCustomFood}
          onAddCustomFood={addCustomFood}
          onDescriptionChange={setMealDescription}
          onDayCoverageChange={setDayCoverage}
          onToggleDetail={() => setShowNutritionDetail((value) => !value)}
          onEnergyChange={setEnergyKcal}
          onProteinChange={setProteinGrams}
          onFatChange={setFatGrams}
          onCarbohydrateChange={setCarbohydrateGrams}
          onFiberChange={setFiberGrams}
          onSodiumChange={setSodiumMg}
          onPotassiumChange={setPotassiumMg}
          onCalciumChange={setCalciumMg}
          onIronChange={setIronMg}
          onMagnesiumChange={setMagnesiumMg}
          onVitaminCChange={setVitaminCMg}
        /> : null}

        {activeIntent === "check_in" ? <CheckInEntry
          mode={entryMode === "sleep" || entryMode === "body" ? entryMode : "recovery"}
          recoveryScore={recoveryScore}
          painSeverity={painSeverity}
          painArea={painArea}
          clinicalContext={clinicalContext}
          sleepQuality={sleepQuality}
          sleepDuration={sleepDuration}
          syncedSleepMinutes={syncedSleepMinutes}
          manualSleep={manualSleep}
          bodyValue={bodyValue}
          bodyMetric={bodyMetric}
          onModeChange={setEntryMode}
          onRecoveryScoreChange={setRecoveryScore}
          onPainSeverityChange={setPainSeverity}
          onPainAreaChange={setPainArea}
          onClinicalContextChange={setClinicalContext}
          onSleepQualityChange={setSleepQuality}
          onSleepDurationChange={setSleepDuration}
          onUseManualSleep={() => setManualSleep(true)}
          onBodyValueChange={setBodyValue}
          onBodyMetricChange={setBodyMetric}
        /> : null}

        {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        {!(entryMode === "sleep" && syncedSleepMinutes !== undefined && !manualSleep) ? <RecordConfirmationBar label={confirmationLabel(activeIntent, mealPreview.energy)} busy={saving} onConfirm={() => void save()} /> : null}
      </>}
    </ScrollView>
  </BottomDrawer>;
}

function RecordModePicker({ onSelect }: { onSelect(mode: RecordFocusMode): void }) {
  return <View style={styles.modeGrid}>{RECORD_MODES.map((mode) => <Pressable
    key={mode.id}
    accessibilityRole="button"
    accessibilityLabel={mobileT(mode.labelKey)}
    onPress={() => onSelect(mode.id)}
    style={({ pressed }) => [styles.modeCard, pressed && styles.modeCardPressed]}
  >
    <View style={styles.modeGlyph}><Text style={styles.modeGlyphText}>{mode.glyph}</Text></View>
    <Text style={styles.modeLabel}>{mobileT(mode.labelKey)}</Text>
    <Text style={styles.modeDetail}>{mobileT(mode.detailKey)}</Text>
  </Pressable>)}</View>;
}

function recordModeCopy(mode: RecordFocusMode): { label: string; detail: string } {
  const item = RECORD_MODES.find((candidate) => candidate.id === mode) ?? RECORD_MODES[0];
  return { label: mobileT(item.labelKey), detail: mobileT(item.detailKey) };
}

function MovementEntry({ cardioEntries, pickerOpen, referenceWeightKg, onOpenPicker, onMovementSelected, onCustomMovement, onCardioChange, onCardioRemove }: {
  cardioEntries: readonly CardioDraft[];
  pickerOpen: boolean;
  referenceWeightKg?: number;
  onOpenPicker(): void;
  onMovementSelected(choice: DailyMovementChoice): void;
  onCustomMovement(input: { name: string; kind: "strength" | "cardio" }): void;
  onCardioChange(id: string, change: Partial<CardioDraft>): void;
  onCardioRemove(id: string): void;
}) {
  return <RecordSection title={mobileT("mobile.ui.recordfocus.6398d8919f")} action={<Pressable accessibilityRole="button" onPress={onOpenPicker} style={styles.addAction}><Text style={styles.addActionText}>{pickerOpen ? mobileT("mobile.ui.recordfocus.5d5815647c") : mobileT("mobile.ui.recordfocus.b8f9049e54")}</Text></Pressable>}>
    {pickerOpen ? <MovementLibraryPicker onSelect={onMovementSelected} onCustom={onCustomMovement} /> : null}
    {cardioEntries.length ? <View style={styles.logGroup}><Text style={styles.groupLabel}>{mobileT("mobile.ui.recordfocus.25b132283f")}</Text>{cardioEntries.map((entry) => <CardioEntryCard key={entry.id} entry={entry} referenceWeightKg={referenceWeightKg} onChange={(change) => onCardioChange(entry.id, change)} onRemove={() => onCardioRemove(entry.id)} />)}</View> : null}
    {!cardioEntries.length && !pickerOpen ? <Pressable accessibilityRole="button" onPress={onOpenPicker} style={styles.emptyMovement}><Text style={styles.emptyMovementText}>{mobileT("mobile.ui.recordfocus.d73b56afe4")}</Text><Text style={styles.emptyMovementArrow}>＋</Text></Pressable> : null}
  </RecordSection>;
}

function CardioEntryCard({ entry, referenceWeightKg, onChange, onRemove }: { entry: CardioDraft; referenceWeightKg?: number; onChange(change: Partial<CardioDraft>): void; onRemove(): void }) {
  const estimated = estimateCardioEnergy({ activityType: entry.activityType, minutes: optionalFiniteNumber(entry.durationMinutes), intensity: entry.intensity, referenceWeightKg });
  const shownEnergy = optionalFiniteNumber(entry.energyKcal) ?? estimated?.kcal;
  return <View style={styles.exerciseCard}>
    <View style={styles.exerciseHeading}><Text style={styles.cardioMark}>◌</Text><Text style={styles.exerciseName}>{entry.activityType}</Text><Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.recordfocus.834f5a99f8", { value0: entry.activityType })} onPress={onRemove} hitSlop={8}><Text style={styles.removeAction}>×</Text></Pressable></View>
    <View style={styles.cardioMetrics}><RecordField label={mobileT("mobile.ui.recordfocus.29d0552d2e")} unit="min" value={entry.durationMinutes} onChangeText={(durationMinutes) => onChange({ durationMinutes })} keyboardType="decimal-pad" /><RecordField label={mobileT("mobile.ui.recordfocus.b3480678b6")} unit="km" value={entry.distanceKm} onChangeText={(distanceKm) => onChange({ distanceKm })} keyboardType="decimal-pad" /><RecordField label={mobileT("mobile.ui.recordfocus.c77f5c7a72")} unit="kcal" value={entry.energyKcal} onChangeText={(energyKcal) => onChange({ energyKcal })} keyboardType="decimal-pad" /><RecordField label="RPE" unit="/10" value={entry.perceivedExertion} onChangeText={(perceivedExertion) => onChange({ perceivedExertion })} keyboardType="decimal-pad" /></View>
    <RecordPills value={entry.intensity} options={[{ id: "easy" as const, label: mobileT("mobile.ui.recordfocus.c9c4a72eeb") }, { id: "moderate" as const, label: mobileT("mobile.ui.recordfocus.ff08d13e6a") }, { id: "hard" as const, label: mobileT("mobile.ui.recordfocus.6ee6e775bb") }]} onChange={(intensity) => onChange({ intensity })} compact />
    {shownEnergy !== undefined ? <Text style={styles.cardioEstimate}>{entry.energyKcal.trim() ? mobileT("mobile.ui.recordfocus.47e85b4dcd", { value0: Math.round(shownEnergy) }) : mobileT("mobile.ui.recordfocus.80b46ef828", { value0: Math.round(shownEnergy), value1: estimated?.basis ?? mobileT("mobile.record.estimate.local") })}</Text> : null}
  </View>;
}

function NutritionEntry({ mealSlot, foods, customFood, description, dayCoverage, showDetail, energy, protein, fat, carbohydrate, fiber, sodium, potassium, calcium, iron, magnesium, vitaminC, preview, onSlotChange, onFoodChange, onFoodRemove, onCustomFoodChange, onAddCustomFood, onDescriptionChange, onDayCoverageChange, onToggleDetail, onEnergyChange, onProteinChange, onFatChange, onCarbohydrateChange, onFiberChange, onSodiumChange, onPotassiumChange, onCalciumChange, onIronChange, onMagnesiumChange, onVitaminCChange }: {
  mealSlot: "breakfast" | "lunch" | "dinner" | "snack" | undefined;
  foods: readonly MealFoodDraft[];
  customFood: string;
  description: string;
  dayCoverage: "partial" | "complete";
  showDetail: boolean;
  energy: string;
  protein: string;
  fat: string;
  carbohydrate: string;
  fiber: string;
  sodium: string;
  potassium: string;
  calcium: string;
  iron: string;
  magnesium: string;
  vitaminC: string;
  preview: NutritionTotals;
  onSlotChange(value: "breakfast" | "lunch" | "dinner" | "snack"): void;
  onFoodChange(id: string, change: Partial<MealFoodDraft>): void;
  onFoodRemove(id: string): void;
  onCustomFoodChange(value: string): void;
  onAddCustomFood(): void;
  onDescriptionChange(value: string): void;
  onDayCoverageChange(value: "partial" | "complete"): void;
  onToggleDetail(): void;
  onEnergyChange(value: string): void;
  onProteinChange(value: string): void;
  onFatChange(value: string): void;
  onCarbohydrateChange(value: string): void;
  onFiberChange(value: string): void;
  onSodiumChange(value: string): void;
  onPotassiumChange(value: string): void;
  onCalciumChange(value: string): void;
  onIronChange(value: string): void;
  onMagnesiumChange(value: string): void;
  onVitaminCChange(value: string): void;
}) {
  return <RecordSection title={mobileT("mobile.ui.recordfocus.76f08d8c85")} action={<Pressable accessibilityRole="button" onPress={onToggleDetail} style={styles.addAction}><Text style={styles.addActionText}>{showDetail ? mobileT("mobile.ui.recordfocus.a137cbf51d") : mobileT("mobile.ui.recordfocus.3e979cf595")}</Text></Pressable>}>
    <RecordPills value={mealSlot} options={[{ id: "breakfast" as const, label: mobileT("mobile.ui.recordfocus.cc13bb1556") }, { id: "lunch" as const, label: mobileT("mobile.ui.recordfocus.663529e2e8") }, { id: "dinner" as const, label: mobileT("mobile.ui.recordfocus.5413d30d2b") }, { id: "snack" as const, label: mobileT("mobile.ui.recordfocus.5b606147f6") }]} onChange={onSlotChange} compact />
    {foods.length ? <View style={styles.logGroup}>{foods.map((food) => <FoodEntryCard key={food.id} food={food} onChange={(change) => onFoodChange(food.id, change)} onRemove={() => onFoodRemove(food.id)} />)}</View> : null}
    <View style={styles.customFoodRow}><TextInput accessibilityLabel={mobileT("mobile.ui.recordfocus.f5634084f6")} value={customFood} onChangeText={onCustomFoodChange} placeholder={mobileT("mobile.ui.recordfocus.4c5f696269")} placeholderTextColor={colors.ink3} style={styles.customFoodInput} /><Pressable accessibilityRole="button" onPress={onAddCustomFood} style={styles.addFoodButton}><Text style={styles.addFoodButtonText}>{mobileT("mobile.ui.recordfocus.94191ce210")}</Text></Pressable></View>
    <TextInput accessibilityLabel={mobileT("mobile.ui.recordfocus.7ebe6983e6")} value={description} onChangeText={onDescriptionChange} placeholder={mobileT("mobile.ui.recordfocus.d2209743d9")} placeholderTextColor={colors.ink3} multiline style={[styles.noteInput, styles.mealInput]} />
    <RecordPills value={dayCoverage} options={[{ id: "partial" as const, label: mobileT("mobile.record.coverage.partial") }, { id: "complete" as const, label: mobileT("mobile.record.coverage.complete") }]} onChange={onDayCoverageChange} compact />
    {showDetail ? <View style={styles.nutritionMetrics}><RecordField label={mobileT("mobile.ui.recordfocus.b22f3de6f1")} unit="kcal" value={energy} onChangeText={onEnergyChange} keyboardType="decimal-pad" /><RecordField label={mobileT("mobile.ui.recordfocus.8807d098eb")} unit="g" value={protein} onChangeText={onProteinChange} keyboardType="decimal-pad" /><RecordField label={mobileT("mobile.ui.recordfocus.2eef1156d9")} unit="g" value={fat} onChangeText={onFatChange} keyboardType="decimal-pad" /><RecordField label={mobileT("mobile.ui.recordfocus.3215da61d1")} unit="g" value={carbohydrate} onChangeText={onCarbohydrateChange} keyboardType="decimal-pad" /><RecordField label={mobileT("mobile.nutrient.fiber")} unit="g" value={fiber} onChangeText={onFiberChange} keyboardType="decimal-pad" /><RecordField label={mobileT("mobile.nutrient.sodium")} unit="mg" value={sodium} onChangeText={onSodiumChange} keyboardType="decimal-pad" /><RecordField label={mobileT("mobile.nutrient.potassium")} unit="mg" value={potassium} onChangeText={onPotassiumChange} keyboardType="decimal-pad" /><RecordField label={mobileT("mobile.nutrient.calcium")} unit="mg" value={calcium} onChangeText={onCalciumChange} keyboardType="decimal-pad" /><RecordField label={mobileT("mobile.nutrient.iron")} unit="mg" value={iron} onChangeText={onIronChange} keyboardType="decimal-pad" /><RecordField label={mobileT("mobile.nutrient.magnesium")} unit="mg" value={magnesium} onChangeText={onMagnesiumChange} keyboardType="decimal-pad" /><RecordField label={mobileT("mobile.nutrient.vitaminC")} unit="mg" value={vitaminC} onChangeText={onVitaminCChange} keyboardType="decimal-pad" /></View> : null}
    {preview.hasAny && !showDetail ? <Text style={styles.foodPreview}>{mobileT("mobile.ui.recordfocus.6104826dd1")}{Math.round(preview.energy ?? 0)} {mobileT("mobile.ui.recordfocus.78c8694083")}{Math.round(preview.protein ?? 0)} g</Text> : null}
  </RecordSection>;
}

function FoodEntryCard({ food, onChange, onRemove }: { food: MealFoodDraft; onChange(change: Partial<MealFoodDraft>): void; onRemove(): void }) {
  return <View style={styles.foodCard}><View style={styles.foodHeading}><Text style={styles.foodName}>{food.name}</Text><Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.recordfocus.834f5a99f8", { value0: food.name })} onPress={onRemove}><Text style={styles.removeAction}>×</Text></Pressable></View><View style={styles.foodPortionRow}><TextInput accessibilityLabel={mobileT("mobile.ui.recordfocus.2a8629d751", { value0: food.name })} value={food.grams} onChangeText={(grams) => onChange({ grams })} keyboardType="decimal-pad" placeholder={mobileT("mobile.ui.recordfocus.442704e38b")} placeholderTextColor={colors.ink3} style={styles.gramInput} /><Text style={styles.gramUnit}>g</Text><Text style={styles.foodUnknown}>{mobileT("mobile.record.nutrition.valuesUnknown")}</Text></View></View>;
}

function CheckInEntry({ mode, recoveryScore, painSeverity, painArea, clinicalContext, sleepQuality, sleepDuration, syncedSleepMinutes, manualSleep, bodyValue, bodyMetric, onModeChange, onRecoveryScoreChange, onPainSeverityChange, onPainAreaChange, onClinicalContextChange, onSleepQualityChange, onSleepDurationChange, onUseManualSleep, onBodyValueChange, onBodyMetricChange }: {
  mode: "sleep" | "recovery" | "body";
  recoveryScore: string;
  painSeverity: string;
  painArea: string;
  clinicalContext: "diagnosed_condition" | "medication" | "pregnancy_or_postpartum" | "recent_surgery_or_acute_injury" | "eating_disorder_or_low_energy_risk" | "other" | undefined;
  sleepQuality: string;
  sleepDuration: string;
  syncedSleepMinutes?: number;
  manualSleep: boolean;
  bodyValue: string;
  bodyMetric: "body_weight" | "body_fat_percentage" | "waist_circumference" | "shoulder_circumference";
  onModeChange(value: "sleep" | "recovery" | "body"): void;
  onRecoveryScoreChange(value: string): void;
  onPainSeverityChange(value: string): void;
  onPainAreaChange(value: string): void;
  onClinicalContextChange(value: "diagnosed_condition" | "medication" | "pregnancy_or_postpartum" | "recent_surgery_or_acute_injury" | "eating_disorder_or_low_energy_risk" | "other" | undefined): void;
  onSleepQualityChange(value: string): void;
  onSleepDurationChange(value: string): void;
  onUseManualSleep(): void;
  onBodyValueChange(value: string): void;
  onBodyMetricChange(value: "body_weight" | "body_fat_percentage" | "waist_circumference" | "shoulder_circumference"): void;
}) {
  return <RecordSection title={mobileT("mobile.ui.recordfocus.101b4bf4e0")}>
    <RecordPills value={mode} options={[{ id: "recovery" as const, label: mobileT("mobile.ui.recordfocus.8031458006") }, { id: "sleep" as const, label: mobileT("mobile.ui.recordfocus.ed5fe3562d") }, { id: "body" as const, label: mobileT("mobile.ui.recordfocus.c4f02d8543") }]} onChange={onModeChange} />
    {mode === "sleep" ? syncedSleepMinutes !== undefined && !manualSleep
      ? <View style={styles.syncedSleep}><View><Text style={styles.syncedSleepLabel}>{mobileT("mobile.ui.recordfocus.91e92a82d2")}</Text><Text style={styles.syncedSleepValue}>{formatSleepMinutes(syncedSleepMinutes)}</Text></View><Pressable accessibilityRole="button" onPress={onUseManualSleep} style={styles.addAction}><Text style={styles.addActionText}>{mobileT("mobile.ui.recordfocus.560d275288")}</Text></Pressable></View>
      : <><Text style={styles.recoveryHint}>{mobileT("mobile.ui.recordfocus.b20d4a0c01")}</Text><RecordField label={mobileT("mobile.ui.recordfocus.2e4066b90c")} unit="min" value={sleepDuration} onChangeText={onSleepDurationChange} keyboardType="decimal-pad" /><ScorePills value={sleepQuality} onChange={onSleepQualityChange} /></> : null}
    {mode === "recovery" ? <><Text style={styles.recoveryHint}>{mobileT("mobile.ui.recordfocus.231373da56")}</Text><ScorePills value={recoveryScore} onChange={onRecoveryScoreChange} /><RecordField label={mobileT("mobile.record.painSeverity")} unit="/10" value={painSeverity} onChangeText={onPainSeverityChange} keyboardType="decimal-pad" /><RecordField label={mobileT("mobile.record.painArea")} value={painArea} onChangeText={onPainAreaChange} /><RecordPills value={clinicalContext} options={[{ id: "diagnosed_condition" as const, label: mobileT("mobile.record.clinical.diagnosed") }, { id: "medication" as const, label: mobileT("mobile.record.clinical.medication") }, { id: "pregnancy_or_postpartum" as const, label: mobileT("mobile.record.clinical.pregnancy") }, { id: "recent_surgery_or_acute_injury" as const, label: mobileT("mobile.record.clinical.injury") }, { id: "eating_disorder_or_low_energy_risk" as const, label: mobileT("mobile.record.clinical.energyRisk") }, { id: "other" as const, label: mobileT("mobile.record.clinical.other") }]} onChange={(value) => onClinicalContextChange(value === clinicalContext ? undefined : value)} compact /></> : null}
    {mode === "body" ? <><RecordPills value={bodyMetric} options={[{ id: "body_weight" as const, label: mobileT("mobile.ui.recordfocus.3193595c29") }, { id: "body_fat_percentage" as const, label: mobileT("mobile.ui.recordfocus.338f5241cc") }, { id: "waist_circumference" as const, label: mobileT("mobile.record.waist") }, { id: "shoulder_circumference" as const, label: mobileT("mobile.record.shoulder") }]} onChange={onBodyMetricChange} compact /><RecordField label={bodyMetric === "body_weight" ? mobileT("mobile.ui.recordfocus.3193595c29") : bodyMetric === "body_fat_percentage" ? mobileT("mobile.ui.recordfocus.338f5241cc") : bodyMetric === "waist_circumference" ? mobileT("mobile.record.waist") : mobileT("mobile.record.shoulder")} unit={bodyMetric === "body_weight" ? "kg" : bodyMetric === "body_fat_percentage" ? "%" : "cm"} value={bodyValue} onChangeText={onBodyValueChange} keyboardType="decimal-pad" /></> : null}
  </RecordSection>;
}

function ScorePills({ value, onChange }: { value: string; onChange(value: string): void }) {
  return <RecordPills value={value} options={[["1", mobileT("mobile.ui.recordfocus.83cd7e5511")], ["2", mobileT("mobile.ui.recordfocus.9d43ae1674")], ["3", mobileT("mobile.ui.recordfocus.f0aaccbc0d")], ["4", mobileT("mobile.ui.recordfocus.56e00434ba")], ["5", mobileT("mobile.ui.recordfocus.77833b3f8c")]].map(([id, label]) => ({ id, label }))} onChange={onChange} compact />;
}

function formatSleepMinutes(minutes: number): string {
  const rounded = Math.round(minutes);
  return `${Math.floor(rounded / 60)} h ${rounded % 60} min`;
}

function cardioFactsFromDraft(entries: readonly CardioDraft[], referenceWeightKg?: number) {
  return entries.flatMap((entry) => {
    const duration = optionalFiniteNumber(entry.durationMinutes);
    if (duration === undefined || duration <= 0) return [];
    const manualEnergy = optionalFiniteNumber(entry.energyKcal);
    const estimated = estimateCardioEnergy({ activityType: entry.activityType, minutes: duration, intensity: entry.intensity, referenceWeightKg });
    const distance = optionalFiniteNumber(entry.distanceKm);
    const energy = manualEnergy ?? estimated?.kcal;
    const rpe = optionalFiniteNumber(entry.perceivedExertion);
    return [{ kind: "activity" as const, activityType: entry.activityType, duration: { value: duration, unit: "minutes" as const }, ...(distance === undefined ? {} : { distance: { value: distance, unit: "km" as const } }), intensity: entry.intensity, ...(rpe === undefined ? {} : { perceivedExertion: Math.max(0, Math.min(10, rpe)) }), ...(energy === undefined ? {} : { energyExpenditure: { value: energy, unit: "kcal" as const }, energyExpenditureSource: manualEnergy === undefined ? "rule_estimate" as const : "manual" as const }), confidence: "confirmed" as const }];
  });
}

type NutritionTotals = { energy?: number; protein?: number; fat?: number; carbohydrate?: number; fiber?: number; sodium?: number; potassium?: number; calcium?: number; iron?: number; magnesium?: number; vitaminC?: number; hasAny: boolean };

function foodEntriesFromDraft(foods: readonly MealFoodDraft[]): readonly FoodEntryData[] {
  return foods.map((food) => ({ id: food.id, name: food.name, ...(food.grams.trim() ? { portion: `${food.grams.trim()} g` } : {}) }));
}

function manualNutritionTotals(input: { energyKcal: string; proteinGrams: string; fatGrams: string; carbohydrateGrams: string; fiberGrams: string; sodiumMg: string; potassiumMg: string; calciumMg: string; ironMg: string; magnesiumMg: string; vitaminCMg: string }): NutritionTotals {
  const energy = optionalFiniteNumber(input.energyKcal);
  const protein = optionalFiniteNumber(input.proteinGrams);
  const fat = optionalFiniteNumber(input.fatGrams);
  const carbohydrate = optionalFiniteNumber(input.carbohydrateGrams);
  const fiber = optionalFiniteNumber(input.fiberGrams);
  const sodium = optionalFiniteNumber(input.sodiumMg);
  const potassium = optionalFiniteNumber(input.potassiumMg);
  const calcium = optionalFiniteNumber(input.calciumMg);
  const iron = optionalFiniteNumber(input.ironMg);
  const magnesium = optionalFiniteNumber(input.magnesiumMg);
  const vitaminC = optionalFiniteNumber(input.vitaminCMg);
  return { ...(energy === undefined ? {} : { energy }), ...(protein === undefined ? {} : { protein }), ...(fat === undefined ? {} : { fat }), ...(carbohydrate === undefined ? {} : { carbohydrate }), ...(fiber === undefined ? {} : { fiber }), ...(sodium === undefined ? {} : { sodium }), ...(potassium === undefined ? {} : { potassium }), ...(calcium === undefined ? {} : { calcium }), ...(iron === undefined ? {} : { iron }), ...(magnesium === undefined ? {} : { magnesium }), ...(vitaminC === undefined ? {} : { vitaminC }), hasAny: [energy, protein, fat, carbohydrate, fiber, sodium, potassium, calcium, iron, magnesium, vitaminC].some((value) => value !== undefined) };
}

function nutrientValuesFromManualTotals(totals: NutritionTotals, ref: string) {
  const source = { kind: "manual_form" as const, ref };
  return [
    ...(totals.energy === undefined ? [] : [{ nutrientId: "energy" as const, amount: totals.energy, unit: "kcal" as const, source }]),
    ...(totals.protein === undefined ? [] : [{ nutrientId: "protein" as const, amount: totals.protein, unit: "g" as const, source }]),
    ...(totals.carbohydrate === undefined ? [] : [{ nutrientId: "carbohydrate" as const, amount: totals.carbohydrate, unit: "g" as const, source }]),
    ...(totals.fat === undefined ? [] : [{ nutrientId: "fat" as const, amount: totals.fat, unit: "g" as const, source }]),
    ...(totals.fiber === undefined ? [] : [{ nutrientId: "fiber" as const, amount: totals.fiber, unit: "g" as const, source }]),
    ...(totals.sodium === undefined ? [] : [{ nutrientId: "sodium" as const, amount: totals.sodium, unit: "mg" as const, source }]),
    ...(totals.potassium === undefined ? [] : [{ nutrientId: "potassium" as const, amount: totals.potassium, unit: "mg" as const, source }]),
    ...(totals.calcium === undefined ? [] : [{ nutrientId: "calcium" as const, amount: totals.calcium, unit: "mg" as const, source }]),
    ...(totals.iron === undefined ? [] : [{ nutrientId: "iron" as const, amount: totals.iron, unit: "mg" as const, source }]),
    ...(totals.magnesium === undefined ? [] : [{ nutrientId: "magnesium" as const, amount: totals.magnesium, unit: "mg" as const, source }]),
    ...(totals.vitaminC === undefined ? [] : [{ nutrientId: "vitamin_c" as const, amount: totals.vitaminC, unit: "mg" as const, source }]),
  ];
}

function newCardio(activityType: string): CardioDraft { return { id: `cardio:${nextId()}`, activityType, durationMinutes: "", distanceKm: "", energyKcal: "", perceivedExertion: "" }; }
function nextId(): string { return Math.random().toString(36).slice(2); }
function optionalFiniteNumber(value: string): number | undefined { const parsed = Number(value.trim()); return value.trim() && Number.isFinite(parsed) ? parsed : undefined; }
function confirmationLabel(intent: RecordIntent, nutritionEnergy: number | undefined): string {
  return intent === "training"
    ? mobileT("mobile.record.confirm.training")
    : intent === "nutrition"
      ? nutritionEnergy === undefined
        ? mobileT("mobile.record.confirm.meal")
        : mobileT("mobile.record.confirm.mealWithEnergy", { energy: Math.round(nutritionEnergy) })
      : mobileT("mobile.record.confirm.generic");
}

function estimateCardioEnergy(input: { activityType: string; minutes: number | undefined; intensity: "easy" | "moderate" | "hard" | undefined; referenceWeightKg: number | undefined }): { kcal: number; basis: string } | undefined {
  if (!input.minutes || input.minutes <= 0 || !input.intensity || !input.referenceWeightKg || input.referenceWeightKg <= 0) return undefined;
  const matched = CARDIO_RULES.find((rule) => rule.keys.some((key) => input.activityType.trim().toLowerCase().includes(key)));
  if (!matched) return undefined;
  const weight = input.referenceWeightKg;
  const intensityMultiplier = input.intensity === "easy" ? 0.8 : input.intensity === "hard" ? 1.2 : 1;
  const kcal = Math.round(matched.kcalPerHour * (input.minutes / 60) * (weight / 65) * intensityMultiplier / 5) * 5;
  return { kcal, basis: `${matched.label} · ${Math.round(weight)} kg` };
}

const CARDIO_RULES = [
  { label: mobileT("mobile.ui.recordfocus.8eb2fcd697"), keys: ["跑", "jog", "run"], kcalPerHour: 560 }, { label: mobileT("mobile.ui.recordfocus.191f5b40d1"), keys: ["走", "walk", "徒步"], kcalPerHour: 250 }, { label: mobileT("mobile.ui.recordfocus.596c5a92ea"), keys: ["骑", "cycle", "bike", "动感"], kcalPerHour: 430 }, { label: mobileT("mobile.ui.recordfocus.b66f447bfc"), keys: ["游", "swim"], kcalPerHour: 490 }, { label: mobileT("mobile.ui.recordfocus.8c53f94cd9"), keys: ["跳绳", "rope"], kcalPerHour: 650 }, { label: mobileT("mobile.ui.recordfocus.97cd453e1a"), keys: ["椭圆", "elliptical"], kcalPerHour: 390 }, { label: mobileT("mobile.ui.recordfocus.91f9e59013"), keys: ["划船", "row"], kcalPerHour: 440 }, { label: mobileT("mobile.ui.recordfocus.4956a3eed5"), keys: ["球", "tennis", "badminton", "basketball", "football"], kcalPerHour: 410 },
] as const;

const styles = StyleSheet.create({
  back: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19, backgroundColor: colors.paper2 },
  backText: { marginTop: -2, color: colors.ink, fontSize: 25, lineHeight: 28, fontWeight: "600" },
  scroll: { flex: 1, minHeight: 0 },
  content: { padding: 16, paddingBottom: 28, gap: 20 },
  pickerContent: { paddingTop: 6 },
  modeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  modeCard: { width: "48.5%", minHeight: 126, padding: 14, justifyContent: "flex-end", borderRadius: 19, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  modeCardPressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  modeGlyph: { width: 34, height: 34, marginBottom: 18, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: colors.dark },
  modeGlyphText: { color: colors.lime, fontSize: 18, fontWeight: "900" },
  modeLabel: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  modeDetail: { marginTop: 4, color: colors.ink3, fontSize: 10, lineHeight: 15, fontWeight: "700" },
  metricRow: { flexDirection: "row", gap: 10 }, logGroup: { gap: 9 }, groupLabel: { color: colors.ink3, fontSize: 11, fontWeight: "900", letterSpacing: 0.45 }, addAction: { minHeight: 32, paddingHorizontal: 11, alignItems: "center", justifyContent: "center", borderRadius: radius.chip, backgroundColor: colors.paper2 }, addActionText: { color: colors.ink2, fontSize: 11, fontWeight: "900" }, emptyMovement: { minHeight: 82, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 18, backgroundColor: colors.paper2 }, emptyMovementText: { color: colors.ink2, fontSize: 14, fontWeight: "800" }, emptyMovementArrow: { color: colors.limeInk, fontSize: 26, fontWeight: "900" }, exerciseCard: { gap: 11, padding: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, exerciseHeading: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 9 }, exerciseIndex: { width: 23, color: colors.limeInk, fontFamily: "monospace", fontSize: 10, fontWeight: "900" }, cardioMark: { width: 23, color: colors.limeInk, fontSize: 19, fontWeight: "900", textAlign: "center" }, exerciseName: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 15, fontWeight: "900" }, removeAction: { width: 26, color: colors.ink3, fontSize: 21, textAlign: "right" }, trainingMetrics: { flexDirection: "row", gap: 7 }, cardioMetrics: { flexDirection: "row", gap: 7 }, cardioEstimate: { color: colors.ink3, fontSize: 11, fontWeight: "700" }, noteInput: { minHeight: 50, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.ink, fontSize: 14, fontWeight: "700" }, mealInput: { minHeight: 58, paddingTop: 12, textAlignVertical: "top" }, estimateButton: { minHeight: 48, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 16, backgroundColor: colors.dark }, estimateButtonText: { color: colors.white, fontSize: 13, fontWeight: "900" }, estimateButtonArrow: { color: colors.lime, fontSize: 21, fontWeight: "900" }, nutritionMetrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, foodCard: { gap: 8, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, foodHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, foodName: { color: colors.ink, fontSize: 14, fontWeight: "900" }, foodPortionRow: { flexDirection: "row", alignItems: "center", gap: 5 }, gramInput: { width: 58, minHeight: 32, padding: 0, color: colors.ink, fontFamily: "monospace", fontSize: 16, fontWeight: "900" }, gramUnit: { color: colors.ink3, fontSize: 11, fontWeight: "800" }, foodNutrients: { flex: 1, minWidth: 0, color: colors.ink2, fontSize: 11, fontWeight: "700", textAlign: "right" }, foodUnknown: { flex: 1, color: colors.terra, fontSize: 11, fontWeight: "800", textAlign: "right" }, customFoodRow: { flexDirection: "row", gap: 8 }, customFoodInput: { flex: 1, minWidth: 0, minHeight: 46, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.ink, fontSize: 13, fontWeight: "700" }, addFoodButton: { minWidth: 64, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.paper2 }, addFoodButtonText: { color: colors.ink, fontSize: 12, fontWeight: "900" }, foodPreview: { color: colors.limeInk, fontSize: 12, fontWeight: "800" }, recoveryHint: { color: colors.ink3, fontSize: 12, lineHeight: 17 }, syncedSleep: { minHeight: 84, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 18, backgroundColor: colors.paper2 }, syncedSleepLabel: { color: colors.ink3, fontSize: 11, fontWeight: "800" }, syncedSleepValue: { marginTop: 3, color: colors.ink, fontFamily: "monospace", fontSize: 22, fontWeight: "900" }, error: { color: colors.terra, fontSize: 12, fontWeight: "800" },
});
