/**
 * 「靶场 RANGE HUD」主题:全局字体、CSS 变量、扫描动画。
 * 内联样式表达不了 keyframes/伪元素/字体加载,所以集中注入一次。
 */

const THEME_ID = "range-hud-theme";

export const HUD = {
  bg: "#060907",
  panel: "#0b100c",
  panel2: "#0e1410",
  line: "#1d2b20",
  lineBright: "#33543c",
  primary: "#57ff8e", // 磷绿:追踪正常/主要信息
  primaryDim: "#2b8f52",
  amber: "#ffb224", // 靶场琥珀:警示/主行动
  danger: "#ff5252",
  text: "#d9e8dd",
  dim: "#63796b",
  mono: "'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace",
  display: "'Zen Dots', 'IBM Plex Mono', monospace",
  sans: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
};

export function injectHudTheme(): void {
  if (typeof document === "undefined" || document.getElementById(THEME_ID)) return;

  const fontLink = document.createElement("link");
  fontLink.rel = "stylesheet";
  fontLink.href =
    "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Zen+Dots&display=swap";
  document.head.appendChild(fontLink);

  const style = document.createElement("style");
  style.id = THEME_ID;
  style.textContent = `
    @keyframes hud-blink { 0%,100% { opacity: 1 } 50% { opacity: 0.25 } }
    @keyframes hud-scan {
      0% { transform: translateX(-100%) }
      100% { transform: translateX(400%) }
    }
    @keyframes hud-reveal {
      from { opacity: 0; transform: translateY(10px) }
      to { opacity: 1; transform: translateY(0) }
    }
    .hud-reveal { animation: hud-reveal 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both }
    .hud-reveal-1 { animation-delay: 0.05s }
    .hud-reveal-2 { animation-delay: 0.12s }
    .hud-reveal-3 { animation-delay: 0.2s }
    .hud-scanline::after {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: repeating-linear-gradient(
        0deg,
        transparent 0px,
        transparent 3px,
        rgba(87, 255, 142, 0.014) 3px,
        rgba(87, 255, 142, 0.014) 4px
      );
    }
    .hud-scanning {
      position: relative;
      overflow: hidden;
    }
    .hud-scanning::before {
      content: "";
      position: absolute;
      top: 0; bottom: 0;
      width: 25%;
      background: linear-gradient(90deg, transparent, rgba(255, 178, 36, 0.12), transparent);
      animation: hud-scan 1.6s linear infinite;
      pointer-events: none;
    }
    select, input {
      font-family: ${HUD.mono};
      background: ${HUD.panel2};
      color: ${HUD.text};
      border: 1px solid ${HUD.line};
      padding: 6px 8px;
      font-size: 12px;
      outline: none;
    }
    select:focus, input:focus { border-color: ${HUD.lineBright} }
    ::-webkit-scrollbar { width: 8px; height: 8px }
    ::-webkit-scrollbar-thumb { background: ${HUD.line}; }
    ::-webkit-scrollbar-track { background: transparent }
  `;
  document.head.appendChild(style);
}

/** HUD 取景框角标(四个直角),纯 CSS 绝对定位 */
export function cornerBrackets(color: string, size = 18, inset = 6): React.CSSProperties[] {
  const base: React.CSSProperties = {
    position: "absolute",
    width: size,
    height: size,
    borderColor: color,
    borderStyle: "solid",
    borderWidth: 0,
    pointerEvents: "none",
    zIndex: 3,
  };
  return [
    { ...base, top: inset, left: inset, borderTopWidth: 2, borderLeftWidth: 2 },
    { ...base, top: inset, right: inset, borderTopWidth: 2, borderRightWidth: 2 },
    { ...base, bottom: inset, left: inset, borderBottomWidth: 2, borderLeftWidth: 2 },
    { ...base, bottom: inset, right: inset, borderBottomWidth: 2, borderRightWidth: 2 },
  ];
}

/** 切角按钮(工业 HUD 风):左上/右下切角 */
export const CHAMFER = "polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)";
export const CHAMFER_SM = "polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)";
