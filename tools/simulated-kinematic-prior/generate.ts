import fs from "node:fs";
import path from "node:path";

import { EXERCISE_REGISTRY } from "../../src/pose/exerciseRegistry";
import {
  SIMULATED_KINEMATIC_PRIOR_SCHEMA,
  buildNominalSimulatedKinematicPrior,
  buildFiveSplitPriorWorkflow,
  listSimulatedKinematicPriorTemplates,
  validateFiveSplitPriorCoverage,
} from "../../src/pose/simulatedKinematicPrior";

const projectRoot = process.cwd();
const outputPath = path.join(
  projectRoot,
  "data",
  "simulated-priors",
  "five-split-v1.json",
);

function main(): void {
  const coverageErrors = validateFiveSplitPriorCoverage();
  if (coverageErrors.length > 0) {
    throw new Error(`Simulated prior coverage is incomplete:\n${coverageErrors.join("\n")}`);
  }

  const workflow = buildFiveSplitPriorWorkflow();
  const artifact = {
    schemaVersion: "form-coach-simulated-prior-bundle/v1",
    generatedAt: new Date().toISOString(),
    source: "simulated_kinematic_prior",
    evidenceStatus: "phase_direction_only",
    calibrationStatus: "uncalibrated",
    intendedUse: [
      "segmentation_initialization",
      "synthetic_dropout_and_noise_testing",
      "capture_workflow_planning",
      "human_approved_observed_trajectory_calibration",
    ],
    prohibitedUse: [
      "form_quality_score",
      "population_standard_claim",
      "medical_diagnosis",
      "injury_risk_prediction",
      "synthetic_coordinate_imputation",
    ],
    templates: listSimulatedKinematicPriorTemplates().map((template) => ({
      ...template,
      exercise: EXERCISE_REGISTRY.get(template.exerciseId),
      nominalSimulations: template.supportedTrainingSides.map((trainingSide) =>
        buildNominalSimulatedKinematicPrior(template, trainingSide),
      ),
    })),
    workflow,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    schema: SIMULATED_KINEMATIC_PRIOR_SCHEMA,
    exerciseCount: artifact.templates.length,
    workflowStepCount: workflow.groups.reduce((total, group) => total + group.steps.length, 0),
  })}\n`);
}

main();
