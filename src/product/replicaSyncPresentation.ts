import type { ReplicaSyncOverview } from "../sync";

/**
 * A compact, UI-safe projection of the local ReplicaSynchronizer state.
 *
 * The synchronizer remains the authority for cursor, transport errors and
 * conflicts. This presentation deliberately exposes neither those values nor
 * device/aggregate identifiers: a person needs to know whether a copy is
 * waiting, whether a retry is safe, and that a concurrent edit needs a new
 * user-authored revision.
 */
export interface ReplicaSyncPresentation {
  readonly label: string;
  readonly detail: string;
  readonly canRetry: boolean;
  readonly retryLabel?: "立即同步" | "重试同步";
  readonly conflicts: readonly ReplicaSyncConflictPresentation[];
}

export interface ReplicaSyncConflictPresentation {
  readonly label: string;
  readonly detail: string;
}

export function presentReplicaSyncOverview(overview: ReplicaSyncOverview): ReplicaSyncPresentation {
  const shared = {
    canRetry: overview.retryAvailable,
    ...(overview.retryAvailable
      ? { retryLabel: overview.status === "pending_upload" || overview.status === "not_started" ? "立即同步" as const : "重试同步" as const }
      : {}),
  };
  switch (overview.status) {
    case "disabled":
      return { label: "未启用", detail: "本机资料独立保存；启用同步后才会传输副本。", ...shared, conflicts: [] };
    case "not_started":
      return { label: "尚未同步", detail: "可在账号连接后同步这台设备的副本。", ...shared, conflicts: [] };
    case "synchronized":
      return {
        label: "已同步",
        detail: overview.lastSucceededAt ? `最近同步于 ${formatMoment(overview.lastSucceededAt)}` : "本机副本已是最新状态。",
        ...shared,
        conflicts: [],
      };
    case "pending_upload":
      return {
        label: "等待同步",
        detail: `${overview.outbox.pending} 项本地更改等待同步`,
        ...shared,
        conflicts: [],
      };
    case "pending_dependency":
      return {
        label: "等待资料",
        detail: `${overview.pendingDependencies} 项变更正在等待关联资料。`,
        ...shared,
        conflicts: [],
      };
    case "conflict":
      return {
        label: "需要处理",
        detail: "发现并发修改；系统不会自动选择任意一份安排。",
        ...shared,
        conflicts: overview.conflicts.map(presentConflict),
      };
    case "rejected":
      return {
        label: "需要检查",
        detail: "有一部分副本未能接收；本机资料不会被移除。",
        ...shared,
        conflicts: [],
      };
    case "retry_needed":
      return {
        label: "等待重试",
        detail: "上次同步未完成；本机资料保持可用。",
        ...shared,
        conflicts: [],
      };
  }
}

function presentConflict(conflict: ReplicaSyncOverview["conflicts"][number]): ReplicaSyncConflictPresentation {
  const label = conflict.change === "goal_contract_revised"
    ? "目标出现并发版本"
    : conflict.change === "coaching_mandate_revised"
      ? "教练权限出现并发版本"
      : conflict.change === "plan_revised"
        ? "计划安排出现并发版本"
        : "资料出现并发版本";
  return {
    label,
    detail: "另一台设备的修改会保留；请在计划中确认后创建新版本。",
  };
}

function formatMoment(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "最近一次完成后" : value.slice(0, 16).replace("T", " ");
}
