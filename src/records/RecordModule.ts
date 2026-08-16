import type { TimelineFact } from "../coach/domain";
import type { MealObservation } from "../nutrition";
import type { TimelineAppendInput, TimelineCorrection } from "../timeline";

/**
 * The single admission module for manual and conversational Records. It owns
 * the confirm-before-admission protocol; callers never write Timeline facts
 * directly or create a second nutrition path.
 */
export class RecordModule {
  constructor(private readonly ports: {
    createTimelineDraft(input: { userId: string; idempotencyKey: string; fact: TimelineFact; occurredAt: string; source: "manual_form" | "user_statement" }): Promise<{ id: string }>;
    confirmTimelineDraft(input: { userId: string; artifactId: string; idempotencyKey: string }): Promise<unknown>;
    createNutritionDraft(input: { userId: string; idempotencyKey: string; observation: MealObservation }): Promise<{ id: string }>;
    confirmNutritionDraft(input: { userId: string; artifactId: string; idempotencyKey: string; observation: MealObservation }): Promise<unknown>;
    correctTimelineFact(input: {
      userId: string;
      idempotencyKey: string;
      correction: TimelineCorrection;
      fact: TimelineFact;
      envelope: TimelineAppendInput["envelope"];
    }): Promise<unknown>;
  }) {}

  async recordFact(input: { userId: string; idempotencyKey: string; fact: TimelineFact; occurredAt: string; source: "manual_form" | "user_statement" }): Promise<void> {
    const draft = await this.ports.createTimelineDraft(input);
    await this.ports.confirmTimelineDraft({ userId: input.userId, artifactId: draft.id, idempotencyKey: input.idempotencyKey });
  }

  async recordNutrition(input: { userId: string; idempotencyKey: string; observation: MealObservation }): Promise<void> {
    const draft = await this.ports.createNutritionDraft(input);
    await this.ports.confirmNutritionDraft({ userId: input.userId, artifactId: draft.id, idempotencyKey: input.idempotencyKey, observation: input.observation });
  }

  /**
   * Corrections are part of the same Record boundary as new facts. The UI may
   * construct the typed correction request, but it cannot reach the domain
   * application directly and create a second mutation path.
   */
  async correctFact(input: {
    userId: string;
    idempotencyKey: string;
    correction: TimelineCorrection;
    fact: TimelineFact;
    envelope: TimelineAppendInput["envelope"];
  }): Promise<void> {
    await this.ports.correctTimelineFact(input);
  }
}
