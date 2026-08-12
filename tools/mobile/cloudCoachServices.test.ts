import assert from "node:assert/strict";
import test from "node:test";

import type { LLMProviderRequest } from "../../src/coach/adapters/provider";
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { InMemoryMediaBlobStore } from "../../src/privacy";
import { createCloudCoachServices } from "../../src/mobile/cloud/createCloudCoachServices";

function sseBody(lines: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

async function grantedLedger(accountId: string): Promise<InMemoryCoachLedger> {
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const app = new CoachApplication({
    ledger,
    runtime: {
      now: () => "2026-08-10T12:00:00.000+08:00",
      nextId: (prefix) => `cloud-runtime-${prefix}-${++sequence}`,
    },
  });
  const meta = {
    userId: accountId,
    actor: { kind: "user" as const, id: accountId },
    deviceId: "phone-1",
    occurredAt: "2026-08-10T12:00:00.000+08:00",
    timezoneOffsetMinutes: 480,
  };
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: { ...meta, idempotencyKey: "bootstrap" },
    profile: {
      id: "profile-1",
      trainingExperience: "intermediate",
      locale: "zh-CN",
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 },
      locations: [{ id: "gym-1", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
    },
    goalContract: {
      id: "goal-1",
      primaryGoal: "hypertrophy",
      horizon: { startDate: "2026-08-10", endDate: "2026-12-10" },
    },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
  await app.executeDomainCommand({
    type: "permission_set.revise",
    meta: { ...meta, idempotencyKey: "permissions" },
    permissionSetId: "permissions-1",
    expectedRevision: 0,
    permissionSet: {
      id: "permissions-1",
      camera: "not_configured",
      health: "not_configured",
      notifications: "not_configured",
      remoteLlm: "granted",
      cloudSync: "granted",
      mediaUpload: "granted",
    },
    authorization: {
      kind: "local_user_presence",
      verifiedAt: meta.occurredAt,
      nonce: "settings",
    },
  });
  return ledger;
}

function coachRequest(): LLMProviderRequest {
  return {
    sessionId: "session-1",
    runId: "run-1",
    userText: "展示当前计划",
    context: {
      userPseudonym: "local-user",
      profile: { trainingExperience: "beginner" },
      plan: {},
      timeline: [],
      workingMemory: [],
      activeConstraints: [],
      nutritionStrategies: [],
      goalCycles: [],
      canonicalEvidence: [],
      historicalSummaries: [],
      currentConversation: [],
      conversationSummaries: [],
    },
    contextManifest: {
      schemaVersion: 1,
      userPseudonym: "local-user",
      providerKind: "maxpower-pi-cloud",
      requestPurpose: "coach.general",
      assembledAt: "2026-08-10T04:00:00.000Z",
      factRefs: [],
      redactedPaths: [],
      includes: [],
      priority: ["authoritative_facts", "active_constraints", "working_memory", "conversation"],
      productionCompression: "none",
      retrievalFactRefs: [],
      summaryRefs: [],
      timeRange: {},
      mediaAttachments: [],
      redactionPolicyVersion: "direct-identifiers-v1",
    },
    toolManifest: [{
      name: "plan.show_current",
      schemaVersion: 1,
      accessClass: "read",
      executionMode: "local_deterministic",
      offlineAvailable: true,
      permissionScopes: [],
      riskCeiling: "none",
      evidenceRequirements: ["current_materialized_plan"],
      output: "artifact_ref",
      outputLimit: 1,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    }],
    modelInput: { systemPrompt: "local harness test prompt", userContent: JSON.stringify({ kind: "local_harness_test" }) },
  };
}

test("真实 Coach composition 使用 Pi provider 请求 MaxPower gateway 并还原本地工具名", async () => {
  const accountId = "account-a";
  const ledger = await grantedLedger(accountId);
  let requestUrl = "";
  let requestHeaders: Readonly<Record<string, string>> = {};
  let requestBody: Record<string, unknown> = {};
  const services = createCloudCoachServices({
    apiBaseUrl: "https://api.maxpower.example/ignored",
    accountId,
    accessTokens: { accessTokenFor: () => "short-lived-service-jwt" },
    accountSignal: new AbortController().signal,
    ledger,
    media: new InMemoryMediaBlobStore(),
    coachFetch: async (url, init) => {
      requestUrl = url;
      requestHeaders = init.headers;
      requestBody = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
      const tools = requestBody.tools as Array<{ function: { name: string } }>;
      const wireToolName = tools[0]?.function.name;
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name) => name.toLowerCase() === "x-maxpower-invocation-id"
            ? "llmi_pi_composition_1"
            : null,
        },
        body: sseBody([
          'id: 1\ndata: {"id":"chatcmpl-1","choices":[{"delta":{"content":"计划如下。"},"finish_reason":null}]}\n\n',
          `id: 2\ndata: ${JSON.stringify({
            id: "chatcmpl-1",
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: "call-1",
                  type: "function",
                  function: { name: wireToolName, arguments: "{}" },
                }],
              },
              finish_reason: "tool_calls",
            }],
          })}\n\n`,
          "data: [DONE]\n\n",
        ]),
      };
    },
  });
  const provider = await services.llmProviderResolver.resolve({
    userId: accountId,
    sessionId: "session-1",
  });
  assert.ok(provider);

  const events = [];
  for await (const event of provider.stream(coachRequest())) events.push(event);

  assert.equal(provider.kind, "maxpower-pi-cloud");
  assert.equal(requestUrl, "https://api.maxpower.example/v1/chat/completions");
  assert.equal(requestHeaders.authorization, "Bearer short-lived-service-jwt");
  assert.equal(requestBody.model, "maxpower/coach-v1");
  assert.equal(requestBody.stream, true);
  assert.equal(requestBody.store, false);
  assert.deepEqual(requestBody.stream_options, { include_usage: true });
  assert.notEqual(
    (requestBody.tools as Array<{ function: { name: string } }>)[0]?.function.name,
    "plan.show_current",
  );
  assert.deepEqual(events, [
    { type: "text-delta", delta: "计划如下。" },
    {
      type: "tool-input-delta",
      toolCallId: "call-1",
      toolName: "plan.show_current",
      delta: "{}",
    },
    {
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "plan.show_current",
      input: {},
    },
    { type: "completed" },
  ]);
});

test("登录后的核心云 Coach 不被旧的本地 remoteLlm 开关阻断", async () => {
  const accountId = "account-core-cloud";
  const services = createCloudCoachServices({
    apiBaseUrl: "https://api.maxpower.example",
    accountId,
    accessTokens: { accessTokenFor: () => "short-lived-service-jwt" },
    accountSignal: new AbortController().signal,
    ledger: new InMemoryCoachLedger(),
    media: new InMemoryMediaBlobStore(),
  });

  const provider = await services.llmProviderResolver.resolve({
    userId: accountId,
    sessionId: "session-core-cloud",
  });

  assert.equal(provider?.kind, "maxpower-pi-cloud");
});

test("云 Coach transport 始终调用 LLM API；它不在 provider 内执行恢复路由", async () => {
  const accountId = "account-deterministic-recovery";
  let networkCalls = 0;
  const services = createCloudCoachServices({
    apiBaseUrl: "https://api.maxpower.example",
    accountId,
    accessTokens: { accessTokenFor: () => "short-lived-service-jwt" },
    accountSignal: new AbortController().signal,
    ledger: new InMemoryCoachLedger(),
    media: new InMemoryMediaBlobStore(),
    coachFetch: async (_url, init) => {
      networkCalls += 1;
      const body = JSON.parse(init.body ?? "{}") as {
        tools: Array<{ function: { name: string; description: string } }>;
      };
      const tool = body.tools.find((candidate) => candidate.function.description.includes("plan.adapt_from_user_report"));
      assert.ok(tool);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: sseBody([
          `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{
            index: 0,
            id: "cloud-call-1",
            type: "function",
            function: {
              name: tool?.function.name,
              arguments: JSON.stringify({
                kind: "recovery",
                summary: "昨晚没睡好，前天练腿现在腿还酸，但上肢状态没问题，今天换肩练。",
                qualitativeAssessment: "poor_sleep_localized_lower_soreness",
                requestedTrainingFocus: "shoulders",
              }),
            },
          }] }, finish_reason: "tool_calls" }] })}\n\n`,
          "data: [DONE]\n\n",
        ]),
      };
    },
  });
  const provider = await services.llmProviderResolver.resolve({ userId: accountId, sessionId: "session-recovery" });
  assert.ok(provider);
  const request = coachRequest();
  const events = [];
  for await (const event of provider.stream({
    ...request,
    sessionId: "session-recovery",
    runId: "run-recovery",
    userText: "昨晚没睡好，前天练腿现在腿还酸，但上肢状态没问题，今天换肩练。",
    toolManifest: [{
      name: "plan.adapt_from_user_report",
      schemaVersion: 1,
      accessClass: "proposal",
      executionMode: "policy_gated",
      offlineAvailable: true,
      permissionScopes: ["coaching_mandate"],
      riskCeiling: "confirmation_required",
      evidenceRequirements: ["current_materialized_plan", "current_user_statement"],
      output: "artifact_ref",
      outputLimit: 1,
      inputSchema: { type: "object", additionalProperties: false },
    }],
  })) events.push(event);
  assert.equal(networkCalls, 1);
  assert.deepEqual(events.map((event) => event.type), ["tool-input-delta", "tool-call", "completed"]);
  assert.deepEqual(events[1], {
    type: "tool-call",
    toolCallId: "cloud-call-1",
    toolName: "plan.adapt_from_user_report",
    input: {
      kind: "recovery",
      summary: "昨晚没睡好，前天练腿现在腿还酸，但上肢状态没问题，今天换肩练。",
      qualitativeAssessment: "poor_sleep_localized_lower_soreness",
      requestedTrainingFocus: "shoulders",
    },
  });
});

test("真实云 AgentRuntime：由 LLM tool call 触发恢复调整，而非 provider 直路由", async () => {
  const accountId = "account-cloud-runtime-recovery";
  const ledger = await grantedLedger(accountId);
  let sequence = 0;
  let remoteToolCallSequence = 0;
  const services = createCloudCoachServices({
    apiBaseUrl: "https://api.maxpower.example",
    accountId,
    accessTokens: { accessTokenFor: () => "short-lived-service-jwt" },
    accountSignal: new AbortController().signal,
    ledger,
    media: new InMemoryMediaBlobStore(),
    coachFetch: async (_url, init) => {
      const body = JSON.parse(init.body ?? "{}") as {
        tools: Array<{ function: { name: string; description: string } }>;
      };
      const tool = body.tools.find((candidate) => candidate.function.description.includes("plan.adapt_from_user_report"));
      assert.ok(tool);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: sseBody([
          `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{
            index: 0,
            id: `cloud-runtime-tool-call-${++remoteToolCallSequence}`,
            type: "function",
            function: {
              name: tool?.function.name,
              arguments: JSON.stringify({
                kind: "recovery",
                summary: "睡眠差，腿部酸痛，用户希望练肩。",
                qualitativeAssessment: "poor_sleep_localized_lower_soreness",
                requestedTrainingFocus: "shoulders",
              }),
            },
          }] }, finish_reason: "tool_calls" }] })}\n\n`,
          "data: [DONE]\n\n",
        ]),
      };
    },
  });
  const app = new CoachApplication({
    ledger,
    runtime: {
      now: () => "2026-08-10T12:00:00.000+08:00",
      nextId: (prefix) => `cloud-agent-${prefix}-${++sequence}`,
    },
    llmProviderResolver: services.llmProviderResolver,
    actionToolsEnabled: true,
    knowledgeToolsEnabled: true,
  });
  await app.materializeGoalCycle({
    userId: accountId,
    trigger: "initial_plan",
    currentDate: "2026-08-10",
    idempotencyKey: "cloud-runtime-initial-plan",
  });
  const before = await app.readDomainProjection({ userId: accountId });
  const utterances = [
    "昨晚没睡好，前天练腿现在腿还酸，但上肢状态没问题，今天换肩练。",
    "睡眠差，腿有点酸，其他部位还行，想练肩。",
    "我睡不好，腿部还在酸痛，其他位置感觉可以，安排肩部。",
  ];
  for (const [index, text] of utterances.entries()) {
    const session = await app.startSession({ userId: accountId, context: { kind: "today", ref: "2026-08-10" }, title: `recovery-route-${index}` });
    await app.sendCoachTurn({ sessionId: session.id, text });
    const snapshot = await ledger.read();
    const call = [...snapshot.toolCalls].reverse().find((item) => item.toolName === "plan.adapt_from_user_report");
    assert.equal(call?.status, "output_available", `云 Agent 表达 ${index + 1} 必须实际执行本地工具，而不只是生成文字`);
    const preview = [...snapshot.artifacts].reverse().find(
      (artifact) => artifact.kind === "evidence_brief"
        && artifact.planningPreview?.status === "awaiting_confirmation"
        && artifact.planningPreview.request.trigger === "recovery_downgraded",
    );
    assert.ok(preview, `表达 ${index + 1} 工具执行后必须落下待确认恢复调整预览`);
    if (!preview || preview.kind !== "evidence_brief" || !preview.planningPreview) continue;
    const nextTraining = preview.planningPreview.proposal.planRevision.sessions.find((candidate) => candidate.tasks.length > 0);
    assert.match(nextTraining?.title ?? "", /肩/, `表达 ${index + 1} 落下的预览必须实际把下一节改为肩部课`);
    const after = await app.readDomainProjection({ userId: accountId });
    assert.equal(after.plan?.revision, before.plan?.revision, "确认前不得写入当前 PlanRevision");
  }
});
