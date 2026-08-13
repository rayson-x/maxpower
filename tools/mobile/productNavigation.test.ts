import assert from "node:assert/strict";
import test from "node:test";

import {
  attachCoachToProductShell,
  applyInboundNavigationIntent,
  applyProductShellNavigation,
  decodeProductShellState,
  encodeProductShellState,
  initialProductNavigationState,
  initialProductShellState,
  markProductFormOpen,
  resolveUserDossierEntryRoute,
  resolveProductShellRecovery,
  resolveMaxPowerDeepLink,
} from "../../src/mobile/ui/productNavigation";

test("未完成 User dossier 的账号在首次产品投影后进入专门建档场景，而不是 Today", () => {
  assert.equal(
    resolveUserDossierEntryRoute({ requestedRoute: "today", onboardingRequired: true }),
    "onboarding",
  );
  assert.equal(
    resolveUserDossierEntryRoute({ requestedRoute: "plan", onboardingRequired: true }),
    "onboarding",
  );
  assert.equal(
    resolveUserDossierEntryRoute({ requestedRoute: "calendar", onboardingRequired: false }),
    "calendar",
  );
});

test("只解析注册的 MaxPower 内部深链，并保留明确的日期或训练标识", () => {
  assert.deepEqual(resolveMaxPowerDeepLink("maxpower://today/2026-08-09"), {
    route: "today",
    date: "2026-08-09",
  });
  assert.deepEqual(resolveMaxPowerDeepLink("maxpower://calendar/2028-02-29"), {
    route: "calendar",
    date: "2028-02-29",
  });
  assert.deepEqual(resolveMaxPowerDeepLink("maxpower://progress/2026-08-09"), {
    route: "progress",
    date: "2026-08-09",
  });
  assert.deepEqual(resolveMaxPowerDeepLink("maxpower://plan"), { route: "plan" });
  assert.deepEqual(resolveMaxPowerDeepLink("maxpower://profile"), { route: "profile" });
  assert.deepEqual(resolveMaxPowerDeepLink("maxpower://workout/workout-abc_01:2"), {
    route: "workout",
    workoutId: "workout-abc_01:2",
  });
});

test("拒绝任意 URL、错误日期、路径穿越、查询参数和未注册路由", () => {
  for (const value of [
    "https://maxpower://today/2026-08-09",
    "maxpower://today/2026-02-29",
    "maxpower://today/2026-02-30",
    "maxpower://today/2026-08-09?artifact=untrusted",
    "maxpower://plan/extra",
    "maxpower://workout/%2Fprivate",
    "maxpower://workout/../other",
    "maxpower://unknown/anything",
    "maxpower://progress/2026-08-09#untrusted",
  ]) {
    assert.equal(resolveMaxPowerDeepLink(value), undefined, value);
  }
});

test("外部路由只替换壳层展示状态，不会隐式创建训练或 Coach 会话", () => {
  const current = {
    ...initialProductNavigationState("2026-08-08"),
    route: "workout" as const,
    workoutId: "workout-active",
    calendarMode: "month" as const,
    coachExpanded: true,
  };

  assert.deepEqual(
    applyInboundNavigationIntent(current, { route: "calendar", date: "2026-08-09" }),
    {
      route: "calendar",
      date: "2026-08-09",
      calendarMode: "month",
      coachExpanded: false,
      workoutId: undefined,
    },
  );
  assert.deepEqual(
    applyInboundNavigationIntent(current, { route: "workout", workoutId: "workout-resume-9" }),
    {
      route: "workout",
      date: "2026-08-08",
      calendarMode: "month",
      coachExpanded: false,
      workoutId: "workout-resume-9",
    },
  );
});

test("壳层快照恢复选中日期与已附着 Coach，但把未提交输入降级为明确的丢弃状态", () => {
  const attached = attachCoachToProductShell(
    initialProductShellState("2026-08-08"),
    {
      sessionId: "coach-session:today-8",
      context: { kind: "today", ref: "2026-08-08" },
      foreground: "expanded",
    },
  );
  const withForm = markProductFormOpen(attached, {
    kind: "activity_log",
    recovery: "discard_on_process_restore",
  });
  const encoded = encodeProductShellState(withForm);

  assert.deepEqual(
    resolveProductShellRecovery(encoded, "2026-08-09"),
    {
      state: {
        navigation: {
          route: "today",
          date: "2026-08-08",
          calendarMode: "week",
          coachExpanded: true,
        },
        coachAttachment: {
          sessionId: "coach-session:today-8",
          context: { kind: "today", ref: "2026-08-08" },
          foreground: "expanded",
        },
      },
      formRecovery: {
        kind: "discarded",
        formKind: "activity_log",
      },
    },
  );
});

test("壳层只恢复已存在事实的引用；非法 Coach/Form 快照不会在进程恢复时变成新会话或新输入", () => {
  const recovery = resolveProductShellRecovery(JSON.stringify({
    schemaVersion: 1,
    navigation: {
      route: "profile",
      date: "2026-08-08",
      calendarMode: "month",
      coachExpanded: true,
      workoutId: "workout/unsafe",
    },
    coachAttachment: {
      sessionId: "coach-session/unsafe",
      context: { kind: "profile", ref: "profile" },
      foreground: "expanded",
    },
    unfinishedForm: {
      kind: "nutrition_draft_review",
      artifactId: "artifact/unsafe",
      recovery: "reopen_persisted_reference",
    },
  }), "2026-08-09");

  assert.deepEqual(recovery, {
    state: initialProductShellState("2026-08-09"),
    formRecovery: { kind: "none" },
  });
  assert.equal(decodeProductShellState("not-json", "2026-08-09"), undefined);
  assert.equal(
    decodeProductShellState(JSON.stringify({
      schemaVersion: 1,
      navigation: {
        route: "today",
        date: "2026-08-08",
        calendarMode: "week",
        coachExpanded: false,
      },
      unfinishedForm: {
        kind: "activity_log",
        recovery: "discard_on_process_restore",
        draftText: "this must never become a persisted fact",
      },
    }), "2026-08-09"),
    undefined,
  );
});

test("页面切换保留可复核的 Coach 附着引用、收起前台，并限制恢复表单只能引用持久 Artifact", () => {
  const initial = attachCoachToProductShell(initialProductShellState("2026-08-08"), {
    sessionId: "coach-session:plan-8",
    context: { kind: "plan", ref: "plan:7" },
    foreground: "expanded",
  });
  const onCalendar = applyProductShellNavigation(initial, {
    ...initialProductNavigationState("2026-08-08"),
    route: "calendar",
    calendarMode: "month",
  });
  assert.deepEqual(onCalendar, {
    navigation: {
      route: "calendar",
      date: "2026-08-08",
      calendarMode: "month",
      coachExpanded: false,
    },
    coachAttachment: {
      sessionId: "coach-session:plan-8",
      context: { kind: "plan", ref: "plan:7" },
      foreground: "minimized",
    },
  });

  assert.deepEqual(
    markProductFormOpen(onCalendar, {
      kind: "nutrition_draft_review",
      artifactId: "nutrition-draft:3",
      recovery: "reopen_persisted_reference",
    }),
    {
      ...onCalendar,
      unfinishedForm: {
        kind: "nutrition_draft_review",
        artifactId: "nutrition-draft:3",
        recovery: "reopen_persisted_reference",
      },
    },
  );
});
