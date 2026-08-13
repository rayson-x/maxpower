import type { RuleDecision, ShadowRuleMetric } from "./model";

interface RecordedMetric extends ShadowRuleMetric {
  proposalId: string;
}

export class InMemoryShadowRuleMetrics {
  private readonly metrics = new Map<string, RecordedMetric>();

  recordProposal(input: {
    proposalId: string;
    decision: RuleDecision;
    ruleCoverage: number;
  }): void {
    this.metrics.set(input.proposalId, {
      proposalId: input.proposalId,
      ruleId: input.decision.rule.id,
      ruleVersion: input.decision.rule.semanticVersion,
      decision: input.decision.decision,
      ruleCoverage: clamp(input.ruleCoverage),
    });
  }

  recordOutcome(input: {
    proposalId: string;
    accepted?: boolean;
    modified?: boolean;
    undone?: boolean;
    completed?: boolean;
    targetRirDeviation?: number;
    repeatedPerformanceDecline?: boolean;
  }): void {
    const current = this.metrics.get(input.proposalId);
    if (!current) throw new Error("shadow_metric_proposal_not_found");
    this.metrics.set(input.proposalId, { ...current, ...input });
  }

  list(): readonly RecordedMetric[] {
    return [...this.metrics.values()].map((item) => ({ ...item }));
  }

  summary() {
    const items = this.list();
    const count = items.length;
    const rate = (predicate: (item: RecordedMetric) => boolean) =>
      count === 0 ? 0 : items.filter(predicate).length / count;
    const rir = items.flatMap((item) =>
      item.targetRirDeviation === undefined ? [] : [Math.abs(item.targetRirDeviation)],
    );
    return {
      proposalCount: count,
      acceptanceRate: rate((item) => item.accepted === true),
      modificationRate: rate((item) => item.modified === true),
      undoRate: rate((item) => item.undone === true),
      completionRate: rate((item) => item.completed === true),
      meanAbsoluteTargetRirDeviation:
        rir.length === 0 ? undefined : rir.reduce((sum, value) => sum + value, 0) / rir.length,
      repeatedPerformanceDeclineRate: rate(
        (item) => item.repeatedPerformanceDecline === true,
      ),
      meanRuleCoverage:
        count === 0
          ? 0
          : items.reduce((sum, item) => sum + item.ruleCoverage, 0) / count,
    };
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
