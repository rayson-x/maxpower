import type {
  ActionReceiptArtifact,
  Artifact,
  ArtifactCardModel,
  PlanChangeProposalArtifact,
  PresentationStatus,
  SetSummaryArtifact,
  TodayPlanArtifact,
} from "./model";

type Renderer = (artifact: Artifact, status: PresentationStatus) => ArtifactCardModel;

function todayPlanCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const plan = artifact as TodayPlanArtifact;
  const totalSets = plan.tasks.reduce((sum, task) => sum + task.sets, 0);
  const primaryRir = plan.tasks.find((task) => task.targetRir !== undefined)?.targetRir;
  return {
    renderer: "today-plan/v1",
    eyebrow: "今日计划",
    artifactId: plan.id,
    title: plan.title,
    subtitle: plan.date,
    metrics: [
      { label: "预计组数", value: String(totalSets) },
      { label: "动作", value: String(plan.tasks.length) },
      { label: "主项目标", value: primaryRir === undefined ? "待记录" : `RIR ${primaryRir}` },
    ],
    taskList: plan.tasks,
    actions: [{ id: "start_workout", label: "开始训练", enabled: status === "ready" }],
    status,
    evidenceLabels: plan.evidenceRefs.map((ref) => `${ref.aggregate} r${ref.revision}`),
    capabilityBoundary: plan.capabilityBoundary,
  };
}

function proposalCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const proposal = artifact as PlanChangeProposalArtifact;
  return {
    renderer: "plan-change-proposal/v1",
    eyebrow: "计划调整",
    artifactId: proposal.id,
    title: "计划调整",
    subtitle: proposal.reason,
    metrics: Object.entries(proposal.after).map(([label, value]) => ({
      label,
      value: String(value ?? "未设置"),
    })),
    taskList: [],
    actions: [
      {
        id: "apply",
        label: "应用",
        enabled: status === "awaiting_user" && proposal.executionPolicy !== "advice_only",
      },
      { id: "reject", label: "保持原计划", enabled: status === "awaiting_user" },
    ],
    status,
    evidenceLabels: proposal.evidenceRefs.map((ref) => `${ref.aggregate} r${ref.revision}`),
    capabilityBoundary: proposal.capabilityBoundary,
  };
}

function receiptCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const receipt = artifact as ActionReceiptArtifact;
  return {
    renderer: "action-receipt/v1",
    eyebrow: "执行回执",
    artifactId: receipt.id,
    title: receipt.result === "undone" ? "已撤销调整" : receipt.result === "rejected" ? "已保持原计划" : "计划已更新",
    metrics:
      receipt.afterRevision === undefined
        ? []
        : [{ label: "计划版本", value: `r${receipt.afterRevision}` }],
    taskList: [],
    actions: receipt.result === "applied" ? [{ id: "undo", label: "撤销", enabled: true }] : [],
    status,
    evidenceLabels: receipt.evidenceRefs.map((ref) => `${ref.aggregate} r${ref.revision}`),
    capabilityBoundary: receipt.capabilityBoundary,
  };
}

function setSummaryCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const summary = artifact as SetSummaryArtifact;
  return {
    renderer: "set-summary/v1",
    eyebrow: "训练记录",
    artifactId: summary.id,
    title: "本组记录",
    metrics: [
      { label: "已确认", value: String(summary.confirmedReps) },
      { label: "待复核", value: String(summary.needsReviewReps) },
      {
        label: "主观 RIR",
        value: summary.userReported?.rir === undefined ? "待记录" : String(summary.userReported.rir),
      },
    ],
    taskList: [],
    actions: [],
    status,
    evidenceLabels: ["canonical motion observation", "user-reported load/RIR"],
    capabilityBoundary: summary.capabilityBoundary,
  };
}

export class ArtifactCardRegistry {
  private readonly renderers = new Map<string, Renderer>([
    ["today_plan/1", todayPlanCard],
    ["plan_change_proposal/1", proposalCard],
    ["action_receipt/1", receiptCard],
    ["set_summary/1", setSummaryCard],
  ]);

  render(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
    const renderer = this.renderers.get(`${artifact.kind}/${artifact.schemaVersion}`);
    if (renderer) return renderer(artifact, status);
    return {
      renderer: "artifact-fallback/v1",
      eyebrow: "无法显示",
      artifactId: artifact.id,
      title: "暂不支持的卡片",
      metrics: [],
      taskList: [],
      actions: [],
      status: "error",
      evidenceLabels: [],
      capabilityBoundary: ["当前客户端无法安全渲染此版本，已禁止操作"],
    };
  }
}
