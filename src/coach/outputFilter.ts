import type { ForbiddenClaimRule } from "../knowledge/model";

/**
 * 禁止声称输出过滤器（ticket 09）：provider 文本落账/展示前的确定性拦截。
 * 规则来自知识包的安全词表（版本化、随包更新）；patterns 为 AND 语义。
 * 命中时整体替换为规则的安全文案——部分改写会让残留上下文改变语义，比整段替换更危险。
 */
export interface CoachOutputFilterResult {
  text: string;
  intercepted: boolean;
  matchedRuleIds: readonly string[];
}

export function filterCoachOutput(
  text: string,
  rules: readonly ForbiddenClaimRule[],
): CoachOutputFilterResult {
  const matched = rules.filter((rule) =>
    rule.patterns.every((pattern) => text.includes(pattern)),
  );
  if (!matched.length) return { text, intercepted: false, matchedRuleIds: [] };
  return {
    text: matched[0].replacement,
    intercepted: true,
    matchedRuleIds: matched.map((rule) => rule.id),
  };
}
