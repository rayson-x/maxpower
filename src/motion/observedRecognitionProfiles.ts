import {
  computeRustExerciseProfileHash,
  type RustExerciseProfileData,
} from "./rustCanonicalWasm";
import type { RustProfileContext } from "./rustProfileResolver";

interface SerializedProfile extends Omit<RustExerciseProfileData, "contentHash"> {
  contentHash: string;
}

interface ObservedProfileEntry {
  exerciseId: string;
  capturePosition: string;
  trainingSide: "bilateral";
  variation: "unrecorded";
  profile: SerializedProfile;
}

interface ObservedProfileArtifact {
  schemaVersion: "form-coach-observed-recognition-profiles/v1";
  profiles: ObservedProfileEntry[];
}

let loadedProfiles: readonly ObservedProfileEntry[] = [];

/**
 * Loads private/local field-derived recognition parameters. They are runtime
 * count/segmentation evidence only, never a normative trajectory reference.
 */
export async function loadObservedRecognitionProfiles(
  url = "/archives/confirmed-captures/recognition-profiles.json",
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Observed recognition profiles unavailable (${response.status})`);
  const artifact = JSON.parse(await response.text()) as ObservedProfileArtifact;
  if (artifact.schemaVersion !== "form-coach-observed-recognition-profiles/v1") {
    throw new Error("Observed recognition profile schema is unsupported");
  }
  loadedProfiles = artifact.profiles.map((entry) => ({
    ...entry,
    profile: { ...entry.profile },
  }));
}

/** Exact context match. An explicit equipment/grip selection never inherits an
 * older label whose variation was not recorded structurally. */
export function resolveObservedRecognitionProfile(
  context: RustProfileContext,
): RustExerciseProfileData | null {
  if (context.trainingSide !== "bilateral" || context.variation.trim() !== "") return null;
  const found = loadedProfiles.find((entry) =>
    entry.exerciseId === context.exerciseId
    && entry.capturePosition === context.capturePosition
    && entry.trainingSide === context.trainingSide
    && entry.variation === "unrecorded",
  );
  if (!found) return null;
  const profile: RustExerciseProfileData = {
    ...found.profile,
    contentHash: BigInt(found.profile.contentHash),
    primarySignal: { ...found.profile.primarySignal },
    secondarySignal: { ...found.profile.secondarySignal },
  };
  return applyObservedRecognitionCompatibilityPolicy(context, profile);
}

/**
 * A conservative compatibility pass for a small number of field-observed
 * profiles. Every branch keeps the exact action/view/side gate and returns a
 * separately identified, provisional profile; it never changes the archived
 * source profile or creates a quality threshold.
 */
export function applyObservedRecognitionCompatibilityPolicy(
  context: RustProfileContext,
  profile: RustExerciseProfileData,
): RustExerciseProfileData {
  if (context.trainingSide !== "bilateral" || context.variation.trim() !== "") return profile;
  if (context.exerciseId === "lateral_raise" && context.capturePosition === "front") {
    return withHash({
      ...profile,
      identity: `${profile.identity}/soft-cycle/v1`,
      primarySignal: { ...profile.primarySignal },
      secondarySignal: { ...profile.secondarySignal },
      startAmplitude: profile.startAmplitude * 0.85,
      minPrimaryAmplitude: profile.minPrimaryAmplitude * 0.85,
      minSecondaryAmplitude: profile.minSecondaryAmplitude * 0.85,
      returnHysteresis: profile.returnHysteresis * 0.85,
      readyTolerance: profile.readyTolerance * 0.85,
      minRepDurationMs: Math.round(profile.minRepDurationMs * 0.85),
    });
  }
  if (context.exerciseId !== "rear_delt_fly" || context.capturePosition !== "front") return profile;
  // The archived front-view rear-delt-fly profile used projected shoulder
  // angles. Their local folds were enough to create false cycles. In this
  // view the bilateral wrist spread is the direct observable of abduction, so
  // make it the versioned v2 segmentation signal. It remains a counting
  // initializer, not an ideal range-of-motion requirement.
  return withHash({
    ...profile,
    identity: `${profile.identity}/wrist-spread-cycle/v2`,
    coordinateUnit: "torso-normalized-distance",
    primarySignal: { kind: "landmark-distance", landmarks: [15, 16] },
    secondarySignal: { kind: "landmark-distance", landmarks: [15, 16] },
    direction: "increasing",
    startAmplitude: 0.04,
    minPrimaryAmplitude: 0.15,
    minSecondaryAmplitude: 0.15,
    returnHysteresis: 0.04,
    readyTolerance: 0.05,
  });
}

function withHash(
  profile: Omit<RustExerciseProfileData, "contentHash">,
): RustExerciseProfileData {
  return {
    ...profile,
    contentHash: computeRustExerciseProfileHash(profile),
  };
}
