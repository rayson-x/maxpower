import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import type { FocusSurfaceAnchor } from "./FocusSurface";
import { uiColors, uiType } from "./tokens";
import { mobileT } from "../../i18n";


export interface DockDestination<T extends string> {
  id: T;
  label: string;
  glyph: string;
}

/** Window-relative bounds of the closed Coach entry, used for the shared-container transition. */
export type CoachComposerAnchor = FocusSurfaceAnchor;

export const APP_DOCK_BODY_HEIGHT = 116;

export function AppDock<T extends string>({ current, destinations, onNavigate, onRecord, onCoach, onCoachAnchorChange, onRecordAnchorChange, coachExpanded = false, coachBusy = false }: {
  current: T;
  destinations: readonly DockDestination<T>[];
  onNavigate(destination: T): void;
  onRecord(): void;
  onCoach(): void;
  onCoachAnchorChange?(anchor: CoachComposerAnchor): void;
  /** Bounds of the plus button, used by the record Focus transition. */
  onRecordAnchorChange?(anchor: CoachComposerAnchor): void;
  /** While Coach owns the surface, the dock visually yields to its expanding container. */
  coachExpanded?: boolean;
  coachBusy?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const initialIndex = Math.max(0, destinations.findIndex((item) => item.id === current));
  const initialSlot = initialIndex >= 2 ? initialIndex + 1 : initialIndex;
  const [visualCurrent, setVisualCurrent] = useState(current);
  const indicatorTargetSlot = useRef(initialSlot);
  const indicatorProgress = useSharedValue(initialSlot);
  const dockVisibility = useSharedValue(coachExpanded ? 0 : 1);
  const composerRef = useRef<View>(null);
  const recordRef = useRef<View>(null);
  const [navigationWidth, setNavigationWidth] = useState(0);

  const destinationSlot = useCallback((destination: T) => {
    const index = Math.max(0, destinations.findIndex((item) => item.id === destination));
    return index >= 2 ? index + 1 : index;
  }, [destinations]);

  const moveIndicator = useCallback((destination: T) => {
    const nextSlot = destinationSlot(destination);
    if (indicatorTargetSlot.current === nextSlot) return;
    indicatorTargetSlot.current = nextSlot;
    indicatorProgress.value = withSpring(nextSlot, {
      damping: 23,
      stiffness: 340,
      mass: 0.7,
    });
  }, [destinationSlot, indicatorProgress]);

  useEffect(() => {
    // Covers swipes, deep links, and any navigation initiated outside the dock.
    setVisualCurrent((previous) => previous === current ? previous : current);
    moveIndicator(current);
  }, [current, moveIndicator]);

  useEffect(() => {
    dockVisibility.value = withTiming(coachExpanded ? 0 : 1, {
      duration: coachExpanded ? 150 : 180,
      easing: coachExpanded ? Easing.out(Easing.quad) : Easing.out(Easing.cubic),
    });
  }, [coachExpanded, dockVisibility]);

  const dockAnimatedStyle = useAnimatedStyle(() => ({
    opacity: dockVisibility.value,
    transform: [{ translateY: interpolate(dockVisibility.value, [0, 1], [18, 0]) }],
  }));
  const indicatorAnimatedStyle = useAnimatedStyle(() => {
    const slotWidth = navigationWidth / (destinations.length + 1);
    return { transform: [{ translateX: indicatorProgress.value * slotWidth }] };
  }, [destinations.length, navigationWidth]);

  const reportComposerAnchor = useCallback(() => {
    requestAnimationFrame(() => composerRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) onCoachAnchorChange?.({ x, y, width, height });
    }));
  }, [onCoachAnchorChange]);

  const reportRecordAnchor = useCallback(() => {
    requestAnimationFrame(() => recordRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) onRecordAnchorChange?.({ x, y, width, height });
    }));
  }, [onRecordAnchorChange]);

  const renderDestination = (item: DockDestination<T>) => {
    const selected = item.id === visualCurrent;
    return <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => {
      // The pager starts its native transition synchronously. Start the dock
      // transition in that same press instead of waiting for the route render.
      setVisualCurrent(item.id);
      moveIndicator(item.id);
      onNavigate(item.id);
    }} style={({ pressed }) => [styles.destination, pressed && styles.destinationPressed]}>
      <Text style={[styles.destinationGlyph, selected && styles.destinationOn]}>{item.glyph}</Text>
      <Text style={[styles.destinationLabel, selected && styles.destinationOn]}>{item.label}</Text>
    </Pressable>;
  };

  return <Animated.View style={[styles.dockLayer, { pointerEvents: coachExpanded ? "none" : "auto" }, dockAnimatedStyle]}>
    <SafeAreaView edges={["bottom"]} style={styles.safe}>
      <View ref={composerRef} onLayout={reportComposerAnchor} style={styles.coachComposer}>
        <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.kit.appdock.5ea26c13e6")} onPress={onCoach} style={({ pressed }) => [styles.coachEntry, pressed && styles.coachEntryPressed]}>
          <View style={[styles.coachDot, coachBusy && styles.coachDotBusy]} />
          <Text numberOfLines={1} style={styles.coachEntryText}>{coachBusy ? mobileT("mobile.ui.kit.appdock.e503f5e380") : mobileT("mobile.ui.kit.appdock.5ea26c13e6")}</Text>
        </Pressable>
      </View>
      <View accessibilityRole="tablist" onLayout={(event) => setNavigationWidth(event.nativeEvent.layout.width)} style={styles.navigation}>
        {navigationWidth > 0 ? <Animated.View style={[styles.destinationIndicator, { width: navigationWidth / (destinations.length + 1), pointerEvents: "none" }, indicatorAnimatedStyle]}>
          <View style={styles.destinationIndicatorHalo} />
          <View style={styles.destinationIndicatorSurface}><View style={styles.destinationIndicatorHighlight} /></View>
        </Animated.View> : null}
        {destinations.slice(0, 2).map(renderDestination)}
        <View ref={recordRef} onLayout={reportRecordAnchor} style={styles.recordSlot}>
          <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.kit.appdock.9058a1c2c5")} onPress={onRecord} style={({ pressed }) => [styles.recordButton, pressed && styles.recordSlotPressed]}>
            <Text style={styles.recordGlyph}>＋</Text>
          </Pressable>
        </View>
        {destinations.slice(2).map(renderDestination)}
      </View>
    </SafeAreaView>
  </Animated.View>;
}

const styles = StyleSheet.create({
  dockLayer: { position: "absolute", right: 0, bottom: 0, left: 0, zIndex: 50, elevation: 24 },
  safe: {
    paddingTop: 7,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255, 254, 250, 0.97)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: uiColors.line,
  },
  coachComposer: {
    height: 49,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 15,
    paddingRight: 5,
    borderWidth: 1,
    borderColor: uiColors.lineStrong,
    borderRadius: 18,
    backgroundColor: uiColors.white,
  },
  coachEntry: { flex: 1, minWidth: 0, height: 47, flexDirection: "row", alignItems: "center", gap: 10, outlineWidth: 0, outlineColor: "transparent" },
  coachEntryPressed: { opacity: 0.65 },
  coachDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: uiColors.limeDeep },
  coachDotBusy: { backgroundColor: uiColors.amber },
  coachEntryText: {
    color: uiColors.inkMuted,
    fontFamily: uiType.body,
    fontSize: 14,
    fontWeight: "700",
  },
  navigation: { position: "relative", height: 60, flexDirection: "row", alignItems: "center" },
  destinationIndicator: { position: "absolute", top: 4, left: 0, height: 52, alignItems: "center", justifyContent: "center" },
  destinationIndicatorHalo: { position: "absolute", top: 4, width: 58, height: 48, borderRadius: 19, backgroundColor: "rgba(17,20,17,0.07)" },
  destinationIndicatorSurface: { width: 56, height: 48, overflow: "hidden", borderRadius: 18, borderWidth: 1, borderColor: "rgba(255,255,255,0.96)", backgroundColor: "rgba(246,248,244,0.94)" },
  destinationIndicatorHighlight: { position: "absolute", top: 3, left: 9, right: 9, height: 9, borderRadius: 7, backgroundColor: "rgba(255,255,255,0.72)" },
  destination: { zIndex: 1, flex: 1, height: 56, alignItems: "center", justifyContent: "center", gap: 2, outlineWidth: 0, outlineColor: "transparent" },
  destinationGlyph: { color: uiColors.inkFaint, fontFamily: uiType.mono, fontSize: 14, fontWeight: "800" },
  destinationLabel: { color: uiColors.inkFaint, fontFamily: uiType.body, fontSize: 10, fontWeight: "700" },
  destinationOn: { color: uiColors.ink },
  destinationPressed: { opacity: 0.55 },
  recordSlot: { flex: 1, height: 60, alignItems: "center", justifyContent: "center" },
  recordSlotPressed: { transform: [{ scale: 0.92 }] },
  recordButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: uiColors.ink,
    shadowColor: uiColors.ink,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
    outlineWidth: 0,
    outlineColor: "transparent",
  },
  recordGlyph: { marginTop: -2, color: uiColors.lime, fontSize: 29, lineHeight: 31, fontWeight: "500" },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
});
