import assert from "node:assert/strict";
import test from "node:test";

import { presentReplicaSyncOverview } from "../../src/product/replicaSyncPresentation";

test("同步状态将待上传变更呈现为可解释的本地状态", () => {
  const presentation = presentReplicaSyncOverview({
    status: "pending_upload",
    retryAvailable: true,
    outbox: { pending: 3, acknowledged: 8, conflicts: 0 },
    pendingDependencies: 0,
    rejected: 0,
    conflicts: [],
  });

  assert.equal(presentation.label, "等待同步");
  assert.equal(presentation.detail, "3 项本地更改等待同步");
  assert.equal(presentation.canRetry, true);
  assert.equal(presentation.retryLabel, "立即同步");
});

test("并发分支只能解释并引导用户新建版本，不能自动选择任意一方", () => {
  const presentation = presentReplicaSyncOverview({
    status: "conflict",
    retryAvailable: false,
    outbox: { pending: 0, acknowledged: 2, conflicts: 1 },
    pendingDependencies: 0,
    rejected: 0,
    conflicts: [{
      id: "conflict-1",
      aggregate: { kind: "plan", id: "plan-private-id", localRevision: 4, incomingRevision: 4 },
      receivedAt: "2026-08-09T12:00:00.000Z",
      source: { device: "another_device", actor: "user" },
      change: "plan_revised",
      resolution: "manual_new_revision_required",
    }],
  });

  assert.equal(presentation.label, "需要处理");
  assert.equal(presentation.canRetry, false);
  assert.deepEqual(presentation.conflicts, [{
    label: "计划安排出现并发版本",
    detail: "另一台设备的修改会保留；请在计划中确认后创建新版本。",
  }]);
  assert.doesNotMatch(JSON.stringify(presentation), /plan-private-id/);
});

test("停用或失败的同步不泄露 transport 内部错误，也不会提供虚假的操作", () => {
  const disabled = presentReplicaSyncOverview({
    status: "disabled",
    retryAvailable: false,
    outbox: { pending: 0, acknowledged: 0, conflicts: 0 },
    pendingDependencies: 0,
    rejected: 0,
    conflicts: [],
  });
  const retry = presentReplicaSyncOverview({
    status: "retry_needed",
    lastSucceededAt: "2026-08-09T08:00:00.000Z",
    retryAvailable: true,
    outbox: { pending: 1, acknowledged: 2, conflicts: 0 },
    pendingDependencies: 0,
    rejected: 0,
    conflicts: [],
  });

  assert.deepEqual(disabled, {
    label: "未启用",
    detail: "本机资料独立保存；启用同步后才会传输副本。",
    canRetry: false,
    conflicts: [],
  });
  assert.equal(retry.label, "等待重试");
  assert.equal(retry.detail, "上次同步未完成；本机资料保持可用。");
  assert.equal(retry.canRetry, true);
  assert.equal(retry.retryLabel, "重试同步");
});
