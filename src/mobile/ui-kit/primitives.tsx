import React, { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { uiColors, uiRadius, uiSpace, uiType } from "./tokens";

export function PanelCard({ children, tone = "paper", style }: {
  children: ReactNode;
  tone?: "paper" | "ink" | "lime";
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, tone === "ink" && styles.cardInk, tone === "lime" && styles.cardLime, style]}>{children}</View>;
}

export function SectionHeading({ title, meta }: { title: string; meta?: string }) {
  return <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text>{meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}</View>;
}

export interface SegmentOption<T extends string> {
  id: T;
  label: string;
  meta?: string;
}

export function SegmentedControl<T extends string>({ value, options, onChange, compact = false }: {
  value: T;
  options: readonly SegmentOption<T>[];
  onChange(value: T): void;
  compact?: boolean;
}) {
  const activeIndex = Math.max(0, options.findIndex((option) => option.id === value));
  const progress = useRef(new Animated.Value(activeIndex)).current;
  const [width, setWidth] = useState(0);
  const padding = compact ? 4 : 5;
  const gap = 5;
  const itemWidth = width > 0 ? (width - padding * 2 - gap * Math.max(0, options.length - 1)) / Math.max(1, options.length) : 0;

  useEffect(() => {
    Animated.spring(progress, {
      toValue: activeIndex,
      damping: 22,
      stiffness: 280,
      mass: 0.78,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, progress]);

  return <View accessibilityRole="tablist" onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={[styles.segments, compact && styles.segmentsCompact]}>
    {itemWidth > 0 ? <Animated.View pointerEvents="none" style={[
      styles.segmentThumb,
      compact && styles.segmentThumbCompact,
      {
        left: padding,
        width: itemWidth,
        transform: [{ translateX: Animated.multiply(progress, itemWidth + gap) }],
      },
    ]} /> : null}
    {options.map((option) => {
    const selected = option.id === value;
    return <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      key={option.id}
      onPress={() => onChange(option.id)}
      style={({ pressed }) => [styles.segment, compact && styles.segmentCompact, pressed && styles.pressed]}
    >
      <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{option.label}</Text>
      {option.meta ? <Text style={[styles.segmentMeta, selected && styles.segmentMetaSelected]}>{option.meta}</Text> : null}
    </Pressable>;
  })}</View>;
}

export function InlineAction({ label, onPress, tone = "quiet", accessibilityLabel }: {
  label: string;
  onPress(): void;
  tone?: "quiet" | "ink" | "lime";
  accessibilityLabel?: string;
}) {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    onPress={onPress}
    style={({ pressed }) => [styles.action, tone === "ink" && styles.actionInk, tone === "lime" && styles.actionLime, pressed && styles.pressed]}
  ><Text style={[styles.actionText, tone === "ink" && styles.actionTextInk]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: uiRadius.large,
    padding: uiSpace.card,
    backgroundColor: uiColors.paper,
    borderWidth: 1,
    borderColor: "rgba(17, 20, 17, 0.045)",
  },
  cardInk: { backgroundColor: uiColors.ink, borderColor: uiColors.ink },
  cardLime: { backgroundColor: uiColors.lime, borderColor: uiColors.lime },
  sectionHeading: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginTop: 4 },
  sectionTitle: { color: uiColors.ink, fontFamily: uiType.display, fontSize: 22, fontWeight: "900", letterSpacing: -0.3 },
  sectionMeta: { color: uiColors.inkMuted, fontFamily: uiType.body, fontSize: 12 },
  segments: { position: "relative", flexDirection: "row", gap: 5, padding: 5, borderRadius: 20, backgroundColor: "#E9E6DD", overflow: "hidden" },
  segmentsCompact: { borderRadius: 17, padding: 4 },
  segmentThumb: { position: "absolute", top: 5, bottom: 5, borderRadius: 16, backgroundColor: uiColors.ink },
  segmentThumbCompact: { top: 4, bottom: 4, borderRadius: 13 },
  segment: { flex: 1, minHeight: 52, paddingHorizontal: 8, paddingVertical: 8, alignItems: "center", justifyContent: "center", borderRadius: 16 },
  segmentCompact: { minHeight: 36, paddingVertical: 5, borderRadius: 13 },
  segmentLabel: { color: uiColors.inkMuted, fontFamily: uiType.body, fontSize: 13, fontWeight: "800" },
  segmentLabelSelected: { color: uiColors.white },
  segmentMeta: { marginTop: 2, color: uiColors.inkFaint, fontFamily: uiType.mono, fontSize: 9 },
  segmentMetaSelected: { color: uiColors.lime },
  action: { minHeight: 38, paddingHorizontal: 14, borderRadius: uiRadius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: uiColors.line, backgroundColor: uiColors.paper },
  actionInk: { borderColor: uiColors.ink, backgroundColor: uiColors.ink },
  actionLime: { borderColor: uiColors.lime, backgroundColor: uiColors.lime },
  actionText: { color: uiColors.ink, fontFamily: uiType.body, fontSize: 12, fontWeight: "800" },
  actionTextInk: { color: uiColors.white },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
});
