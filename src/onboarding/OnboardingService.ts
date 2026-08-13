import {
  DOMAIN_EVENT_SCHEMA_VERSION,
  type DomainAggregateRef,
  type DomainEvent,
  type LengthQuantity,
  type MassQuantity,
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
  type OnboardingEntryState,
  type OnboardingPatch,
  type OnboardingProgress,
  type OnboardingSection,
  type BaselineIntakeDraft,
  type BaselineIntakeField,
  type OnboardingInputSource,
  type BaselineGoalNarrativeCapture,
  type GoalNarrativeCaptureDraft,
  type GoalDraft,
  type GoalTargetCapture,
  type TimelineBaselineMeasurementDraft,
  type OnboardingGoalConflict,
  type OnboardingDynamicFormRequest,
  type OnboardingDynamicFieldCapture,
  type TrainingBackgroundDraft,
  type CoachingLevelAssessment,
} from "./model";
import { createCoachingLevelAssessment } from "./CoachingLevelAssessment";
import {
  ONBOARDING_FIELD_CATALOG_VERSION,
  fieldById,
  limitedActionsFor,
  recommendFieldsForGoal,
  validateDynamicFieldInput,
  validateDynamicFormProposal,
  type DynamicFieldInput,
  type DynamicFormAnswer,
  type DynamicFormCard,
  type OnboardingFieldDefinition,
  type OnboardingDynamicFormProposal,
} from "./FieldCatalog";

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

  /**
   * The public entry point for the four-field intake. Reopening onboarding
   * must continue the latest unfinished draft instead of creating a second
   * competing source of truth.
   */
  async startOrResumeBaseline(input: { userId: string }): Promise<OnboardingProgress> {
    const snapshot = await this.ledger.read();
    const latest = latestDraftForUser(snapshot.onboardingDraftEvents, input.userId);
    if (latest) return latest;

    // This is a user-scoped, stable initialisation rather than an ordinary
    // "start" action. Two app surfaces can discover a new account before
    // either receives the other response; using a deterministic draft/event
    // pair lets Ledger idempotency collapse that race into one shared draft.
    const draftId = `onboarding-draft:${stableHash({ kind: "baseline_intake", userId: input.userId })}`;
    const recordedAt = this.runtime.now();
    const event: OnboardingDraftEvent = {
      id: `onboarding-event:${stableHash({ kind: "baseline_started", userId: input.userId })}`,
      schemaVersion: ONBOARDING_DRAFT_SCHEMA_VERSION,
      type: "onboarding.started",
      userId: input.userId,
      draftId,
      recordedAt,
      payload: { depth: "basic" },
    };
    await this.commitDraftEvent({
      userId: input.userId,
      event,
      intent: "onboarding.start_baseline",
      idempotencyKey: `baseline-start:${input.userId}`,
      recordedAt,
    });
    return this.read(draftId);
  }

  async saveBaseline(input: {
    draftId: string;
    inputMode: "form" | "conversation";
    values: BaselineIntakeDraft;
    idempotencyKey: string;
  }): Promise<OnboardingProgress> {
    const values = normalizeBaselineIntake(input.values);
    validateBaselineIntake(input.inputMode, values);
    const current = await this.read(input.draftId);
    const goalCapture = values.goalNarrative
      ? mergeGoalNarrativeCapture(
          current.patch.goalCapture,
          interpretGoalNarrative(values.goalNarrative),
        )
      : undefined;
    return this.save({
      draftId: input.draftId,
      inputMode: input.inputMode,
      patch: {
        baseline: values,
        ...(goalCapture ? { goalCapture } : {}),
      },
      confirmedSections: [],
      idempotencyKey: input.idempotencyKey,
    });
  }

  /**
   * The model may choose a catalog field ID, a topic and a closed reason code.
   * All field semantics, controls and writes are resolved locally below.
   */
  async requestDynamicForm(input: {
    draftId: string;
    expectedDraftRevision: number;
    proposal: OnboardingDynamicFormProposal;
    idempotencyKey: string;
  }): Promise<DynamicFormCard> {
    const current = await this.read(input.draftId);
    const cardId = `onboarding-form-card:${stableHash({ draftId: current.id, idempotencyKey: input.idempotencyKey })}`;
    const existing = findRequestedDynamicCard((await this.ledger.read()).onboardingDraftEvents, current.id, cardId);
    if (existing) {
      const fields = existing.fieldIds.map((fieldId) => fieldById(fieldId));
      if (fields.some((field) => !field)) throw new OnboardingValidationError("dynamic_form_rejected");
      return { ...existing, fields: fields as DynamicFormCard["fields"] };
    }
    assertCurrentDynamicRevision(current, input.expectedDraftRevision);
    const fields = validateDynamicFormProposal(current, input.proposal);
    const recordedAt = this.runtime.now();
    // Replays of the same tool call must point at the card that was actually
    // persisted, not manufacture a new in-memory card ID after Ledger
    // idempotency has accepted the original event.
    const request: OnboardingDynamicFormRequest = {
      cardId,
      catalogVersion: ONBOARDING_FIELD_CATALOG_VERSION,
      draftRevision: current.revision + 1,
      topic: input.proposal.topic,
      fieldIds: [...input.proposal.fieldIds],
      reasonCode: input.proposal.reasonCode,
      requiredFor: input.proposal.requiredFor,
    };
    const event: OnboardingDraftEvent = {
      id: `onboarding-event:${stableHash({ kind: "dynamic_form_requested", cardId })}`,
      schemaVersion: ONBOARDING_DRAFT_SCHEMA_VERSION,
      type: "onboarding.dynamic_form_requested",
      userId: current.userId,
      draftId: current.id,
      recordedAt,
      payload: request,
    };
    await this.commitDraftEvent({
      userId: current.userId,
      event,
      intent: "onboarding.request_dynamic_form",
      idempotencyKey: input.idempotencyKey,
      recordedAt,
    });
    return { ...request, fields };
  }

  /** Conversation extraction shares the catalog validation and event stream with cards. */
  async captureDynamicFields(input: {
    draftId: string;
    expectedDraftRevision: number;
    inputMode: "form" | "conversation";
    captures: readonly DynamicFieldInput[];
    idempotencyKey: string;
  }): Promise<OnboardingProgress> {
    const current = await this.read(input.draftId);
    assertCurrentDynamicRevision(current, input.expectedDraftRevision);
    const captures = input.captures.map((capture) => validateDynamicFieldInput(capture, input.inputMode));
    assertDistinctCatalogFields(captures);
    const saved = await this.saveDynamicCaptures({ current, inputMode: input.inputMode, captures, idempotencyKey: input.idempotencyKey });
    return this.assessAfterTrainingCapture(saved, captures, `${input.idempotencyKey}:assessment`);
  }

  /** A rendered card is single-use and may only submit against its own draft frontier. */
  async submitDynamicForm(input: {
    draftId: string;
    cardId: string;
    expectedDraftRevision: number;
    answers: readonly DynamicFormAnswer[];
    idempotencyKey: string;
  }): Promise<OnboardingProgress> {
    const current = await this.read(input.draftId);
    assertCurrentDynamicRevision(current, input.expectedDraftRevision);
    const snapshot = await this.ledger.read();
    const card = findRequestedDynamicCard(snapshot.onboardingDraftEvents, current.id, input.cardId);
    if (!card || card.catalogVersion !== ONBOARDING_FIELD_CATALOG_VERSION || card.draftRevision !== current.revision || dynamicCardAlreadySubmitted(snapshot.onboardingDraftEvents, current.id, input.cardId)) {
      throw new OnboardingValidationError("stale_dynamic_form");
    }
    if (input.answers.length === 0 || input.answers.length > card.fieldIds.length || new Set(input.answers.map((answer) => answer.fieldId)).size !== input.answers.length || !input.answers.every((answer) => card.fieldIds.includes(answer.fieldId))) {
      throw new OnboardingValidationError("dynamic_form_rejected");
    }
    const submissionId = this.runtime.nextId("onboarding-form-submission");
    const observedAt = this.runtime.now();
    const captures = input.answers.map((answer) => validateDynamicFieldInput({
      ...answer,
      observedAt,
      source: { kind: "form_submission", submissionId },
    }, "form"));
    const saved = await this.saveDynamicCaptures({
      current,
      inputMode: "form",
      captures,
      dynamicForm: { catalogVersion: card.catalogVersion, cardId: card.cardId, submissionId, fieldIds: card.fieldIds },
      idempotencyKey: input.idempotencyKey,
    });
    return this.assessAfterTrainingCapture(saved, captures, `${input.idempotencyKey}:assessment`);
  }

  /** The UI renders the last still-open Agent-requested card from durable draft events. */
  async readActiveDynamicForm(draftId: string): Promise<DynamicFormCard | undefined> {
    const snapshot = await this.ledger.read();
    const draft = projectOnboardingProgress(snapshot.onboardingDraftEvents, draftId);
    if (draft.status === "completed") return undefined;
    const request = [...snapshot.onboardingDraftEvents]
      .reverse()
      .find((event): event is Extract<OnboardingDraftEvent, { type: "onboarding.dynamic_form_requested" }> =>
        event.type === "onboarding.dynamic_form_requested"
        && event.draftId === draftId
        && !dynamicCardAlreadySubmitted(snapshot.onboardingDraftEvents, draftId, event.payload.cardId),
      )?.payload;
    if (!request || request.draftRevision !== draft.revision) return undefined;
    const fields = request.fieldIds.map(fieldById);
    if (fields.some((field) => !field)) return undefined;
    return { ...request, fields: fields as OnboardingFieldDefinition[] };
  }

  recommendDynamicForm(input: {
    draft: OnboardingProgress;
    goalKind: "fat_loss" | "hypertrophy" | "strength" | "visual_physique" | "general";
  }): OnboardingDynamicFormProposal {
    return recommendFieldsForGoal(input.goalKind);
  }

  /**
   * Captures a free-language goal statement and its deterministic, reviewable
   * interpretation in one append-only draft event. This is deliberately a
   * draft operation: it does not write a Goal Contract or a Timeline fact.
   */
  async captureGoalNarrative(input: {
    draftId: string;
    inputMode: "form" | "conversation";
    narrative: BaselineGoalNarrativeCapture;
    idempotencyKey: string;
  }): Promise<OnboardingProgress> {
    validateGoalNarrative(input.inputMode, input.narrative);
    const current = await this.read(input.draftId);
    if (current.status === "completed") throw new OnboardingValidationError("draft_completed");
    const capture = interpretGoalNarrative(input.narrative);
    const goalCapture = mergeGoalNarrativeCapture(current.patch.goalCapture, capture);
    return this.save({
      draftId: input.draftId,
      inputMode: input.inputMode,
      patch: { goalCapture },
      confirmedSections: [],
      idempotencyKey: input.idempotencyKey,
    });
  }

  /**
   * Stores only user-confirmed training-background facts. The legacy profile
   * level is intentionally neither an input nor an output of this command.
   */
  async captureTrainingBackground(input: {
    draftId: string;
    expectedDraftRevision: number;
    inputMode: "form" | "conversation";
    background: TrainingBackgroundDraft;
    idempotencyKey: string;
  }): Promise<OnboardingProgress> {
    const current = await this.read(input.draftId);
    assertCurrentDynamicRevision(current, input.expectedDraftRevision);
    validateTrainingBackground(input.inputMode, input.background);
    return this.save({
      draftId: input.draftId,
      inputMode: input.inputMode,
      patch: { trainingBackground: input.background },
      confirmedSections: [],
      idempotencyKey: input.idempotencyKey,
    });
  }

  /**
   * Adds an independent, replayable assessment artifact. It is not a Profile
   * write, and its source frontier makes later corrections auditable.
   */
  async assessCoachingLevel(input: {
    draftId: string;
    expectedDraftRevision: number;
    idempotencyKey: string;
  }): Promise<CoachingLevelAssessment> {
    const current = await this.read(input.draftId);
    const eventId = `onboarding-assessment:${stableHash({
      draftId: input.draftId,
      idempotencyKey: input.idempotencyKey,
    })}`;
    const snapshot = await this.ledger.read();
    const existing = snapshot.onboardingDraftEvents.find(
      (event): event is Extract<OnboardingDraftEvent, { type: "onboarding.coaching_level_assessed" }> =>
        event.type === "onboarding.coaching_level_assessed" && event.id === eventId,
    );
    if (existing) return existing.payload;
    assertCurrentDynamicRevision(current, input.expectedDraftRevision);
    const assessment = createCoachingLevelAssessment({
      progress: current,
      assessedAt: this.runtime.now(),
      revision: current.coachingLevelAssessments?.length ? current.coachingLevelAssessments.length + 1 : 1,
    });
    const event: OnboardingDraftEvent = {
      id: eventId,
      schemaVersion: ONBOARDING_DRAFT_SCHEMA_VERSION,
      type: "onboarding.coaching_level_assessed",
      userId: current.userId,
      draftId: current.id,
      recordedAt: assessment.assessedAt,
      payload: assessment,
    };
    await this.commitDraftEvent({
      userId: current.userId,
      event,
      intent: "onboarding.assess_coaching_level",
      idempotencyKey: input.idempotencyKey,
      recordedAt: assessment.assessedAt,
    });
    return assessment;
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

  private async saveDynamicCaptures(input: {
    current: OnboardingProgress;
    inputMode: "form" | "conversation";
    captures: readonly OnboardingDynamicFieldCapture[];
    dynamicForm?: { catalogVersion: string; cardId?: string; submissionId: string; fieldIds: readonly string[] };
    idempotencyKey: string;
  }): Promise<OnboardingProgress> {
    const recordedAt = this.runtime.now();
    const trainingBackground = trainingBackgroundFromCaptures(input.current.patch.trainingBackground, input.captures, input.inputMode);
    const event: OnboardingDraftEvent = {
      id: this.runtime.nextId("onboarding-event"),
      schemaVersion: ONBOARDING_DRAFT_SCHEMA_VERSION,
      type: "onboarding.progress_saved",
      userId: input.current.userId,
      draftId: input.current.id,
      recordedAt,
      payload: {
        inputMode: input.inputMode,
        patch: {
          dynamicFields: Object.fromEntries(input.captures.map((capture) => [capture.fieldId, capture])),
          ...(trainingBackground ? { trainingBackground } : {}),
        },
        confirmedSections: [],
        ...(input.dynamicForm ? { dynamicForm: input.dynamicForm } : {}),
      },
    };
    await this.commitDraftEvent({
      userId: input.current.userId,
      event,
      intent: "onboarding.capture_dynamic_fields",
      idempotencyKey: input.idempotencyKey,
      recordedAt,
    });
    return this.read(input.current.id);
  }

  private async assessAfterTrainingCapture(
    progress: OnboardingProgress,
    captures: readonly OnboardingDynamicFieldCapture[],
    idempotencyKey: string,
  ): Promise<OnboardingProgress> {
    if (!captures.some((capture) => capture.state !== "explicit_unknown" && capture.fieldId.startsWith("training.")) || !progress.patch.trainingBackground) {
      return progress;
    }
    await this.assessCoachingLevel({
      draftId: progress.id,
      expectedDraftRevision: progress.revision,
      idempotencyKey,
    });
    return this.read(progress.id);
  }

  private async commitDraftEvent(input: {
    userId: string;
    event: OnboardingDraftEvent;
    intent: string;
    idempotencyKey: string;
    recordedAt: string;
  }): Promise<void> {
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: input.userId,
      intent: input.intent,
      expectedRevisions: [],
      domainEvents: [],
      draftEvents: [input.event],
      idempotencyKey: input.idempotencyKey,
      recordedAt: input.recordedAt,
    });
  }

  async read(draftId: string): Promise<OnboardingProgress> {
    const snapshot = await this.ledger.read();
    return projectOnboardingProgress(snapshot.onboardingDraftEvents, draftId);
  }

  async complete(input: { draftId: string; idempotencyKey: string }): Promise<OnboardingCompletion> {
    const progress = await this.read(input.draftId);
    const completedBefore = progress.status === "completed";
    const now = this.runtime.now();
    // A draft entered through the four-field intake is a different contract
    // from the retired fixed questionnaire. Preserve the old validator for
    // historical drafts, but never make a new account manufacture its old
    // sections, self-selected level, cadence, place, authority or a safety
    // denial simply to satisfy it.
    const data = progress.patch.baseline
      ? validateNewDossierCompletion(progress, now)
      : validateCompletion(progress);
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
    const before = await this.ledger.read();
    const revisionOf = (kind: DomainAggregateRef["kind"], id: string): number =>
      before.aggregateRevisions.find((state) =>
        state.userId === progress.userId && state.kind === kind && state.id === id,
      )?.revision ?? 0;
    const profileRevision = revisionOf("user_profile", profileId);
    const goalContractRevision = revisionOf("goal_contract", goalContractId);
    const mandateRevision = revisionOf("coaching_mandate", mandateId);
    const permissionSetRevision = revisionOf("permission_set", permissionSetId);
    const safetyConstraintRevision = revisionOf("safety_constraint", safetyConstraintId);
    const timelineId = `timeline.${progress.userId}`;
    const timelineRevision = revisionOf("timeline", timelineId);
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
    const remoteLlm = data.permissions.remoteLlm ?? "granted";
    const cloudSync = data.permissions.cloudSync ?? "granted";
    const permissionSet: PermissionSetData = {
      id: permissionSetId,
      camera: data.permissions.camera ?? "not_configured",
      health: data.permissions.health ?? "not_configured",
      notifications: data.permissions.notifications ?? "not_configured",
      remoteLlm,
      cloudSync,
      mediaUpload: data.permissions.mediaUpload ?? "not_configured",
      ...(remoteLlm === "granted"
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
        name: profileRevision === 0 ? "user_profile.created" : "user_profile.revised",
        aggregate: { kind: "user_profile", id: profileId, revision: profileRevision + 1 },
        payload: {
          id: profileId,
          trainingExperience: data.profile.trainingExperience!,
          locale: "zh-CN",
          ...(data.profile.demographics ? { demographics: data.profile.demographics } : {}),
          adultConfirmed: data.profile.adultConfirmed,
          returningStatus: data.profile.returningStatus,
          schedule: data.profile.schedule,
          dailyActivityLevel: data.profile.dailyActivityLevel,
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
        name: goalContractRevision === 0 ? "goal_contract.created" : "goal_contract.revised",
        aggregate: { kind: "goal_contract", id: goalContractId, revision: goalContractRevision + 1 },
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
        name: mandateRevision === 0 ? "coaching_mandate.created" : "coaching_mandate.revised",
        aggregate: { kind: "coaching_mandate", id: mandateId, revision: mandateRevision + 1 },
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
        name: permissionSetRevision === 0 ? "permission_set.created" : "permission_set.revised",
        aggregate: { kind: "permission_set", id: permissionSetId, revision: permissionSetRevision + 1 },
        payload: permissionSet,
      }),
      event({
        name: safetyConstraintRevision === 0 ? "safety_constraint.created" : "safety_constraint.revised",
        aggregate: { kind: "safety_constraint", id: safetyConstraintId, revision: safetyConstraintRevision + 1 },
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
      const customRevision = revisionOf("custom_exercise", id);
      domainEvents.push(
        event({
          name: customRevision === 0 ? "custom_exercise.created" : "custom_exercise.revised",
          aggregate: { kind: "custom_exercise", id, revision: customRevision + 1 },
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
            id: timelineId,
            revision: timelineRevision + index + 1,
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
      { kind: "user_profile", id: profileId, revision: profileRevision },
      { kind: "goal_contract", id: goalContractId, revision: goalContractRevision },
      { kind: "coaching_mandate", id: mandateId, revision: mandateRevision },
      { kind: "permission_set", id: permissionSetId, revision: permissionSetRevision },
      { kind: "safety_constraint", id: safetyConstraintId, revision: safetyConstraintRevision },
      ...(data.professional?.availableCustomExercises ?? []).map((custom) => ({
        kind: "custom_exercise" as const,
        id: `custom.${stableHash({
          userId: progress.userId,
          name: custom.name.trim(),
          movement: custom.movement,
          equipmentRequirement: custom.equipmentRequirement ?? null,
        })}`,
        revision: revisionOf("custom_exercise", `custom.${stableHash({
          userId: progress.userId,
          name: custom.name.trim(),
          movement: custom.movement,
          equipmentRequirement: custom.equipmentRequirement ?? null,
        })}`),
      })),
      ...(timelineFacts.length
        ? [{ kind: "timeline" as const, id: timelineId, revision: timelineRevision }]
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
          mandateRevision: mandateRevision + 1,
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
  const coachingLevelAssessments: CoachingLevelAssessment[] = [];
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
    if (current.type === "onboarding.coaching_level_assessed") {
      coachingLevelAssessments.push(current.payload);
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
    revision: relevant.length,
    baselineMissingFields: baselineMissingFields(patch.baseline),
    ...(coachingLevelAssessments.length ? { coachingLevelAssessments } : {}),
    confirmedSections: [...confirmed],
    nextRequiredSections: required.filter((section) => !confirmed.has(section)),
    inputModeBySection,
    limitedActions: limitedActionsFor({ patch }),
    ...(lastInputMode ? { lastInputMode } : {}),
    updatedAt,
  };
}

/** Pure, replayable account-entry decision for a User dossier and its drafts. */
export function projectOnboardingEntryState(input: {
  userId: string;
  dossierComplete: boolean;
  events: readonly OnboardingDraftEvent[];
}): OnboardingEntryState {
  if (input.dossierComplete) {
    return { status: "dossier_complete", destination: "home" };
  }
  const drafts = input.events
    .filter((event): event is Extract<OnboardingDraftEvent, { type: "onboarding.started" }> =>
      event.type === "onboarding.started" && event.userId === input.userId,
    )
    .map((event) => projectOnboardingProgress(input.events, event.draftId))
    .sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
    );
  const draft = drafts[0];
  if (!draft) return { status: "not_started", destination: "onboarding" };
  if (draft.status === "completed") {
    // A completed event and aggregate commit are atomic in the current
    // Ledger. This state is nevertheless explicit so recovery never routes
    // an interrupted/imported transition to Home as if completion succeeded.
    return { status: "commit_pending", destination: "onboarding", draft };
  }
  if (requiresSafetyHold(draft.patch)) {
    return { status: "safety_hold", destination: "onboarding", draft };
  }
  if (draft.nextRequiredSections.length === 0) {
    return { status: "ready_for_confirmation", destination: "onboarding", draft };
  }
  return { status: "in_progress", destination: "onboarding", draft };
}

function baselineMissingFields(baseline: BaselineIntakeDraft | undefined): BaselineIntakeField[] {
  const missing: BaselineIntakeField[] = [];
  if (!baseline?.age) missing.push("age");
  if (!baseline?.height) missing.push("height");
  if (!baseline?.currentWeight) missing.push("current_weight");
  if (!baseline?.goalNarrative) missing.push("goal_narrative");
  return missing;
}

function latestDraftForUser(
  events: readonly OnboardingDraftEvent[],
  userId: string,
): OnboardingProgress | undefined {
  return events
    .filter((event): event is Extract<OnboardingDraftEvent, { type: "onboarding.started" }> =>
      event.type === "onboarding.started" && event.userId === userId,
    )
    .map((event) => projectOnboardingProgress(events, event.draftId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))[0];
}

/**
 * Baseline storage has one canonical unit per physical quantity. The selected
 * form unit is an input concern; its submitted source remains attached to the
 * normalized value, while local planning never needs to guess which unit it
 * received. We deliberately normalize only explicit user captures.
 */
function normalizeBaselineIntake(values: BaselineIntakeDraft): BaselineIntakeDraft {
  return {
    ...values,
    ...(values.height
      ? { height: { ...values.height, value: normalizeLength(values.height.value) } }
      : {}),
    ...(values.currentWeight
      ? { currentWeight: { ...values.currentWeight, value: normalizeMass(values.currentWeight.value) } }
      : {}),
  };
}

function normalizeLength(quantity: LengthQuantity): LengthQuantity {
  if (quantity.unit === "cm") return { value: quantity.value, unit: "cm" };
  if (quantity.unit === "in") return { value: roundBaselineQuantity(quantity.value * 2.54), unit: "cm" };
  throw new OnboardingValidationError("invalid_baseline_intake", ["height"]);
}

function normalizeMass(quantity: MassQuantity): MassQuantity {
  if (quantity.unit === "kg") return { value: quantity.value, unit: "kg" };
  if (quantity.unit === "lb") return { value: roundBaselineQuantity(quantity.value * 0.45359237), unit: "kg" };
  throw new OnboardingValidationError("invalid_baseline_intake", ["current_weight"]);
}

function roundBaselineQuantity(value: number): number {
  return Number(value.toFixed(2));
}

function validateBaselineIntake(
  inputMode: "form" | "conversation",
  values: BaselineIntakeDraft,
): void {
  if (!values.age && !values.height && !values.currentWeight && !values.goalNarrative) {
    throw new OnboardingValidationError("invalid_baseline_intake", ["baseline"]);
  }
  const validateCapture = (capture: { observedAt: string; source: OnboardingInputSource }, field: BaselineIntakeField) => {
    const sourceId = capture.source.kind === "conversation_message"
      ? capture.source.messageId
      : capture.source.submissionId;
    if (
      !capture.observedAt.trim() ||
      !Number.isFinite(Date.parse(capture.observedAt)) ||
      !sourceId.trim() ||
      !sourceMatchesInputMode(capture.source, inputMode)
    ) {
      throw new OnboardingValidationError("invalid_baseline_intake", [field]);
    }
  };
  if (values.age) {
    validateCapture(values.age, "age");
    if (!Number.isInteger(values.age.ageYears) || values.age.ageYears < 13 || values.age.ageYears > 120) {
      throw new OnboardingValidationError("invalid_baseline_intake", ["age"]);
    }
  }
  if (values.height) {
    validateCapture(values.height, "height");
    if (
      values.height.value.unit !== "cm" ||
      !Number.isFinite(values.height.value.value) ||
      values.height.value.value < 100 ||
      values.height.value.value > 250
    ) {
      throw new OnboardingValidationError("invalid_baseline_intake", ["height"]);
    }
  }
  if (values.currentWeight) {
    validateCapture(values.currentWeight, "current_weight");
    if (
      values.currentWeight.value.unit !== "kg" ||
      !Number.isFinite(values.currentWeight.value.value) ||
      values.currentWeight.value.value < 25 ||
      values.currentWeight.value.value > 500
    ) {
      throw new OnboardingValidationError("invalid_baseline_intake", ["current_weight"]);
    }
  }
  if (values.goalNarrative) {
    validateCapture(values.goalNarrative, "goal_narrative");
    if (!values.goalNarrative.text.trim()) {
      throw new OnboardingValidationError("invalid_baseline_intake", ["goal_narrative"]);
    }
  }
}

function validateTrainingBackground(
  inputMode: "form" | "conversation",
  background: TrainingBackgroundDraft,
): void {
  const sourceId = background.source.kind === "conversation_message"
    ? background.source.messageId
    : background.source.submissionId;
  if (
    !background.capturedAt.trim() ||
    !Number.isFinite(Date.parse(background.capturedAt)) ||
    !sourceId.trim() ||
    !sourceMatchesInputMode(background.source, inputMode)
  ) {
    throw new OnboardingValidationError("invalid_professional_history", ["training_background"]);
  }
  if (background.cumulativeTrainingMonths && (
    !Number.isInteger(background.cumulativeTrainingMonths.minimum) ||
    !Number.isInteger(background.cumulativeTrainingMonths.maximum) ||
    background.cumulativeTrainingMonths.minimum < 0 ||
    background.cumulativeTrainingMonths.maximum < background.cumulativeTrainingMonths.minimum
  )) {
    throw new OnboardingValidationError("invalid_professional_history", ["cumulative_training_months"]);
  }
  const continuity = background.recentContinuity;
  if (continuity && [continuity.consecutiveWeeks, continuity.usualSessionsPerWeek, continuity.timeAwayWeeks].some(
    (value) => value !== undefined && (!Number.isFinite(value) || value < 0),
  )) {
    throw new OnboardingValidationError("invalid_professional_history", ["recent_continuity"]);
  }
  for (const set of background.comparableSets ?? []) {
    if (
      !set.exerciseVariantId.trim() ||
      !Number.isFinite(set.load.value) || set.load.value <= 0 ||
      !Number.isInteger(set.reps) || set.reps <= 0 ||
      !Number.isFinite(Date.parse(set.performedOn)) ||
      (set.rir !== undefined && (!Number.isFinite(set.rir) || set.rir < 0)) ||
      (set.rpe !== undefined && (!Number.isFinite(set.rpe) || set.rpe < 0 || set.rpe > 10))
    ) {
      throw new OnboardingValidationError("invalid_professional_history", ["comparable_sets"]);
    }
  }
}

function validateGoalNarrative(
  inputMode: "form" | "conversation",
  narrative: BaselineGoalNarrativeCapture,
): void {
  const sourceId = narrative.source.kind === "conversation_message"
    ? narrative.source.messageId
    : narrative.source.submissionId;
  if (
    !narrative.text.trim() ||
    !narrative.observedAt.trim() ||
    !Number.isFinite(Date.parse(narrative.observedAt)) ||
    !sourceId.trim() ||
    !sourceMatchesInputMode(narrative.source, inputMode)
  ) {
    throw new OnboardingValidationError("invalid_baseline_intake", ["goal_narrative"]);
  }
}

function sourceMatchesInputMode(
  source: OnboardingInputSource,
  inputMode: "form" | "conversation",
): boolean {
  return inputMode === "form" ? source.kind === "form_submission" : source.kind === "conversation_message";
}

function requiresSafetyHold(patch: OnboardingPatch): boolean {
  const safety = patch.safety;
  return Boolean(
    safety?.professionalRestriction ||
    safety?.recentSurgeryOrAcuteInjury ||
    safety?.pregnancyOrPostpartumSpecialConsideration ||
    safety?.eatingDisorderOrLowEnergyRiskDeclared ||
    safety?.stopSignals?.length,
  );
}

function mergePatch(current: OnboardingPatch, incoming: OnboardingPatch): OnboardingPatch {
  return {
    ...current,
    ...incoming,
    ...(incoming.baseline ? { baseline: { ...current.baseline, ...incoming.baseline } } : {}),
    ...(incoming.dynamicFields
      ? { dynamicFields: { ...current.dynamicFields, ...incoming.dynamicFields } }
      : {}),
    ...(incoming.goalCapture ? { goalCapture: incoming.goalCapture } : {}),
    ...(incoming.trainingBackground ? { trainingBackground: incoming.trainingBackground } : {}),
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

function assertCurrentDynamicRevision(progress: OnboardingProgress, expectedRevision: number): void {
  if (!Number.isInteger(expectedRevision) || expectedRevision !== progress.revision) {
    throw new OnboardingValidationError("stale_dynamic_form");
  }
  if (progress.status === "completed") throw new OnboardingValidationError("draft_completed");
}

function assertDistinctCatalogFields(captures: readonly OnboardingDynamicFieldCapture[]): void {
  if (captures.length === 0 || new Set(captures.map((capture) => capture.fieldId)).size !== captures.length) {
    throw new OnboardingValidationError("dynamic_form_rejected");
  }
}

function findRequestedDynamicCard(
  events: readonly OnboardingDraftEvent[],
  draftId: string,
  cardId: string,
): OnboardingDynamicFormRequest | undefined {
  return events.find((event): event is Extract<OnboardingDraftEvent, { type: "onboarding.dynamic_form_requested" }> =>
    event.type === "onboarding.dynamic_form_requested" && event.draftId === draftId && event.payload.cardId === cardId,
  )?.payload;
}

function dynamicCardAlreadySubmitted(
  events: readonly OnboardingDraftEvent[],
  draftId: string,
  cardId: string,
): boolean {
  return events.some((event) =>
    event.type === "onboarding.progress_saved" &&
    event.draftId === draftId &&
    event.payload.dynamicForm?.cardId === cardId,
  );
}

const GOAL_NARRATIVE_NORMALIZER_VERSION = "goal-narrative-v1";

/**
 * This intentionally recognizes only a small, audited vocabulary. Richer
 * language understanding belongs to the Scenario Harness, which must submit
 * a typed capture through a future Field Catalog tool rather than inventing
 * fields in this reducer.
 */
function interpretGoalNarrative(
  narrative: BaselineGoalNarrativeCapture,
): GoalNarrativeCaptureDraft {
  const sourceKey = goalCaptureSourceKey(narrative.source);
  const observedAt = narrative.observedAt;
  const shared = { observedAt, source: narrative.source };
  const targetBodyFat = readPercentage(
    narrative.text.match(
      /(?:目标\s*(?:体脂(?:率)?)?\s*(?:是|为|到|降到|降至)?|体脂(?:率)?\s*(?:降到|降至|目标(?:是|为)?|到))\s*(\d+(?:\.\d+)?)\s*[%％]/u,
    )?.[1],
  );
  const currentBodyFat = readPercentage(
    narrative.text.match(
      /(?:目前|当前|现在)\s*(?:体脂(?:率)?\s*(?:大约|约|是|为)?\s*)?(\d+(?:\.\d+)?)\s*[%％]/u,
    )?.[1],
  );
  const goalTargets: GoalTargetCapture[] = targetBodyFat
    ? [{
        id: `goal-target-body-fat:${sourceKey}`,
        kind: "target_body_fat",
        status: "captured_explicit",
        value: targetBodyFat,
        ...shared,
      }]
    : [];
  const timelineBaselineMeasurements: TimelineBaselineMeasurementDraft[] = currentBodyFat
    ? [{
        id: `timeline-body-fat:${sourceKey}`,
        kind: "body_fat_percentage",
        owner: "timeline_baseline",
        status: "captured_explicit",
        value: currentBodyFat,
        measurementMethod: "unknown",
        ...shared,
      }]
    : [];
  return {
    narratives: [narrative],
    goalTargets,
    timelineBaselineMeasurements,
    visualIntents: /宽肩窄腰/u.test(narrative.text)
      ? [{
          id: `visual-wide-shoulders-narrow-waist:${sourceKey}`,
          kind: "wide_shoulders_narrow_waist",
          status: "normalized_needs_review",
          ...shared,
          normalizerVersion: GOAL_NARRATIVE_NORMALIZER_VERSION,
        }]
      : [],
    protectionIntents: /减脂[^，,。；;]*(?:保持|保住)[^，,。；;]*(?:卧推|bench\s*press)/iu.test(narrative.text)
      ? [{
          id: `protection-bench-press:${sourceKey}`,
          kind: "bench_press_performance",
          status: "normalized_needs_review",
          ...shared,
          normalizerVersion: GOAL_NARRATIVE_NORMALIZER_VERSION,
        }]
      : [],
    tradeoffs: /可以慢一点|慢一点也可以|接受[^，,。；;]*慢/u.test(narrative.text)
      ? [{
          id: `tradeoff-slower-progress:${sourceKey}`,
          kind: "slower_progress_accepted",
          status: "normalized_needs_review",
          ...shared,
          normalizerVersion: GOAL_NARRATIVE_NORMALIZER_VERSION,
        }]
      : [],
    conflicts: [],
  };
}

function readPercentage(value: string | undefined): import("../coach/domain").PercentageQuantity | undefined {
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100
    ? { value: number, unit: "percent" }
    : undefined;
}

function goalCaptureSourceKey(source: OnboardingInputSource): string {
  return source.kind === "conversation_message" ? source.messageId : source.submissionId;
}

function mergeGoalNarrativeCapture(
  current: GoalNarrativeCaptureDraft | undefined,
  incoming: GoalNarrativeCaptureDraft,
): GoalNarrativeCaptureDraft {
  const baseline: GoalNarrativeCaptureDraft = current ?? {
    narratives: [],
    goalTargets: [],
    timelineBaselineMeasurements: [],
    visualIntents: [],
    protectionIntents: [],
    tradeoffs: [],
    conflicts: [],
  };
  const goalTargets = appendDistinct(baseline.goalTargets, incoming.goalTargets);
  const timelineBaselineMeasurements = appendDistinct(
    baseline.timelineBaselineMeasurements,
    incoming.timelineBaselineMeasurements,
  );
  const conflicts = appendDistinct(
    baseline.conflicts,
    [
      ...incoming.conflicts,
      ...conflictsForGoalTargets(goalTargets),
      ...conflictsForCurrentBodyFat(timelineBaselineMeasurements),
    ],
  );
  return {
    narratives: appendDistinctNarratives(baseline.narratives, incoming.narratives),
    goalTargets,
    timelineBaselineMeasurements,
    visualIntents: appendDistinct(baseline.visualIntents, incoming.visualIntents),
    protectionIntents: appendDistinct(baseline.protectionIntents, incoming.protectionIntents),
    tradeoffs: appendDistinct(baseline.tradeoffs, incoming.tradeoffs),
    conflicts,
  };
}

function appendDistinct<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
  identity: (value: T) => string = (value) => value.id,
): T[] {
  const seen = new Set(current.map(identity));
  return [...current, ...incoming.filter((value) => !seen.has(identity(value)))];
}

function narrativeIdentity(narrative: BaselineGoalNarrativeCapture): string {
  return `${goalCaptureSourceKey(narrative.source)}:${narrative.text}`;
}

function appendDistinctNarratives(
  current: readonly BaselineGoalNarrativeCapture[],
  incoming: readonly BaselineGoalNarrativeCapture[],
): BaselineGoalNarrativeCapture[] {
  const seen = new Set(current.map(narrativeIdentity));
  return [...current, ...incoming.filter((narrative) => !seen.has(narrativeIdentity(narrative)))];
}

function conflictsForGoalTargets(captures: readonly GoalTargetCapture[]): OnboardingGoalConflict[] {
  return conflictsForPercentageCaptures(captures, "target_body_fat");
}

function conflictsForCurrentBodyFat(
  captures: readonly TimelineBaselineMeasurementDraft[],
): OnboardingGoalConflict[] {
  return conflictsForPercentageCaptures(captures, "current_body_fat");
}

function conflictsForPercentageCaptures<T extends { id: string; value: { value: number } }>(
  captures: readonly T[],
  subject: OnboardingGoalConflict["subject"],
): OnboardingGoalConflict[] {
  const conflicts: OnboardingGoalConflict[] = [];
  for (let index = 1; index < captures.length; index += 1) {
    const latest = captures[index]!;
    const prior = captures.slice(0, index).find((candidate) => candidate.value.value !== latest.value.value);
    if (!prior) continue;
    conflicts.push({
      id: `${prior.id}::${latest.id}`,
      subject,
      state: "unresolved",
      captureIds: [prior.id, latest.id],
    });
  }
  return conflicts;
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

/**
 * Compiles the new, provenance-bearing dossier draft into the existing owned
 * aggregates. This is deliberately a narrow compatibility bridge, not a
 * second onboarding form: every user fact comes from a baseline/dynamic
 * capture/training background, and gaps remain absent or explicitly limited.
 */
function validateNewDossierCompletion(
  progress: OnboardingProgress,
  now: string,
): Required<Pick<OnboardingPatch, "profile" | "goal" | "mandate" | "permissions" | "safety">> & Pick<OnboardingPatch, "professional"> {
  const baseline = progress.patch.baseline;
  if (!baseline || baselineMissingFields(baseline).length) {
    throw new OnboardingValidationError("missing_required_fields", baselineMissingFields(baseline));
  }
  if (baseline.age!.ageYears < 18) {
    throw new OnboardingValidationError("adult_confirmation_required", ["age"]);
  }
  const primaryGoal = goalFromNarrative(baseline.goalNarrative!.text);
  if (!primaryGoal) {
    throw new OnboardingValidationError("missing_required_fields", ["goal_clarification"]);
  }
  const dynamic = progress.patch.dynamicFields ?? {};
  const schedule = scheduleFromNewDossier(progress);
  const sex = sexFromNewDossier(dynamic);
  const dailyActivityLevel = dailyActivityLevelFromNewDossier(dynamic);
  const remoteLlmCapture = dynamic["permission.remote_llm"];
  const remoteLlm = remoteLlmCapture?.state === "captured_explicit"
    && (remoteLlmCapture.value === "granted" || remoteLlmCapture.value === "denied")
    ? remoteLlmCapture.value
    : "not_configured";
  const restrictions = dynamic["safety.activity_restrictions"];
  const restrictionsValue = restrictions?.state === "captured_explicit" && Array.isArray(restrictions.value)
    ? restrictions.value.filter((value): value is string => typeof value === "string")
    : [];
  const safety = {
    // Age is a supplied baseline fact, so adulthood can be derived. Every
    // other safety item remains absent until the user explicitly answers the
    // contextual safety card; absence is not a denial.
    adultConfirmed: true,
    ...(restrictionsValue.includes("medical_restriction") ? { professionalRestriction: true } : {}),
    ...(restrictionsValue.includes("pain_or_injury") ? { recentSurgeryOrAcuteInjury: true } : {}),
  };
  const background = progress.patch.trainingBackground;
  const locations = locationsFromTrainingBackground(background);
  const goalCapture = progress.patch.goalCapture;
  const targetBodyFat = goalCapture?.goalTargets.find((target) => target.kind === "target_body_fat")?.value;
  const currentBodyFat = goalCapture?.timelineBaselineMeasurements.find((measurement) => measurement.kind === "body_fat_percentage")?.value;
  const professional = background || currentBodyFat
    ? {
        ...(background?.recentSplit?.length ? { recentSplit: background.recentSplit } : {}),
        ...(background?.comparableSets?.length ? {
          setHistory: background.comparableSets.map((set) => ({
            occurredAt: set.performedOn,
            exerciseVariantId: set.exerciseVariantId,
            load: set.load,
            reps: set.reps,
            ...(set.rir !== undefined ? { rir: set.rir } : {}),
          })),
        } : {}),
        ...(currentBodyFat ? {
          bodyObservations: [{
            occurredAt: baseline.goalNarrative!.observedAt,
            metric: "body_fat_percentage" as const,
            quantity: currentBodyFat,
            condition: "unknown",
          }],
        } : {}),
      }
    : undefined;
  return {
    profile: {
      // `unknown` is deliberate. New planning uses the independent Coaching
      // level assessment; it must never see a made-up beginner label.
      trainingExperience: "unknown",
      adultConfirmed: true,
      demographics: {
        ageYears: baseline.age!.ageYears,
        height: baseline.height!.value,
        currentWeight: baseline.currentWeight!.value,
        ...(sex ? { sex } : {}),
      },
      ...(schedule ? { schedule } : {}),
      ...(locations ? { locations } : {}),
      ...(dailyActivityLevel ? { dailyActivityLevel } : {}),
      ...(background?.recentSplit?.length ? { trainingHistorySummary: { recentSplit: background.recentSplit } } : {}),
      exerciseConstraints: [],
      nutritionPreferences: [],
      professionalConstraints: [],
    },
    goal: {
      primaryGoal,
      expectedDirection: primaryGoal === "fat_loss_preserve_lean_mass"
        ? "decrease_body_fat_preserve_performance"
        : primaryGoal === "hypertrophy" ? "gain_lean_mass" : "increase_strength",
      successMetrics: primaryGoal === "fat_loss_preserve_lean_mass"
        ? ["weekly_weight_trend", "training_performance_maintained"]
        : primaryGoal === "hypertrophy" ? ["training_volume_progress"] : ["training_load_progress"],
      horizon: { startDate: now.slice(0, 10) },
      ...(targetBodyFat ? { targets: { targetBodyFat } } : {}),
      ...(primaryGoal === "fat_loss_preserve_lean_mass" ? { goalType: "fat_loss" as const } : { goalType: primaryGoal }),
    },
    // This is the minimum-authority policy boundary, not a user-selected
    // collaboration mode. It grants no autonomous plan changes.
    mandate: {
      mode: "manual",
      scopes: {
        loadReps: "manual", volume: "manual", substitution: "manual",
        schedule: "manual", deload: "manual", nutrition: "advice_only", recording: "confirm",
      },
      limits: {},
      locks: [],
    },
    permissions: {
      camera: "not_configured", health: "not_configured", notifications: "not_configured",
      remoteLlm, cloudSync: "not_configured", mediaUpload: "not_configured",
    },
    safety,
    ...(professional ? { professional } : {}),
  };
}

function goalFromNarrative(text: string): NonNullable<GoalDraft["primaryGoal"]> | undefined {
  if (/(?:减脂|减重|体脂|腹肌|瘦)/u.test(text)) return "fat_loss_preserve_lean_mass";
  if (/(?:力量|卧推|深蹲|硬拉|重量)/u.test(text)) return "strength";
  if (/(?:增肌|肌肉|围度|宽肩|翘臀|体型)/u.test(text)) return "hypertrophy";
  return undefined;
}

function scheduleFromNewDossier(progress: OnboardingProgress): { weeklyFrequency: number; sessionDurationMinutes: number } | undefined {
  const fromBackground = progress.patch.trainingBackground?.schedule;
  if (fromBackground) return fromBackground;
  const capture = progress.patch.dynamicFields?.["profile.training_schedule"];
  if (!isReviewableCapturedValue(capture) || !capture.value || typeof capture.value !== "object") return undefined;
  const value = capture.value as Record<string, unknown>;
  return typeof value.days_per_week === "number" && typeof value.minutes_per_session === "number"
    ? { weeklyFrequency: value.days_per_week, sessionDurationMinutes: value.minutes_per_session }
    : undefined;
}

function sexFromNewDossier(
  dynamic: Readonly<Record<string, OnboardingDynamicFieldCapture>>,
): "female" | "male" | "prefer_not_to_say" | undefined {
  const capture = dynamic["profile.sex"];
  return isReviewableCapturedValue(capture)
    && (capture.value === "female" || capture.value === "male" || capture.value === "prefer_not_to_say")
    ? capture.value
    : undefined;
}

function dailyActivityLevelFromNewDossier(
  dynamic: Readonly<Record<string, OnboardingDynamicFieldCapture>>,
): "sedentary" | "lightly_active" | "active" | undefined {
  const capture = dynamic["timeline.daily_activity"];
  if (!isReviewableCapturedValue(capture)) return undefined;
  switch (capture.value) {
    case "sedentary_remote_work": return "sedentary";
    case "mixed_activity": return "lightly_active";
    case "active_job": return "active";
    default: return undefined;
  }
}

/** The dossier confirmation, not the model, is the confirmation boundary. */
function isReviewableCapturedValue(
  capture: OnboardingDynamicFieldCapture | undefined,
): capture is OnboardingDynamicFieldCapture & { value: unknown } {
  return Boolean(capture && (capture.state === "captured_explicit" || capture.state === "normalized_needs_review"));
}

/**
 * Training locations are planning-critical, but must remain a direct mapping
 * of what the person selected during calibration.  In particular, an
 * `environments: ["gym"]` report does not imply that every machine or barbell
 * is available: only the explicit full-gym capture creates this location.
 */
function locationsFromTrainingBackground(
  background: TrainingBackgroundDraft | undefined,
): NonNullable<OnboardingPatch["profile"]>["locations"] | undefined {
  if (
    !background?.environments?.includes("gym")
    || !background.availableEquipment?.includes("full_gym")
  ) return undefined;
  return [{
    id: "onboarding:full_gym",
    kind: "gym",
    environment: { space: "large", noise: "any" },
    availableEquipment: ["full_gym"],
  }];
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

function trainingBackgroundFromCaptures(
  current: TrainingBackgroundDraft | undefined,
  captures: readonly OnboardingDynamicFieldCapture[],
  inputMode: "form" | "conversation",
): TrainingBackgroundDraft | undefined {
  const training = captures.filter((capture) => capture.state !== "explicit_unknown" && capture.fieldId.startsWith("training."));
  const schedule = captures.find((capture) => capture.state !== "explicit_unknown" && capture.fieldId === "profile.training_schedule");
  if (training.length === 0 && !schedule) return current;
  const sourceCapture = training[0] ?? schedule;
  if (!sourceCapture) return current;
  const next: TrainingBackgroundDraft = {
    ...(current ?? {}),
    capturedAt: sourceCapture.observedAt,
    source: sourceCapture.source,
    captureStatus: inputMode === "form" ? "captured_explicit" : "normalized_needs_review",
  };
  for (const capture of [...training, ...(schedule ? [schedule] : [])]) {
    const value = capture.value;
    if (capture.fieldId === "training.cumulative_months" && isUnknownRecord(value) && typeof value.value === "number" && value.unit === "month") {
      next.cumulativeTrainingMonths = { minimum: value.value, maximum: value.value };
    } else if (capture.fieldId === "training.recent_continuity" && isUnknownRecord(value)) {
      next.recentContinuity = {
        ...(typeof value.consecutive_weeks === "number" ? { consecutiveWeeks: value.consecutive_weeks } : {}),
        ...(typeof value.usual_sessions_per_week === "number" ? { usualSessionsPerWeek: value.usual_sessions_per_week } : {}),
        ...(typeof value.time_away_weeks === "number" ? { timeAwayWeeks: value.time_away_weeks } : {}),
      };
    } else if (capture.fieldId === "training.recent_split" && typeof value === "string") {
      next.recentSplit = value.split(/[,，、/\n]+/u).map((part) => part.trim()).filter(Boolean);
    } else if (capture.fieldId === "training.environment" && isStringArray(value)) {
      next.environments = value;
    } else if (capture.fieldId === "training.equipment" && isStringArray(value)) {
      next.availableEquipment = value;
    } else if (capture.fieldId === "training.execution_stability" && (value === "reported_consistent" || value === "reported_variable" || value === "unknown")) {
      next.executionStability = value;
    } else if (capture.fieldId === "profile.training_schedule" && isUnknownRecord(value) && typeof value.days_per_week === "number" && typeof value.minutes_per_session === "number") {
      next.schedule = { weeklyFrequency: value.days_per_week, sessionDurationMinutes: value.minutes_per_session };
    } else if (capture.fieldId === "training.comparable_set" && isUnknownRecord(value) && isUnknownRecord(value.load) && typeof value.exercise_variant === "string" && typeof value.load.value === "number" && value.load.unit === "kg" && typeof value.reps === "number" && typeof value.performed_on === "string") {
      next.comparableSets = [{
        exerciseVariantId: value.exercise_variant,
        load: { value: value.load.value, unit: "kg" },
        reps: value.reps,
        ...(typeof value.rir_or_rpe === "number" ? { rpe: value.rir_or_rpe } : {}),
        performedOn: value.performed_on,
        ...(typeof value.conditions === "string" ? { conditions: value.conditions } : {}),
      }];
    }
  }
  return next;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
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
