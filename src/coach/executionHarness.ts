import type { LLMProviderRequest, ProviderEvent } from "./adapters/provider";

/**
 * Deterministic execution-time Agent harness.
 *
 * Interface: given the canonical user text and enabled tool manifest, either
 * return one complete, schema-shaped tool route or decline it. It has no
 * ledger access and cannot write a plan itself; ToolRegistry remains the only
 * route that can produce a preview. This keeps identical behavior across
 * local and cloud language adapters.
 */
export class CoachExecutionHarness {
  route(request: LLMProviderRequest): readonly ProviderEvent[] | undefined {
    const text = request.userText.trim();
    const lower = text.toLowerCase();
    const hasActionTool = (name: string) => request.toolManifest.some((tool) => tool.name === name);
    const explicitEnergyExcess = text.match(/(?:多吃|超出|多了)\s*(\d+(?:\.\d+)?)\s*(?:千卡|大卡|kcal)?/i)?.[1];
    const reportedEnergyExcess = explicitEnergyExcess ? Number(explicitEnergyExcess) : undefined;
    const isoDates = [...new Set(text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [])].sort();
    const recoveryScore = text.match(/(?:恢复|状态)\s*(?:是|为|只有)?\s*([1-5])\s*(?:\/\s*5|分)?/i)?.[1];
    const fatigueScore = text.match(/(?:疲劳|累)\s*(?:是|为)?\s*(\d{1,2})\s*(?:\/\s*10|分)?/i)?.[1];
    const durationMinutes = text.match(/(\d{1,4})\s*(?:分钟|min(?:ute)?s?)/i)?.[1];

    if (/聚餐|吃多了|吃超了|热量超/.test(lower) && hasActionTool("plan.propose_energy_rebalance")) {
      return [
        { type: "text-delta", delta: "我会先记录这次饮食偏差，再只调整尚未发生的低冲击活动；确认前不会改动当前计划。" },
        { type: "tool-call", toolCallId: `execution-energy-rebalance-${request.runId}`, toolName: "plan.propose_energy_rebalance", input: { description: text, ...(reportedEnergyExcess === undefined ? {} : { excessKcal: reportedEnergyExcess }) } },
        { type: "completed" },
      ];
    }
    if (/出差|旅行|加班|没时间|无法训练|练不了|漏训|漏练/.test(lower) && hasActionTool("plan.adapt_from_user_report")) {
      if (!isoDates.length) return [
        { type: "text-delta", delta: "我可以记录这次日程变化并重新排尚未发生的训练。请告诉我受影响的具体日期（如 2026-08-05）；确认调整前，当前计划不会改变。" },
        { type: "completed" },
      ];
      const missed = /无法训练|练不了|漏训|漏练/.test(lower);
      return [
        { type: "text-delta", delta: "我会先保存这项日程/缺训事实，再按当前轮转与恢复规则生成未来调整预览，交给你确认。" },
        { type: "tool-call", toolCallId: `execution-adapt-schedule-${request.runId}`, toolName: "plan.adapt_from_user_report", input: missed ? { kind: "missed_training", summary: text, missedDates: isoDates } : { kind: "schedule", summary: text, unavailableDates: isoDates } },
        { type: "completed" },
      ];
    }
    if (/恢复差|疲劳|很累|酸痛|睡不好|睡得不好|没睡好|睡眠差|状态不好/.test(lower) && hasActionTool("plan.adapt_from_user_report")) {
      const recovery = recoveryScore ? Number(recoveryScore) : undefined;
      const fatigue = fatigueScore ? Number(fatigueScore) : undefined;
      if (recovery === undefined && fatigue === undefined) {
        const reportsLegSoreness = /(?:腿|下肢).{0,12}(?:酸|酸痛)/.test(lower);
        const reportsOtherAreasOkay = /(?:其他(?:位置|部位)?|上肢).{0,12}(?:还行|正常|没问题|感觉可以)/.test(lower);
        if (reportsLegSoreness && reportsOtherAreasOkay) return [
          { type: "text-delta", delta: "你的腿部仍在恢复、上肢感觉可用：我会生成『保守肩日、取消练后有氧、不补腿』的未来调整预览。它不会把睡眠情况伪造成数值评分，也不会在你确认前改动计划。" },
          { type: "tool-call", toolCallId: `execution-adapt-qualitative-recovery-${request.runId}`, toolName: "plan.adapt_from_user_report", input: { kind: "recovery", summary: text, qualitativeAssessment: "poor_sleep_localized_lower_soreness", requestedTrainingFocus: "shoulders" } },
          { type: "completed" },
        ];
        return [
          { type: "text-delta", delta: "我可以把这次恢复反馈写入记录并复核后续安排。请给我一个恢复评分（1–5）或疲劳评分（1–10）；若有局部酸痛，也请说部位和严重程度。" },
          { type: "completed" },
        ];
      }
      return [
        { type: "text-delta", delta: "我会先记录你的主观恢复反馈，再用本地恢复规则复核尚未开始的训练；任何计划改动都会先让你确认。" },
        { type: "tool-call", toolCallId: `execution-adapt-recovery-${request.runId}`, toolName: "plan.adapt_from_user_report", input: { kind: "recovery", summary: text, ...(recovery === undefined ? {} : { perceivedRecovery: recovery }), ...(fatigue === undefined ? {} : { fatigue }) } },
        { type: "completed" },
      ];
    }
    if (/(跑步|慢跑|跳绳|球类|爬山|骑车|骑行)/.test(lower) && durationMinutes && hasActionTool("plan.adapt_from_user_report")) {
      const activityType = /跑步|慢跑/.test(lower) ? "跑步" : /跳绳/.test(lower) ? "跳绳" : /球类/.test(lower) ? "球类运动" : /爬山/.test(lower) ? "爬山" : "骑行";
      const intensity = /高强度|很累|冲刺|hard/.test(lower) ? "hard" : /轻松|easy/.test(lower) ? "easy" : "moderate";
      return [
        { type: "text-delta", delta: "我会记录这次额外活动，并检查它是否会与接下来的力量训练恢复冲突；有调整时只生成待确认的未来预览。" },
        { type: "tool-call", toolCallId: `execution-adapt-activity-${request.runId}`, toolName: "plan.adapt_from_user_report", input: { kind: "activity", summary: text, activityType, durationMinutes: Number(durationMinutes), intensity } },
        { type: "completed" },
      ];
    }
    return undefined;
  }
}
