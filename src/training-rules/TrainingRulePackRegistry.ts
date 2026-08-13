import { stableHash } from "../coach/stable";
import type { KnowledgeVersionPins } from "../knowledge/model";
import { createTrainingRulePacks } from "./trainingRulePacks";
import type {
  RuleDecision,
  RuleEvaluationContext,
  RulePackLoadRequest,
  RulePackLoadResult,
  TrainingGoal,
  TrainingRulePack,
} from "./model";

const IDS: Record<TrainingGoal, string> = {
  hypertrophy: "maxpower.training.hypertrophy",
  strength: "maxpower.training.strength",
  fat_loss_preserve_lean_mass: "maxpower.training.fat_loss_preserve_lean_mass",
};

export class TrainingRulePackRegistry {
  private readonly packs: ReadonlyMap<TrainingGoal, TrainingRulePack>;
  private readonly packsByPin: ReadonlyMap<string, TrainingRulePack>;

  constructor(
    private readonly pins: KnowledgeVersionPins,
    archivedPins: readonly KnowledgeVersionPins[] = [],
  ) {
    const current = createTrainingRulePacks(pins.rulePacks);
    const archived = archivedPins.flatMap((candidate) => createTrainingRulePacks(candidate.rulePacks));
    this.packs = new Map(current.map((pack) => [pack.descriptor.goal, pack]));
    this.packsByPin = new Map(
      [...current, ...archived].map((pack) => [
        pinKey({
          id: pack.descriptor.id,
          semanticVersion: pack.descriptor.semanticVersion,
          schemaVersion: pack.descriptor.schemaVersion,
          contentHash: pack.descriptor.contentHash,
        }),
        pack,
      ]),
    );
  }

  load(request: RulePackLoadRequest): RulePackLoadResult {
    const current = this.packs.get(request.goal);
    if (!current) return unavailable(request.goal, "unsupported_goal");
    if (!request.pin) return unavailable(request.goal, "missing_version_pin");
    const pack = this.packsByPin.get(pinKey(request.pin));
    if (!pack || pack.descriptor.goal !== request.goal) {
      return unavailable(request.goal, "pin_mismatch");
    }
    return { status: "available", pack };
  }

  current(goal: TrainingGoal): RulePackLoadResult {
    const id = IDS[goal];
    return this.load({ goal, pin: this.pins.rulePacks.find((candidate) => candidate.id === id) });
  }

  descriptor(goal: TrainingGoal) {
    const loaded = this.current(goal);
    return loaded.status === "available" ? loaded.pack.descriptor : undefined;
  }

  substitutionPolicy(goal: TrainingGoal): {
    policy: import("./model").SubstitutionRankingPolicy;
    rule: { id: string; semanticVersion: string; schemaVersion: number; contentHash: string };
  } | undefined {
    const loaded = this.current(goal);
    if (loaded.status !== "available") return undefined;
    const descriptor = loaded.pack.descriptor;
    return {
      policy: descriptor.substitutionRanking,
      rule: {
        id: descriptor.id,
        semanticVersion: descriptor.semanticVersion,
        schemaVersion: descriptor.schemaVersion,
        contentHash: descriptor.contentHash,
      },
    };
  }

  evaluate(context: RuleEvaluationContext): RuleDecision {
    const loaded = this.current(context.goal);
    return loaded.status === "available" ? loaded.pack.evaluate(context) : loaded.decision;
  }
}

function pinKey(pin: {
  id: string;
  semanticVersion: string;
  schemaVersion: number;
  contentHash: string;
}): string {
  return `${pin.id}@${pin.semanticVersion}/s${pin.schemaVersion}#${pin.contentHash}`;
}

function unavailable(
  goal: TrainingGoal,
  reason: "missing_version_pin" | "pin_mismatch" | "unsupported_goal",
): Extract<RulePackLoadResult, { status: "unavailable" }> {
  return {
    status: "unavailable",
    reason,
    decision: {
      decision: "unavailable",
      scope: "next_session",
      states: { performance: "INSUFFICIENT_EVIDENCE", volume: "INSUFFICIENT_EVIDENCE" },
      reasonCodes: [`rule_pack_${reason}`],
      evidenceRefs: [],
      missing: ["compatible_versioned_training_rule_pack"],
      conflicts: [],
      before: {},
      after: {},
      rule: { id: IDS[goal], semanticVersion: "unknown", contentHash: stableHash({ goal, reason }) },
      confidence: 0,
      requiresConfirmation: true,
      reviewBoundary: "weekly_review",
      safetyBoundary: ["no_unversioned_or_LLM_fallback"],
      explanation: "规则包不可用，保持当前训练计划并禁止猜测进阶。",
    },
  };
}
