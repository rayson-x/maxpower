import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from "react-native";
import Svg, { Circle, Defs, Ellipse, LinearGradient, Stop } from "react-native-svg";

import { describeCycleRange } from "./calendarModel";
import { uiColors, uiRadius, uiType } from "./tokens";

export interface CalendarPagerDay {
  date: string;
  completed: boolean;
  partial: boolean;
  hasActivityLog: boolean;
}

export interface CalendarPlanRange {
  startDate: string;
  endDate: string;
}

export function CalendarPager({ mode, days, selectedDate, today, planRange, locale, onModeChange, onSelectDate, onPrevious, onNext, onGestureActiveChange, onGestureRegionChange }: {
  mode: "week" | "month";
  days: readonly CalendarPagerDay[];
  selectedDate: string;
  today: string;
  planRange?: CalendarPlanRange;
  /** From profile.locale; falls back to English when unknown. */
  locale?: string;
  onModeChange(mode: "week" | "month"): void;
  onSelectDate(date: string): void;
  onPrevious(): void;
  onNext(): void;
  onGestureActiveChange?(active: boolean): void;
  onGestureRegionChange?(region: { top: number; bottom: number }): void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const modeProgress = useRef(new Animated.Value(mode === "month" ? 1 : 0)).current;
  const [pageWidth, setPageWidth] = useState(0);
  const pendingStep = useRef<-1 | 1 | undefined>(undefined);
  const transitionActive = useRef(false);
  const transitionFallback = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const calendarViewport = useRef<View>(null);
  const pageKey = `${mode}:${days[0]?.date ?? "empty"}:${days.at(-1)?.date ?? "empty"}:${days.length}`;
  const previousPageKey = useRef(pageKey);

  useEffect(() => {
    Animated.timing(modeProgress, {
      toValue: mode === "month" ? 1 : 0,
      duration: 190,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [mode, modeProgress]);

  useEffect(() => {
    if (previousPageKey.current === pageKey) return;
    previousPageKey.current = pageKey;
    pendingStep.current = undefined;
    if (transitionFallback.current !== undefined) clearTimeout(transitionFallback.current);
    translateX.setValue(-pageWidth);
    transitionActive.current = false;
  }, [pageKey, pageWidth, translateX]);

  useEffect(() => {
    if (pageWidth > 0 && !transitionActive.current) translateX.setValue(-pageWidth);
  }, [pageWidth, translateX]);

  useEffect(() => () => {
    if (transitionFallback.current !== undefined) clearTimeout(transitionFallback.current);
  }, []);

  const settle = useCallback(() => {
    Animated.spring(translateX, {
      toValue: -pageWidth,
      damping: 20,
      stiffness: 240,
      mass: 0.82,
      useNativeDriver: true,
    }).start(() => {
      transitionActive.current = false;
    });
  }, [translateX]);

  const changePage = useCallback((step: -1 | 1) => {
    if (transitionActive.current) return;
    if (pageWidth <= 0) {
      if (step < 0) onPrevious();
      else onNext();
      return;
    }
    transitionActive.current = true;
    Animated.timing(translateX, {
      toValue: step < 0 ? 0 : -pageWidth * 2,
      duration: 230,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) {
        settle();
        return;
      }
      pendingStep.current = step;
      if (step < 0) onPrevious();
      else onNext();
      transitionFallback.current = setTimeout(() => {
        if (pendingStep.current !== step) return;
        pendingStep.current = undefined;
        settle();
      }, 1_200);
    });
  }, [onNext, onPrevious, pageWidth, settle, translateX]);

  const responder = useMemo(() => {
    const shouldOwnHorizontalDateGesture = (_event: GestureResponderEvent, gesture: PanResponderGestureState) => (
      !transitionActive.current
      && Math.abs(gesture.dx) > 10
      && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35
    );
    return PanResponder.create({
    onMoveShouldSetPanResponder: shouldOwnHorizontalDateGesture,
    // Calendar paging is nested inside the app's primary destination pager.
    // Capture horizontal drags that begin on the date grid so one gesture can
    // never move both the week and the top-level destination.
    onMoveShouldSetPanResponderCapture: shouldOwnHorizontalDateGesture,
    onPanResponderGrant: () => {
      translateX.stopAnimation();
    },
    onPanResponderMove: (_event, gesture) => {
      const distance = Math.max(-pageWidth, Math.min(pageWidth, gesture.dx));
      translateX.setValue(-pageWidth + distance);
    },
    onPanResponderRelease: (_event, gesture) => {
      onGestureActiveChange?.(false);
      const projectedDistance = gesture.dx + gesture.vx * 90;
      if (Math.abs(projectedDistance) < Math.min(72, pageWidth * 0.2)) {
        settle();
        return;
      }
      changePage(projectedDistance < 0 ? 1 : -1);
    },
    onPanResponderTerminate: () => {
      onGestureActiveChange?.(false);
      settle();
    },
  });
  }, [changePage, onGestureActiveChange, pageWidth, settle, translateX]);
  const month = calendarMonthLabel(days[0]?.date ?? selectedDate);
  const previousDays = useMemo(
    () => adjacentCalendarDays(mode, days, -1),
    [days, mode],
  );
  const nextDays = useMemo(
    () => adjacentCalendarDays(mode, days, 1),
    [days, mode],
  );
  return <View style={styles.frame}>
    <View style={styles.header}>
      <View style={styles.periodCopy}>
        <Text style={styles.month}>{month}</Text>
        <Text style={styles.range}>{describeCycleRange(today, planRange, locale)}</Text>
      </View>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="切换周视图与月视图"
        accessibilityState={{ checked: mode === "month" }}
        onPress={() => onModeChange(mode === "week" ? "month" : "week")}
        style={({ pressed }) => [styles.modeSwitch, pressed && styles.modeSwitchPressed]}
      >
        <Animated.View style={[styles.modeSwitchThumb, {
          transform: [{ translateX: modeProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 32] }) }],
        }]} />
        <Text style={[styles.modeSwitchLabel, mode === "week" && styles.modeSwitchLabelSelected]}>周</Text>
        <Text style={[styles.modeSwitchLabel, mode === "month" && styles.modeSwitchLabelSelected]}>月</Text>
      </Pressable>
    </View>
    <View style={styles.pagerRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="上一段日期" onPress={() => changePage(-1)} style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed]}><Text style={styles.arrowText}>‹</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="下一段日期" onPress={() => changePage(1)} style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed]}><Text style={styles.arrowText}>›</Text></Pressable>
    </View>
    <View
      ref={calendarViewport}
      style={styles.calendarViewport}
      onLayout={(event) => {
        setPageWidth(event.nativeEvent.layout.width);
        requestAnimationFrame(() => calendarViewport.current?.measureInWindow((_x, y, _width, height) => {
          onGestureRegionChange?.({ top: y, bottom: y + height });
        }));
      }}
      {...responder.panHandlers}
      onStartShouldSetResponderCapture={() => {
        onGestureActiveChange?.(true);
        return false;
      }}
      onTouchStart={() => onGestureActiveChange?.(true)}
      onTouchEnd={() => onGestureActiveChange?.(false)}
      onTouchCancel={() => onGestureActiveChange?.(false)}
    >
      {pageWidth > 0 ? <Animated.View style={[styles.calendarTrack, { width: pageWidth * 3, transform: [{ translateX }] }]}>
        <CalendarDatePage mode={mode} days={previousDays} selectedDate={selectedDate} today={today} width={pageWidth} />
        <CalendarDatePage mode={mode} days={days} selectedDate={selectedDate} today={today} width={pageWidth} onSelectDate={onSelectDate} />
        <CalendarDatePage mode={mode} days={nextDays} selectedDate={selectedDate} today={today} width={pageWidth} />
      </Animated.View> : <CalendarDatePage mode={mode} days={days} selectedDate={selectedDate} today={today} onSelectDate={onSelectDate} />}
    </View>
  </View>;
}

function CalendarDatePage({ mode, days, selectedDate, today, width, onSelectDate }: {
  mode: "week" | "month";
  days: readonly CalendarPagerDay[];
  selectedDate: string;
  today: string;
  width?: number;
  onSelectDate?: (date: string) => void;
}) {
  const leading = mode === "month" && days.length ? mondayIndex(days[0]!.date) : 0;
  return <View pointerEvents={onSelectDate ? "auto" : "none"} style={[styles.calendarPage, width === undefined ? styles.calendarPageUnmeasured : { width }]}>
    <View style={styles.weekLabels}>{["一", "二", "三", "四", "五", "六", "日"].map((label) => <Text key={label} style={styles.weekLabel}>{label}</Text>)}</View>
    <View style={styles.grid}>
      {Array.from({ length: leading }, (_, index) => <View key={`empty:${index}`} style={styles.cell} />)}
      {days.map((day) => {
        const selected = day.date === selectedDate;
        const isToday = day.date === today;
        const hasRecord = day.completed || day.partial || day.hasActivityLog;
        return <Pressable key={day.date} accessibilityRole="button" accessibilityLabel={`查看 ${day.date} 的实际记录`} disabled={!onSelectDate} onPress={() => onSelectDate?.(day.date)} style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}>
          <View style={styles.dayFaceStack}>
            {selected ? <SelectedDateGlass /> : null}
            <View style={[styles.dayFace, selected && styles.dayFaceSelected, isToday && !selected && styles.dayFaceToday]}>
              <Text style={[styles.dayNumber, selected && styles.dayNumberSelected]}>{Number(day.date.slice(-2))}</Text>
              <View style={[styles.recordDot, hasRecord && styles.recordDotVisible, day.partial && styles.recordDotPartial, selected && hasRecord && styles.recordDotSelected]} />
            </View>
          </View>
        </Pressable>;
      })}
    </View>
  </View>;
}

function SelectedDateGlass() {
  return <View pointerEvents="none" style={styles.dayFaceGlass}>
    <Svg width={32} height={32}>
      <Defs>
        <LinearGradient id="selected-date-glass" x1="10%" y1="6%" x2="90%" y2="94%">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.46" stopColor="#EEF1EC" />
          <Stop offset="1" stopColor="#CDD3CA" />
        </LinearGradient>
      </Defs>
      <Circle cx={16} cy={16} r={15.2} fill="url(#selected-date-glass)" stroke="rgba(93,101,89,0.18)" strokeWidth={0.8} />
      <Circle cx={16} cy={16} r={14} fill="none" stroke="rgba(255,255,255,0.58)" strokeWidth={0.7} />
      <Ellipse cx={11.8} cy={8.6} rx={5.7} ry={2.3} fill="#FFFFFF" opacity={0.62} />
      <Ellipse cx={20} cy={24.8} rx={4.4} ry={1} fill="#687064" opacity={0.08} />
    </Svg>
  </View>;
}

function adjacentCalendarDays(
  mode: "week" | "month",
  days: readonly CalendarPagerDay[],
  step: -1 | 1,
): readonly CalendarPagerDay[] {
  if (mode === "week") {
    return days.map((day) => blankCalendarDay(shiftIsoDate(day.date, step * 7)));
  }
  // The visible page, not the selected fact, determines its neighbouring
  // pages.  Those two values intentionally diverge while browsing history.
  const anchor = shiftIsoMonth(days[0]?.date ?? "1970-01-01", step);
  const [year, month] = anchor.split("-").map(Number);
  const count = new Date(Date.UTC(year!, month!, 0, 12)).getUTCDate();
  return Array.from({ length: count }, (_, index) => blankCalendarDay(
    `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
  ));
}

function blankCalendarDay(date: string): CalendarPagerDay {
  return { date, completed: false, partial: false, hasActivityLog: false };
}

function shiftIsoDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function shiftIsoMonth(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year!, month! - 1 + months, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(day!, lastDay));
  return target.toISOString().slice(0, 10);
}

function calendarMonthLabel(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return `${year} 年 ${month} 月`;
}

function mondayIndex(date: string): number {
  return (new Date(`${date}T12:00:00.000Z`).getUTCDay() + 6) % 7;
}

const styles = StyleSheet.create({
  frame: { padding: 16, borderRadius: uiRadius.large, backgroundColor: uiColors.paper, borderWidth: 1, borderColor: "rgba(17, 20, 17, 0.05)" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  periodCopy: { flex: 1, minWidth: 0 },
  month: { color: uiColors.ink, fontFamily: uiType.display, fontSize: 25, fontWeight: "900", letterSpacing: -0.5 },
  range: { marginTop: 3, color: uiColors.inkMuted, fontFamily: uiType.body, fontSize: 11 },
  modeSwitch: { width: 70, height: 34, padding: 3, flexDirection: "row", alignItems: "center", borderRadius: 17, backgroundColor: "#E9E6DD" },
  modeSwitchPressed: { opacity: 0.82 },
  modeSwitchThumb: { position: "absolute", left: 3, top: 3, width: 32, height: 28, borderRadius: 14, backgroundColor: uiColors.ink },
  modeSwitchLabel: { width: 32, zIndex: 1, textAlign: "center", color: uiColors.inkMuted, fontFamily: uiType.body, fontSize: 11, fontWeight: "900" },
  modeSwitchLabelSelected: { color: uiColors.white },
  pagerRow: { marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  arrow: { width: 36, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "#ECE9E1" },
  arrowPressed: { opacity: 0.7, transform: [{ scale: 0.94 }] },
  arrowText: { marginTop: -2, color: uiColors.ink, fontSize: 26, lineHeight: 28 },
  calendarViewport: { overflow: "hidden" },
  calendarTrack: { flexDirection: "row" },
  calendarPage: { flexShrink: 0 },
  calendarPageUnmeasured: { width: "100%" },
  weekLabels: { marginTop: 12, flexDirection: "row" },
  weekLabel: { width: "14.285%", textAlign: "center", color: uiColors.inkFaint, fontFamily: uiType.body, fontSize: 10, fontWeight: "700" },
  grid: { marginTop: 5, flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "14.285%", height: 48, alignItems: "center", justifyContent: "center" },
  cellPressed: { transform: [{ scale: 0.94 }] },
  dayFaceStack: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  dayFace: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16 },
  dayFaceSelected: { zIndex: 2, backgroundColor: "transparent" },
  dayFaceGlass: { position: "absolute", width: 32, height: 32 },
  dayFaceToday: { borderWidth: 1, borderColor: uiColors.lineStrong },
  dayNumber: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, color: uiColors.ink, fontFamily: uiType.mono, fontSize: 12, lineHeight: 32, fontWeight: "800", textAlign: "center", textAlignVertical: "center", includeFontPadding: false },
  dayNumberSelected: { color: uiColors.ink, fontSize: 13, fontWeight: "900" },
  recordDot: { position: "absolute", bottom: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: "transparent" },
  recordDotVisible: { backgroundColor: uiColors.safe },
  recordDotPartial: { backgroundColor: uiColors.amber },
  recordDotSelected: { backgroundColor: uiColors.limeDeep },
});
