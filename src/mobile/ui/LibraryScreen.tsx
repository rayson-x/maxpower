import React, { useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  buildLibrary,
  countByRecognitionAvailability,
  filterLibrary,
  type RecognitionFilter,
} from "../libraryModel";
import { colors } from "./theme";

/** 动作库首页：65 个动作全量可选，按本机是否有可执行 profile 分层。 */
export function LibraryScreen(props: {
  onSelect: (exerciseId: string) => void;
  onOpenProgress: () => void;
  onOpenProfile: () => void;
}) {
  const [query, setQuery] = useState("");
  const [recognition, setRecognition] = useState<RecognitionFilter>("all");
  const groups = useMemo(() => buildLibrary(), []);
  const counts = useMemo(() => countByRecognitionAvailability(), []);
  const visible = useMemo(
    () => filterLibrary(groups, query, recognition),
    [groups, query, recognition],
  );

  const filters: Array<{ id: RecognitionFilter; label: string }> = [
    { id: "all", label: "全部" },
    { id: "available", label: `可识别 · ${counts.available}` },
    { id: "unavailable", label: `无 profile · ${counts.unavailable}` },
  ];

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.brand}>
          动作<Text style={styles.brandAccent}>库</Text>
        </Text>
      </View>
      <View style={styles.search}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="搜索 65 个动作…"
          placeholderTextColor={colors.ink3}
          value={query}
          onChangeText={setQuery}
        />
      </View>
      <View style={styles.seg}>
        {filters.map((filter) => (
          <TouchableOpacity
            key={filter.id}
            style={[styles.segItem, recognition === filter.id && styles.segItemOn]}
            onPress={() => setRecognition(filter.id)}
          >
            <Text style={[styles.segText, recognition === filter.id && styles.segTextOn]}>
              {filter.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {visible.map((group) => (
          <View key={group.id}>
            <View style={styles.groupTitle}>
              <Text style={styles.groupLabel}>{group.label}</Text>
              <View style={styles.groupLine} />
              <Text style={styles.groupCount}>{group.rows.length}</Text>
            </View>
            {group.rows.map((row) => (
              <TouchableOpacity
                key={row.exercise.id}
                style={styles.row}
                onPress={() => props.onSelect(row.exercise.id)}
              >
                <View style={styles.rowIcon}>
                  <Text style={styles.rowEmoji}>🏋️</Text>
                  {row.recognition === "available" && <View style={styles.calibDot} />}
                </View>
                <View style={styles.rowInfo}>
                  <View style={styles.rowNameLine}>
                    <Text style={styles.rowName}>{row.exercise.nameZh}</Text>
                    {row.recognition === "available" ? (
                      <View style={[styles.chip, styles.chipLime]}>
                        <Text style={styles.chipLimeText}>可计数</Text>
                      </View>
                    ) : (
                      <View style={[styles.chip, styles.chipOut]}>
                        <Text style={styles.chipOutText}>无 profile</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.rowMeta}>
                    {row.exercise.equipment.join(" / ")}
                    {row.recognition === "available" ? " · Rust profile" : " · 仅录制"}
                  </Text>
                </View>
                {row.capturePositionLabel && (
                  <View style={styles.camTag}>
                    <Text style={styles.camTagText}>{row.capturePositionLabel}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>
      <View style={styles.tabbar}>
        <View style={styles.tab}>
          <View style={[styles.tabDot, styles.tabDotOn]}>
            <Text>🏋️</Text>
          </View>
          <Text style={styles.tabTextOn}>动作</Text>
        </View>
        <TouchableOpacity style={styles.tab} onPress={props.onOpenProgress}>
          <View style={styles.tabDot}><Text>📈</Text></View>
          <Text style={styles.tabText}>进展</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tab} onPress={props.onOpenProfile}>
          <View style={styles.tabDot}><Text>⚙️</Text></View>
          <Text style={styles.tabText}>我的</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: 24, paddingTop: 8 },
  brand: { fontSize: 30, fontWeight: "900", color: colors.ink, letterSpacing: 2 },
  brandAccent: { color: colors.limeDeep },
  search: {
    marginHorizontal: 24,
    marginTop: 16,
    height: 44,
    backgroundColor: colors.white,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 10,
  },
  searchIcon: { fontSize: 14, color: colors.ink3 },
  searchInput: { flex: 1, fontSize: 14, color: colors.ink, padding: 0 },
  seg: {
    flexDirection: "row",
    marginHorizontal: 24,
    marginTop: 14,
    backgroundColor: colors.paper2,
    borderRadius: 12,
    padding: 4,
  },
  segItem: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  segItemOn: { backgroundColor: colors.white },
  segText: { fontSize: 12.5, fontWeight: "700", color: colors.ink2 },
  segTextOn: { color: colors.ink },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 24 },
  groupTitle: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18, marginBottom: 10 },
  groupLabel: { fontSize: 13, fontWeight: "900", color: colors.ink2 },
  groupLine: { flex: 1, height: 1, backgroundColor: colors.line },
  groupCount: { fontSize: 10, color: colors.ink3, fontFamily: "monospace" },
  row: {
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    marginBottom: 8,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: colors.paper2,
    alignItems: "center",
    justifyContent: "center",
  },
  rowEmoji: { fontSize: 20 },
  calibDot: {
    position: "absolute",
    right: -2,
    top: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.lime,
    borderWidth: 2.5,
    borderColor: colors.white,
  },
  rowInfo: { flex: 1 },
  rowNameLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowName: { fontSize: 15, fontWeight: "700", color: colors.ink },
  rowMeta: { fontSize: 11, color: colors.ink3, marginTop: 3 },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  chipLime: { backgroundColor: colors.lime },
  chipLimeText: { fontSize: 11, fontWeight: "700", color: colors.limeInk },
  chipOut: { borderWidth: 1.5, borderColor: colors.ink3 },
  chipOutText: { fontSize: 11, fontWeight: "700", color: colors.ink2 },
  camTag: { backgroundColor: colors.paper2, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  camTagText: { fontSize: 10, color: colors.ink2 },
  tabbar: {
    height: 78,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    flexDirection: "row",
    paddingTop: 12,
  },
  tab: { flex: 1, alignItems: "center", gap: 4 },
  tabDot: { width: 22, height: 22, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  tabDotOn: { backgroundColor: colors.lime },
  tabText: { fontSize: 10, color: colors.ink3 },
  tabTextOn: { fontSize: 10, color: colors.ink, fontWeight: "700" },
});
