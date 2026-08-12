/**
 * User-visible, replayable projection of PlannerHarness lifecycle.
 *
 * This is deliberately not an intent classifier or a proposal generator. The
 * caller supplies the durable planning outcome; this module only makes its
 * externally verifiable boundary safe to render.
 */
export type PlannerProgressStage =
  | "started"
  | "retrieving"
  | "evaluating"
  | "needs_input"
  | "proposal_ready"
  | "paused"
  | "failed";

export interface PlannerProgressClaimInput {
  text: string;
  /** Passage ids returned by `knowledge.search` in the same Agent run. */
  passageIds: readonly string[];
}

export interface PlannerProgressProposalInput {
  tradeoffs: readonly string[];
  executionBurden: string;
  nextVerificationSignal: string;
  confirmationStatus: "awaiting_confirmation" | "confirmed" | "rejected" | "stale";
  effectAfterConfirmation: string;
}

export interface PlannerProgressInput {
  stage: PlannerProgressStage;
  /** User and Timeline facts, not LLM reasoning. */
  factBasis: readonly string[];
  requestedInformation?: readonly string[];
  professionalClaims?: readonly PlannerProgressClaimInput[];
  proposal?: PlannerProgressProposalInput;
  /** A safe, non-sensitive operational reason for paused/failed. */
  message?: string;
}

export interface VerifiedPlannerClaim {
  text: string;
  passageIds: readonly string[];
}

export interface PlannerProgressProjection {
  stage: PlannerProgressStage;
  title: string;
  subtitle: string;
  status: "ready" | "awaiting_user" | "error";
  claims: readonly VerifiedPlannerClaim[];
  cannotJudge: readonly string[];
  sections: readonly { title: string; items: readonly string[] }[];
}

const STAGE_PRESENTATION: Record<PlannerProgressStage, Pick<PlannerProgressProjection, "title" | "subtitle" | "status">> = {
  started: { title: "正在准备规划", subtitle: "正在整理已确认的训练、饮食与恢复记录。", status: "ready" },
  retrieving: { title: "正在核对依据", subtitle: "正在查找与当前问题直接相关的已审核知识。", status: "ready" },
  evaluating: { title: "正在评估路径", subtitle: "正在比较当前目标、执行记录与可行调整。", status: "ready" },
  needs_input: { title: "需要一项信息", subtitle: "补充后才能可靠判断是否需要调整。", status: "awaiting_user" },
  proposal_ready: { title: "调整方案已准备好", subtitle: "确认前，当前计划不会改变。", status: "awaiting_user" },
  paused: { title: "规划已暂停", subtitle: "当前不能安全生成下一步调整。", status: "awaiting_user" },
  failed: { title: "暂时无法完成规划", subtitle: "当前计划保持不变；可稍后重新检查。", status: "error" },
};

/**
 * Gates professional copy to passage ids produced in this run. A missing
 * citation is intentionally represented as cannot_judge rather than silently
 * removing the uncertainty from the card.
 */
export function projectPlannerProgress(input: PlannerProgressInput, currentRunPassageIds: ReadonlySet<string>): PlannerProgressProjection {
  const base = STAGE_PRESENTATION[input.stage];
  const claims: VerifiedPlannerClaim[] = [];
  const cannotJudge: string[] = [];
  for (const claim of input.professionalClaims ?? []) {
    const passageIds = [...new Set(claim.passageIds)].filter((id) => currentRunPassageIds.has(id));
    if (passageIds.length > 0) {
      claims.push({ text: claim.text, passageIds });
    } else {
      cannotJudge.push("专业解释缺少本轮知识检索依据，暂无法判断。");
    }
  }
  const sections: Array<{ title: string; items: readonly string[] }> = [];
  if (input.factBasis.length) sections.push({ title: "事实依据", items: input.factBasis });
  if (claims.length) sections.push({ title: "依据说明", items: claims.map((claim) => claim.text) });
  if (input.requestedInformation?.length) sections.push({ title: "需要补充", items: input.requestedInformation });
  if (input.proposal) {
    if (input.proposal.tradeoffs.length) sections.push({ title: "取舍", items: input.proposal.tradeoffs });
    sections.push({ title: "执行负担", items: [input.proposal.executionBurden] });
    sections.push({ title: "下次验证", items: [input.proposal.nextVerificationSignal] });
    sections.push({ title: "确认后的影响", items: [input.proposal.effectAfterConfirmation] });
  }
  if (cannotJudge.length) sections.push({ title: "暂无法判断", items: [...new Set(cannotJudge)] });
  if (input.message) sections.push({ title: input.stage === "failed" ? "说明" : "当前限制", items: [input.message] });
  return { stage: input.stage, ...base, claims, cannotJudge: [...new Set(cannotJudge)], sections };
}
