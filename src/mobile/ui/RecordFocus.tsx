import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import type { CoachApplication } from "../../coach";
import { createManualMealObservation, type FoodEntryData } from "../../nutrition";
import {
  FoodLibraryPicker,
  MovementLibraryPicker,
  FocusSurface,
  RecordCaptureComposer,
  RecordConfirmationBar,
  RecordField,
  RecordIntentGrid,
  RecordPills,
  RecordSection,
  type DailyMovementChoice,
  type FocusSurfaceAnchor,
  type FoodLibraryChoice,
  type RecordIntent,
} from "../ui-kit";
import { colors, radius } from "./theme";

/**
 * One daily-log surface. Strength and cardio deliberately share the user
 * entry point ("运动"), but retain their distinct actual-performance fields
 * when written to Timeline.
 */
export type RecordFocusMode = "training" | "activity" | "nutrition" | "sleep" | "recovery" | "body";

type TrainingExerciseDraft = {
  id: string;
  name: string;
  conceptId?: string;
  setCount: string;
  reps: string;
  loadKg: string;
  rir: string;
};

type CardioDraft = {
  id: string;
  activityType: string;
  durationMinutes: string;
  distanceKm: string;
  energyKcal: string;
  intensity: "easy" | "moderate" | "hard";
  perceivedExertion: string;
};

type MealFoodDraft = {
  id: string;
  name: string;
  grams: string;
  library?: FoodLibraryChoice;
};

const RECORD_INTENTS = [
  { id: "training" as const, label: "运动", detail: "力量、有氧", glyph: "↗" },
  { id: "nutrition" as const, label: "吃喝", detail: "食物与份量", glyph: "◒" },
  { id: "check_in" as const, label: "恢复", detail: "睡眠与感受", glyph: "○" },
] as const;

/**
 * The user records what actually happened. The optional free-form path is
 * still useful for "我刚练完" / "午饭吃了…"; it goes to Coach as a source
 * labelled Capture, never as an unreviewed inference.
 */
export function RecordFocus({
  application,
  userId,
  initialMode = "training",
  referenceWeightKg,
  syncedSleepMinutes,
  visible,
  anchor,
  onDismiss,
  onSaved,
  onAskCoach,
  onEstimateMeal,
}: {
  application: CoachApplication;
  userId: string;
  initialMode?: RecordFocusMode;
  referenceWeightKg?: number;
  /** Latest confirmed sleep imported from an authorized health source for today. */
  syncedSleepMinutes?: number;
  visible: boolean;
  anchor?: FocusSurfaceAnchor;
  onDismiss(): void;
  onSaved(): void;
  onAskCoach(prompt: string): void;
  /** Creates a review-only nutrition estimate from text; it never writes a meal directly. */
  onEstimateMeal(description: string): void;
}) {
  const [entryMode, setEntryMode] = useState<RecordFocusMode>(initialMode);
  const [quickCapture, setQuickCapture] = useState("");
  const [trainingDuration, setTrainingDuration] = useState("");
  const [trainingNote, setTrainingNote] = useState("");
  const [trainingExercises, setTrainingExercises] = useState<TrainingExerciseDraft[]>([]);
  const [cardioEntries, setCardioEntries] = useState<CardioDraft[]>([]);
  const [movementPickerOpen, setMovementPickerOpen] = useState(false);
  const [mealSlot, setMealSlot] = useState<"breakfast" | "lunch" | "dinner" | "snack">("snack");
  const [mealFoods, setMealFoods] = useState<MealFoodDraft[]>([]);
  const [customFood, setCustomFood] = useState("");
  const [mealDescription, setMealDescription] = useState("");
  const [showNutritionDetail, setShowNutritionDetail] = useState(false);
  const [energyKcal, setEnergyKcal] = useState("");
  const [proteinGrams, setProteinGrams] = useState("");
  const [fatGrams, setFatGrams] = useState("");
  const [carbohydrateGrams, setCarbohydrateGrams] = useState("");
  const [sleepDuration, setSleepDuration] = useState("");
  const [sleepQuality, setSleepQuality] = useState("3");
  const [manualSleep, setManualSleep] = useState(false);
  const [recoveryScore, setRecoveryScore] = useState("3");
  const [bodyValue, setBodyValue] = useState("");
  const [bodyMetric, setBodyMetric] = useState<"body_weight" | "body_fat_percentage">("body_weight");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const wasVisible = useRef(visible);

  useEffect(() => {
    if (visible && !wasVisible.current) {
      setEntryMode(initialMode);
      setQuickCapture("");
      setTrainingDuration("");
      setTrainingNote("");
      setTrainingExercises([]);
      setCardioEntries([]);
      setMovementPickerOpen(false);
      setMealSlot("snack");
      setMealFoods([]);
      setCustomFood("");
      setMealDescription("");
      setShowNutritionDetail(false);
      setEnergyKcal("");
      setProteinGrams("");
      setFatGrams("");
      setCarbohydrateGrams("");
      setSleepDuration("");
      setSleepQuality("3");
      setError(undefined);
      setManualSleep(false);
      setRecoveryScore("3");
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
  const mealPreview = useMemo(() => mealPreviewFromDraft(mealFoods), [mealFoods]);

  const selectIntent = (intent: RecordIntent) => {
    setError(undefined);
    setEntryMode(intent === "check_in" ? "recovery" : intent === "nutrition" ? "nutrition" : "training");
  };

  const askCoach = () => {
    const capture = quickCapture.trim();
    if (!capture) {
      setError("先写下今天发生了什么。");
      return;
    }
    onAskCoach([
      "用户正在报告今天真实发生的事，并希望你代为整理记录。它是用户陈述，不是传感器或规则推测。",
      "事实清晰、字段足够且当前授权允许代办时，可使用受控记录工具写入；否则只生成可编辑的记录草稿并追问必要项。",
      "自定义动作或有氧可以保留用户原始名称；不得把视觉识别、规则估算或缺失信息当成用户事实，也不得虚构重量、组数、热量或营养数值。",
      "若用户要求估算有氧消耗，只能生成待确认的估算记录，不能直接写入。",
      "\n原始记录：",
      capture,
    ].join("\n"));
  };

  const addMovement = (choice: DailyMovementChoice) => {
    setError(undefined);
    setMovementPickerOpen(false);
    if (choice.kind === "cardio") {
      setCardioEntries((current) => [...current, newCardio(choice.name)]);
      return;
    }
    setTrainingExercises((current) => [...current, newTrainingExercise(choice.name, choice.id)]);
  };
  const addCustomMovement = ({ name, kind }: { name: string; kind: "strength" | "cardio" }) => {
    setError(undefined);
    setMovementPickerOpen(false);
    if (kind === "cardio") {
      setCardioEntries((current) => [...current, newCardio(name)]);
      return;
    }
    setTrainingExercises((current) => [...current, newTrainingExercise(name)]);
  };
  const askCoachAboutCustomMovement = ({ name, kind }: { name: string; kind: "strength" | "cardio" }) => {
    setError(undefined);
    setMovementPickerOpen(false);
    onAskCoach([
      "用户要补录一个动作库还没有收录的今日运动。名称保持为用户原话，不要擅自映射为标准动作。",
      `类型：${kind === "cardio" ? "有氧" : "力量"}`,
      `名称：${name}`,
      kind === "cardio"
        ? "请让用户补充时长、强度、距离或设备/手表实际消耗。若用户要你估算消耗，可提出 energyEstimateKcal，但它必须形成待确认草稿，不能直接写入。"
        : "请让用户补充实际组数、次数、重量和 RIR；只有用户明确说出的数字才可写入 exercises。没有说出的字段留空或追问，不能猜。",
    ].join("\n"));
  };

  const updateTrainingExercise = (id: string, change: Partial<TrainingExerciseDraft>) => {
    setTrainingExercises((current) => current.map((exercise) => exercise.id === id ? { ...exercise, ...change } : exercise));
  };
  const updateCardio = (id: string, change: Partial<CardioDraft>) => {
    setCardioEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...change } : entry));
  };
  const addFood = (food: FoodLibraryChoice) => {
    setMealFoods((current) => [...current, { id: `food:${nextId()}`, name: food.name, grams: String(food.servingGrams), library: food }]);
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

  const requestMealEstimate = () => {
    const description = [mealDescription.trim(), ...mealFoods.map((food) => `${food.name}${food.grams.trim() ? ` ${food.grams.trim()}g` : ""}`)].filter(Boolean).join("、");
    if (!description) {
      setError("先写下或选中这餐吃了什么。");
      return;
    }
    onEstimateMeal(description);
  };

  const save = async () => {
    const now = new Date();
    const recoveryScoreValue = optionalFiniteNumber(recoveryScore);
    const sleepQualityValue = optionalFiniteNumber(sleepQuality);
    const bodyValueNumber = optionalFiniteNumber(bodyValue);
    const training = trainingSessionFromDraft({
      durationMinutes: optionalFiniteNumber(trainingDuration),
      note: trainingNote,
      exercises: trainingExercises,
    });
    const cardio = cardioFactsFromDraft(cardioEntries, referenceWeightKg);
    const isMovement = activeIntent === "training";
    if (isMovement && !training && !cardio.length) {
      setError("从动作列表选择今天做过的运动，再填写实际完成情况。");
      return;
    }
    if (isMovement && cardioEntries.length !== cardio.length) {
      setError("每项有氧至少填写时长；距离、强度和消耗可选。");
      return;
    }
    if (entryMode === "nutrition" && !mealFoods.length && !mealDescription.trim()) {
      setError("选择食物，或写下这餐吃了什么。");
      return;
    }
    if (entryMode === "recovery" && (recoveryScoreValue === undefined || recoveryScoreValue < 1 || recoveryScoreValue > 5)) {
      setError("请选择 1 到 5。");
      return;
    }
    if (entryMode === "sleep" && syncedSleepMinutes !== undefined && !manualSleep) {
      setError("昨晚睡眠已同步；如需修改，请选择手动补记。");
      return;
    }
    if (entryMode === "sleep" && (sleepQualityValue === undefined || sleepQualityValue < 1 || sleepQualityValue > 5 || optionalFiniteNumber(sleepDuration) === undefined || optionalFiniteNumber(sleepDuration)! <= 0)) {
      setError("填写睡眠时长和质量。");
      return;
    }
    if (entryMode === "body" && (bodyValueNumber === undefined || bodyValueNumber <= 0 || (bodyMetric === "body_fat_percentage" && bodyValueNumber > 100))) {
      setError(bodyMetric === "body_weight" ? "填写体重。" : "体脂率应在 0 到 100 之间。");
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      if (entryMode === "nutrition") {
        const manualTotals = manualNutritionTotals({ energyKcal, proteinGrams, fatGrams, carbohydrateGrams });
        const foods = foodEntriesFromDraft(mealFoods);
        const calculated = manualTotals.hasAny ? manualTotals : mealPreview;
        const description = mealDescription.trim() || mealFoods.map((food) => food.name).join("、");
        const observation = createManualMealObservation({
          id: `manual-meal:${now.getTime()}`,
          occurredAt: now.toISOString(),
          description,
          mealSlot,
          foods,
          mode: calculated.hasAny ? "precise" : "simplified",
          provenance: "manual",
          ...(calculated.energy !== undefined ? { energyKcal: calculated.energy } : {}),
          ...(calculated.protein !== undefined ? { proteinGrams: calculated.protein } : {}),
          ...(calculated.fat !== undefined ? { fatGrams: calculated.fat } : {}),
          ...(calculated.carbohydrate !== undefined ? { carbohydrateGrams: calculated.carbohydrate } : {}),
          ...(calculated.hasAny ? {} : { simplified: { proteinCompletion: "partial" as const, hunger: "moderate" as const, deviation: "none" as const } }),
        });
        await application.confirmMealObservation({
          userId,
          idempotencyKey: `mobile-meal:${now.getTime()}`,
          source: "manual",
          observation,
        });
        onSaved();
        return;
      }

      if (isMovement) {
        if (training) {
          await application.recordTimelineFact({
            userId,
            idempotencyKey: `mobile-movement:${now.getTime()}:strength`,
            fact: { kind: "training", reportedSession: training, confidence: "confirmed" },
            envelope: recordEnvelope(now),
          });
        }
        for (const [index, fact] of cardio.entries()) {
          await application.recordTimelineFact({
            userId,
            idempotencyKey: `mobile-movement:${now.getTime()}:cardio:${index}`,
            fact,
            envelope: recordEnvelope(now),
          });
        }
        onSaved();
        return;
      }

      await application.recordTimelineFact({
        userId,
        idempotencyKey: `mobile-record:${now.getTime()}`,
        fact: entryMode === "sleep"
          ? { kind: "sleep", duration: { value: optionalFiniteNumber(sleepDuration)!, unit: "minutes" }, quality: sleepQualityValue, confidence: "confirmed" }
          : entryMode === "recovery"
            ? { kind: "recovery", perceivedRecovery: recoveryScoreValue, confidence: "confirmed" }
            : {
                kind: "body",
                measurement: bodyMetric === "body_weight"
                  ? { metric: "body_weight", quantity: { value: bodyValueNumber!, unit: "kg" } }
                  : { metric: "body_fat_percentage", quantity: { value: bodyValueNumber!, unit: "percent" } },
                confidence: "confirmed",
              },
        envelope: recordEnvelope(now),
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时未能保存记录");
    } finally {
      setSaving(false);
    }
  };

  return <FocusSurface visible={visible} anchor={anchor} accessibilityLabel="收起记录" onDismiss={onDismiss}>
    <View style={styles.panel}>
      <View style={styles.header}>
        <View><Text style={styles.title}>记录今天</Text><Text style={styles.subtitle}>运动、吃喝与恢复</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="收起记录" onPress={onDismiss} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <RecordCaptureComposer value={quickCapture} onChangeText={setQuickCapture} onSubmit={askCoach} />
        <RecordIntentGrid value={activeIntent} options={RECORD_INTENTS} onChange={selectIntent} />

        {activeIntent === "training" ? <MovementEntry
          duration={trainingDuration}
          note={trainingNote}
          exercises={trainingExercises}
          cardioEntries={cardioEntries}
          pickerOpen={movementPickerOpen}
          referenceWeightKg={referenceWeightKg}
          onDurationChange={setTrainingDuration}
          onNoteChange={setTrainingNote}
          onOpenPicker={() => setMovementPickerOpen((current) => !current)}
          onMovementSelected={addMovement}
          onCustomMovement={addCustomMovement}
          onAskCoachAboutCustomMovement={askCoachAboutCustomMovement}
          onExerciseChange={updateTrainingExercise}
          onExerciseRemove={(id) => setTrainingExercises((current) => current.filter((exercise) => exercise.id !== id))}
          onCardioChange={updateCardio}
          onCardioRemove={(id) => setCardioEntries((current) => current.filter((entry) => entry.id !== id))}
        /> : null}

        {entryMode === "nutrition" ? <NutritionEntry
          mealSlot={mealSlot}
          foods={mealFoods}
          customFood={customFood}
          description={mealDescription}
          showDetail={showNutritionDetail}
          energy={energyKcal}
          protein={proteinGrams}
          fat={fatGrams}
          carbohydrate={carbohydrateGrams}
          preview={mealPreview}
          onSlotChange={setMealSlot}
          onFoodSelected={addFood}
          onFoodChange={updateFood}
          onFoodRemove={(id) => setMealFoods((current) => current.filter((food) => food.id !== id))}
          onCustomFoodChange={setCustomFood}
          onAddCustomFood={addCustomFood}
          onDescriptionChange={setMealDescription}
          onToggleDetail={() => setShowNutritionDetail((value) => !value)}
          onEnergyChange={setEnergyKcal}
          onProteinChange={setProteinGrams}
          onFatChange={setFatGrams}
          onCarbohydrateChange={setCarbohydrateGrams}
          onEstimate={requestMealEstimate}
        /> : null}

        {activeIntent === "check_in" ? <CheckInEntry
          mode={entryMode === "sleep" || entryMode === "body" ? entryMode : "recovery"}
          recoveryScore={recoveryScore}
          sleepQuality={sleepQuality}
          sleepDuration={sleepDuration}
          syncedSleepMinutes={syncedSleepMinutes}
          manualSleep={manualSleep}
          bodyValue={bodyValue}
          bodyMetric={bodyMetric}
          onModeChange={setEntryMode}
          onRecoveryScoreChange={setRecoveryScore}
          onSleepQualityChange={setSleepQuality}
          onSleepDurationChange={setSleepDuration}
          onUseManualSleep={() => setManualSleep(true)}
          onBodyValueChange={setBodyValue}
          onBodyMetricChange={setBodyMetric}
        /> : null}

        {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        {!(entryMode === "sleep" && syncedSleepMinutes !== undefined && !manualSleep) ? <RecordConfirmationBar label={confirmationLabel(activeIntent, mealPreview.energy)} busy={saving} onConfirm={() => void save()} /> : null}
      </ScrollView>
    </View>
  </FocusSurface>;
}

function MovementEntry({ duration, note, exercises, cardioEntries, pickerOpen, referenceWeightKg, onDurationChange, onNoteChange, onOpenPicker, onMovementSelected, onCustomMovement, onAskCoachAboutCustomMovement, onExerciseChange, onExerciseRemove, onCardioChange, onCardioRemove }: {
  duration: string;
  note: string;
  exercises: readonly TrainingExerciseDraft[];
  cardioEntries: readonly CardioDraft[];
  pickerOpen: boolean;
  referenceWeightKg?: number;
  onDurationChange(value: string): void;
  onNoteChange(value: string): void;
  onOpenPicker(): void;
  onMovementSelected(choice: DailyMovementChoice): void;
  onCustomMovement(input: { name: string; kind: "strength" | "cardio" }): void;
  onAskCoachAboutCustomMovement(input: { name: string; kind: "strength" | "cardio" }): void;
  onExerciseChange(id: string, change: Partial<TrainingExerciseDraft>): void;
  onExerciseRemove(id: string): void;
  onCardioChange(id: string, change: Partial<CardioDraft>): void;
  onCardioRemove(id: string): void;
}) {
  return <RecordSection title="今天的运动" action={<Pressable accessibilityRole="button" onPress={onOpenPicker} style={styles.addAction}><Text style={styles.addActionText}>{pickerOpen ? "收起" : "＋ 选择运动"}</Text></Pressable>}>
    {pickerOpen ? <MovementLibraryPicker onSelect={onMovementSelected} onCustom={onCustomMovement} onAskCoach={onAskCoachAboutCustomMovement} /> : null}
    {exercises.length ? <View style={styles.logGroup}><Text style={styles.groupLabel}>力量</Text>{exercises.map((exercise, index) => <TrainingExerciseCard key={exercise.id} exercise={exercise} index={index} onChange={(change) => onExerciseChange(exercise.id, change)} onRemove={() => onExerciseRemove(exercise.id)} />)}</View> : null}
    {cardioEntries.length ? <View style={styles.logGroup}><Text style={styles.groupLabel}>有氧</Text>{cardioEntries.map((entry) => <CardioEntryCard key={entry.id} entry={entry} referenceWeightKg={referenceWeightKg} onChange={(change) => onCardioChange(entry.id, change)} onRemove={() => onCardioRemove(entry.id)} />)}</View> : null}
    {!exercises.length && !cardioEntries.length && !pickerOpen ? <Pressable accessibilityRole="button" onPress={onOpenPicker} style={styles.emptyMovement}><Text style={styles.emptyMovementText}>选择今天做过的运动</Text><Text style={styles.emptyMovementArrow}>＋</Text></Pressable> : null}
    {(exercises.length || cardioEntries.length) ? <><View style={styles.metricRow}><RecordField label="总时长" unit="min" value={duration} onChangeText={onDurationChange} keyboardType="decimal-pad" /></View><TextInput accessibilityLabel="运动备注" value={note} onChangeText={onNoteChange} placeholder="备注（可选）" placeholderTextColor={colors.ink3} style={styles.noteInput} /></> : null}
  </RecordSection>;
}

function TrainingExerciseCard({ exercise, index, onChange, onRemove }: { exercise: TrainingExerciseDraft; index: number; onChange(change: Partial<TrainingExerciseDraft>): void; onRemove(): void }) {
  return <View style={styles.exerciseCard}>
    <View style={styles.exerciseHeading}><Text style={styles.exerciseIndex}>{String(index + 1).padStart(2, "0")}</Text><Text style={styles.exerciseName}>{exercise.name}</Text><Pressable accessibilityRole="button" accessibilityLabel={`删除 ${exercise.name}`} onPress={onRemove} hitSlop={8}><Text style={styles.removeAction}>×</Text></Pressable></View>
    <View style={styles.trainingMetrics}>
      <RecordField label="组数" value={exercise.setCount} onChangeText={(setCount) => onChange({ setCount })} keyboardType="decimal-pad" />
      <RecordField label="每组" unit="次" value={exercise.reps} onChangeText={(reps) => onChange({ reps })} keyboardType="decimal-pad" />
      <RecordField label="重量" unit="kg" value={exercise.loadKg} onChangeText={(loadKg) => onChange({ loadKg })} keyboardType="decimal-pad" />
      <RecordField label="RIR" value={exercise.rir} onChangeText={(rir) => onChange({ rir })} keyboardType="decimal-pad" />
    </View>
  </View>;
}

function CardioEntryCard({ entry, referenceWeightKg, onChange, onRemove }: { entry: CardioDraft; referenceWeightKg?: number; onChange(change: Partial<CardioDraft>): void; onRemove(): void }) {
  const estimated = estimateCardioEnergy({ activityType: entry.activityType, minutes: optionalFiniteNumber(entry.durationMinutes), intensity: entry.intensity, referenceWeightKg });
  const shownEnergy = optionalFiniteNumber(entry.energyKcal) ?? estimated?.kcal;
  return <View style={styles.exerciseCard}>
    <View style={styles.exerciseHeading}><Text style={styles.cardioMark}>◌</Text><Text style={styles.exerciseName}>{entry.activityType}</Text><Pressable accessibilityRole="button" accessibilityLabel={`删除 ${entry.activityType}`} onPress={onRemove} hitSlop={8}><Text style={styles.removeAction}>×</Text></Pressable></View>
    <View style={styles.cardioMetrics}><RecordField label="时长" unit="min" value={entry.durationMinutes} onChangeText={(durationMinutes) => onChange({ durationMinutes })} keyboardType="decimal-pad" /><RecordField label="距离" unit="km" value={entry.distanceKm} onChangeText={(distanceKm) => onChange({ distanceKm })} keyboardType="decimal-pad" /><RecordField label="消耗" unit="kcal" value={entry.energyKcal} onChangeText={(energyKcal) => onChange({ energyKcal })} keyboardType="decimal-pad" /><RecordField label="RPE" unit="/10" value={entry.perceivedExertion} onChangeText={(perceivedExertion) => onChange({ perceivedExertion })} keyboardType="decimal-pad" /></View>
    <RecordPills value={entry.intensity} options={[{ id: "easy" as const, label: "轻松" }, { id: "moderate" as const, label: "适中" }, { id: "hard" as const, label: "吃力" }]} onChange={(intensity) => onChange({ intensity })} compact />
    {shownEnergy !== undefined ? <Text style={styles.cardioEstimate}>{entry.energyKcal.trim() ? `${Math.round(shownEnergy)} kcal · 用户填写` : `约 ${Math.round(shownEnergy)} kcal · ${estimated?.basis ?? "本地估算"}`}</Text> : null}
  </View>;
}

function NutritionEntry({ mealSlot, foods, customFood, description, showDetail, energy, protein, fat, carbohydrate, preview, onSlotChange, onFoodSelected, onFoodChange, onFoodRemove, onCustomFoodChange, onAddCustomFood, onDescriptionChange, onToggleDetail, onEnergyChange, onProteinChange, onFatChange, onCarbohydrateChange, onEstimate }: {
  mealSlot: "breakfast" | "lunch" | "dinner" | "snack";
  foods: readonly MealFoodDraft[];
  customFood: string;
  description: string;
  showDetail: boolean;
  energy: string;
  protein: string;
  fat: string;
  carbohydrate: string;
  preview: NutritionTotals;
  onSlotChange(value: "breakfast" | "lunch" | "dinner" | "snack"): void;
  onFoodSelected(choice: FoodLibraryChoice): void;
  onFoodChange(id: string, change: Partial<MealFoodDraft>): void;
  onFoodRemove(id: string): void;
  onCustomFoodChange(value: string): void;
  onAddCustomFood(): void;
  onDescriptionChange(value: string): void;
  onToggleDetail(): void;
  onEnergyChange(value: string): void;
  onProteinChange(value: string): void;
  onFatChange(value: string): void;
  onCarbohydrateChange(value: string): void;
  onEstimate(): void;
}) {
  return <RecordSection title="这餐吃了什么" action={<Pressable accessibilityRole="button" onPress={onToggleDetail} style={styles.addAction}><Text style={styles.addActionText}>{showDetail ? "收起热量" : "手填热量"}</Text></Pressable>}>
    <RecordPills value={mealSlot} options={[{ id: "breakfast" as const, label: "早餐" }, { id: "lunch" as const, label: "午餐" }, { id: "dinner" as const, label: "晚餐" }, { id: "snack" as const, label: "加餐" }]} onChange={onSlotChange} compact />
    <FoodLibraryPicker onSelect={onFoodSelected} />
    {foods.length ? <View style={styles.logGroup}>{foods.map((food) => <FoodEntryCard key={food.id} food={food} onChange={(change) => onFoodChange(food.id, change)} onRemove={() => onFoodRemove(food.id)} />)}</View> : null}
    <View style={styles.customFoodRow}><TextInput accessibilityLabel="自定义食物" value={customFood} onChangeText={onCustomFoodChange} placeholder="没有找到？输入食物" placeholderTextColor={colors.ink3} style={styles.customFoodInput} /><Pressable accessibilityRole="button" onPress={onAddCustomFood} style={styles.addFoodButton}><Text style={styles.addFoodButtonText}>添加</Text></Pressable></View>
    <TextInput accessibilityLabel="餐食补充描述" value={description} onChangeText={onDescriptionChange} placeholder="例如：外卖少油、酱汁另放" placeholderTextColor={colors.ink3} multiline style={[styles.noteInput, styles.mealInput]} />
    <Pressable accessibilityRole="button" onPress={onEstimate} style={styles.estimateButton}><Text style={styles.estimateButtonText}>让 Coach 估算这餐</Text><Text style={styles.estimateButtonArrow}>↗</Text></Pressable>
    {showDetail ? <View style={styles.nutritionMetrics}><RecordField label="整餐热量" unit="kcal" value={energy} onChangeText={onEnergyChange} keyboardType="decimal-pad" /><RecordField label="蛋白" unit="g" value={protein} onChangeText={onProteinChange} keyboardType="decimal-pad" /><RecordField label="脂肪" unit="g" value={fat} onChangeText={onFatChange} keyboardType="decimal-pad" /><RecordField label="碳水" unit="g" value={carbohydrate} onChangeText={onCarbohydrateChange} keyboardType="decimal-pad" /></View> : null}
    {preview.hasAny && !showDetail ? <Text style={styles.foodPreview}>已选食物约 {Math.round(preview.energy ?? 0)} kcal · 蛋白 {Math.round(preview.protein ?? 0)} g</Text> : null}
  </RecordSection>;
}

function FoodEntryCard({ food, onChange, onRemove }: { food: MealFoodDraft; onChange(change: Partial<MealFoodDraft>): void; onRemove(): void }) {
  const perPortion = food.library ? nutritionForFood(food) : undefined;
  return <View style={styles.foodCard}><View style={styles.foodHeading}><Text style={styles.foodName}>{food.name}</Text><Pressable accessibilityRole="button" accessibilityLabel={`删除 ${food.name}`} onPress={onRemove}><Text style={styles.removeAction}>×</Text></Pressable></View><View style={styles.foodPortionRow}><TextInput accessibilityLabel={`${food.name} 克数`} value={food.grams} onChangeText={(grams) => onChange({ grams })} keyboardType="decimal-pad" placeholder="份量" placeholderTextColor={colors.ink3} style={styles.gramInput} /><Text style={styles.gramUnit}>g</Text>{perPortion ? <Text style={styles.foodNutrients}>{Math.round(perPortion.kcal)} kcal · P {Math.round(perPortion.protein)} g</Text> : <Text style={styles.foodUnknown}>待估算</Text>}</View></View>;
}

function CheckInEntry({ mode, recoveryScore, sleepQuality, sleepDuration, syncedSleepMinutes, manualSleep, bodyValue, bodyMetric, onModeChange, onRecoveryScoreChange, onSleepQualityChange, onSleepDurationChange, onUseManualSleep, onBodyValueChange, onBodyMetricChange }: {
  mode: "sleep" | "recovery" | "body";
  recoveryScore: string;
  sleepQuality: string;
  sleepDuration: string;
  syncedSleepMinutes?: number;
  manualSleep: boolean;
  bodyValue: string;
  bodyMetric: "body_weight" | "body_fat_percentage";
  onModeChange(value: "sleep" | "recovery" | "body"): void;
  onRecoveryScoreChange(value: string): void;
  onSleepQualityChange(value: string): void;
  onSleepDurationChange(value: string): void;
  onUseManualSleep(): void;
  onBodyValueChange(value: string): void;
  onBodyMetricChange(value: "body_weight" | "body_fat_percentage"): void;
}) {
  return <RecordSection title="今天的恢复">
    <RecordPills value={mode} options={[{ id: "recovery" as const, label: "恢复感受" }, { id: "sleep" as const, label: "昨晚睡眠" }, { id: "body" as const, label: "身体数据" }]} onChange={onModeChange} />
    {mode === "sleep" ? syncedSleepMinutes !== undefined && !manualSleep
      ? <View style={styles.syncedSleep}><View><Text style={styles.syncedSleepLabel}>已同步昨晚睡眠</Text><Text style={styles.syncedSleepValue}>{formatSleepMinutes(syncedSleepMinutes)}</Text></View><Pressable accessibilityRole="button" onPress={onUseManualSleep} style={styles.addAction}><Text style={styles.addActionText}>手动补记</Text></Pressable></View>
      : <><Text style={styles.recoveryHint}>没有同步数据时，可在这里补记。</Text><RecordField label="睡眠时长" unit="min" value={sleepDuration} onChangeText={onSleepDurationChange} keyboardType="decimal-pad" /><ScorePills value={sleepQuality} onChange={onSleepQualityChange} /></> : null}
    {mode === "recovery" ? <><Text style={styles.recoveryHint}>今天恢复怎样？只记录你的感受，不诊断原因。</Text><ScorePills value={recoveryScore} onChange={onRecoveryScoreChange} /></> : null}
    {mode === "body" ? <><RecordPills value={bodyMetric} options={[{ id: "body_weight" as const, label: "体重" }, { id: "body_fat_percentage" as const, label: "体脂" }]} onChange={onBodyMetricChange} compact /><RecordField label={bodyMetric === "body_weight" ? "体重" : "体脂"} unit={bodyMetric === "body_weight" ? "kg" : "%"} value={bodyValue} onChangeText={onBodyValueChange} keyboardType="decimal-pad" /></> : null}
  </RecordSection>;
}

function ScorePills({ value, onChange }: { value: string; onChange(value: string): void }) {
  return <RecordPills value={value} options={[["1", "很差"], ["2", "偏低"], ["3", "一般"], ["4", "不错"], ["5", "很好"]].map(([id, label]) => ({ id, label }))} onChange={onChange} compact />;
}

function formatSleepMinutes(minutes: number): string {
  const rounded = Math.round(minutes);
  return `${Math.floor(rounded / 60)} h ${rounded % 60} min`;
}

function trainingSessionFromDraft(input: { durationMinutes: number | undefined; note: string; exercises: readonly TrainingExerciseDraft[] }) {
  const exercises = input.exercises.flatMap((exercise) => {
    const setCount = optionalInteger(exercise.setCount);
    const reps = optionalInteger(exercise.reps);
    const load = optionalFiniteNumber(exercise.loadKg);
    const rir = optionalFiniteNumber(exercise.rir);
    if (setCount === undefined || setCount < 1 || setCount > 99 || reps === undefined || reps < 0 || (load !== undefined && load < 0) || (rir !== undefined && (rir < 0 || rir > 10))) return [];
    return [{ name: exercise.name, ...(exercise.conceptId ? { exerciseConceptId: exercise.conceptId } : {}), sets: Array.from({ length: setCount }, () => ({ reps, ...(load === undefined ? {} : { load: { value: load, unit: "kg" as const } }), ...(rir === undefined ? {} : { rir }) })) }];
  });
  const note = input.note.trim();
  if (!exercises.length && !note && !input.durationMinutes) return undefined;
  return { summary: "自主训练", ...(input.durationMinutes && input.durationMinutes > 0 ? { duration: { value: input.durationMinutes, unit: "minutes" as const } } : {}), ...(note ? { note } : {}), ...(exercises.length ? { exercises } : {}) };
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
    return [{ kind: "activity" as const, activityType: entry.activityType, duration: { value: duration, unit: "minutes" as const }, ...(distance === undefined ? {} : { distance: { value: distance, unit: "km" as const } }), intensity: entry.intensity, ...(rpe === undefined ? {} : { perceivedExertion: Math.max(0, Math.min(10, rpe)) }), ...(energy === undefined ? {} : { energyExpenditure: { value: energy, unit: "kcal" as const }, energyExpenditureSource: manualEnergy === undefined ? "rule_estimate" as const : "manual" as const }), confidence: manualEnergy === undefined ? "estimated" as const : "confirmed" as const }];
  });
}

type NutritionTotals = { energy?: number; protein?: number; fat?: number; carbohydrate?: number; hasAny: boolean };

function mealPreviewFromDraft(foods: readonly MealFoodDraft[]): NutritionTotals {
  const known = foods.map(nutritionForFood).filter((value): value is { kcal: number; protein: number; fat: number; carbohydrate: number } => value !== undefined);
  if (!known.length) return { hasAny: false };
  return { energy: sum(known.map((item) => item.kcal)), protein: sum(known.map((item) => item.protein)), fat: sum(known.map((item) => item.fat)), carbohydrate: sum(known.map((item) => item.carbohydrate)), hasAny: true };
}

function nutritionForFood(food: MealFoodDraft): { kcal: number; protein: number; fat: number; carbohydrate: number } | undefined {
  const grams = optionalFiniteNumber(food.grams);
  if (!food.library || grams === undefined || grams <= 0) return undefined;
  const multiplier = grams / 100;
  return { kcal: food.library.per100g.kcal * multiplier, protein: food.library.per100g.protein * multiplier, fat: food.library.per100g.fat * multiplier, carbohydrate: food.library.per100g.carbohydrate * multiplier };
}

function foodEntriesFromDraft(foods: readonly MealFoodDraft[]): readonly FoodEntryData[] {
  return foods.map((food) => {
    const nutrients = nutritionForFood(food);
    return { id: food.id, name: food.name, ...(food.grams.trim() ? { portion: `${food.grams.trim()} g` } : {}), ...(nutrients ? { energy: { value: Math.round(nutrients.kcal), unit: "kcal" as const }, proteinGrams: roundOne(nutrients.protein), fatGrams: roundOne(nutrients.fat), carbohydrateGrams: roundOne(nutrients.carbohydrate) } : {}), source: "manual" as const };
  });
}

function manualNutritionTotals(input: { energyKcal: string; proteinGrams: string; fatGrams: string; carbohydrateGrams: string }): NutritionTotals {
  const energy = optionalFiniteNumber(input.energyKcal);
  const protein = optionalFiniteNumber(input.proteinGrams);
  const fat = optionalFiniteNumber(input.fatGrams);
  const carbohydrate = optionalFiniteNumber(input.carbohydrateGrams);
  return { ...(energy === undefined ? {} : { energy }), ...(protein === undefined ? {} : { protein }), ...(fat === undefined ? {} : { fat }), ...(carbohydrate === undefined ? {} : { carbohydrate }), hasAny: [energy, protein, fat, carbohydrate].some((value) => value !== undefined) };
}

function recordEnvelope(now: Date) {
  return { time: { startedAt: now.toISOString(), timezoneOffsetMinutes: -now.getTimezoneOffset() }, provenance: { origin: "manual" as const, recordingMethod: "manual_entry" as const, dataStatus: "available" as const, confidence: "confirmed" as const }, privacyClass: "sensitive" as const, causalRefs: [], evidenceRefs: [], layer: "raw_observation" as const };
}

function newTrainingExercise(name: string, conceptId?: string): TrainingExerciseDraft { return { id: `exercise:${nextId()}`, name, ...(conceptId ? { conceptId } : {}), setCount: "3", reps: "10", loadKg: "", rir: "" }; }
function newCardio(activityType: string): CardioDraft { return { id: `cardio:${nextId()}`, activityType, durationMinutes: "", distanceKm: "", energyKcal: "", intensity: "moderate", perceivedExertion: "" }; }
function nextId(): string { return Math.random().toString(36).slice(2); }
function optionalFiniteNumber(value: string): number | undefined { const parsed = Number(value.trim()); return value.trim() && Number.isFinite(parsed) ? parsed : undefined; }
function optionalInteger(value: string): number | undefined { const number = optionalFiniteNumber(value); return number !== undefined && Number.isInteger(number) ? number : undefined; }
function sum(values: readonly number[]): number { return values.reduce((total, value) => total + value, 0); }
function roundOne(value: number): number { return Math.round(value * 10) / 10; }
function confirmationLabel(intent: RecordIntent, nutritionEnergy: number | undefined): string { return intent === "training" ? "确认今天的运动" : intent === "nutrition" ? nutritionEnergy === undefined ? "确认这餐" : `确认 ${Math.round(nutritionEnergy)} kcal` : "确认记录"; }

function estimateCardioEnergy(input: { activityType: string; minutes: number | undefined; intensity: "easy" | "moderate" | "hard"; referenceWeightKg: number | undefined }): { kcal: number; basis: string } | undefined {
  if (!input.minutes || input.minutes <= 0) return undefined;
  const matched = CARDIO_RULES.find((rule) => rule.keys.some((key) => input.activityType.trim().toLowerCase().includes(key)));
  if (!matched) return undefined;
  const weight = input.referenceWeightKg && input.referenceWeightKg > 0 ? input.referenceWeightKg : 65;
  const intensityMultiplier = input.intensity === "easy" ? 0.8 : input.intensity === "hard" ? 1.2 : 1;
  const kcal = Math.round(matched.kcalPerHour * (input.minutes / 60) * (weight / 65) * intensityMultiplier / 5) * 5;
  return { kcal, basis: `${matched.label} · ${Math.round(weight)} kg` };
}

const CARDIO_RULES = [
  { label: "跑步", keys: ["跑", "jog", "run"], kcalPerHour: 560 }, { label: "步行", keys: ["走", "walk", "徒步"], kcalPerHour: 250 }, { label: "骑行", keys: ["骑", "cycle", "bike", "动感"], kcalPerHour: 430 }, { label: "游泳", keys: ["游", "swim"], kcalPerHour: 490 }, { label: "跳绳", keys: ["跳绳", "rope"], kcalPerHour: 650 }, { label: "椭圆机", keys: ["椭圆", "elliptical"], kcalPerHour: 390 }, { label: "划船机", keys: ["划船", "row"], kcalPerHour: 440 }, { label: "球类", keys: ["球", "tennis", "badminton", "basketball", "football"], kcalPerHour: 410 },
] as const;

const styles = StyleSheet.create({
  panel: { flex: 1, minHeight: 0 }, header: { minHeight: 67, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, title: { color: colors.ink, fontSize: 20, fontWeight: "900", letterSpacing: -0.35 }, subtitle: { marginTop: 1, color: colors.ink3, fontSize: 11, fontWeight: "700" }, close: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: colors.paper2 }, closeText: { marginTop: -4, color: colors.ink, fontSize: 26, lineHeight: 29, fontWeight: "500" }, scroll: { flex: 1, minHeight: 0 }, content: { padding: 16, paddingBottom: 28, gap: 20 }, metricRow: { flexDirection: "row", gap: 10 }, logGroup: { gap: 9 }, groupLabel: { color: colors.ink3, fontSize: 11, fontWeight: "900", letterSpacing: 0.45 }, addAction: { minHeight: 32, paddingHorizontal: 11, alignItems: "center", justifyContent: "center", borderRadius: radius.chip, backgroundColor: colors.paper2 }, addActionText: { color: colors.ink2, fontSize: 11, fontWeight: "900" }, emptyMovement: { minHeight: 82, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 18, backgroundColor: colors.paper2 }, emptyMovementText: { color: colors.ink2, fontSize: 14, fontWeight: "800" }, emptyMovementArrow: { color: colors.limeInk, fontSize: 26, fontWeight: "900" }, exerciseCard: { gap: 11, padding: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, exerciseHeading: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 9 }, exerciseIndex: { width: 23, color: colors.limeInk, fontFamily: "monospace", fontSize: 10, fontWeight: "900" }, cardioMark: { width: 23, color: colors.limeInk, fontSize: 19, fontWeight: "900", textAlign: "center" }, exerciseName: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 15, fontWeight: "900" }, removeAction: { width: 26, color: colors.ink3, fontSize: 21, textAlign: "right" }, trainingMetrics: { flexDirection: "row", gap: 7 }, cardioMetrics: { flexDirection: "row", gap: 7 }, cardioEstimate: { color: colors.ink3, fontSize: 11, fontWeight: "700" }, noteInput: { minHeight: 50, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.ink, fontSize: 14, fontWeight: "700" }, mealInput: { minHeight: 58, paddingTop: 12, textAlignVertical: "top" }, estimateButton: { minHeight: 48, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 16, backgroundColor: colors.dark }, estimateButtonText: { color: colors.white, fontSize: 13, fontWeight: "900" }, estimateButtonArrow: { color: colors.lime, fontSize: 21, fontWeight: "900" }, nutritionMetrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, foodCard: { gap: 8, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white }, foodHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, foodName: { color: colors.ink, fontSize: 14, fontWeight: "900" }, foodPortionRow: { flexDirection: "row", alignItems: "center", gap: 5 }, gramInput: { width: 58, minHeight: 32, padding: 0, color: colors.ink, fontFamily: "monospace", fontSize: 16, fontWeight: "900" }, gramUnit: { color: colors.ink3, fontSize: 11, fontWeight: "800" }, foodNutrients: { flex: 1, minWidth: 0, color: colors.ink2, fontSize: 11, fontWeight: "700", textAlign: "right" }, foodUnknown: { flex: 1, color: colors.terra, fontSize: 11, fontWeight: "800", textAlign: "right" }, customFoodRow: { flexDirection: "row", gap: 8 }, customFoodInput: { flex: 1, minWidth: 0, minHeight: 46, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.ink, fontSize: 13, fontWeight: "700" }, addFoodButton: { minWidth: 64, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.paper2 }, addFoodButtonText: { color: colors.ink, fontSize: 12, fontWeight: "900" }, foodPreview: { color: colors.limeInk, fontSize: 12, fontWeight: "800" }, recoveryHint: { color: colors.ink3, fontSize: 12, lineHeight: 17 }, syncedSleep: { minHeight: 84, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 18, backgroundColor: colors.paper2 }, syncedSleepLabel: { color: colors.ink3, fontSize: 11, fontWeight: "800" }, syncedSleepValue: { marginTop: 3, color: colors.ink, fontFamily: "monospace", fontSize: 22, fontWeight: "900" }, error: { color: colors.terra, fontSize: 12, fontWeight: "800" },
});
