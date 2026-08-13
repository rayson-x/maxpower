import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { uiColors, uiRadius, uiSpace, uiType } from "./tokens";

/**
 * A lightweight, browsable daily-log vocabulary. These are selection labels,
 * not a substitute for the versioned exercise knowledge pack used by planning.
 * A selected movement stays a user-stated record until a later resolver links
 * it to an exact variant / comparable performance history.
 */
export type DailyMovementKind = "strength" | "cardio";
export type DailyMovementGroup = "chest" | "back" | "shoulders" | "arms" | "legs" | "core" | "cardio";

export interface DailyMovementChoice {
  id: string;
  name: string;
  kind: DailyMovementKind;
  group: DailyMovementGroup;
  aliases: readonly string[];
}

export const DAILY_MOVEMENT_GROUPS: readonly { id: DailyMovementGroup | "all"; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "chest", label: "胸" },
  { id: "back", label: "背" },
  { id: "shoulders", label: "肩" },
  { id: "arms", label: "手臂" },
  { id: "legs", label: "腿臀" },
  { id: "core", label: "核心" },
  { id: "cardio", label: "有氧" },
] as const;

export const DAILY_MOVEMENT_LIBRARY: readonly DailyMovementChoice[] = [
  { id: "concept.bench_press", name: "卧推", kind: "strength", group: "chest", aliases: ["杠铃卧推", "哑铃卧推", "推胸"] },
  { id: "concept.push_up", name: "俯卧撑", kind: "strength", group: "chest", aliases: ["push up"] },
  { id: "concept.chest_fly", name: "飞鸟", kind: "strength", group: "chest", aliases: ["夹胸"] },
  { id: "concept.row", name: "划船", kind: "strength", group: "back", aliases: ["杠铃划船", "坐姿划船", "哑铃划船"] },
  { id: "concept.lat_pulldown", name: "高位下拉", kind: "strength", group: "back", aliases: ["下拉"] },
  { id: "concept.pull_up", name: "引体向上", kind: "strength", group: "back", aliases: ["pull up"] },
  { id: "concept.straight_arm_pulldown", name: "直臂下压", kind: "strength", group: "back", aliases: ["直臂下拉"] },
  { id: "concept.overhead_press", name: "肩上推举", kind: "strength", group: "shoulders", aliases: ["推举", "肩推"] },
  { id: "concept.lateral_raise", name: "侧平举", kind: "strength", group: "shoulders", aliases: ["侧平"] },
  { id: "concept.front_raise", name: "前平举", kind: "strength", group: "shoulders", aliases: ["前平"] },
  { id: "concept.rear_delt_fly", name: "后束飞鸟", kind: "strength", group: "shoulders", aliases: ["反向飞鸟"] },
  { id: "concept.external_rotation", name: "肩外旋", kind: "strength", group: "shoulders", aliases: ["外旋"] },
  { id: "concept.biceps_curl", name: "二头弯举", kind: "strength", group: "arms", aliases: ["哑铃弯举", "杠铃弯举"] },
  { id: "concept.triceps_extension", name: "三头伸展", kind: "strength", group: "arms", aliases: ["臂屈伸", "下压"] },
  { id: "concept.squat", name: "深蹲", kind: "strength", group: "legs", aliases: ["杠铃深蹲", "高脚杯深蹲"] },
  { id: "concept.leg_press", name: "腿举", kind: "strength", group: "legs", aliases: ["leg press"] },
  { id: "concept.deadlift", name: "硬拉", kind: "strength", group: "legs", aliases: ["罗马尼亚硬拉", "RDL"] },
  { id: "concept.hip_thrust", name: "臀推", kind: "strength", group: "legs", aliases: ["hip thrust"] },
  { id: "concept.lunge", name: "弓步", kind: "strength", group: "legs", aliases: ["行走弓步"] },
  { id: "concept.split_squat", name: "分腿蹲", kind: "strength", group: "legs", aliases: ["保加利亚分腿蹲"] },
  { id: "concept.knee_extension", name: "腿屈伸", kind: "strength", group: "legs", aliases: ["leg extension"] },
  { id: "concept.knee_flexion", name: "腿弯举", kind: "strength", group: "legs", aliases: ["leg curl"] },
  { id: "concept.calf_raise", name: "提踵", kind: "strength", group: "legs", aliases: ["小腿"] },
  { id: "concept.plank", name: "平板支撑", kind: "strength", group: "core", aliases: ["plank"] },
  { id: "concept.crunch", name: "卷腹", kind: "strength", group: "core", aliases: ["crunch"] },
  { id: "concept.anti_rotation_press", name: "抗旋推", kind: "strength", group: "core", aliases: ["Pallof press"] },
  { id: "cardio.run", name: "跑步", kind: "cardio", group: "cardio", aliases: ["慢跑", "jog", "run"] },
  { id: "cardio.walk", name: "步行 / 快走", kind: "cardio", group: "cardio", aliases: ["走路", "walk", "徒步"] },
  { id: "cardio.cycle", name: "骑行", kind: "cardio", group: "cardio", aliases: ["动感单车", "bike"] },
  { id: "cardio.swim", name: "游泳", kind: "cardio", group: "cardio", aliases: ["swim"] },
  { id: "cardio.jump_rope", name: "跳绳", kind: "cardio", group: "cardio", aliases: ["rope"] },
  { id: "cardio.elliptical", name: "椭圆机", kind: "cardio", group: "cardio", aliases: ["elliptical"] },
  { id: "cardio.rower", name: "划船机", kind: "cardio", group: "cardio", aliases: ["rower"] },
  { id: "cardio.stair", name: "爬楼机", kind: "cardio", group: "cardio", aliases: ["登阶"] },
  { id: "cardio.ball", name: "球类运动", kind: "cardio", group: "cardio", aliases: ["羽毛球", "篮球", "足球", "网球"] },
] as const;

export interface FoodLibraryChoice {
  id: string;
  name: string;
  servingLabel: string;
  servingGrams: number;
  per100g: { kcal: number; protein: number; carbohydrate: number; fat: number };
  aliases: readonly string[];
}

/**
 * Fast, local staples for MVP entry. This is intentionally a small library,
 * not an asserted comprehensive food database: anything not found can be
 * sent to the estimate-and-confirm workflow instead of being fabricated.
 */
export const DAILY_FOOD_LIBRARY: readonly FoodLibraryChoice[] = [
  { id: "food.rice", name: "米饭", servingLabel: "一小碗", servingGrams: 150, per100g: { kcal: 116, protein: 2.6, carbohydrate: 25.9, fat: 0.3 }, aliases: ["白米饭", "饭"] },
  { id: "food.oats", name: "燕麦", servingLabel: "一份", servingGrams: 50, per100g: { kcal: 367, protein: 15.0, carbohydrate: 61.0, fat: 6.7 }, aliases: ["燕麦片"] },
  { id: "food.sweet_potato", name: "红薯", servingLabel: "一个", servingGrams: 200, per100g: { kcal: 86, protein: 1.6, carbohydrate: 20.1, fat: 0.1 }, aliases: ["地瓜"] },
  { id: "food.chicken_breast", name: "鸡胸肉", servingLabel: "一掌", servingGrams: 120, per100g: { kcal: 165, protein: 31.0, carbohydrate: 0, fat: 3.6 }, aliases: ["鸡胸"] },
  { id: "food.beef", name: "瘦牛肉", servingLabel: "一掌", servingGrams: 120, per100g: { kcal: 172, protein: 26.0, carbohydrate: 0, fat: 6.5 }, aliases: ["牛肉"] },
  { id: "food.egg", name: "鸡蛋", servingLabel: "一个", servingGrams: 50, per100g: { kcal: 143, protein: 12.6, carbohydrate: 1.1, fat: 9.5 }, aliases: ["水煮蛋"] },
  { id: "food.tofu", name: "豆腐", servingLabel: "半盒", servingGrams: 150, per100g: { kcal: 76, protein: 8.1, carbohydrate: 1.9, fat: 4.2 }, aliases: ["嫩豆腐", "北豆腐"] },
  { id: "food.salmon", name: "三文鱼", servingLabel: "一掌", servingGrams: 120, per100g: { kcal: 208, protein: 20.0, carbohydrate: 0, fat: 13.0 }, aliases: ["鲑鱼"] },
  { id: "food.yogurt", name: "无糖酸奶", servingLabel: "一杯", servingGrams: 200, per100g: { kcal: 63, protein: 5.0, carbohydrate: 7.0, fat: 2.0 }, aliases: ["希腊酸奶", "酸奶"] },
  { id: "food.whey", name: "乳清蛋白", servingLabel: "一勺", servingGrams: 30, per100g: { kcal: 400, protein: 80.0, carbohydrate: 8.0, fat: 6.0 }, aliases: ["蛋白粉"] },
  { id: "food.banana", name: "香蕉", servingLabel: "一根", servingGrams: 120, per100g: { kcal: 89, protein: 1.1, carbohydrate: 22.8, fat: 0.3 }, aliases: [] },
  { id: "food.apple", name: "苹果", servingLabel: "一个", servingGrams: 180, per100g: { kcal: 52, protein: 0.3, carbohydrate: 13.8, fat: 0.2 }, aliases: [] },
  { id: "food.broccoli", name: "西兰花", servingLabel: "一份", servingGrams: 150, per100g: { kcal: 34, protein: 2.8, carbohydrate: 6.6, fat: 0.4 }, aliases: ["花椰菜"] },
  { id: "food.milk", name: "牛奶", servingLabel: "一杯", servingGrams: 250, per100g: { kcal: 61, protein: 3.2, carbohydrate: 4.8, fat: 3.3 }, aliases: [] },
] as const;

export function MovementLibraryPicker({ onSelect, onCustom, onAskCoach }: { onSelect(choice: DailyMovementChoice): void; onCustom?(input: { name: string; kind: DailyMovementKind }): void; onAskCoach?(input: { name: string; kind: DailyMovementKind }): void }) {
  const [group, setGroup] = useState<DailyMovementGroup | "all">("all");
  const [query, setQuery] = useState("");
  const choices = useMemo(() => filterByQuery(DAILY_MOVEMENT_LIBRARY, group, query), [group, query]);
  return <View style={styles.library}>
    <View style={styles.libraryHeading}><Text style={styles.libraryTitle}>选择运动</Text><Text style={styles.libraryMeta}>{choices.length} 项</Text></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} keyboardShouldPersistTaps="handled">
      {DAILY_MOVEMENT_GROUPS.map((option) => <LibraryFilter key={option.id} label={option.label} selected={option.id === group} onPress={() => setGroup(option.id)} />)}
    </ScrollView>
    <TextInput accessibilityLabel="搜索运动" value={query} onChangeText={setQuery} placeholder="搜索动作或运动" placeholderTextColor={uiColors.inkFaint} style={styles.search} />
    <View style={styles.choiceGrid}>{choices.map((choice) => <Pressable key={choice.id} accessibilityRole="button" onPress={() => onSelect(choice)} style={({ pressed }) => [styles.choice, pressed && styles.pressed]}><Text numberOfLines={1} style={styles.choiceName}>{choice.name}</Text><Text style={styles.choiceMeta}>{choice.kind === "cardio" ? "有氧" : groupLabel(choice.group)}</Text></Pressable>)}</View>
    {query.trim() && (onCustom || onAskCoach) ? <View style={styles.customChoice}>
      <View style={styles.customChoiceCopy}><Text style={styles.customChoiceText}>没有找到「{query.trim()}」</Text><Text style={styles.customChoiceMeta}>{group === "cardio" ? "有氧" : "力量"}</Text></View>
      <View style={styles.customChoiceActions}>
        {onCustom ? <Pressable accessibilityRole="button" onPress={() => onCustom({ name: query.trim(), kind: group === "cardio" ? "cardio" : "strength" })} style={({ pressed }) => [styles.customAction, pressed && styles.pressed]}><Text style={styles.customActionText}>直接添加</Text></Pressable> : null}
        {onAskCoach ? <Pressable accessibilityRole="button" onPress={() => onAskCoach({ name: query.trim(), kind: group === "cardio" ? "cardio" : "strength" })} style={({ pressed }) => [styles.customCoachAction, pressed && styles.pressed]}><Text style={styles.customCoachActionText}>交给 Coach</Text></Pressable> : null}
      </View>
    </View> : null}
  </View>;
}

export function FoodLibraryPicker({ onSelect }: { onSelect(choice: FoodLibraryChoice): void }) {
  const [query, setQuery] = useState("");
  const choices = useMemo(() => filterByQuery(DAILY_FOOD_LIBRARY, "all", query), [query]);
  return <View style={styles.library}>
    <View style={styles.libraryHeading}><Text style={styles.libraryTitle}>食物库</Text><Text style={styles.libraryMeta}>常用食物</Text></View>
    <TextInput accessibilityLabel="搜索食物" value={query} onChangeText={setQuery} placeholder="搜索食物" placeholderTextColor={uiColors.inkFaint} style={styles.search} />
    <View style={styles.choiceGrid}>{choices.map((choice) => <Pressable key={choice.id} accessibilityRole="button" onPress={() => onSelect(choice)} style={({ pressed }) => [styles.choice, pressed && styles.pressed]}><Text numberOfLines={1} style={styles.choiceName}>{choice.name}</Text><Text numberOfLines={1} style={styles.choiceMeta}>{choice.servingLabel} · {choice.servingGrams} g</Text></Pressable>)}</View>
  </View>;
}

function LibraryFilter({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.filter, selected && styles.filterSelected, pressed && styles.pressed]}><Text style={[styles.filterText, selected && styles.filterTextSelected]}>{label}</Text></Pressable>;
}

function filterByQuery<T extends { name: string; aliases: readonly string[]; group?: DailyMovementGroup }>(items: readonly T[], group: DailyMovementGroup | "all", query: string): T[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => (group === "all" || item.group === group) && (!needle || [item.name, ...item.aliases].some((value) => value.toLowerCase().includes(needle))));
}

function groupLabel(group: DailyMovementGroup): string {
  return DAILY_MOVEMENT_GROUPS.find((item) => item.id === group)?.label ?? "力量";
}

const styles = StyleSheet.create({
  library: { gap: 10, padding: uiSpace.compact, borderRadius: uiRadius.medium, backgroundColor: "#ECE9E1" },
  libraryHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  libraryTitle: { color: uiColors.ink, fontFamily: uiType.body, fontSize: 14, fontWeight: "900" },
  libraryMeta: { color: uiColors.inkFaint, fontFamily: uiType.body, fontSize: 11, fontWeight: "800" },
  filterRow: { gap: 7, paddingRight: 8 },
  filter: { minHeight: 32, paddingHorizontal: 11, justifyContent: "center", borderRadius: uiRadius.pill, backgroundColor: "#DFDDD6" },
  filterSelected: { backgroundColor: uiColors.ink },
  filterText: { color: uiColors.inkMuted, fontFamily: uiType.body, fontSize: 11, fontWeight: "800" },
  filterTextSelected: { color: uiColors.white },
  search: { minHeight: 42, paddingHorizontal: 12, borderRadius: uiRadius.small, backgroundColor: uiColors.paper, color: uiColors.ink, fontFamily: uiType.body, fontSize: 13, fontWeight: "700" },
  choiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  choice: { width: "48.8%", minHeight: 57, justifyContent: "center", paddingHorizontal: 11, borderRadius: uiRadius.small, backgroundColor: uiColors.paper },
  choiceName: { color: uiColors.ink, fontFamily: uiType.body, fontSize: 13, fontWeight: "900" },
  choiceMeta: { marginTop: 3, color: uiColors.inkFaint, fontFamily: uiType.body, fontSize: 10, fontWeight: "700" },
  customChoice: { minHeight: 62, padding: 10, flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "space-between", borderRadius: uiRadius.small, borderWidth: 1, borderColor: uiColors.line, borderStyle: "dashed", backgroundColor: uiColors.paper },
  customChoiceCopy: { flex: 1, minWidth: 0 },
  customChoiceActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  customAction: { minHeight: 31, paddingHorizontal: 9, alignItems: "center", justifyContent: "center", borderRadius: uiRadius.pill, backgroundColor: "#E8E5DC" },
  customActionText: { color: uiColors.ink, fontFamily: uiType.body, fontSize: 10, fontWeight: "900" },
  customCoachAction: { minHeight: 31, paddingHorizontal: 9, alignItems: "center", justifyContent: "center", borderRadius: uiRadius.pill, backgroundColor: uiColors.ink },
  customCoachActionText: { color: uiColors.white, fontFamily: uiType.body, fontSize: 10, fontWeight: "900" },
  customChoiceText: { color: uiColors.ink, fontFamily: uiType.body, fontSize: 12, fontWeight: "900" },
  customChoiceMeta: { color: uiColors.inkFaint, fontFamily: uiType.body, fontSize: 11, fontWeight: "800" },
  pressed: { opacity: 0.74, transform: [{ scale: 0.985 }] },
});
