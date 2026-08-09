import {
  DOMAIN_EVENT_SCHEMA_VERSION,
  type DomainAggregateRef,
  type DomainEvent,
  type PermissionSetData,
  type SafetyConstraintData,
  type TimelineFact,
} from "../coach/domain";
import type { ActionEvent, FactRef } from "../coach/model";
import type { CoachLedger, DomainAtomicCommit } from "../coach/ledger";
import type { RuntimeServices } from "../coach/model";
import { stableHash } from "../coach/stable";
import {
  ONBOARDING_DRAFT_SCHEMA_VERSION,
  OnboardingValidationError,
  type OnboardingCompletion,
  type OnboardingDraftEvent,
  type OnboardingPatch,
  type OnboardingProgress,
  type OnboardingSection,
} from "./model";

const REQUIRED_SECTIONS: readonly OnboardingSection[] = [
  "profile",
  "goal",
  "mandate",
  "permissions",
  "safety",
];

export class OnboardingService {
  constructor(private readonly ledger: CoachLedger, private readonly runtime: RuntimeServices) {}

  async start(input: { userId: string; depth: "basic" | "professional" }): Promise<OnboardingProgress> {
    const id = this.runtime.nextId("onboarding-draft");
    const recordedAt = this.runtime.now();
    const event: OnboardingDraftEvent = {
      id: this.runtime.nextId("onboarding-event"),
      schemaVersion: ONBOARDING_DRAFT_SCHEMA_VERSION,
      type: "onboarding.started",
      userId: input.userId,
      draftId: id,
      recordedAt,
      payload: { depth: input.depth },
    };
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: input.userId,
      intent: "onboarding.start",
      expectedRevisions: [],
      domainEvents: [],
      draftEvents: [event],
      idempotencyKey: `start:${id}`,
      recordedAt,
    });
    return this.read(id);
  }

  async save(input: {
    draftId: string;
    inputMode: "form" | "conversation";
    patch: OnboardingPatch;
    confirmedSections: readonly OnboardingSection[];
    idempotencyKey: string;
  }): Promise<OnboardingProgress> {
    const current = await this.read(input.draftId);
    if (current.status === "completed") throw new OnboardingValidationError("draft_completed");
    const recordedAt = this.runtime.now();
    const event: OnboardingDraftEvent = {
      id: this.runtime.nextId("onboarding-event"),
      schemaVersion: ONBOARDING_DRAFT_SCHEMA_VERSION,
      type: "onboarding.progress_saved",
      userId: current.userId,
      draftId: current.id,
      recordedAt,
      payload: {
        inputMode: input.inputMode,
        patch: input.patch,
        confirmedSections: input.confirmedSections,
      },
    };
    await this.ledger.commit({
      kind: "domain",
      userId: current.userId,
      actorId: current.userId,
      intent: "onboarding.save_progress",
      expectedRevisions: [],
      domainEvents: [],
      draftEvents: [event],
      idempotencyKey: input.idempotencyKey,
      recordedAt,
    });
    return this.read(input.draftId);
  }

  async read(draftId: string): Promise<OnboardingProgress> {
    const snapshot = await this.ledger.read();
    return projectOnboardingProgress(snapshot.onboardingDraftEvents, draftId);
  }

  async complete(input: { draftId: string; idempotencyKey: string }): Promise<OnboardingCompletion> {
    const progress = await this.read(input.draftId);
    const completedBefore = progress.status === "completed";
    const data = validateCompletion(progress);
    const now = this.runtime.now();
    const correlationId = `onboarding:${progress.id}`;
    const event = <T extends DomainEvent>(
      value: Omit<
        T,
        | "id"
        | "schemaVersion"
        | "userId"
        | "actor"
        | "deviceId"
        | "occurredAt"
        | "recordedAt"
        | "timezoneOffsetMinutes"
        | "provenance"
        | "evidenceRefs"
        | "causationId"
        | "correlationId"
      > & { occurredAt?: string },
    ): T => ({
      ...value,
      id: this.runtime.nextId("domain-event"),
      schemaVersion: DOMAIN_EVENT_SCHEMA_VERSION,
      userId: progress.userId,
      actor: { kind: "user", id: progress.userId },
      deviceId: "local-device",
      occurredAt: value.occurredAt ?? now,
      recordedAt: now,
      timezoneOffsetMinutes: new Date(value.occurredAt ?? now).getTimezoneOffset() * -1,
      provenance: { source: "user", confidence: "confirmed" },
      evidenceRefs: [],
      causationId: correlationId,
      correlationId,
    }) as unknown as T;

    const profileId = `profile:${progress.userId}`;
    const goalContractId = `goal:${progress.userId}`;
    const mandateId = `mandate:${progress.userId}`;
    const permissionSetId = `permissions:${progress.userId}`;
    const safetyConstraintId = `safety:${progress.userId}`;
    const fieldProvenance = {
      ...Object.fromEntries(
        Object.keys(data.profile).map((field) => [
          field,
          {
            source: progress.inputModeBySection.profile ?? "form",
            confidence: "confirmed" as const,
            confirmedAt: now,
          },
        ]),
      ),
      ...((data.professional?.recentSplit?.length || data.professional?.weeklyVolume?.length)
        ? {
            trainingHistorySummary: {
              source: "professional" as const,
              confidence: "confirmed" as const,
              confirmedAt: now,
            },
          }
        : {}),
      ...(data.professional?.bodyObservations?.length
        ? {
            bodyObservationRefs: {
              source: "professional" as const,
              confidence: "confirmed" as const,
              confirmedAt: now,
            },
          }
        : {}),
    };
    const permissionSet: PermissionSetData = {
      id: permissionSetId,
      camera: data.permissions.camera ?? "not_configured",
      health: data.permissions.health ?? "not_configured",
      notifications: data.permissions.notifications ?? "not_configured",
      remoteLlm: data.permissions.remoteLlm ?? "not_configured",
      cloudSync: data.permissions.cloudSync ?? "not_configured",
      mediaUpload: data.permissions.mediaUpload ?? "not_configured",
      ...(data.permissions.remoteLlm === "granted"
        ? {
            remoteLlmDisclosure: {
              taskRelevantHealthTrainingNutritionSleepAndExperienceSent: true as const,
              directIdentityFieldsRemoved: [
                "name" as const,
                "address" as const,
                "contact_details" as const,
                "precise_location" as const,
                "external_account_id" as const,
              ],
              consentedAt: now,
            },
          }
        : {}),
    };
    const safetyConstraint = buildSafetyConstraint(safetyConstraintId, data.safety);
    const domainEvents: DomainEvent[] = [
      event({
        name: "user_profile.created",
        aggregate: { kind: "user_profile", id: profileId, revision: 1 },
        payload: {
          id: profileId,
          trainingExperience: data.profile.trainingExperience!,
          locale: "zh-CN",
          ...(data.profile.demographics ? { demographics: data.profile.demographics } : {}),
          adultConfirmed: data.profile.adultConfirmed,
          returningStatus: data.profile.returningStatus,
          schedule: data.profile.schedule,
          locations: data.profile.locations,
          bodyDirection: data.profile.bodyDirection,
          exerciseConstraints: data.profile.exerciseConstraints ?? [],
          nutritionPreferences: data.profile.nutritionPreferences ?? [],
          professionalConstraints: [
            ...(data.profile.professionalConstraints ?? []),
            ...(data.safety.professionalConstraints ?? []),
          ],
          trainingHistorySummary: {
            ...(data.professional?.recentSplit?.length
              ? { recentSplit: data.professional.recentSplit }
              : {}),
            ...(data.professional?.weeklyVolume?.length
              ? { weeklyVolume: data.professional.weeklyVolume }
              : {}),
          },
          ...(data.professional?.plateauHistory || data.professional?.priorStrategies?.length || data.professional?.majorWeightLossHistory
            ? {
                historyModifiers: {
                  ...(data.professional.priorStrategies?.length
                    ? { priorStrategies: data.professional.priorStrategies }
                    : data.professional.plateauHistory?.priorStrategies?.length
                      ? { priorStrategies: data.professional.plateauHistory.priorStrategies }
                      : {}),
                  ...(data.professional.plateauHistory
                    ? { plateau: data.professional.plateauHistory }
                    : {}),
                  ...(data.professional.majorWeightLossHistory
                    ? { majorWeightLossHistory: data.professional.majorWeightLossHistory }
                    : {}),
                },
              }
            : {}),
          ...(data.professional?.strengthBaseline ? { strengthBaseline: data.professional.strengthBaseline } : {}),
          bodyObservationRefs: (data.professional?.bodyObservations ?? []).map(
            (_observation, index) => `onboarding-body:${progress.id}:${index}`,
          ),
          fieldProvenance,
        },
      }),
      event({
        name: "goal_contract.created",
        aggregate: { kind: "goal_contract", id: goalContractId, revision: 1 },
        payload: {
          id: goalContractId,
          primaryGoal: data.goal.primaryGoal!,
          modifiers: data.goal.modifiers ?? [],
          expectedDirection: data.goal.expectedDirection,
          successMetrics: data.goal.successMetrics,
          horizon: data.goal.horizon!,
          acceptableCosts: data.goal.acceptableCosts,
          measurementStrategy: data.goal.measurementStrategy,
          maintenanceFloors: data.goal.maintenanceFloors,
          ...(data.goal.goalType ? { goalType: data.goal.goalType } : {}),
          ...(data.goal.targets ? { targets: data.goal.targets } : {}),
          ...(data.goal.unacceptableCosts ? { unacceptableCosts: data.goal.unacceptableCosts } : {}),
          status: "active",
        },
      }),
      event({
        name: "coaching_mandate.created",
        aggregate: { kind: "coaching_mandate", id: mandateId, revision: 1 },
        payload: {
          id: mandateId,
          mode: data.mandate.mode!,
          scopes: data.mandate.scopes,
          limits: data.mandate.limits,
          locks: data.mandate.locks ?? [],
          validUntil: data.mandate.validUntil,
        },
      }),
      event({
        name: "permission_set.created",
        aggregate: { kind: "permission_set", id: permissionSetId, revision: 1 },
        payload: permissionSet,
      }),
      event({
        name: "safety_constraint.created",
        aggregate: { kind: "safety_constraint", id: safetyConstraintId, revision: 1 },
        payload: safetyConstraint,
      }),
    ];
    for (const custom of data.professional?.availableCustomExercises ?? []) {
      const id = `custom.${stableHash({
        userId: progress.userId,
        name: custom.name.trim(),
        movement: custom.movement,
        equipmentRequirement: custom.equipmentRequirement ?? null,
      })}`;
      domainEvents.push(
        event({
          name: "custom_exercise.created",
          aggregate: { kind: "custom_exercise", id, revision: 1 },
          payload: {
            id,
            name: custom.name.trim(),
            movement: custom.movement,
            prescriptionMode: "weighted_reps",
            equipmentRequirement: custom.equipmentRequirement ?? { kind: "unknown" },
            unknownFields: [
              "expected_muscles",
              "stimulus",
              "difficulty",
              "load_history",
              ...(custom.equipmentRequirement ? [] : ["equipment" as const]),
              "motion_capability",
            ],
            motionCapability: "unknown",
          },
        }),
      );
    }
    const timelineFacts = professionalTimelineFacts(data.professional);
    timelineFacts.forEach(({ occurredAt, fact }, index) => {
      domainEvents.push(
        event({
          name: "timeline.fact_appended",
          aggregate: {
            kind: "timeline",
            id: `timeline:${progress.userId}`,
            revision: index + 1,
          },
          payload: { fact },
          occurredAt,
        }),
      );
    });
    const draftEvent: OnboardingDraftEvent = {
      id: this.runtime.nextId("onboarding-event"),
      schemaVersion: ONBOARDING_DRAFT_SCHEMA_VERSION,
      type: "onboarding.completed",
      userId: progress.userId,
      draftId: progress.id,
      recordedAt: now,
      payload: { domainEventIds: domainEvents.map((domainEvent) => domainEvent.id) },
    };
    const expectedRevisions: DomainAggregateRef[] = [
      { kind: "user_profile", id: profileId, revision: 0 },
      { kind: "goal_contract", id: goalContractId, revision: 0 },
      { kind: "coaching_mandate", id: mandateId, revision: 0 },
      { kind: "permission_set", id: permissionSetId, revision: 0 },
      { kind: "safety_constraint", id: safetyConstraintId, revision: 0 },
      ...(data.professional?.availableCustomExercises ?? []).map((custom) => ({
        kind: "custom_exercise" as const,
        id: `custom.${stableHash({
          userId: progress.userId,
          name: custom.name.trim(),
          movement: custom.movement,
          equipmentRequirement: custom.equipmentRequirement ?? null,
        })}`,
        revision: 0,
      })),
      ...(timelineFacts.length
        ? [{ kind: "timeline" as const, id: `timeline:${progress.userId}`, revision: 0 }]
        : []),
    ];
    const commit: DomainAtomicCommit = {
      kind: "domain",
      userId: progress.userId,
      actorId: progress.userId,
      intent: "onboarding.complete",
      expectedRevisions,
      domainEvents,
      draftEvents: [draftEvent],
      actionEvents: domainEvents.map((domainEvent): ActionEvent => {
        const ref = onboardingFactRef(domainEvent);
        return {
          id: this.runtime.nextId("action"),
          userId: progress.userId,
          occurredAt: now,
          actor: "user",
          action: domainEvent.name.startsWith("permission_set.")
            ? "permission.changed"
            : domainEvent.name.startsWith("coaching_mandate.")
              ? "mandate.changed"
              : "fact.written",
          targetType: onboardingTargetType(domainEvent.aggregate.kind),
          targetId: domainEvent.aggregate.id,
          scope: domainEvent.aggregate.kind,
          intent: "onboarding.complete",
          afterRevision: domainEvent.aggregate.revision,
          before: {},
          after: { revision: domainEvent.aggregate.revision, eventId: domainEvent.id },
          evidenceRefs: ref ? [ref] : [],
          beforeRefs: [],
          afterRefs: ref ? [ref] : [],
          ruleVersions: { onboarding: `schema-v${ONBOARDING_DRAFT_SCHEMA_VERSION}` },
          mandateRevision: 1,
          result: "applied",
          undoBoundary: "compensating_revision",
          policyDecision: "allow",
          humanDecision: "confirmed",
          causationId: correlationId,
          correlationId,
          reversible: true,
        };
      }),
      outbox: domainEvents.map((domainEvent) => ({
        id: this.runtime.nextId("outbox"),
        userId: progress.userId,
        replicaId: "device:local-device",
        deviceId: "local-device",
        domainEventId: domainEvent.id,
        payloadHash: stableHash(domainEvent),
        status: "pending",
        createdAt: now,
      })),
      idempotencyKey: input.idempotencyKey,
      recordedAt: now,
    };
    await this.ledger.commit(commit);
    return {
      status: completedBefore ? "idempotent" : "completed",
      userId: progress.userId,
      profileId,
      goalContractId,
      mandateId,
      knownFields: completionKnownFields(),
      estimatedFields: completionEstimatedFields(data.professional),
      unknownFields: completionUnknownFields(data.professional),
      permissions: {
        camera: permissionSet.camera,
        health: permissionSet.health,
        notifications: permissionSet.notifications,
        remoteLlm: permissionSet.remoteLlm,
        cloudSync: permissionSet.cloudSync,
        mediaUpload: permissionSet.mediaUpload,
      },
      nextStep: "review_initial_plan",
    };
  }
}

export function projectOnboardingProgress(
  events: readonly OnboardingDraftEvent[],
  draftId: string,
): OnboardingProgress {
  const relevant = events.filter((event) => event.draftId === draftId);
  const started = relevant.find((event) => event.type === "onboarding.started");
  if (!started || started.type !== "onboarding.started") {
    throw new OnboardingValidationError("draft_not_found");
  }
  let patch: OnboardingPatch = {};
  const confirmed = new Set<OnboardingSection>();
  const inputModeBySection: Partial<Record<OnboardingSection, "form" | "conversation">> = {};
  let lastInputMode: "form" | "conversation" | undefined;
  for (const current of relevant) {
    if (current.type === "onboarding.progress_saved") {
      patch = mergePatch(patch, current.payload.patch);
      current.payload.confirmedSections.forEach((section) => confirmed.add(section));
      for (const section of current.payload.confirmedSections) {
        inputModeBySection[section] = current.payload.inputMode;
      }
      lastInputMode = current.payload.inputMode;
    }
  }
  const required = [
    ...REQUIRED_SECTIONS,
    ...(started.payload.depth === "professional" ? (["professional"] as const) : []),
  ];
  const updatedAt = relevant.at(-1)?.recordedAt ?? started.recordedAt;
  return {
    id: draftId,
    userId: started.userId,
    depth: started.payload.depth,
    status: relevant.some((event) => event.type === "onboarding.completed")
      ? "completed"
      : "in_progress",
    patch,
    confirmedSections: [...confirmed],
    nextRequiredSections: required.filter((section) => !confirmed.has(section)),
    inputModeBySection,
    ...(lastInputMode ? { lastInputMode } : {}),
    updatedAt,
  };
}

function mergePatch(current: OnboardingPatch, incoming: OnboardingPatch): OnboardingPatch {
  return {
    ...current,
    ...incoming,
    ...(incoming.profile ? { profile: { ...current.profile, ...incoming.profile } } : {}),
    ...(incoming.goal ? { goal: { ...current.goal, ...incoming.goal } } : {}),
    ...(incoming.mandate ? { mandate: { ...current.mandate, ...incoming.mandate } } : {}),
    ...(incoming.permissions
      ? { permissions: { ...current.permissions, ...incoming.permissions } }
      : {}),
    ...(incoming.safety ? { safety: { ...current.safety, ...incoming.safety } } : {}),
    ...(incoming.professional
      ? { professional: { ...current.professional, ...incoming.professional } }
      : {}),
  };
}

function validateCompletion(progress: OnboardingProgress): Required<
  Pick<OnboardingPatch, "profile" | "goal" | "mandate" | "permissions" | "safety">
> & Pick<OnboardingPatch, "professional"> {
  const missingSections = REQUIRED_SECTIONS.filter(
    (section) => !progress.confirmedSections.includes(section),
  );
  if (progress.depth === "professional" && !progress.confirmedSections.includes("professional")) {
    missingSections.push("professional");
  }
  if (missingSections.length) {
    throw new OnboardingValidationError("missing_required_fields", missingSections);
  }
  const { profile, goal, mandate, permissions, safety, professional } = progress.patch;
  if (!profile || !goal || !mandate || !permissions || !safety) {
    throw new OnboardingValidationError("missing_required_fields", [
      ...(!profile ? ["profile"] : []),
      ...(!goal ? ["goal"] : []),
      ...(!mandate ? ["mandate"] : []),
      ...(!permissions ? ["permissions"] : []),
      ...(!safety ? ["safety"] : []),
    ]);
  }
  const missing = [
    ...(!profile.trainingExperience ? ["profile.trainingExperience"] : []),
    ...(!profile.schedule ? ["profile.schedule"] : []),
    ...(!profile.locations?.length ? ["profile.locations"] : []),
    ...(!profile.bodyDirection ? ["profile.bodyDirection"] : []),
    ...(!goal.primaryGoal ? ["goal.primaryGoal"] : []),
    ...(!goal.horizon ? ["goal.horizon"] : []),
    ...(!goal.successMetrics?.length ? ["goal.successMetrics"] : []),
    ...(!mandate.mode ? ["mandate.mode"] : []),
    ...(!mandate.scopes ? ["mandate.scopes"] : []),
  ];
  if (missing.length) throw new OnboardingValidationError("missing_required_fields", missing);
  if (new Set(goal.proposedPrimaryGoals ?? []).size > 1) {
    throw new OnboardingValidationError("primary_goal_conflict", ["goal.primaryGoal"]);
  }
  if (profile.adultConfirmed !== true || safety.adultConfirmed !== true) {
    throw new OnboardingValidationError("adult_confirmation_required");
  }
  if (professional) validateProfessional(professional);
  return { profile, goal, mandate, permissions, safety, ...(professional ? { professional } : {}) };
}

function validateProfessional(professional: NonNullable<OnboardingPatch["professional"]>): void {
  for (const set of professional.setHistory ?? []) {
    if (
      !Number.isFinite(Date.parse(set.occurredAt)) ||
      !Number.isFinite(set.load.value) ||
      set.load.value < 0 ||
      !Number.isInteger(set.reps) ||
      set.reps < 0 ||
      (set.rir !== undefined && (set.rir < 0 || set.rir > 10))
    ) {
      throw new OnboardingValidationError("invalid_professional_history");
    }
  }
}

function buildSafetyConstraint(
  id: string,
  safety: NonNullable<OnboardingPatch["safety"]>,
): SafetyConstraintData {
  const reasons = [
    ...(safety.professionalRestriction ? ["professional_restriction"] : []),
    ...(safety.recentSurgeryOrAcuteInjury ? ["recent_surgery_or_acute_injury"] : []),
    ...(safety.pregnancyOrPostpartumSpecialConsideration
      ? ["pregnancy_or_postpartum_special_consideration"]
      : []),
    ...(safety.eatingDisorderOrLowEnergyRiskDeclared
      ? ["eating_disorder_or_low_energy_risk_declared"]
      : []),
    ...(safety.stopSignals ?? []),
  ];
  const disposition = (safety.stopSignals?.length ?? 0) > 0
    ? "stop_and_seek_professional_guidance"
    : reasons.length
      ? "pause_and_confirm"
      : "clear";
  return {
    id,
    disposition,
    reasons,
    stopSignals: safety.stopSignals ?? [],
    professionalConstraints: safety.professionalConstraints ?? [],
  };
}

function professionalTimelineFacts(
  professional: OnboardingPatch["professional"],
): readonly { occurredAt: string; fact: TimelineFact }[] {
  if (!professional) return [];
  return [
    ...(professional.setHistory ?? []).map((set) => ({
      occurredAt: set.occurredAt,
      fact: {
        kind: "training" as const,
        historicalSet: {
          exerciseVariantId: set.exerciseVariantId,
          load: set.load,
          reps: set.reps,
          ...(set.rir !== undefined ? { rir: set.rir } : {}),
        },
        confidence: "confirmed" as const,
      },
    })),
    ...(professional.bodyObservations ?? []).map((observation) => ({
      occurredAt: observation.occurredAt,
      fact: {
        kind: "body" as const,
        measurement: {
          ...(observation.metric === "circumference"
            ? {
                metric: "circumference" as const,
                site: observation.site ?? "unknown",
                quantity: observation.quantity as import("../coach/domain").LengthQuantity,
              }
              : observation.metric === "body_fat_percentage"
              ? {
                  metric: "body_fat_percentage" as const,
                  quantity: observation.quantity as import("../coach/domain").PercentageQuantity,
                  ...(professional.bodyFatEstimate
                    ? {
                        estimate: {
                          formulaId: professional.bodyFatEstimate.formulaId,
                          inputs: professional.bodyFatEstimate.inputs,
                          range: professional.bodyFatEstimate.estimateRange,
                          measuredAt: professional.bodyFatEstimate.measuredAt,
                          ...(professional.bodyFatEstimate.userOverride
                            ? { userOverride: professional.bodyFatEstimate.userOverride }
                            : {}),
                        },
                      }
                    : {}),
                }
              : {
                  metric: "body_weight" as const,
                  quantity: observation.quantity as import("../coach/domain").MassQuantity,
                }),
          ...(observation.condition ? { condition: observation.condition } : {}),
        },
        confidence: "confirmed" as const,
      },
    })),
    ...(professional.bodyFatEstimate
      ? [{
          occurredAt: professional.bodyFatEstimate.measuredAt,
          fact: {
            kind: "body" as const,
            measurement: {
              metric: "body_fat_percentage" as const,
              quantity: professional.bodyFatEstimate.userOverride ?? {
                value: (professional.bodyFatEstimate.estimateRange.min.value + professional.bodyFatEstimate.estimateRange.max.value) / 2,
                unit: "percent" as const,
              },
              method: professional.bodyFatEstimate.method,
              algorithmVersion: professional.bodyFatEstimate.formulaId,
              estimate: {
                formulaId: professional.bodyFatEstimate.formulaId,
                inputs: professional.bodyFatEstimate.inputs,
                range: professional.bodyFatEstimate.estimateRange,
                measuredAt: professional.bodyFatEstimate.measuredAt,
                ...(professional.bodyFatEstimate.userOverride
                  ? { userOverride: professional.bodyFatEstimate.userOverride }
                  : {}),
              },
            },
            confidence: professional.bodyFatEstimate.userOverride ? "confirmed" as const : "estimated" as const,
          },
        }]
      : []),
    ...(professional.nutritionObservations ?? []).map((observation, index) => ({
      occurredAt: observation.occurredAt,
      fact: {
        kind: "nutrition" as const,
        observationId: `onboarding-nutrition:${index}`,
        energy: observation.energy,
        confidence: observation.source === "user_exact" ? "confirmed" as const : "estimated" as const,
      },
    })),
    ...(professional.recoveryObservations ?? []).flatMap((observation) => [
      {
        occurredAt: observation.occurredAt,
        fact: {
          kind: "recovery" as const,
          ...(observation.perceivedRecovery !== undefined ? { perceivedRecovery: observation.perceivedRecovery } : {}),
          ...(observation.fatigue !== undefined ? { fatigue: observation.fatigue } : {}),
          confidence: "confirmed" as const,
        },
      },
      ...(observation.soreness !== undefined
        ? [{
            occurredAt: observation.occurredAt,
            fact: { kind: "symptom" as const, symptom: "soreness" as const, severity: observation.soreness, confidence: "confirmed" as const },
          }]
        : []),
      ...(observation.sleepHours !== undefined
        ? [{
            occurredAt: observation.occurredAt,
            fact: { kind: "sleep" as const, duration: { value: observation.sleepHours, unit: "hours" as const }, confidence: "confirmed" as const },
          }]
        : []),
    ]),
  ];
}

function completionUnknownFields(professional: OnboardingPatch["professional"]): readonly string[] {
  return [
    ...(!professional?.bodyObservations?.length ? ["body_measurements"] : []),
    ...(!professional?.nutritionObservations?.length ? ["nutrition_intake"] : []),
    ...(!professional?.setHistory?.length ? ["training_load_history"] : []),
  ];
}

function completionKnownFields(): readonly string[] {
  return [
    "adult_status",
    "primary_goal",
    "training_experience",
    "schedule",
    "training_environment",
    "body_direction",
    "safety_constraints",
    "coaching_mandate",
  ];
}

function completionEstimatedFields(
  professional: OnboardingPatch["professional"],
): readonly string[] {
  return [
    ...(professional?.nutritionObservations?.some((item) => item.source === "user_estimate")
      ? ["nutrition_intake"]
      : []),
  ];
}

function onboardingFactRef(event: DomainEvent): FactRef | undefined {
  const aggregate: Partial<Record<DomainEvent["aggregate"]["kind"], FactRef["aggregate"]>> = {
    user_profile: "profile",
    goal_contract: "goal",
    coaching_mandate: "mandate",
    timeline: "timeline",
    permission_set: "permission",
    safety_constraint: "safety",
    custom_exercise: "exercise",
  };
  const resolved = aggregate[event.aggregate.kind];
  return resolved
    ? { aggregate: resolved, id: event.aggregate.id, revision: event.aggregate.revision }
    : undefined;
}

function onboardingTargetType(
  kind: DomainEvent["aggregate"]["kind"],
): ActionEvent["targetType"] {
  const mapping: Partial<
    Record<DomainEvent["aggregate"]["kind"], ActionEvent["targetType"]>
  > = {
    user_profile: "profile",
    goal_contract: "goal",
    coaching_mandate: "mandate",
    timeline: "timeline",
    permission_set: "permission",
    safety_constraint: "safety",
    custom_exercise: "exercise",
  };
  return mapping[kind] ?? "session";
}
