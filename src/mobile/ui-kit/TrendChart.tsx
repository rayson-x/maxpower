import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Polyline } from "react-native-svg";

import { uiColors, uiRadius, uiType } from "./tokens";

export interface TrendChartPoint {
  label: string;
  value: number;
}

export function TrendChart({ title, value, meta, points, color = uiColors.limeDeep }: {
  title: string;
  value: string;
  meta: string;
  points: readonly TrendChartPoint[];
  color?: string;
}) {
  const width = 280;
  const height = 74;
  const inset = 8;
  const values = points.map((point) => point.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = Math.max(1, max - min);
  const chartPoints = points.map((point, index) => ({
    x: points.length <= 1 ? width / 2 : inset + index * ((width - inset * 2) / (points.length - 1)),
    y: height - inset - ((point.value - min) / span) * (height - inset * 2),
  }));
  return <View style={styles.card}>
    <View style={styles.heading}><View><Text style={styles.title}>{title}</Text><Text style={styles.meta}>{meta}</Text></View><Text style={styles.value}>{value}</Text></View>
    {points.length ? <Svg accessibilityLabel={`${title}趋势图`} height={height} viewBox={`0 0 ${width} ${height}`} width="100%">
      <Line x1={inset} x2={width - inset} y1={height - inset} y2={height - inset} stroke={uiColors.line} strokeWidth={1} />
      {chartPoints.length > 1 ? <Polyline fill="none" points={chartPoints.map((point) => `${point.x},${point.y}`).join(" ")} stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} /> : null}
      {chartPoints.map((point, index) => <Circle key={`${point.x}:${point.y}`} cx={point.x} cy={point.y} fill={index === chartPoints.length - 1 ? uiColors.ink : color} r={index === chartPoints.length - 1 ? 4.5 : 2.5} />)}
    </Svg> : <View style={styles.empty}><Text style={styles.emptyText}>记录后开始形成趋势</Text></View>}
  </View>;
}

const styles = StyleSheet.create({
  card: { minHeight: 148, padding: 16, borderRadius: uiRadius.medium, backgroundColor: uiColors.paper, borderWidth: 1, borderColor: "rgba(17, 20, 17, 0.05)" },
  heading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  title: { color: uiColors.ink, fontFamily: uiType.body, fontSize: 13, fontWeight: "900" },
  meta: { marginTop: 3, color: uiColors.inkFaint, fontFamily: uiType.body, fontSize: 10 },
  value: { color: uiColors.ink, fontFamily: uiType.display, fontSize: 24, fontWeight: "900" },
  empty: { flex: 1, minHeight: 74, alignItems: "center", justifyContent: "center" },
  emptyText: { color: uiColors.inkFaint, fontFamily: uiType.body, fontSize: 11 },
});
