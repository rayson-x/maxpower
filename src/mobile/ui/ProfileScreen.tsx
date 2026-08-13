import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { colors } from "./theme";

/** 我的页：引擎与存储说明（纯本地，无账号体系）。 */
export function ProfileScreen() {
  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.brand}>我<Text style={styles.accent}>的</Text></Text>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>识别引擎</Text>
          <View style={styles.kv}><Text style={styles.k}>姿态模型</Text><Text style={styles.v}>MediaPipe lite · GPU 优先</Text></View>
          <View style={styles.kv}><Text style={styles.k}>计数权威</Text><Text style={styles.v}>Rust motion-sdk · 8 profiles（均 provisional）</Text></View>
          <View style={styles.kv}><Text style={styles.k}>能力层级</Text><Text style={styles.v}>可计数 6 动作 · 模拟 59 动作</Text></View>
          <View style={[styles.kv, styles.kvLast]}><Text style={styles.k}>目标帧率</Text><Text style={styles.v}>24 fps（底线 15）</Text></View>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>数据与隐私</Text>
          <View style={styles.kv}><Text style={styles.k}>识别计算</Text><Text style={styles.v}>全部在本机完成</Text></View>
          <View style={styles.kv}><Text style={styles.k}>上传</Text><Text style={styles.v}>零上传 · 无 LLM</Text></View>
          <View style={[styles.kv, styles.kvLast]}><Text style={styles.k}>素材位置</Text><Text style={styles.v}>本机 captures/（可导出）</Text></View>
        </View>
        <Text style={styles.foot}>MaxPower · Android MVP v1</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: 24, paddingTop: 8 },
  brand: { fontSize: 30, fontWeight: "900", color: colors.ink, letterSpacing: 2 },
  accent: { color: colors.limeDeep },
  list: { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 24 },
  card: { backgroundColor: colors.white, borderRadius: 18, padding: 16, marginBottom: 14 },
  cardTitle: { fontSize: 12, fontWeight: "900", color: colors.ink2, letterSpacing: 1, marginBottom: 8 },
  kv: {
    flexDirection: "row", justifyContent: "space-between", paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  kvLast: { borderBottomWidth: 0 },
  k: { fontSize: 13, color: colors.ink2 },
  v: { fontSize: 13, fontWeight: "700", color: colors.ink },
  foot: { textAlign: "center", fontSize: 11, color: colors.ink3, marginTop: 12, fontFamily: "monospace" },
});
