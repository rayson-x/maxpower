import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { PoseEstimate } from "../../src/pose/PoseEngine";
import {
  buildPersonalProvisionalReference,
  extractNormalizedLatPulldownRep,
  type NormalizedLatPulldownReferenceRep,
  type ReferenceSourceStatus,
  type ReferenceTrajectorySegment,
} from "../../src/pose/referenceTrajectory";
import { CAPTURE_POSITIONS, type CapturePosition } from "../../src/pose/viewGating";

interface Fixture {
  durationSec: number;
  model?: string;
  poses: PoseEstimate[];
}

interface ManifestEntry {
  id: string;
  video: string;
  keypoints: string;
  labels: string;
}

interface Manifest {
  version: string;
  captures: ManifestEntry[];
}

interface DraftReview {
  exerciseId: string;
  capturePosition?: string | null;
  expectedCount: string;
  draftSegments: ReferenceTrajectorySegment[];
  updatedAt?: string;
}

interface ApprovedReview {
  exerciseId: string;
  capturePosition?: string | null;
  expectedCount: string;
  approvedSegments: ReferenceTrajectorySegment[];
  approvedAt: string;
  variation?: string | null;
  trainingSide?: "bilateral" | "left" | "right" | "alternating" | null;
}

interface ApprovalExport {
  version: string;
  exportedAt: string;
  approvals?: Record<string, ApprovedReview>;
  drafts?: Record<string, DraftReview>;
}

interface NormalizedReview {
  exerciseId: string;
  capturePosition: string | null;
  expectedCount: string;
  segments: ReferenceTrajectorySegment[];
  sourceStatus: ReferenceSourceStatus;
  variation: string;
  trainingSide: "bilateral" | "left" | "right" | "alternating" | "unrecorded";
}

const projectRoot = process.cwd();
const capturesRoot = path.join(projectRoot, "public", "field-captures");
const manifestPath = path.join(capturesRoot, "manifest.json");
const defaultOutputPath = path.join(
  projectRoot,
  "data",
  "reference",
  "private",
  "lat-pulldown-personal-provisional-v0.json",
);

function main(): void {
  const approvalPath = process.argv.find((argument) =>
    !argument.startsWith("--") && argument.endsWith(".json"),
  );
  if (!approvalPath) {
    throw new Error(
      "Usage: npm run generate:provisional-reference -- /path/to/approvals.json [--output=/path/output.json]",
    );
  }
  const outputPath = process.argv
    .find((argument) => argument.startsWith("--output="))
    ?.slice("--output=".length) || defaultOutputPath;
  const approvalBytes = fs.readFileSync(approvalPath);
  const approvalExport = JSON.parse(approvalBytes.toString("utf8")) as ApprovalExport;
  const manifest = readJson<Manifest>(manifestPath);
  const manifestById = new Map(manifest.captures.map((entry) => [entry.id, entry]));
  const reviews = normalizedReviews(approvalExport);
  const groups = new Map<string, NormalizedLatPulldownReferenceRep[]>();
  const screeningRecords: Array<Record<string, unknown>> = [];
  const rejected: Array<Record<string, unknown>> = [];

  for (const [captureId, review] of reviews) {
    if (review.exerciseId !== "lat_pulldown") continue;
    const capturePosition = validCapturePosition(review.capturePosition)
      ? review.capturePosition
      : null;
    const manifestEntry = manifestById.get(captureId);
    if (!capturePosition || !manifestEntry) {
      rejected.push({
        captureId,
        reason: !capturePosition ? "missing_or_invalid_capture_position" : "missing_manifest_entry",
      });
      continue;
    }
    if (Number(review.expectedCount) !== review.segments.length) {
      rejected.push({ captureId, reason: "expected_count_segment_mismatch" });
      continue;
    }
    const fixture = readJson<Fixture[]>(path.join(capturesRoot, manifestEntry.keypoints))[0];
    if (!fixture) {
      rejected.push({ captureId, reason: "missing_pose_fixture" });
      continue;
    }
    const groupKey = [
      capturePosition,
      review.variation,
      review.trainingSide,
      "local_cable_lat_pulldown_unrecorded",
    ].join("|");
    for (const segment of review.segments) {
      const result = extractNormalizedLatPulldownRep({
        captureId,
        capturePosition,
        sourceStatus: review.sourceStatus,
        profileContext: {
          variation: review.variation,
          trainingSide: review.trainingSide,
          equipment: "local_cable_lat_pulldown_unrecorded",
          coordinateSystem: "source-image/v1",
          poseModelVersion: fixture.model ?? "unknown",
        },
        segment,
        poses: fixture.poses,
      });
      if (result.status === "rejected") {
        rejected.push({ captureId, repIndex: segment.repIndex, reason: result.reason });
        continue;
      }
      const rep = result.rep;
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), rep]);
      screeningRecords.push({
        captureId,
        repIndex: segment.repIndex,
        capturePosition,
        sourceStatus: review.sourceStatus,
        screening: rep.screening,
        featureCoverage: rep.featureCoverage,
        rawTiming: rep.rawTiming,
      });
    }
  }

  const profiles = [...groups.entries()].flatMap(([groupKey, reps]) => {
    const [capturePosition, variation, trainingSide, equipment] = groupKey.split("|") as [
      CapturePosition,
      string,
      "bilateral" | "left" | "right" | "alternating" | "unrecorded",
      string,
    ];
    const result = buildPersonalProvisionalReference({
      capturePosition,
      reps,
      identity: {
        variation,
        trainingSide,
        equipment,
        coordinateSystem: "source-image/v1",
      },
      generatedAt: approvalExport.exportedAt,
    });
    if (result.status === "rejected") {
      rejected.push({ groupKey, reason: result.reason });
      return [];
    }
    return [result.profile];
  });

  const artifact = {
    schemaVersion: "form-coach-personal-provisional-reference-bundle/v1",
    generatedAt: new Date().toISOString(),
    source: {
      approvalExport: path.resolve(approvalPath),
      approvalExportSha256: createHash("sha256").update(approvalBytes).digest("hex"),
      approvalExportVersion: approvalExport.version,
      approvalExportedAt: approvalExport.exportedAt,
      manifest: path.relative(projectRoot, manifestPath),
      participantCount: 1,
      formQualityLabelsAvailable: false,
    },
    intendedUse: [
      "personal_provisional_trajectory_comparison",
      "biomechanical_direction_screening",
      "matching_logic_calibration",
    ],
    prohibitedUses: [
      "population_standard_claim",
      "medical_diagnosis",
      "injury_risk_prediction",
      "automatic_promotion_of_user_uploads_to_reference",
    ],
    profiles,
    screeningRecords,
    rejected,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    profileCount: profiles.length,
    candidateRepCount: profiles.reduce(
      (total, profile) => total + profile.referencePopulation.repCount,
      0,
    ),
    screeningRecordCount: screeningRecords.length,
    rejectedCount: rejected.length,
    profiles: profiles.map((profile) => ({
      capturePosition: profile.identity.capturePosition,
      repCount: profile.referencePopulation.repCount,
      screeningSummary: profile.screeningSummary,
    })),
  }, null, 2)}\n`);
}

function normalizedReviews(approvalExport: ApprovalExport): Array<[string, NormalizedReview]> {
  const reviews = new Map<string, NormalizedReview>();
  for (const [captureId, draft] of Object.entries(approvalExport.drafts ?? {})) {
    reviews.set(captureId, {
      exerciseId: draft.exerciseId,
      capturePosition: draft.capturePosition ?? null,
      expectedCount: draft.expectedCount,
      segments: draft.draftSegments ?? [],
      sourceStatus: "human_edited_draft",
      variation: "unrecorded",
      trainingSide: "unrecorded",
    });
  }
  for (const [captureId, approval] of Object.entries(approvalExport.approvals ?? {})) {
    reviews.set(captureId, {
      exerciseId: approval.exerciseId,
      capturePosition: approval.capturePosition ?? null,
      expectedCount: approval.expectedCount,
      segments: approval.approvedSegments ?? [],
      sourceStatus: "human_approved_segmentation",
      variation: approval.variation ?? "unrecorded",
      trainingSide: approval.trainingSide ?? "unrecorded",
    });
  }
  return [...reviews.entries()];
}

function validCapturePosition(value: unknown): value is CapturePosition {
  return CAPTURE_POSITIONS.some((position) => position.id === value);
}

function readJson<T>(filename: string): T {
  return JSON.parse(fs.readFileSync(filename, "utf8")) as T;
}

main();
