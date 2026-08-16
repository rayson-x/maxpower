(function attachQualityReviewDocument(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.QualityReviewDocument = api;
})(typeof globalThis === "object" ? globalThis : this, function createQualityReviewDocumentModule() {
  "use strict";

  const EXPORT_SCHEMA_VERSION = "maxpower-motion-quality-review-export/v1";
  const VERDICTS = new Set(["correct", "incorrect", "cannot_judge"]);
  const ENDPOINTS = ["start_anchor", "primary_turnaround", "end_return"];

  function createReviewDocument(input) {
    const value = requireRecord(input, "review document input");
    const proposal = freezeJson(cloneJson(requireRecord(value.proposal, "proposal")));
    const reviewer = freezeJson(cloneJson(requireRecord(value.reviewer, "reviewer")));
    requireString(reviewer.reviewerId, "reviewerId");
    requireString(reviewer.reviewerRole, "reviewerRole");
    const targetOrder = proposalTargets(proposal);
    const decisions = new Map();

    return Object.freeze({
      proposal,
      reviewer,
      setDecision(rawDecision) {
        const decision = normalizeDecision(rawDecision, targetOrder);
        decisions.set(targetKey(decision.target), decision);
        return decision;
      },
      getDecision(rawTarget) {
        const target = normalizeTarget(rawTarget);
        const key = targetKey(target);
        if (!targetOrder.has(key)) throw new Error(`unknown review target ${key}`);
        return decisions.get(key) ?? null;
      },
      clearDecision(rawTarget) {
        const target = normalizeTarget(rawTarget);
        const key = targetKey(target);
        if (!targetOrder.has(key)) throw new Error(`unknown review target ${key}`);
        return decisions.delete(key);
      },
      listDecisions() {
        return Object.freeze([...decisions.values()]
          .sort((left, right) => targetOrder.get(targetKey(left.target)) - targetOrder.get(targetKey(right.target))));
      },
      exportJson(rawMetadata) {
        const exportMetadata = cloneJson(requireRecord(rawMetadata, "export metadata"));
        requireString(exportMetadata.exportId, "exportId");
        requireString(exportMetadata.exportedAt, "exportedAt");
        requireString(exportMetadata.applicationVersion, "applicationVersion");
        const orderedDecisions = [...decisions.values()]
          .sort((left, right) => targetOrder.get(targetKey(left.target)) - targetOrder.get(targetKey(right.target)))
          .map((decision) => cloneJson(decision));
        return stableJson({
          schemaVersion: EXPORT_SCHEMA_VERSION,
          proposalHash: requireString(proposal.proposalHash, "proposal hash"),
          proposalLineage: cloneJson(requireRecord(proposal.lineage, "proposal lineage")),
          reviewer: cloneJson(reviewer),
          exportMetadata,
          decisions: orderedDecisions,
        });
      },
    });
  }

  function importReviewDocument(input) {
    const value = requireRecord(input, "review import input");
    const proposal = requireRecord(value.proposal, "proposal");
    if (typeof value.json !== "string") throw new Error("review import json must be a string");
    let imported;
    try {
      imported = requireRecord(JSON.parse(value.json), "review export");
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("review import json is invalid");
      throw error;
    }
    if (imported.schemaVersion !== EXPORT_SCHEMA_VERSION) throw new Error("unsupported review export schema");
    if (imported.proposalHash !== proposal.proposalHash) throw new Error("review export proposal hash mismatch");
    if (stableJson(imported.proposalLineage) !== stableJson(proposal.lineage)) {
      throw new Error("review export proposal lineage mismatch");
    }
    requireRecord(imported.exportMetadata, "review export metadata");
    if (!Array.isArray(imported.decisions)) throw new Error("review export decisions must be an array");
    const review = createReviewDocument({ proposal, reviewer: imported.reviewer });
    for (const decision of imported.decisions) review.setDecision(decision);
    return review;
  }

  function proposalTargets(proposal) {
    requireString(proposal.proposalHash, "proposal hash");
    requireRecord(proposal.lineage, "proposal lineage");
    if (!Array.isArray(proposal.reps)) throw new Error("proposal reps must be an array");
    const targets = new Map();
    let order = 0;
    for (const rawRep of proposal.reps) {
      const rep = requireRecord(rawRep, "proposal rep");
      const repId = requireString(rep.repId, "proposal rep id");
      const endpoints = requireRecord(rep.endpoints, `proposal rep ${repId} endpoints`);
      for (const endpoint of ENDPOINTS) {
        if (!Object.prototype.hasOwnProperty.call(endpoints, endpoint)) {
          throw new Error(`proposal rep ${repId} is missing endpoint ${endpoint}`);
        }
        requireRecord(endpoints[endpoint], `proposal rep ${repId} endpoint ${endpoint}`);
        const key = targetKey({ kind: "endpoint", repId, endpoint });
        if (targets.has(key)) throw new Error(`duplicate review target ${key}`);
        targets.set(key, order++);
      }
      if (!Array.isArray(rep.conclusions)) throw new Error(`proposal rep ${repId} conclusions must be an array`);
      for (const rawConclusion of rep.conclusions) {
        const conclusion = requireRecord(rawConclusion, `proposal rep ${repId} conclusion`);
        const conclusionId = requireString(conclusion.conclusionId, "proposal conclusion id");
        const key = targetKey({ kind: "conclusion", repId, conclusionId });
        if (targets.has(key)) throw new Error(`duplicate review target ${key}`);
        targets.set(key, order++);
      }
    }
    return targets;
  }

  function normalizeDecision(rawDecision, targetOrder) {
    const value = requireRecord(rawDecision, "review decision");
    const target = normalizeTarget(value.target);
    const key = targetKey(target);
    if (!targetOrder.has(key)) throw new Error(`unknown review target ${key}`);
    if (!VERDICTS.has(value.verdict)) throw new Error("invalid review verdict");
    if (!Object.prototype.hasOwnProperty.call(value, "correctedValue")) {
      throw new Error("correctedValue must be explicitly provided as a value or null");
    }
    return freezeJson({
      target,
      verdict: value.verdict,
      correctedValue: cloneJson(value.correctedValue),
      note: normalizeOptionalString(value.note, "review note"),
    });
  }

  function normalizeTarget(rawTarget) {
    const value = requireRecord(rawTarget, "review target");
    const repId = requireString(value.repId, "review target rep id");
    if (value.kind === "endpoint") {
      const endpoint = requireString(value.endpoint, "review endpoint");
      if (!ENDPOINTS.includes(endpoint)) throw new Error("invalid review endpoint");
      return { kind: "endpoint", repId, endpoint };
    }
    if (value.kind === "conclusion") {
      return {
        kind: "conclusion",
        repId,
        conclusionId: requireString(value.conclusionId, "review conclusion id"),
      };
    }
    throw new Error("invalid review target kind");
  }

  function targetKey(target) {
    return target.kind === "endpoint"
      ? `${target.repId}\u0000endpoint\u0000${target.endpoint}`
      : `${target.repId}\u0000conclusion\u0000${target.conclusionId}`;
  }

  function stableJson(value) {
    return `${JSON.stringify(sortJson(value), null, 2)}\n`;
  }

  function sortJson(value) {
    if (Array.isArray(value)) return value.map(sortJson);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
    }
    return value;
  }

  function cloneJson(value, seen = new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("review document contains a non-finite number");
      return value;
    }
    if (typeof value !== "object") throw new Error("review document must contain JSON values only");
    if (seen.has(value)) throw new Error("review document contains a circular value");
    seen.add(value);
    const cloned = Array.isArray(value)
      ? value.map((entry) => cloneJson(entry, seen))
      : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJson(entry, seen)]));
    seen.delete(value);
    return cloned;
  }

  function freezeJson(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.values(value).forEach(freezeJson);
      Object.freeze(value);
    }
    return value;
  }

  function requireRecord(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value;
  }

  function requireString(value, label) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
    return value.trim();
  }

  function normalizeOptionalString(value, label) {
    if (value == null) return null;
    if (typeof value !== "string") throw new Error(`${label} must be a string or null`);
    return value.trim() || null;
  }

  return {
    EXPORT_SCHEMA_VERSION,
    createReviewDocument,
    importReviewDocument,
  };
});
