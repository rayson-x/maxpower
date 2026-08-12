import assert from "node:assert/strict";
import test from "node:test";

import { CoachStreamProjection } from "../../src/coach/ui/coachStreamProjection";
import type { ActionReceiptArtifact, EvidenceBriefArtifact, ExerciseSubstitutionArtifact, MesocycleReviewArtifact, TodayPlanArtifact } from "../../src/coach/model";
import { ArtifactCardRegistry } from "../../src/coach/cards";

const plan: TodayPlanArtifact = {
  id: "artifact-today",
  kind: "today_plan",
  schemaVersion: 1,
  renderVersion: 1,
  createdAt: "2026-08-08T08:00:00.000Z",
  contextRefs: [{ kind: "today", ref: "2026-08-08" }],
  evidenceRefs: [{ aggregate: "plan", id: "plan", revision: 4 }],
  missingness: [],
  capabilityBoundary: [],
  hash: "artifact-hash",
  date: "2026-08-08",
  title: "今日上肢推",
  planRevision: 4,
  tasks: [{ id: "bench", name: "杠铃卧推", sets: 4, reps: "8", targetRir: 2 }],
};

const receipt: ActionReceiptArtifact = {
  id: "artifact-receipt",
  kind: "action_receipt",
  schemaVersion: 1,
  renderVersion: 1,
  createdAt: "2026-08-08T08:02:00.000Z",
  contextRefs: [{ kind: "plan", ref: "plan:4" }],
  evidenceRefs: [],
  missingness: [],
  capabilityBoundary: ["撤销会创建补偿版本，不删除历史"],
  hash: "receipt-hash",
  action: "apply",
  targetArtifactId: "proposal-1",
  result: "applied",
  beforeRevision: 4,
  afterRevision: 5,
};

const artifactBase = {
  schemaVersion: 1 as const,
  renderVersion: 1 as const,
  createdAt: "2026-08-08T08:00:00.000Z",
  contextRefs: [{ kind: "plan" as const, ref: "plan:4" }],
  evidenceRefs: [{ aggregate: "plan" as const, id: "plan", revision: 4 }],
  missingness: [],
  capabilityBoundary: [],
};

test("闭合 Registry 覆盖平替、周期回顾和依据 Artifact，不接受模型自定义 renderer", () => {
  const registry = new ArtifactCardRegistry();
  const artifacts: readonly (ExerciseSubstitutionArtifact | MesocycleReviewArtifact | EvidenceBriefArtifact)[] = [
    {
      ...artifactBase, id: "substitution", hash: "substitution-hash", kind: "exercise_substitution", userId: "u1", sourceExerciseVariantId: "bench",
      candidates: [{ exerciseVariantId: "dumbbell-press", label: "哑铃卧推", stimulusFit: "matches", equipmentFit: "available", comparableLoadHistory: "cold_start" }],
    },
    {
      ...artifactBase, id: "review", hash: "review-hash", kind: "mesocycle_review", userId: "u1", period: { start: "2026-08-01", end: "2026-08-28" }, status: "adjust", summary: ["完成率下降"],
    },
    {
      ...artifactBase, id: "brief", hash: "brief-hash", kind: "evidence_brief", userId: "u1", title: "调整依据", summary: ["来自已确认训练记录"],
    },
  ];
  assert.deepEqual(artifacts.map((artifact) => registry.render(artifact, "ready").renderer), [
    "exercise-substitution/v1", "mesocycle-review/v1", "evidence-brief/v1",
  ]);
});

test("TodayPlan stream 在同一 presentation 原位从 loading 更新为 ready", () => {
  const stream = new CoachStreamProjection([plan]);

  stream.accept({
    type: "tool-started",
    sessionId: "session-1",
    runId: "run-1",
    toolCallId: "tool-call-1",
    toolName: "plan.show_today",
    presentationId: "presentation-1",
    occurredAt: "2026-08-08T08:00:00.000Z",
  });

  const loading = stream.snapshot();
  assert.equal(loading.status, "streaming");
  assert.equal(loading.parts.length, 2);
  assert.deepEqual(loading.parts.map((part) => part.id), [
    "tool:tool-call-1",
    "presentation:presentation-1",
  ]);
  assert.equal(loading.parts[0]?.state, "input-streaming");
  assert.equal(loading.parts[1]?.state, "loading");

  stream.accept({
    type: "artifact-ready",
    sessionId: "session-1",
    runId: "run-1",
    toolCallId: "tool-call-1",
    artifactRef: {
      id: plan.id,
      kind: plan.kind,
      schemaVersion: plan.schemaVersion,
      hash: plan.hash,
    },
    presentation: {
      id: "presentation-1",
      artifactId: plan.id,
      renderer: "today-plan/v1",
      status: "ready",
    },
    occurredAt: "2026-08-08T08:00:01.000Z",
  });

  const ready = stream.snapshot();
  assert.equal(ready.status, "ready");
  assert.equal(ready.parts.length, 2);
  assert.deepEqual(ready.parts.map((part) => part.id), [
    "tool:tool-call-1",
    "presentation:presentation-1",
  ]);
  assert.equal(ready.parts[0]?.state, "output-available");
  assert.equal(ready.parts[1]?.state, "ready");
  assert.equal(ready.parts[1]?.type, "data-artifact-card");
  if (ready.parts[1]?.type === "data-artifact-card") {
    assert.equal(ready.parts[1].data.card?.title, "今日上肢推");
  }
});

test("AI SDK 风格 tool state 与 HITL 在同一 part 原位暂停和恢复", () => {
  const stream = new CoachStreamProjection();
  stream.accept({
    type: "tool-state",
    sessionId: "session-1",
    runId: "run-1",
    toolCallId: "choice-1",
    toolName: "ui.request_choice",
    state: "input-available",
    occurredAt: "2026-08-08T08:00:00.000Z",
  });
  stream.accept({
    type: "hitl-suspended",
    sessionId: "session-1",
    runId: "run-1",
    toolCallId: "choice-1",
    pendingActionId: "pending-1",
    presentationId: "presentation-1",
    occurredAt: "2026-08-08T08:00:01.000Z",
  });
  assert.equal(stream.snapshot().status, "streaming");
  assert.equal(
    stream.snapshot().parts.find((part) => part.id === "human-action:pending-1")?.state,
    "awaiting_user",
  );
  stream.accept({
    type: "hitl-resumed",
    sessionId: "session-1",
    runId: "run-1",
    toolCallId: "choice-1",
    pendingActionId: "pending-1",
    presentationId: "presentation-1",
    occurredAt: "2026-08-08T08:00:02.000Z",
  });
  stream.accept({
    type: "tool-state",
    sessionId: "session-1",
    runId: "run-1",
    toolCallId: "choice-1",
    toolName: "ui.request_choice",
    state: "output-available",
    occurredAt: "2026-08-08T08:00:02.000Z",
  });
  assert.equal(stream.snapshot().status, "ready");
  assert.equal(
    stream.snapshot().parts.find((part) => part.id === "human-action:pending-1")?.state,
    "resolved",
  );
});

test("恢复会话时使用当前 presentation 状态，并将 ActionReceipt 渲染为独立稳定卡片", () => {
  const stream = new CoachStreamProjection(
    [plan, receipt],
    undefined,
    [
      { id: "presentation-plan", artifactId: plan.id, renderer: "today-plan/v1", status: "applied" },
      { id: "presentation-receipt", artifactId: receipt.id, renderer: "action-receipt/v1", status: "ready" },
    ],
  );
  stream.accept({
    type: "artifact-ready",
    sessionId: "session-1",
    runId: "run-1",
    toolCallId: "tool-plan",
    artifactRef: { id: plan.id, kind: plan.kind, schemaVersion: plan.schemaVersion, hash: plan.hash },
    presentation: { id: "presentation-plan", artifactId: plan.id, renderer: "today-plan/v1", status: "awaiting_user" },
    occurredAt: "2026-08-08T08:00:00.000Z",
  });
  stream.accept({
    type: "action-receipt",
    sessionId: "session-1",
    runId: "run-1",
    toolCallId: "tool-plan",
    artifactRef: { id: receipt.id, kind: receipt.kind, schemaVersion: receipt.schemaVersion, hash: receipt.hash },
    occurredAt: "2026-08-08T08:02:00.000Z",
  });

  const cards = stream.snapshot().parts.filter((part) => part.type === "data-artifact-card");
  assert.equal(cards.length, 2);
  assert.equal(cards[0]?.type, "data-artifact-card");
  assert.equal(cards[1]?.type, "data-artifact-card");
  if (cards[0]?.type === "data-artifact-card" && cards[1]?.type === "data-artifact-card") {
    assert.equal(cards[0].state, "applied");
    assert.equal(cards[1].data.card?.title, "计划已更新");
    assert.equal(cards[1].data.card?.actions[0]?.id, "undo");
  }
});

test("未知 renderer 使用不可操作的稳定 fallback 卡片", () => {
  const stream = new CoachStreamProjection([plan]);

  stream.accept({
    type: "artifact-ready",
    sessionId: "session-1",
    runId: "run-1",
    toolCallId: "tool-call-unknown",
    artifactRef: {
      id: plan.id,
      kind: plan.kind,
      schemaVersion: plan.schemaVersion,
      hash: plan.hash,
    },
    presentation: {
      id: "presentation-unknown",
      artifactId: plan.id,
      renderer: "model-authored-component/v99",
      status: "ready",
    },
    occurredAt: "2026-08-08T08:00:01.000Z",
  });

  const artifactPart = stream
    .snapshot()
    .parts.find((part) => part.type === "data-artifact-card");
  assert.equal(artifactPart?.type, "data-artifact-card");
  if (artifactPart?.type === "data-artifact-card") {
    assert.equal(artifactPart.data.card?.renderer, "artifact-fallback/v1");
    assert.equal(artifactPart.data.card?.actions.length, 0);
    assert.equal(artifactPart.data.card?.status, "error");
    assert.match(artifactPart.data.card?.subtitle ?? "", /today_plan · schema v1 · ready/);
  }
});

test("artifact ref 或 presentation identity 不一致时拒绝展示缓存内容", () => {
  const stream = new CoachStreamProjection([plan]);

  stream.accept({
    type: "artifact-ready",
    sessionId: "session-1",
    runId: "run-1",
    toolCallId: "tool-call-mismatch",
    artifactRef: {
      id: plan.id,
      kind: plan.kind,
      schemaVersion: plan.schemaVersion,
      hash: "newer-hash-not-in-client",
    },
    presentation: {
      id: "presentation-mismatch",
      artifactId: "another-artifact",
      renderer: "today-plan/v1",
      status: "ready",
    },
    occurredAt: "2026-08-08T08:00:01.000Z",
  });

  const artifactPart = stream
    .snapshot()
    .parts.find((part) => part.type === "data-artifact-card");
  assert.equal(artifactPart?.type, "data-artifact-card");
  if (artifactPart?.type === "data-artifact-card") {
    assert.equal(artifactPart.state, "error");
    assert.equal(artifactPart.data.card?.renderer, "artifact-fallback/v1");
  }
});

test("empty 与 stream error 都给出稳定可恢复展示", () => {
  const stream = new CoachStreamProjection();

  assert.deepEqual(stream.snapshot(), {
    status: "empty",
    parts: [],
    emptyMessage: "还没有 Coach 内容",
  });

  stream.fail({
    id: "transport-1",
    message: "连接中断，请重试",
  });
  stream.fail({
    id: "transport-1",
    message: "连接中断，请重试",
  });

  assert.deepEqual(stream.snapshot(), {
    status: "error",
    parts: [
      {
        type: "data-stream-error",
        id: "error:transport-1",
        state: "error",
        data: { message: "连接中断，请重试" },
      },
    ],
    emptyMessage: "还没有 Coach 内容",
  });
});

test("同一 artifact 的新 presentation 会更新既有卡片而不是追加副本", () => {
  const stream = new CoachStreamProjection([plan]);
  const artifactReady = (
    presentationId: string,
    runId = "run-1",
    toolCallId = "tool-call-1",
  ) =>
    ({
      type: "artifact-ready" as const,
      sessionId: "session-1",
      runId,
      toolCallId,
      artifactRef: {
        id: plan.id,
        kind: plan.kind,
        schemaVersion: plan.schemaVersion,
        hash: plan.hash,
      },
      presentation: {
        id: presentationId,
        artifactId: plan.id,
        renderer: "today-plan/v1",
        status: "ready" as const,
      },
      occurredAt: "2026-08-08T08:00:01.000Z",
    });

  stream.accept(artifactReady("presentation-1"));
  stream.accept({
    type: "tool-started",
    sessionId: "session-1",
    runId: "run-2",
    toolCallId: "tool-call-2",
    toolName: "plan.show_today",
    presentationId: "presentation-2",
    occurredAt: "2026-08-08T08:00:02.000Z",
  });
  stream.accept(artifactReady("presentation-2", "run-2", "tool-call-2"));

  const cards = stream
    .snapshot()
    .parts.filter((part) => part.type === "data-artifact-card");
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.type, "data-artifact-card");
  if (cards[0]?.type === "data-artifact-card") {
    assert.equal(cards[0].data.presentationId, "presentation-2");
  }
});

test("text-only run 失败时原位结束 streaming 并保留部分输出", () => {
  const stream = new CoachStreamProjection();
  stream.accept({
    type: "text-delta",
    sessionId: "session-1",
    runId: "run-text-failed",
    delta: "已读取今天的计划",
    occurredAt: "2026-08-08T08:00:00.000Z",
  });
  stream.accept({
    type: "run-error",
    sessionId: "session-1",
    runId: "run-text-failed",
    code: "provider_error",
    message: "后续生成中断",
    occurredAt: "2026-08-08T08:00:01.000Z",
  });

  assert.deepEqual(stream.snapshot().parts, [
    {
      type: "text",
      id: "text:run-text-failed",
      state: "error",
      text: "已读取今天的计划",
      errorText: "后续生成中断",
    },
  ]);
});

test("canonical run-error 将活动 tool 与 loading card 原位切到失败", () => {
  const stream = new CoachStreamProjection([plan]);
  stream.accept({
    type: "tool-started",
    sessionId: "session-1",
    runId: "run-failed",
    toolCallId: "tool-call-failed",
    toolName: "plan.show_today",
    presentationId: "presentation-failed",
    occurredAt: "2026-08-08T08:00:00.000Z",
  });

  stream.accept({
    type: "run-error",
    sessionId: "session-1",
    runId: "run-failed",
    code: "provider_error",
    message: "Provider 暂不可用",
    occurredAt: "2026-08-08T08:00:01.000Z",
  });

  const failed = stream.snapshot();
  assert.equal(failed.status, "error");
  assert.equal(failed.parts.length, 2);
  assert.equal(failed.parts[0]?.state, "output-error");
  assert.equal(failed.parts[1]?.state, "error");
});

test("text、completion 与 live cue 使用稳定 AI-SDK-style part，未来事件安全忽略", () => {
  const stream = new CoachStreamProjection();
  stream.accept({
    type: "text-delta",
    sessionId: "session-1",
    runId: "run-stream",
    delta: "今天先做",
    occurredAt: "2026-08-08T08:00:00.000Z",
  });
  stream.accept({
    type: "text-delta",
    sessionId: "session-1",
    runId: "run-stream",
    delta: "卧推。",
    occurredAt: "2026-08-08T08:00:01.000Z",
  });
  stream.accept({
    type: "run-completed",
    sessionId: "session-1",
    runId: "run-stream",
    occurredAt: "2026-08-08T08:00:02.000Z",
  });
  stream.accept({
    type: "live-cue",
    sessionId: "session-1",
    runId: "run-stream",
    presentationId: "cue-current-set",
    setId: "set-1",
    message: "下一次保持同样节奏",
    occurredAt: "2026-08-08T08:00:03.000Z",
  });
  stream.accept({ type: "future-event" } as unknown as Parameters<typeof stream.accept>[0]);

  const snapshot = stream.snapshot();
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.parts.length, 2);
  assert.deepEqual(snapshot.parts[0], {
    type: "text",
    id: "text:run-stream",
    state: "done",
    text: "今天先做卧推。",
  });
  assert.deepEqual(snapshot.parts[1], {
    type: "data-live-cue",
    id: "presentation:cue-current-set",
    state: "ready",
    data: { setId: "set-1", message: "下一次保持同样节奏" },
  });
});
