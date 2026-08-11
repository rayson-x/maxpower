/**
 * 文案资源层（2026-08-12 用户拍板：文案不写死中文，用资源引用支持多语言切换）。
 *
 * 面向海外市场，所以**英文为主文案（默认）、中文为翻译**。
 * 用法：
 *   - 定义：const note = copy({ en: "...", zh: "..." })
 *   - 使用：note.resolve(locale) 或 note.en / note.zh
 *   - 插值：copy({ en: "Lose {min}-{max}% per week", zh: "每周掉 {min}-{max}%" }).format(locale, { min, max })
 *
 * 纪律：
 * - 所有用户可见文案都必须经这个层，不散落中文字面量
 * - 英文为权威源（海外市场 + 便于核验）；中文为翻译
 * - 新增语言只加字段，不改调用点
 */

export type Locale = "en" | "zh";

/** 一段多语言文案。 */
export interface LocalizedText {
  readonly en: string;
  readonly zh: string;
  resolve(locale: Locale): string;
  format(locale: Locale, vars: Record<string, string | number>): string;
}

/** 定义一段多语言文案。 */
export function copy(text: { en: string; zh: string }): LocalizedText {
  return {
    en: text.en,
    zh: text.zh,
    resolve(locale) {
      return locale === "zh" ? text.zh : text.en;
    },
    format(locale, vars) {
      const template = locale === "zh" ? text.zh : text.en;
      return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
    },
  };
}

/** 从档案/上下文解析 locale（默认英文——海外市场优先）。 */
export function localeOf(locale?: string): Locale {
  return locale?.startsWith("zh") ? "zh" : "en";
}
