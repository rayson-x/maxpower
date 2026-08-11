import { useMemo } from "react";

import { createTranslator, resolveLocale, type Locale, type TranslationTable } from "./core";

/**
 * React 绑定：组件里取用翻译。
 *
 * 用法：
 *   const t = useT(PLANNING_COPY, profile.locale);
 *   <Text>{t("goal.fatLoss.title")}</Text>
 *   <Text>{t("goal.timeline.weeks", { weeks: 12 })}</Text>
 *
 * locale 从用户档案（profile.locale）传入；缺省回退英文（海外优先）。
 */
export function useT(table: TranslationTable, locale?: string): (key: string, vars?: Record<string, string | number>) => string {
  const resolved: Locale = resolveLocale(locale);
  return useMemo(() => createTranslator(table, resolved), [table, resolved]);
}

/** 非 hook 版本（在非组件代码/服务里用）。 */
export function getT(table: TranslationTable, locale?: string) {
  return createTranslator(table, resolveLocale(locale));
}
