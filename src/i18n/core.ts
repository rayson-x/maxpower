/**
 * 客户端 i18n 基建（2026-08-12 用户拍板：文案只在客户端，服务端不输出文案）。
 *
 * 架构定位：
 * - **服务端 / planner / 引擎只产出结构化数据与 code**，绝不携带展示文案
 * - **客户端 i18n 层**负责把 code / 数据 → 用户可读文案（多语言）
 * - 英文为权威源（海外市场 + 便于核验），中文为翻译；新增语言只加资源，不改代码
 *
 * 三部分：
 *   1. 资源表（translations.ts）：key → { en, zh }
 *   2. 解析器（这里）：t(key, vars, locale) → 字符串
 *   3. React 绑定（useT）：组件里取用
 */

export type Locale = "en" | "zh";

/** 从档案/设备语言解析 locale（默认英文——海外市场优先）。 */
export function resolveLocale(locale?: string): Locale {
  return locale?.startsWith("zh") ? "zh" : "en";
}

/** 单条翻译资源。 */
export interface TranslationEntry {
  en: string;
  zh: string;
}

/** 资源表类型（键名分层：domain.scope.name）。 */
export type TranslationTable = Readonly<Record<string, TranslationEntry>>;

/** 缺失键时返回的占位（带 key，便于发现漏翻）。 */
function missingKey(key: string): string {
  return `[${key}]`;
}

/** 模板插值：{name} → vars.name。未提供的变量保留占位并可见。 */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] !== undefined ? String(vars[key]) : `{${key}}`));
}

/**
 * 核心解析函数。非 React 代码（facade、报告、测试）直接用这个。
 *
 * @param table  资源表（translations.ts 里的某个域）
 * @param key    键名
 * @param locale 目标语言
 * @param vars   插值变量
 */
export function translate(
  table: TranslationTable,
  key: string,
  locale: Locale,
  vars?: Record<string, string | number>,
): string {
  const entry = table[key];
  if (!entry) return missingKey(key);
  return interpolate(locale === "zh" ? entry.zh : entry.en, vars);
}

/**
 * 创建一个绑定到某资源表的翻译函数（减少每次传 table）。
 * 用法：const t = createTranslator(PLANNING_COPY, locale); t("goal.fatLoss.title")
 */
export function createTranslator(table: TranslationTable, locale: Locale) {
  return (key: string, vars?: Record<string, string | number>): string =>
    translate(table, key, locale, vars);
}
