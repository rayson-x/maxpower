import assert from "node:assert/strict";
import test from "node:test";

import { ContextAssembler } from "../../src/coach/adapters/provider";
import { EMPTY_LEDGER_SNAPSHOT } from "../../src/coach/ledger";
import type { CoachMessage, LedgerSnapshot, WorkingMemoryItem } from "../../src/coach/model";

const BASE = "2026-08-08T08:00:00.000Z";

function message(id: string, runId: string, index: number): CoachMessage {
  return {
    id,
    userId: "user-1",
    sessionId: "session-1",
    runId,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `消息 ${id} `.repeat(4),
    createdAt: new Date(Date.parse(BASE) + index * 1000).toISOString(),
  };
}

function snapshotWith(input: {
  messages?: CoachMessage[];
  workingMemory?: WorkingMemoryItem[];
}): LedgerSnapshot {
  return {
    ...EMPTY_LEDGER_SNAPSHOT,
    users: [
      {
        userId: "user-1",
        profile: { goal: "hypertrophy", trainingExperience: "intermediate" },
        profileRevision: 1,
        plan: {
          revision: 1,
          effectiveDate: "2026-08-08",
          title: "上肢推",
          tasks: [{ id: "bench", name: "卧推", sets: 3, reps: "8", loadKg: 60, targetRir: 2 }],
        },
        timeline: [],
        timelineRevision: 0,
        mandate: { mode: "collaborative", revision: 1 },
        safetyHold: false,
      },
    ],
    messages: input.messages ?? [],
    workingMemory: input.workingMemory ?? [],
  };
}

function memoryItem(id: string, pinned: boolean): WorkingMemoryItem {
  return {
    id,
    userId: "user-1",
    kind: "strategy_note",
    content: `笔记 ${id} `.repeat(20),
    evidenceRefs: [],
    provenance: { actor: "agent" },
    authority: "non_authoritative",
    confidence: 0.5,
    version: 1,
    sensitivity: "normal",
    pinned,
    createdAt: BASE,
    updatedAt: BASE,
  };
}

test("短会话无压缩：全部原文、无预算裁剪记录之外的变更", () => {
  const assembler = new ContextAssembler();
  const messages = Array.from({ length: 6 }, (_, i) => message(`m${i}`, "run-1", i));
  const { context, contextManifest } = assembler.assemble(
    snapshotWith({ messages }),
    "user-1",
    "session-1",
  );
  assert.equal(context.currentConversation.length, 6);
  assert.equal(context.conversationSummaries.length, 0);
  assert.equal(contextManifest.contextBudget?.conversation, "verbatim");
});

test("长会话超出窗口：窗口内保留原文，更早消息按 run 摘要并记入 manifest", () => {
  const assembler = new ContextAssembler();
  const messages = [
    ...Array.from({ length: 30 }, (_, i) => message(`a${i}`, "run-1", i)),
    ...Array.from({ length: 30 }, (_, i) => message(`b${i}`, "run-2", 30 + i)),
    ...Array.from({ length: 30 }, (_, i) => message(`c${i}`, "run-3", 60 + i)),
  ];
  const { context, contextManifest } = assembler.assemble(
    snapshotWith({ messages }),
    "user-1",
    "session-1",
  );
  assert.equal(context.currentConversation.length, 40);
  assert.equal(context.currentConversation.at(-1)?.id, "c29");
  assert.ok(context.conversationSummaries.length >= 2);
  const summarized = context.conversationSummaries.reduce(
    (sum, group) => sum + (group.messageCount as number),
    0,
  );
  assert.equal(summarized, 50);
  assert.equal(contextManifest.contextBudget?.conversation, "run_summary_window");
});

test("极小预算按固定顺序降级：对话先裁到全摘要、非置顶记忆被裁、置顶记忆与权威事实保留", () => {
  const assembler = new ContextAssembler();
  const messages = Array.from({ length: 90 }, (_, i) => message(`m${i}`, "run-1", i));
  const { context, contextManifest } = assembler.assemble(
    snapshotWith({
      messages,
      workingMemory: [memoryItem("mem-pinned", true), memoryItem("mem-loose", false)],
    }),
    "user-1",
    "session-1",
    { maxContextTokens: 200 },
  );
  assert.equal(context.currentConversation.length, 0);
  assert.ok(context.conversationSummaries.length >= 1);
  assert.deepEqual(
    context.workingMemory.map((item) => item.id),
    ["mem-pinned"],
  );
  assert.ok(Object.keys(context.profile).length > 0);
  assert.ok(Array.isArray(context.activeConstraints));
  assert.equal(contextManifest.contextBudget?.conversation, "summarized");
  assert.ok(contextManifest.contextBudget?.droppedSections.includes("working_memory_unpinned"));
});

test("中等预算先裁对话窗口、保留工作记忆", () => {
  const assembler = new ContextAssembler();
  const messages = Array.from({ length: 90 }, (_, i) => message(`m${i}`, "run-1", i));
  const baseline = assembler.assemble(
    snapshotWith({ messages, workingMemory: [memoryItem("mem-1", false)] }),
    "user-1",
    "session-1",
  );
  const memoryTokens = Math.ceil(JSON.stringify(baseline.context.workingMemory).length / 4);
  const budget = memoryTokens + 800;
  const { context } = assembler.assemble(
    snapshotWith({ messages, workingMemory: [memoryItem("mem-1", false)] }),
    "user-1",
    "session-1",
    { maxContextTokens: budget },
  );
  assert.ok(context.currentConversation.length < 40);
  assert.deepEqual(context.workingMemory.map((item) => item.id), ["mem-1"]);
});
