import React, { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Modal, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { uiColors, uiRadius, uiSpace, uiType } from "./tokens";
import { mobileT } from "../../i18n";


const AnimatedSafeAreaView = Animated.createAnimatedComponent(SafeAreaView);

export function BottomDrawer({ visible, title, subtitle, onDismiss, leadingAction, headerAction, children, tall = false }: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onDismiss(): void;
  leadingAction?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
  tall?: boolean;
}) {
  const [mounted, setMounted] = useState(visible);
  const drawerY = useRef(new Animated.Value(48)).current;
  const scrimOpacity = useRef(new Animated.Value(0)).current;
  const dismissing = useRef(false);

  const requestDismiss = useCallback(() => {
    if (dismissing.current) return;
    dismissing.current = true;
    Animated.parallel([
      Animated.timing(drawerY, {
        toValue: 420,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(scrimOpacity, {
        toValue: 0,
        duration: 155,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
      dismissing.current = false;
    });
  }, [drawerY, onDismiss, scrimOpacity]);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      dismissing.current = false;
      drawerY.setValue(48);
      scrimOpacity.setValue(0);
      const frame = requestAnimationFrame(() => {
        Animated.parallel([
          Animated.spring(drawerY, {
            toValue: 0,
            damping: 24,
            stiffness: 270,
            mass: 0.86,
            useNativeDriver: true,
          }),
          Animated.timing(scrimOpacity, {
            toValue: 1,
            duration: 180,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start();
      });
      return () => cancelAnimationFrame(frame);
    }
    Animated.parallel([
      Animated.timing(drawerY, {
        toValue: 90,
        duration: 190,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(scrimOpacity, {
        toValue: 0,
        duration: 160,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [drawerY, mounted, scrimOpacity, visible]);

  const handleResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 5 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2,
    onPanResponderGrant: () => {
      drawerY.stopAnimation();
    },
    onPanResponderMove: (_event, gesture) => {
      drawerY.setValue(Math.max(0, gesture.dy));
    },
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > 76 || gesture.vy > 0.9) {
        requestDismiss();
        return;
      }
      Animated.spring(drawerY, {
        toValue: 0,
        damping: 23,
        stiffness: 285,
        mass: 0.82,
        useNativeDriver: true,
      }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(drawerY, {
        toValue: 0,
        damping: 23,
        stiffness: 285,
        mass: 0.82,
        useNativeDriver: true,
      }).start();
    },
  }), [drawerY, requestDismiss]);

  return <Modal
    animationType="none"
    onRequestClose={requestDismiss}
    presentationStyle="overFullScreen"
    statusBarTranslucent
    transparent
    visible={mounted}
  >
    <View style={styles.root}>
      <Animated.View pointerEvents="none" style={[styles.scrim, {
        opacity: Animated.multiply(scrimOpacity, drawerY.interpolate({
          inputRange: [0, 320],
          outputRange: [1, 0.38],
          extrapolate: "clamp",
        })),
      }]} />
      <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.kit.bottomdrawer.4c997bfc14")} onPress={requestDismiss} style={StyleSheet.absoluteFill} />
      <AnimatedSafeAreaView edges={["bottom"]} style={[styles.drawer, tall && styles.drawerTall, { transform: [{ translateY: drawerY }] }]}>
        <View style={styles.handleTarget} {...handleResponder.panHandlers}><View style={styles.handle} /></View>
        <View style={styles.header}>
          {leadingAction}
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {headerAction}
          <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.kit.bottomdrawer.f8d247efed", { value0: title })} onPress={requestDismiss} style={styles.close}>
            <Text style={styles.closeGlyph}>×</Text>
          </Pressable>
        </View>
        <View style={styles.body}>{children}</View>
      </AnimatedSafeAreaView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: uiColors.scrim },
  drawer: {
    maxHeight: "82%",
    minHeight: 320,
    overflow: "hidden",
    borderTopLeftRadius: uiRadius.drawer,
    borderTopRightRadius: uiRadius.drawer,
    backgroundColor: uiColors.canvas,
  },
  drawerTall: { height: "91%", maxHeight: "91%" },
  handleTarget: { height: 28, alignItems: "center", justifyContent: "center" },
  handle: { width: 42, height: 5, borderRadius: 3, backgroundColor: uiColors.lineStrong },
  header: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: uiSpace.page, borderBottomWidth: 1, borderBottomColor: uiColors.line },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { color: uiColors.ink, fontFamily: uiType.display, fontSize: 19, fontWeight: "900", letterSpacing: -0.2 },
  subtitle: { marginTop: 2, color: uiColors.inkMuted, fontFamily: uiType.body, fontSize: 11 },
  close: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "#E8E5DC" },
  closeGlyph: { marginTop: -2, color: uiColors.ink, fontSize: 26, lineHeight: 28, fontWeight: "500" },
  body: { flex: 1, minHeight: 0 },
});
