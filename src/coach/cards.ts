import type {
  ActionReceiptArtifact,
  Artifact,
  ArtifactCardModel,
  EvidenceBriefArtifact,
  ExerciseSubstitutionArtifact,
  GoalForecastArtifact,
  PlanChangeProposalArtifact,
  PlanOverviewArtifact,
  PresentationStatus,
  ReplanEvaluationArtifact,
  SetSummaryArtifact,
  TodayPlanArtifact,
  WeeklyCoachReportArtifact,
  NutritionObservationDraftArtifact,
  NutritionChangeProposalArtifact,
  RecoveryBriefArtifact,
  SafetyHoldArtifact,
  NutritionStrategyArtifact,
  MesocycleReviewArtifact,
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
    actions: plan.tasks.length ? [{ id: "start_workout", label: "开始训练", enabled: status === "ready" }] : [],
    status,
    evidenceLabels: plan.evidenceRefs.map((ref) => `${ref.aggregate} r${ref.revision}`),
    capabilityBoundary: plan.capabilityBoundary,
  };
}

function planOverviewCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const plan = artifact as PlanOverviewArtifact;
  const strategyLabels: Record<string, string> = {
    conservative_gain: "保守增肌",
    stable_strength_gain: "稳定增力",
    preserve_lean_mass_cut: "保肌减脂",
    fat_loss_recomposition: "减脂重组",
    maintenance_recomposition: "维持重组",
    recovery_maintenance: "恢复维持",
    return_to_training: "停训回归",
  };
  const energy = plan.nutrition?.energyRange;
  const protein = plan.nutrition?.proteinGrams;
  const todayIntake = plan.nutrition?.today;
  const todayKind = todayIntake?.dayKind === "training" ? "训练日" : todayIntake?.dayKind === "rest" ? "休息日" : todayIntake?.dayKind === "deload" ? "减量日" : todayIntake?.dayKind === "recovery" ? "恢复日" : "今日";
  return {
    renderer: "plan_overview/1",
    eyebrow: "训练与摄入计划",
    artifactId: plan.id,
    title: strategyLabels[plan.strategy] ?? "当前训练计划",
    subtitle: `${plan.window.start}—${plan.window.end} · 版本 r${plan.planRevision}`,
    metrics: [
      { label: "训练", value: `${plan.trainingDays} 天 / ${plan.totalWorkSets} 组` },
      { label: todayIntake?.recommendedKcal === undefined ? "热量" : `${todayKind}摄入`, value: todayIntake?.recommendedKcal === undefined ? energy ? `${Math.round(energy.min)}–${Math.round(energy.max)} kcal` : "先记录基线" : `${Math.round(todayIntake.recommendedKcal)} kcal` },
      { label: "蛋白质", value: protein ? `${protein.min}–${protein.max} g` : "补体重后计算" },
    ],
    taskList: plan.tasks.map((task) => ({ ...task, name: `${task.scheduledFor.slice(5)} · ${task.name}` })),
    actions: [],
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

function exerciseSubstitutionCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const substitution = artifact as ExerciseSubstitutionArtifact;
  const strongest = substitution.candidates[0];
  return {
    renderer: "exercise-substitution/v1",
    eyebrow: "动作选择",
    artifactId: substitution.id,
    title: strongest ? `可考虑 ${strongest.label}` : "暂时没有合适平替",
    subtitle: "选择动作后会按新的可比训练上下文记录，不沿用原动作的绝对重量。",
    metrics: strongest
      ? [
          { label: "刺激匹配", value: strongest.stimulusFit === "matches" ? "匹配" : strongest.stimulusFit === "partial" ? "部分" : "待确认" },
          { label: "器材", value: strongest.equipmentFit === "available" ? "可用" : strongest.equipmentFit === "unavailable" ? "不可用" : "待确认" },
          { label: "负荷历史", value: strongest.comparableLoadHistory === "available" ? "可比较" : strongest.comparableLoadHistory === "cold_start" ? "需校准" : "不可比" },
        ]
      : [],
    taskList: [],
    actions: [],
    status,
    evidenceLabels: substitution.evidenceRefs.map((ref) => `${ref.aggregate} r${ref.revision}`),
    capabilityBoundary: substitution.capabilityBoundary,
  };
}

function receiptCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const receipt = artifact as ActionReceiptArtifact;
  const isNutrition = receipt.targetKind === "nutrition";
  return {
    renderer: "action-receipt/v1",
    eyebrow: "执行回执",
    artifactId: receipt.id,
    title: receipt.result === "undone"
      ? "已撤销调整"
      : receipt.result === "rejected"
        ? isNutrition ? "已保持当前饮食安排" : "已保持原计划"
        : isNutrition ? "饮食安排已更新" : "计划已更新",
    metrics:
      receipt.afterRevision === undefined
        ? []
        : [{ label: isNutrition ? "饮食版本" : "计划版本", value: `r${receipt.afterRevision}` }],
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

function replanEvaluationCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const replan = artifact as ReplanEvaluationArtifact;
  const { evaluation } = replan;
  const deferred = evaluation.outcome === "proposal_deferred";
  const unchanged = evaluation.outcome === "no_change";
  return {
    renderer: "replan-evaluation/v1",
    eyebrow: "计划复核",
    artifactId: replan.id,
    title: unchanged
      ? "当前计划保持不变"
      : deferred
        ? "已记录，等待更多稳定证据"
        : "计划需要复核",
    subtitle: evaluation.trigger.kind,
    metrics: [
      { label: "结果", value: unchanged ? "保持" : deferred ? "暂不变更" : "待确认" },
      { label: "事实版本", value: String(evaluation.factFrontier.length) },
      { label: "预测情景", value: String(evaluation.forecasts.length) },
    ],
    taskList: [],
    actions: [],
    status,
    evidenceLabels: replan.evidenceRefs.map((ref) => `${ref.aggregate} r${ref.revision}`),
    capabilityBoundary: replan.capabilityBoundary,
  };
}

function goalForecastCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const forecastArtifact = artifact as GoalForecastArtifact;
  const base = forecastArtifact.forecasts.find((item) => item.scenario === "base");
  return {
    renderer: "goal_forecast/1",
    eyebrow: "目标路径",
    artifactId: forecastArtifact.id,
    title: base ? "按当前路径推进" : "暂时无法生成目标路径",
    subtitle: base
      ? `${forecastArtifact.evaluatedAt ? `复核于 ${forecastArtifact.evaluatedAt.slice(0, 10)} · ` : ""}${base.milestones[0]?.description ?? "等待下一次已确认的本地复核"}`
      : "完成一次本地计划复核后，可显示保守、基准与进取三种情景",
    metrics: base
      ? [
          { label: "情景", value: String(forecastArtifact.forecasts.length) },
          { label: "基准置信度", value: base.confidence === "moderate" ? "中等" : "有限" },
          { label: "数据缺口", value: String(base.missingness.length) },
        ]
      : [],
    taskList: [],
    actions: [],
    status,
    evidenceLabels: forecastArtifact.evidenceRefs.map((ref) => `${ref.aggregate} r${ref.revision}`),
    capabilityBoundary: forecastArtifact.capabilityBoundary,
  };
}

function weeklyCoachReportCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const weekly = artifact as WeeklyCoachReportArtifact;
  const { report } = weekly;
  return {
    renderer: "weekly-coach-report/v1",
    eyebrow: "每周回顾",
    artifactId: weekly.id,
    title: "本周训练回顾",
    subtitle: `${weekly.window.start} · ${weekly.window.end}`,
    metrics: [
      { label: "计划组", value: String(report.plannedSetCount) },
      { label: "已完成", value: String(report.performedSetCount) },
      { label: "数据覆盖", value: report.dataCoverage === "complete" ? "完整" : report.dataCoverage === "partial" ? "部分" : "有限" },
    ],
    taskList: [],
    actions: [],
    status,
    evidenceLabels: weekly.evidenceRefs.map((ref) => `${ref.aggregate} r${ref.revision}`),
    capabilityBoundary: weekly.capabilityBoundary,
  };
}

function mesocycleReviewCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const review = artifact as MesocycleReviewArtifact;
  const statusLabel = {
    continue: "继续当前周期",
    adjust: "建议复核周期",
    complete: "周期已完成",
    insufficient_data: "数据仍不足",
  } as const;
  return {
    renderer: "mesocycle-review/v1",
    eyebrow: "周期回顾",
    artifactId: review.id,
    title: statusLabel[review.status],
    subtitle: `${review.period.start} · ${review.period.end}`,
    metrics: [{ label: "要点", value: String(review.summary.length) }],
    taskList: [],
    actions: [],
    status,
    evidenceLabels: review.evidenceRefs.map((ref) => `${ref.aggregate} r${ref.revision}`),
    capabilityBoundary: review.capabilityBoundary,
  };
}

function planTraceCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  if (artifact.kind !== "plan_trace") throw new Error("invalid_artifact_kind");
  const trace = artifact.trace;
  return {
    renderer: "plan_trace/1",
    eyebrow: "可观测性",
    artifactId: artifact.id,
    title: "计划推理链",
    subtitle: `结局：${trace.outcome.kind}`,
    taskList: [],
    metrics: [
      { label: "表现证据", value: String(trace.historySummary.count) },
      { label: "slot 推理", value: String(trace.slots.length) },
      { label: "约束事件", value: String(trace.constraintEvents.length) },
      { label: "决策码", value: String(trace.outcome.reasonCodes.length) },
    ],
    actions: [],
    status,
    evidenceLabels: [
      `输入指纹 ${trace.inputFingerprint.slice(0, 16)}`,
      ...(trace.splitSelection
        ? [`分化 ${trace.splitSelection.rotationId} · 每肌群每周约 ${trace.splitSelection.exposuresPerWeek} 次`]
        : []),
    ],
    capabilityBoundary: artifact.capabilityBoundary,
  };
}

function evidenceBriefCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const brief = artifact as EvidenceBriefArtifact;
  return {
    renderer: "evidence-brief/v1",
    eyebrow: "依据",
    artifactId: brief.id,
    title: brief.title,
    subtitle: brief.summary[0],
    metrics: [{ label: "依据", value: String(brief.evidenceRefs.length) }],
    taskList: [],
    actions: [],
    status,
    evidenceLabels: brief.evidenceRefs.map((ref) => `${ref.aggregate} r${ref.revision}`),
    capabilityBoundary: brief.capabilityBoundary,
  };
}

function nutritionObservationDraftCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const draft = artifact as NutritionObservationDraftArtifact;
  return {
    renderer: "nutrition-observation-draft/v1",
    eyebrow: "饮食记录",
    artifactId: draft.id,
    title: draft.draft.observation.description ?? "待确认的一餐",
    subtitle: draft.draft.clarificationRequired ? "还需要补充一点信息" : "估算仅用于记录，请确认或修改",
    metrics: [
      { label: "候选", value: String(draft.draft.estimates.length) },
      { label: "置信度", value: draft.draft.estimates[0]?.confidence ?? "低" },
    ],
    taskList: [],
    actions: [
      // A review surface exposes ranges, assumptions and an explicit edit
      // before it can dispatch the deterministic confirmation action.
      { id: "review", label: draft.draft.clarificationRequired ? "补充后确认" : "查看并确认", enabled: status === "awaiting_user" },
      { id: "reject", label: "不记录", enabled: status === "awaiting_user" },
    ],
    status,
    evidenceLabels: draft.draft.provider ? [`${draft.draft.provider.id} · ${draft.draft.provider.modelVersion}`] : ["本地输入"],
    capabilityBoundary: draft.capabilityBoundary,
  };
}

function nutritionChangeProposalCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const proposalArtifact = artifact as NutritionChangeProposalArtifact;
  const proposal = proposalArtifact.proposal;
  const beforeRange = proposal.before.calorieRange;
  const afterRange = proposal.after.calorieRange;
  const isDayTypeCoordination = proposal.changeKind === "day_type_coordination";
  return {
    renderer: "nutrition-change-proposal/1",
    eyebrow: isDayTypeCoordination ? "训练与饮食" : "饮食调整",
    artifactId: proposalArtifact.id,
    title: isDayTypeCoordination ? "同步本周训练与饮食节奏" : "建议复核饮食安排",
    subtitle: isDayTypeCoordination
      ? "只更新训练日、休息日与恢复日标记；能量目标保持不变"
      : proposal.reasonCodes.join(" · "),
    metrics: isDayTypeCoordination
      ? [
          { label: "计划日", value: String(proposal.after.dayTypes?.length ?? 0) },
          { label: "能量目标", value: "保持" },
          { label: "需确认", value: "是" },
        ]
      : [
          {
            label: "能量范围",
            value: beforeRange && afterRange
              ? `${beforeRange.min.value}–${beforeRange.max.value} → ${afterRange.min.value}–${afterRange.max.value} kcal`
              : "未估算",
          },
          { label: "观察窗口", value: `${proposal.evidenceWindow.comparableWeeks} 周` },
          { label: "预期方向", value: proposal.expectedDirection === "decrease" ? "下调" : proposal.expectedDirection === "increase" ? "上调" : "保持" },
        ],
    taskList: [],
    actions: [
      {
        id: "apply",
        label: "确认调整",
        enabled: status === "awaiting_user" && proposalArtifact.executionPolicy === "confirm",
      },
      { id: "reject", label: "保持当前安排", enabled: status === "awaiting_user" },
    ],
    status,
    evidenceLabels: proposalArtifact.evidenceRefs.map((ref) => `${ref.aggregate} r${ref.revision}`),
    capabilityBoundary: proposalArtifact.capabilityBoundary,
  };
}

function recoveryBriefCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const brief = artifact as RecoveryBriefArtifact;
  const labels = {
    normal: "按原计划",
    slight_reduction: "稍微放缓",
    recovery_priority: "优先恢复",
    pause_and_confirm: "暂停并确认",
  } as const;
  const constraint = brief.constraint;
  const intentions = constraint?.intentions ?? [];
  return {
    renderer: "recovery_brief/1",
    eyebrow: "恢复安排",
    artifactId: brief.id,
    title: constraint ? labels[constraint.level] : "当前没有恢复调整",
    subtitle: constraint
      ? brief.status === "timeline_assessment"
        ? "基于已记录事实的本地复核；尚未写入恢复约束"
        : `有效至 ${constraint.validUntil}`
      : brief.status === "expired_constraint"
        ? "上一条恢复约束已到期；可在训练前补充一次自检"
        : "补充今天的恢复感受后，才能判断是否需要调整",
    metrics: constraint
      ? [
          { label: "影响范围", value: constraint.scope ?? "下一次训练" },
          { label: "建议", value: intentions.length ? String(intentions.length) : "保持" },
          { label: "确认", value: constraint.evaluation?.confirmationRequired ? "需要" : "不需要" },
        ]
      : [],
    taskList: [],
    actions: [],
    status,
    evidenceLabels: brief.evidenceRefs.map((ref) => `${ref.aggregate} r${ref.revision}`),
    capabilityBoundary: brief.capabilityBoundary,
  };
}

function safetyHoldCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const hold = artifact as SafetyHoldArtifact;
  const constraint = hold.constraint;
  return {
    renderer: "safety_hold/1",
    eyebrow: "训练提示",
    artifactId: hold.id,
    title: constraint?.disposition === "stop_and_seek_professional_guidance"
      ? "先停止训练"
      : constraint
        ? "先暂停并确认"
        : "当前没有安全限制",
    subtitle: constraint
      ? constraint.reasons[0] ?? "当前限制需要先处理"
      : "如出现新的不适，请先记录感受或暂停训练",
    metrics: constraint
      ? [
          { label: "停止信号", value: String(constraint.stopSignals.length) },
          { label: "限制", value: constraint.validUntil ? `至 ${constraint.validUntil.slice(0, 10)}` : "持续有效" },
        ]
      : [],
    taskList: [],
    actions: [],
    status,
    evidenceLabels: hold.evidenceRefs.map((ref) => `${ref.aggregate} r${ref.revision}`),
    capabilityBoundary: hold.capabilityBoundary,
  };
}

function nutritionStrategyCard(artifact: Artifact, status: PresentationStatus): ArtifactCardModel {
  const strategyArtifact = artifact as NutritionStrategyArtifact;
  const strategy = strategyArtifact.strategy;
  const phaseLabel = {
    hypertrophy: "增肌",
    strength_stable: "增力 · 稳定体重",
    fat_loss_preserve_lean_mass: "减脂 · 保留肌肉",
  } as const;
  return {
    renderer: "nutrition_strategy/1",
    eyebrow: "饮食安排",
    artifactId: strategyArtifact.id,
    title: strategy?.status === "paused"
      ? "饮食安排已暂停"
      : strategy?.phase
        ? phaseLabel[strategy.phase]
        : "暂未建立饮食安排",
    subtitle: strategy?.status === "paused"
      ? "当前策略已暂停，需先处理限制条件"
      : strategy?.reviewWindow
        ? `复核期至 ${strategy.reviewWindow.endsAt}`
        : "建立目标和基础信息后可生成范围建议",
    metrics: strategy
      ? [
          {
            label: "能量范围",
            value: strategy.calorieRange
              ? `${Math.round(strategy.calorieRange.min.value)}–${Math.round(strategy.calorieRange.max.value)} ${strategy.calorieRange.min.unit}`
              : "待校准",
          },
          {
            label: "蛋白质",
            value: strategy.macronutrientTargets
              ? `${strategy.macronutrientTargets.proteinGrams.min}–${strategy.macronutrientTargets.proteinGrams.max} g`
              : "待设置",
          },
          { label: "置信度", value: strategy.confidence ?? "低" },
        ]
      : [],
    taskList: [],
    actions: [],
    status,
    evidenceLabels: strategyArtifact.evidenceRefs.map((ref) => `${ref.aggregate} r${ref.revision}`),
    capabilityBoundary: strategyArtifact.capabilityBoundary,
  };
}

export class ArtifactCardRegistry {
  private readonly renderers = new Map<string, Renderer>([
    ["today_plan/1", todayPlanCard],
    ["plan_overview/1", planOverviewCard],
    ["plan_change_proposal/1", proposalCard],
    ["exercise_substitution/1", exerciseSubstitutionCard],
    ["action_receipt/1", receiptCard],
    ["set_summary/1", setSummaryCard],
    ["replan_evaluation/1", replanEvaluationCard],
    ["goal_forecast/1", goalForecastCard],
    ["weekly_coach_report/1", weeklyCoachReportCard],
    ["mesocycle_review/1", mesocycleReviewCard],
    ["evidence_brief/1", evidenceBriefCard],
    ["plan_trace/1", planTraceCard],
    ["nutrition_observation_draft/1", nutritionObservationDraftCard],
    ["nutrition_change_proposal/1", nutritionChangeProposalCard],
    ["recovery_brief/1", recoveryBriefCard],
    ["safety_hold/1", safetyHoldCard],
    ["nutrition_strategy/1", nutritionStrategyCard],
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
