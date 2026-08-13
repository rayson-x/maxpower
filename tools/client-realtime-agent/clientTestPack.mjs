import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_DATASET = "data/training/personal-golden-segmentation-v2.json";
const DEFAULT_PROFILES = "public/archives/confirmed-captures/recognition-profiles.candidate.json";
const DEFAULT_OUTPUT = "data/workflows/client-realtime-agent/client-single-pass-v1/test-pack-before-truth.json";
const DEFAULT_SEED = "maxpower-client-single-pass-2026-08-12-v1";
const DEFAULT_COUNT = 3;

export async function buildClientTestPack(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const datasetPath = resolve(projectRoot, options.datasetPath ?? DEFAULT_DATASET);
  const profilesPath = resolve(projectRoot, options.profilesPath ?? DEFAULT_PROFILES);
  const outputPath = resolve(projectRoot, options.outputPath ?? DEFAULT_OUTPUT);
  const archiveRoot = resolve(projectRoot, "public/archives/confirmed-captures");
  const seed = options.seed ?? DEFAULT_SEED;
  const count = options.count ?? DEFAULT_COUNT;
  const excludedSourceCaptureIds = new Set(options.excludedSourceCaptureIds ?? []);
  const includedExerciseIds = new Set(options.includedExerciseIds ?? []);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("count must be a positive integer");

  const [dataset, profileArchive] = await Promise.all([
    readJson(datasetPath),
    readJson(profilesPath),
  ]);
  const profiles = new Map();
  for (const entry of profileArchive.profiles ?? []) {
    const key = profileKey(entry.exerciseId, entry.capturePosition);
    if (!profiles.has(key)) profiles.set(key, entry);
  }

  const eligible = [];
  const seen = new Set();
  for (const record of dataset.records ?? []) {
    const sourceCaptureId = String(record.sourceCaptureId ?? record.captureId ?? "");
    const videoPath = record.source?.video;
    const profileEntry = profiles.get(profileKey(record.exerciseId, record.capturePosition));
    if (!sourceCaptureId
      || seen.has(sourceCaptureId)
      || excludedSourceCaptureIds.has(sourceCaptureId)
      || (includedExerciseIds.size > 0 && !includedExerciseIds.has(String(record.exerciseId)))
      || typeof videoPath !== "string"
      || !profileEntry) continue;
    await access(resolve(archiveRoot, videoPath));
    seen.add(sourceCaptureId);
    eligible.push({
      captureId: String(record.captureId),
      sourceCaptureId,
      exerciseId: String(record.exerciseId),
      capturePosition: String(record.capturePosition),
      analysisView: String(record.analysisView ?? record.capturePosition),
      // The client must process the same whole-stream boundary available from
      // a live camera. Dataset evaluation windows are label-derived truth and
      // therefore remain hidden until after prediction is frozen.
      evaluationWindow: null,
      videoPath,
      profileIdentity: String(profileEntry.profile.identity),
      profile: profileEntry.profile,
    });
  }
  if (eligible.length < count) {
    throw new Error(`only ${eligible.length} client-test captures have an exact action/view profile`);
  }
  const selected = seededShuffle(eligible, seed).slice(0, count);
  const semantic = {
    schemaVersion: "maxpower-client-single-pass-test-pack/v1",
    protocol: {
      inference: "client_onnx_yolox_rtmpose_halpe26_to_rust_sdk",
      causality: "chronological_single_pass_no_future_no_reinference",
      truthAccess: "forbidden_until_prediction_persisted",
      sampleIntervalMs: 100,
      runtimeInputs: ["video_frame", "preset_exercise", "preset_camera_view", "candidate_profile"],
      forbiddenRuntimeInputs: ["expectedCount", "segments", "startMs", "peakMs", "endMs"],
    },
    seed,
    sourceDatasetSha256: await sha256(datasetPath),
    sourceProfilesSha256: await sha256(profilesPath),
    cases: selected,
  };
  assertTruthFree(semantic);
  const pack = {
    ...semantic,
    packSha256: createHash("sha256").update(JSON.stringify(semantic)).digest("hex"),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  return { outputPath, pack };
}

export function publicClientTestPack(pack) {
  assertTruthFree(pack);
  return {
    ...pack,
    cases: pack.cases.map(({ videoPath: _privatePath, ...testCase }) => ({
      ...testCase,
      videoUrl: `/media/client-realtime-agent?id=${encodeURIComponent(testCase.captureId)}`,
    })),
  };
}

export function assertTruthFree(value) {
  const forbidden = new Set(["expectedCount", "segments", "startMs", "peakMs", "endMs"]);
  const visit = (node, path = "$") => {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (forbidden.has(key)) throw new Error(`truth field ${path}.${key} is forbidden before inference`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(value);
}

function profileKey(exerciseId, capturePosition) {
  return `${String(exerciseId)}\u0000${String(capturePosition)}`;
}

function seededShuffle(values, seed) {
  const output = [...values];
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0) || 0x9e3779b9;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  for (let index = output.length - 1; index > 0; index -= 1) {
    const replacement = Math.floor(random() * (index + 1));
    [output[index], output[replacement]] = [output[replacement], output[index]];
  }
  return output;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const excludePackPaths = args.flatMap((value, index) => value === "--exclude-pack" ? [args[index + 1]] : []).filter(Boolean);
  const excludePacks = await Promise.all(excludePackPaths.map((path) => readJson(resolve(process.cwd(), path))));
  const result = await buildClientTestPack({
    seed: option("--seed", DEFAULT_SEED),
    count: Number(option("--count", DEFAULT_COUNT)),
    outputPath: option("--output", DEFAULT_OUTPUT),
    profilesPath: option("--profiles", DEFAULT_PROFILES),
    includedExerciseIds: args.flatMap((value, index) => value === "--exercise" ? [args[index + 1]] : []).filter(Boolean),
    excludedSourceCaptureIds: excludePacks.flatMap((pack) => (pack?.cases ?? []).map((item) => String(item.sourceCaptureId ?? item.captureId ?? ""))),
  });
  process.stdout.write(`${result.outputPath}\n`);
  for (const item of result.pack.cases) {
    process.stdout.write(`${item.captureId}\t${item.exerciseId}\t${item.capturePosition}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  await main();
}
