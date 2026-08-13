import assert from "node:assert/strict";
import test from "node:test";

import { projectCameraCoachPresentation } from "../../src/mobile/ui/cameraCoachPresentation";
import type { CoachStreamSnapshot } from "../../src/coach/ui/coachStreamProjection";

function snapshot(parts: CoachStreamSnapshot["parts"], status: CoachStreamSnapshot["status"] = "ready"): CoachStreamSnapshot {
  return { parts, status, emptyMessage: "" };
}

test("相机字幕最多保留三行，并区分本地识别、用户输入与流式 Coach", () => {
  const presentation = projectCameraCoachPresentation({
    localCue: "保持节奏，再完成两次",
    userMessage: "但不痛，下一组怎么办？",
    stream: snapshot([
      { type: "data-live-cue", id: "cue-1", state: "ready", data: { setId: "set-1", message: "右肩再向后一点" } },
      { type: "text", id: "text-1", state: "streaming", text: "既然是紧而不痛，先暂停这一组" },
    ], "streaming"),
  });

  assert.equal(presentation.captions.length, 3);
  assert.deepEqual(presentation.captions.map((line) => line.source), ["user", "local_vision", "coach"]);
  assert.equal(presentation.captions[2]?.state, "streaming");
  assert.equal(presentation.statusLabel, "Coach is replying", "缺省 locale 走英文（权威源）");
});

test("纯文本永不生成写入操作；只有结构化 artifact 才暴露明确确认", () => {
  const textOnly = projectCameraCoachPresentation({
    stream: snapshot([{ type: "text", id: "text-1", state: "done", text: "下一组可以减重。" }]),
  });
  assert.deepEqual(textOnly.actions, []);

  const proposed = projectCameraCoachPresentation({
    stream: snapshot([{
      type: "data-artifact-card",
      id: "proposal-1",
      state: "awaiting_user",
      data: {
        artifactId: "artifact-1",
        presentationId: "presentation-1",
        card: {
          renderer: "plan-change-proposal/v1",
          eyebrow: "下一组建议",
          artifactId: "artifact-1",
          title: "下一组降低 2.5 kg",
          subtitle: "只在确认后写入",
          metrics: [],
          taskList: [],
          actions: [
            { id: "reject", label: "保持原安排", enabled: true },
            { id: "apply", label: "写入下一组", enabled: true },
          ],
          status: "awaiting_user",
          evidenceLabels: [],
          capabilityBoundary: [],
        },
      },
    }]),
  });

  assert.deepEqual(proposed.actions.map((action) => action.label), ["保持原安排", "写入下一组"]);
  assert.ok(proposed.actions.every((action) => action.kind === "artifact"));
});

test("写入回执独立展示并保留撤销入口", () => {
  const presentation = projectCameraCoachPresentation({
    stream: snapshot([{
      type: "data-artifact-card",
      id: "receipt-1",
      state: "ready",
      data: {
        artifactId: "receipt-artifact-1",
        presentationId: "receipt-presentation-1",
        card: {
          renderer: "action-receipt/v1",
          eyebrow: "执行回执",
          artifactId: "receipt-artifact-1",
          title: "计划已更新",
          metrics: [],
          taskList: [],
          actions: [{ id: "undo", label: "撤销", enabled: true }],
          status: "ready",
          evidenceLabels: [],
          capabilityBoundary: [],
        },
      },
    }]),
  });

  assert.equal(presentation.receipt?.title, "计划已更新");
  assert.equal(presentation.actions[0]?.label, "撤销");
});
