import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { mobileT } from "../../i18n";
import { uiColors, uiRadius, uiSpace, uiType } from "./tokens";

/** Searchable movement vocabulary for the manual Record drawer only. */
export type DailyMovementKind = "strength" | "cardio";
export type DailyMovementGroup = "chest" | "back" | "shoulders" | "arms" | "legs" | "core" | "cardio";

export interface DailyMovementChoice {
  id: string;
  name: string;
  kind: DailyMovementKind;
  group: DailyMovementGroup;
  aliases: readonly string[];
}

const MOVEMENTS: readonly DailyMovementChoice[] = [
  { id: "bench_press", name: "卧推", kind: "strength", group: "chest", aliases: ["杠铃卧推", "哑铃卧推", "推胸"] },
  { id: "push_up", name: "俯卧撑", kind: "strength", group: "chest", aliases: ["push up"] },
  { id: "row", name: "划船", kind: "strength", group: "back", aliases: ["杠铃划船", "坐姿划船", "哑铃划船"] },
  { id: "lat_pulldown", name: "高位下拉", kind: "strength", group: "back", aliases: ["下拉"] },
  { id: "pull_up", name: "引体向上", kind: "strength", group: "back", aliases: ["pull up"] },
  { id: "overhead_press", name: "肩上推举", kind: "strength", group: "shoulders", aliases: ["推举", "肩推"] },
  { id: "lateral_raise", name: "侧平举", kind: "strength", group: "shoulders", aliases: ["侧平"] },
  { id: "biceps_curl", name: "二头弯举", kind: "strength", group: "arms", aliases: ["弯举"] },
  { id: "triceps_extension", name: "三头伸展", kind: "strength", group: "arms", aliases: ["臂屈伸", "下压"] },
  { id: "squat", name: "深蹲", kind: "strength", group: "legs", aliases: ["杠铃深蹲", "高脚杯深蹲"] },
  { id: "leg_press", name: "腿举", kind: "strength", group: "legs", aliases: ["leg press"] },
  { id: "deadlift", name: "硬拉", kind: "strength", group: "legs", aliases: ["罗马尼亚硬拉", "RDL"] },
  { id: "hip_thrust", name: "臀推", kind: "strength", group: "legs", aliases: ["hip thrust"] },
  { id: "lunge", name: "弓步", kind: "strength", group: "legs", aliases: ["分腿蹲", "保加利亚分腿蹲"] },
  { id: "plank", name: "平板支撑", kind: "strength", group: "core", aliases: ["plank"] },
  { id: "run", name: "跑步", kind: "cardio", group: "cardio", aliases: ["慢跑", "jog", "run"] },
  { id: "walk", name: "步行 / 快走", kind: "cardio", group: "cardio", aliases: ["走路", "徒步", "walk"] },
  { id: "cycle", name: "骑行", kind: "cardio", group: "cardio", aliases: ["单车", "bike"] },
  { id: "swim", name: "游泳", kind: "cardio", group: "cardio", aliases: ["swim"] },
  { id: "jump_rope", name: "跳绳", kind: "cardio", group: "cardio", aliases: ["rope"] },
];

const GROUPS: readonly { id: DailyMovementGroup | "all"; labelKey: string }[] = [
  { id: "all", labelKey: "mobile.ui.kit.dailyrecordlibrary.778fc8f994" }, { id: "chest", labelKey: "mobile.ui.kit.dailyrecordlibrary.a6577e51aa" }, { id: "back", labelKey: "mobile.ui.kit.dailyrecordlibrary.e072ffdd2a" }, { id: "shoulders", labelKey: "mobile.ui.kit.dailyrecordlibrary.dd0ea605ea" }, { id: "arms", labelKey: "mobile.ui.kit.dailyrecordlibrary.056110f611" }, { id: "legs", labelKey: "mobile.ui.kit.dailyrecordlibrary.014bc59546" }, { id: "core", labelKey: "mobile.ui.kit.dailyrecordlibrary.10d95f2cd2" }, { id: "cardio", labelKey: "mobile.ui.kit.dailyrecordlibrary.25b132283f" },
];

export function MovementLibraryPicker({ onSelect, onCustom, onAskCoach }: { onSelect(choice: DailyMovementChoice): void; onCustom?(input: { name: string; kind: DailyMovementKind }): void; onAskCoach?(input: { name: string; kind: DailyMovementKind }): void }) {
  const [group, setGroup] = useState<DailyMovementGroup | "all">("all");
  const [query, setQuery] = useState("");
  const choices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return MOVEMENTS.filter((item) => (group === "all" || item.group === group) && (!needle || [item.name, ...item.aliases].some((text) => text.toLowerCase().includes(needle))));
  }, [group, query]);
  const customKind: DailyMovementKind = group === "cardio" ? "cardio" : "strength";
  return <View style={styles.library}>
    <View style={styles.heading}><Text style={styles.title}>{mobileT("mobile.ui.kit.dailyrecordlibrary.be8bfada50")}</Text><Text style={styles.meta}>{mobileT("mobile.record.movement.count", { count: choices.length })}</Text></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} keyboardShouldPersistTaps="handled">
      {GROUPS.map((option) => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ selected: option.id === group }} onPress={() => setGroup(option.id)} style={[styles.filter, option.id === group && styles.filterSelected]}><Text style={[styles.filterText, option.id === group && styles.filterTextSelected]}>{mobileT(option.labelKey)}</Text></Pressable>)}
    </ScrollView>
    <TextInput accessibilityLabel={mobileT("mobile.ui.kit.dailyrecordlibrary.8e3449796b")} value={query} onChangeText={setQuery} placeholder={mobileT("mobile.ui.kit.dailyrecordlibrary.d514cb74e7")} placeholderTextColor={uiColors.inkFaint} style={styles.search} />
    <View style={styles.choices}>{choices.map((choice) => <Pressable key={choice.id} accessibilityRole="button" onPress={() => onSelect(choice)} style={styles.choice}><Text numberOfLines={1} style={styles.choiceName}>{choice.name}</Text><Text style={styles.choiceMeta}>{choice.kind === "cardio" ? mobileT("mobile.ui.kit.dailyrecordlibrary.25b132283f") : mobileT(GROUPS.find((group) => group.id === choice.group)?.labelKey ?? "mobile.ui.kit.dailyrecordlibrary.778fc8f994")}</Text></Pressable>)}</View>
    {query.trim() && (onCustom || onAskCoach) ? <View style={styles.custom}><Text style={styles.customText}>{mobileT("mobile.record.movement.notFound", { query: query.trim() })}</Text>{onCustom ? <Pressable accessibilityRole="button" onPress={() => onCustom({ name: query.trim(), kind: customKind })} style={styles.customAction}><Text style={styles.customActionText}>{mobileT("mobile.ui.kit.dailyrecordlibrary.c1a0857be7")}</Text></Pressable> : null}{onAskCoach ? <Pressable accessibilityRole="button" onPress={() => onAskCoach({ name: query.trim(), kind: customKind })} style={styles.coachAction}><Text style={styles.coachActionText}>{mobileT("mobile.record.movement.askCoach")}</Text></Pressable> : null}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  library: { gap: 10, padding: uiSpace.compact, borderRadius: uiRadius.medium, backgroundColor: "#ECE9E1" }, heading: { flexDirection: "row", justifyContent: "space-between" }, title: { color: uiColors.ink, fontFamily: uiType.body, fontWeight: "900" }, meta: { color: uiColors.inkFaint, fontSize: 11 }, filters: { gap: 7 }, filter: { minHeight: 32, paddingHorizontal: 11, justifyContent: "center", borderRadius: uiRadius.pill, backgroundColor: "#DFDDD6" }, filterSelected: { backgroundColor: uiColors.ink }, filterText: { color: uiColors.inkMuted, fontSize: 11 }, filterTextSelected: { color: uiColors.white }, search: { minHeight: 42, paddingHorizontal: 12, borderRadius: uiRadius.small, backgroundColor: uiColors.paper, color: uiColors.ink }, choices: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, choice: { width: "48.8%", minHeight: 57, justifyContent: "center", paddingHorizontal: 11, borderRadius: uiRadius.small, backgroundColor: uiColors.paper }, choiceName: { color: uiColors.ink, fontWeight: "900" }, choiceMeta: { marginTop: 3, color: uiColors.inkFaint, fontSize: 10 }, custom: { minHeight: 48, alignItems: "center", flexDirection: "row", gap: 8 }, customText: { flex: 1, color: uiColors.inkMuted, fontSize: 12 }, customAction: { paddingHorizontal: 9, paddingVertical: 7, borderRadius: uiRadius.pill, backgroundColor: "#E8E5DC" }, customActionText: { color: uiColors.ink, fontSize: 11, fontWeight: "800" }, coachAction: { paddingHorizontal: 9, paddingVertical: 7, borderRadius: uiRadius.pill, backgroundColor: uiColors.ink }, coachActionText: { color: uiColors.white, fontSize: 11, fontWeight: "800" },
});
