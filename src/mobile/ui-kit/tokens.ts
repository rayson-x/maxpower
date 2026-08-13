import { Platform } from "react-native";

export const uiColors = {
  canvas: "#F4F1E9",
  paper: "#FFFEFA",
  ink: "#111411",
  inkMuted: "#676B64",
  inkFaint: "#979B93",
  line: "#DEDCD3",
  lineStrong: "#C9C7BD",
  lime: "#C8FF24",
  limeDeep: "#7FAF00",
  limeSoft: "#ECFFC0",
  amber: "#F3B63C",
  amberSoft: "#FFF2CF",
  coral: "#F06449",
  coralSoft: "#FFE4DC",
  safe: "#2D9A67",
  safeSoft: "#DFF4E9",
  white: "#FFFFFF",
  scrim: "rgba(12, 14, 12, 0.48)",
} as const;

export const uiRadius = {
  small: 12,
  medium: 18,
  large: 26,
  drawer: 30,
  pill: 999,
} as const;

export const uiSpace = {
  page: 20,
  section: 24,
  card: 18,
  compact: 12,
} as const;

export const uiType = {
  display: Platform.select({ ios: "Avenir Next Condensed", android: "sans-serif-condensed", web: "'Arial Narrow', sans-serif" }),
  body: Platform.select({ ios: "PingFang SC", android: "sans-serif", web: "'Noto Sans SC', sans-serif" }),
  mono: Platform.select({ ios: "Menlo", android: "monospace", web: "ui-monospace, monospace" }),
} as const;
