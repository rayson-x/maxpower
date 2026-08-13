import React, {
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
} from "react-native";

export interface HorizontalRoutePagerPage {
  id: string;
  content: ReactNode;
}

export interface HorizontalRoutePagerHandle {
  navigate(destination: string): void;
  setSwipeEnabled(enabled: boolean): void;
  setSwipeExclusion(exclusion?: { destination: string; top: number; bottom: number }): void;
}

/**
 * A small UIPageViewController-style pager for the app's primary destinations.
 * Every destination remains mounted, so the neighbouring page is already
 * visible while the finger is moving instead of appearing after navigation.
 */
export const HorizontalRoutePager = forwardRef<HorizontalRoutePagerHandle, {
  current: string;
  pages: readonly HorizontalRoutePagerPage[];
  onChange(destination: string): void;
}>(function HorizontalRoutePager({ current, pages, onChange }, ref) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [pageWidth, setPageWidth] = useState(0);
  const pageWidthRef = useRef(0);
  const currentIndexRef = useRef(0);
  const pagesRef = useRef(pages);
  const onChangeRef = useRef(onChange);
  const transitionActive = useRef(false);
  const swipeEnabled = useRef(true);
  const swipeExclusion = useRef<{ destination: string; top: number; bottom: number } | undefined>(undefined);
  const activeIndex = Math.max(0, pages.findIndex((page) => page.id === current));

  pageWidthRef.current = pageWidth;
  currentIndexRef.current = activeIndex;
  pagesRef.current = pages;
  onChangeRef.current = onChange;

  const animateToIndex = (targetIndex: number, announce: boolean) => {
    const width = pageWidthRef.current;
    const availablePages = pagesRef.current;
    const boundedIndex = Math.max(0, Math.min(availablePages.length - 1, targetIndex));
    const destination = availablePages[boundedIndex];
    if (!destination || width <= 0) {
      if (announce && destination) onChangeRef.current(destination.id);
      return;
    }

    transitionActive.current = true;
    if (announce && destination.id !== availablePages[currentIndexRef.current]?.id) {
      onChangeRef.current(destination.id);
    }
    Animated.spring(translateX, {
      toValue: -boundedIndex * width,
      damping: 24,
      stiffness: 265,
      mass: 0.88,
      restDisplacementThreshold: 0.4,
      restSpeedThreshold: 0.4,
      useNativeDriver: true,
    }).start(() => {
      transitionActive.current = false;
    });
  };

  useImperativeHandle(ref, () => ({
    navigate(destination) {
      const targetIndex = pagesRef.current.findIndex((page) => page.id === destination);
      if (targetIndex >= 0) animateToIndex(targetIndex, true);
    },
    setSwipeEnabled(enabled) {
      swipeEnabled.current = enabled;
    },
    setSwipeExclusion(exclusion) {
      swipeExclusion.current = exclusion;
    },
  }));

  useEffect(() => {
    if (pageWidth <= 0) return;
    if (transitionActive.current) return;
    Animated.spring(translateX, {
      toValue: -activeIndex * pageWidth,
      damping: 24,
      stiffness: 265,
      mass: 0.88,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, pageWidth, translateX]);

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (event, gesture) => {
      const exclusion = swipeExclusion.current;
      const destination = pagesRef.current[currentIndexRef.current]?.id;
      const insideOwnedChild = exclusion?.destination === destination
        && event.nativeEvent.pageY >= exclusion.top
        && event.nativeEvent.pageY <= exclusion.bottom;
      return swipeEnabled.current
        && !insideOwnedChild
        && !transitionActive.current
        && Math.abs(gesture.dx) > 12
        && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.3;
    },
    onPanResponderGrant: () => {
      translateX.stopAnimation();
    },
    onPanResponderMove: (_event, gesture) => {
      const width = pageWidthRef.current;
      if (width <= 0) return;
      const index = currentIndexRef.current;
      const atLeadingEdge = index === 0 && gesture.dx > 0;
      const atTrailingEdge = index === pagesRef.current.length - 1 && gesture.dx < 0;
      const distance = atLeadingEdge || atTrailingEdge ? gesture.dx * 0.22 : gesture.dx;
      translateX.setValue(-index * width + distance);
    },
    onPanResponderRelease: (_event, gesture) => {
      const width = pageWidthRef.current;
      const index = currentIndexRef.current;
      if (width <= 0) return;
      const projected = gesture.dx + gesture.vx * 110;
      const threshold = Math.min(92, width * 0.22);
      if (Math.abs(projected) < threshold) {
        animateToIndex(index, false);
        return;
      }
      animateToIndex(index + (projected < 0 ? 1 : -1), true);
    },
    onPanResponderTerminate: () => animateToIndex(currentIndexRef.current, false),
  }), [translateX]);

  return <View
    style={styles.viewport}
    onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)}
    {...responder.panHandlers}
  >
    {pageWidth > 0 ? <Animated.View style={[styles.track, {
      width: pageWidth * pages.length,
      transform: [{ translateX }],
    }]}>
      {pages.map((page) => {
        const active = page.id === current;
        return <View
          key={page.id}
          accessibilityElementsHidden={!active}
          importantForAccessibility={active ? "auto" : "no-hide-descendants"}
          pointerEvents={active ? "auto" : "none"}
          style={[styles.page, { width: pageWidth }]}
        >{page.content}</View>;
      })}
    </Animated.View> : <View style={styles.page}>{pages[activeIndex]?.content}</View>}
  </View>;
});

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: "hidden" },
  track: { flex: 1, flexDirection: "row" },
  page: { flex: 1, flexShrink: 0 },
});
