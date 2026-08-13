import React, { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { uiColors, uiRadius } from "./tokens";

/**
 * Window-relative bounds for a small control that expands into a focused task.
 * The source is deliberately presentation-only: it keeps navigation concerns
 * out of Coach and Record while allowing both to share one transition grammar.
 */
export interface FocusSurfaceAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function FocusSurface({
  visible,
  anchor,
  bottomInset = 6,
  horizontalInset = 8,
  accessibilityLabel,
  onDismiss,
  children,
  surfaceStyle,
}: {
  visible: boolean;
  anchor?: FocusSurfaceAnchor;
  /** Space reserved for the keyboard or a system inset below the focus surface. */
  bottomInset?: number;
  horizontalInset?: number;
  accessibilityLabel: string;
  onDismiss(): void;
  children: ReactNode;
  surfaceStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(visible ? 1 : 0);
  const sourceCenterX = useSharedValue(window.width / 2);
  const sourceCenterY = useSharedValue(window.height * 0.82);
  const sourceScaleX = useSharedValue(1);
  const sourceScaleY = useSharedValue(1);
  const dismissProgress = useSharedValue(0);

  const frame = useMemo(() => {
    const top = Math.max(8, insets.top + 6);
    const bottom = Math.max(6, bottomInset);
    const width = Math.max(1, window.width - horizontalInset * 2);
    const height = Math.max(1, window.height - top - bottom);
    return { top, bottom, width, height, centerX: horizontalInset + width / 2, centerY: top + height / 2 };
  }, [bottomInset, horizontalInset, insets.top, window.height, window.width]);

  useEffect(() => {
    const fallback: FocusSurfaceAnchor = {
      x: 20,
      y: Math.max(frame.top + 60, window.height - insets.bottom - 132),
      width: Math.max(1, window.width - 40),
      height: 49,
    };
    const source = anchor && anchor.width > 0 && anchor.height > 0 ? anchor : fallback;
    sourceCenterX.value = source.x + source.width / 2;
    sourceCenterY.value = source.y + source.height / 2;
    sourceScaleX.value = Math.max(0.04, source.width / frame.width);
    sourceScaleY.value = Math.max(0.04, source.height / frame.height);
  }, [anchor, frame, insets.bottom, sourceCenterX, sourceCenterY, sourceScaleX, sourceScaleY, window.height, window.width]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      dismissProgress.value = 0;
      progress.value = 0;
      const animationFrame = requestAnimationFrame(() => {
        progress.value = withTiming(1, { duration: 260, easing: Easing.bezier(0.16, 1, 0.3, 1) });
      });
      return () => cancelAnimationFrame(animationFrame);
    }

    progress.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
    return undefined;
  }, [dismissProgress, progress, visible]);

  const requestDismiss = useCallback(() => onDismiss(), [onDismiss]);

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetY(12)
    .failOffsetX([-24, 24])
    .onBegin(() => {
      dismissProgress.value = 0;
    })
    .onUpdate((event) => {
      dismissProgress.value = Math.max(0, event.translationY / 240);
    })
    .onFinalize((event) => {
      const shouldDismiss = event.translationY > 86 || event.velocityY > 820;
      if (shouldDismiss) {
        runOnJS(requestDismiss)();
        return;
      }
      dismissProgress.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic) });
    }), [dismissProgress]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP) }));
  const surfaceAnimatedStyle = useAnimatedStyle(() => {
    const drag = dismissProgress.value;
    const transition = progress.value;
    const translateX = interpolate(transition, [0, 1], [sourceCenterX.value - frame.centerX, 0], Extrapolation.CLAMP);
    const translateY = interpolate(transition, [0, 1], [sourceCenterY.value - frame.centerY, 0], Extrapolation.CLAMP) + drag * 96;
    const scaleX = interpolate(transition, [0, 1], [sourceScaleX.value, 1], Extrapolation.CLAMP);
    const scaleY = interpolate(transition, [0, 1], [sourceScaleY.value, 1], Extrapolation.CLAMP);
    return {
      opacity: interpolate(transition, [0, 0.08, 1], [0, 1, 1], Extrapolation.CLAMP),
      transform: [{ translateX }, { translateY }, { scaleX }, { scaleY }],
    };
  }, [frame.centerX, frame.centerY]);
  const contentAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.18, 0.58, 1], [0, 0, 0.92, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [12, 0], Extrapolation.CLAMP) }],
  }));

  if (!mounted) return null;

  return <View accessibilityViewIsModal style={styles.layer}>
    <Animated.View style={[styles.scrim, scrimStyle]} />
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={requestDismiss} style={StyleSheet.absoluteFill} />
    <Animated.View style={[styles.surface, { top: frame.top, bottom: frame.bottom, left: horizontalInset, width: frame.width }, surfaceStyle, surfaceAnimatedStyle]}>
      <Animated.View style={[styles.content, contentAnimatedStyle]}>
        <GestureDetector gesture={pan}>
          <View accessibilityRole="adjustable" accessibilityLabel="下滑收起" style={styles.handleTarget}>
            <View style={styles.handle} />
          </View>
        </GestureDetector>
        {children}
      </Animated.View>
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 90, elevation: 42 },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: uiColors.scrim, pointerEvents: "none" },
  surface: {
    position: "absolute",
    overflow: "hidden",
    borderRadius: uiRadius.drawer,
    backgroundColor: uiColors.canvas,
    shadowColor: uiColors.ink,
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 26,
  },
  content: { flex: 1, minHeight: 0 },
  handleTarget: { height: 30, alignItems: "center", justifyContent: "center" },
  handle: { width: 42, height: 5, borderRadius: 3, backgroundColor: uiColors.lineStrong },
});
