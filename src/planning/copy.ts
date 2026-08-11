/**
 * 文案资源（纯数据，可序列化）。客户端 i18n 基建见 src/i18n/。
 *
 * 注意：这里必须是**纯数据**（无方法），因为要随账本/artifact 序列化存储。
 * 带方法的版本会触发 DataCloneError。解析用顶层函数 resolveCopy/formatCopy。
 */

export type Locale = "en" | "zh";

export interface LocalizedText {
  readonly en: string;
  readonly zh: string;
}

/** 定义一段多语言文案（纯数据）。 */
export function copy(text: { en: string; zh: string }): LocalizedText {
  return { en: text.en, zh: text.zh };
}

/** 按 locale 取文案。 */
export function resolveCopy(text: LocalizedText, locale: Locale): string {
  return locale === "zh" ? text.zh : text.en;
}

/** 按 locale 取文案并插值（{name} → vars.name）。 */
export function formatCopy(text: LocalizedText, locale: Locale, vars: Record<string, string | number>): string {
  const template = locale === "zh" ? text.zh : text.en;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
}

/** 从档案/上下文解析 locale（默认英文——海外优先）。 */
export function localeOf(locale?: string): Locale {
  return locale?.startsWith("zh") ? "zh" : "en";
}
