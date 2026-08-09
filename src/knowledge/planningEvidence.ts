import type { KnowledgeVersionPins } from "./model";

export interface CitationRecord {
  id: string;
  claim: string;
  population: string;
  limitation: string;
  sourceKind: "local_registry";
}

export interface KnowledgeCandidate {
  id: string;
  status: "unreviewed_external";
  title: string;
  sourceUrl?: string;
  discoveredAt: string;
  cannotChangeRulePack: true;
}

const LOCAL_CITATIONS: readonly CitationRecord[] = [{
  id: "maxpower.exercise-wiki.v1",
  claim: "训练与恢复策略应在可比较事实和明确边界下迭代",
  population: "general fitness planning",
  limitation: "本地知识条目不是对个人结果的保证",
  sourceKind: "local_registry",
}];

export class PlanningCitationRegistry {
  constructor(private readonly pins: KnowledgeVersionPins) {}

  resolve(id: string): CitationRecord {
    const citation = LOCAL_CITATIONS.find((candidate) => candidate.id === id);
    if (!citation) throw new Error(`planning_citation_not_found:${id}`);
    return citation;
  }

  pinsForCitation(): KnowledgeVersionPins {
    return this.pins;
  }
}

export function asUnreviewedKnowledgeCandidate(input: {
  id: string;
  title: string;
  sourceUrl?: string;
  discoveredAt: string;
}): KnowledgeCandidate {
  return { ...input, status: "unreviewed_external", cannotChangeRulePack: true };
}
