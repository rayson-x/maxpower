import {
  instantiateRustMotionWasm,
  RustCanonicalWasmSession,
  type MotionWasmExports,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm";
import {
  RtmposeEngine,
  WEB_VISION_MODEL_MANIFEST,
  type WebVisionModelIdentity,
} from "../../src/pose/RtmposeEngine";
import {
  fetchAndVerifyBinaryArtifact,
  type VerifiedBinaryIdentity,
} from "../../src/pose/YoloxPersonDetector";

interface ClientTestCase {
  captureId: string;
  sourceCaptureId: string;
  exerciseId: string;
  capturePosition: string;
  analysisView: string;
  evaluationWindow: { startMs: number; endMs: number } | null;
  profileIdentity: string;
  profile: Omit<RustExerciseProfileData, "contentHash"> & { contentHash: string | number };
  videoUrl: string;
}

interface ClientTestPack {
  schemaVersion: string;
  seed: string;
  packSha256: string;
  sourceProfilesSha256: string;
  protocol: { sampleIntervalMs: number };
  cases: ClientTestCase[];
}

interface FrozenClientPrediction {
  schemaVersion?: string;
  packSha256?: string;
  predictionIdentity?: unknown;
  predictionIdentitySha256?: string;
}

export interface PredictionProfileIdentity {
  readonly captureId: string;
  readonly profileIdentity: string;
  readonly contentHash: string;
}

export interface PredictionRuntimeIdentity {
  readonly onnxRuntime: string;
  readonly yoloxExecutionProvider: "webgpu" | "wasm";
  readonly rtmposeExecutionProvider: "webgpu" | "wasm";
  readonly motionPacketContract: "MOTN/1.8+QLT1";
  readonly pass: "causal-chronological-single-pass";
  readonly harness: "maxpower-client-single-pass/v2";
  readonly userAgent: string;
}

export interface PredictionIdentityInput {
  readonly packSha256: string;
  readonly profileArchiveSha256: string;
  readonly models: Readonly<WebVisionModelIdentity>;
  readonly rustWasm: Readonly<VerifiedBinaryIdentity>;
  readonly profiles: readonly PredictionProfileIdentity[];
  readonly runtime: Readonly<PredictionRuntimeIdentity>;
}

export interface FrozenPredictionIdentity {
  readonly identity: Readonly<PredictionIdentityInput & {
    readonly schemaVersion: "maxpower-client-prediction-identity/v1";
  }>;
  readonly sha256: string;
}

declare global {
  interface Window {
    __MAXPOWER_CLIENT_TEST_RESULT__?: unknown;
  }
}

const CLIENT_MINIMUM_SAMPLE_INTERVAL_MS = 1_000 / 15;

if (typeof document !== "undefined") {
  const status = requireElement<HTMLElement>("#status");
  const progress = requireElement<HTMLElement>("#progress");
  const output = requireElement<HTMLElement>("#output");
  const video = requireElement<HTMLVideoElement>("#runtime-video");
  void run({ status, progress, output, video }).catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    status.textContent = `FAILED: ${message}`;
    document.body.dataset.testState = "failed";
  });
}

async function run(ui: {
  status: HTMLElement;
  progress: HTMLElement;
  output: HTMLElement;
  video: HTMLVideoElement;
}): Promise<void> {
  const { status, progress, output, video } = ui;
  document.body.dataset.testState = "loading";
  status.textContent = "Loading truth-free pack and client ONNX models…";
  const [pack, frozen, verifiedRustWasm] = await Promise.all([
    fetchJson<ClientTestPack>("/api/client-realtime-agent/pack"),
    fetchOptionalJson<FrozenClientPrediction>("/api/client-realtime-agent/prediction"),
    fetchAndVerifyBinaryArtifact(WEB_VISION_MODEL_MANIFEST.rustWasm),
  ]);
  const engine = await RtmposeEngine.create(
    WEB_VISION_MODEL_MANIFEST.models.rtmpose.publicPath,
    WEB_VISION_MODEL_MANIFEST.models.yolox.publicPath,
  );
  const predictionIdentity = await buildPredictionIdentity({
    packSha256: pack.packSha256,
    profileArchiveSha256: pack.sourceProfilesSha256,
    models: engine.modelIdentity,
    rustWasm: verifiedRustWasm.identity,
    profiles: pack.cases.map((testCase) => ({
      captureId: testCase.captureId,
      profileIdentity: testCase.profileIdentity,
      contentHash: String(testCase.profile.contentHash),
    })),
    runtime: {
      ...engine.runtimeIdentity,
      motionPacketContract: "MOTN/1.8+QLT1",
      pass: "causal-chronological-single-pass",
      harness: "maxpower-client-single-pass/v2",
      userAgent: navigator.userAgent,
    },
  });
  if (canReuseFrozenPrediction(frozen, predictionIdentity)) {
    engine.close();
    window.__MAXPOWER_CLIENT_TEST_RESULT__ = frozen;
    output.textContent = JSON.stringify(frozen, jsonReplacer, 2);
    status.textContent = "Existing byte-identical one-pass prediction is frozen; inference was not repeated";
    document.body.dataset.testState = "complete";
    return;
  }
  const rustWasm = await instantiateRustMotionWasm(verifiedRustWasm.copyBytes().buffer);
  const cases = [];
  try {
    for (let index = 0; index < pack.cases.length; index += 1) {
      const testCase = pack.cases[index];
      progress.textContent = `${index + 1}/${pack.cases.length} · ${testCase.exerciseId} · ${testCase.capturePosition}`;
      cases.push(await runCase(engine, rustWasm, video, testCase));
    }
  } finally {
    engine.close();
  }
  const result = {
    schemaVersion: "maxpower-client-single-pass-prediction/v2",
    generatedAt: new Date().toISOString(),
    packSha256: pack.packSha256,
    seed: pack.seed,
    predictionIdentity: predictionIdentity.identity,
    predictionIdentitySha256: predictionIdentity.sha256,
    runtime: {
      visual: "onnxruntime-web/yolox-nano-humanart/rtmpose-m-halpe26+rust-wasm/causal-barbell-axis",
      motion: "rust-wasm/maxpower-motion-sdk",
      pass: "causal-chronological-single-pass",
      packetContract: "MOTN/1.8+QLT1",
      byteIdentity: predictionIdentity.identity,
      pythonVisionUsed: false,
      userAgent: navigator.userAgent,
    },
    boundaries: {
      acceptanceEligible: false,
      originAttestation: "self_reported_local_browser_runtime_not_cryptographic",
      intendedUse: "client_runtime_diagnostic_only",
    },
    cases,
  };
  window.__MAXPOWER_CLIENT_TEST_RESULT__ = result;
  output.textContent = JSON.stringify(result, jsonReplacer, 2);
  status.textContent = "Prediction frozen before truth reveal";
  document.body.dataset.testState = "complete";
  await postJson("/api/client-realtime-agent/prediction", result);
}

async function runCase(
  engine: RtmposeEngine,
  rustWasm: MotionWasmExports,
  runtimeVideo: HTMLVideoElement,
  testCase: ClientTestCase,
) {
  engine.resetTracking();
  await loadVideo(runtimeVideo, testCase.videoUrl);
  const motion = new RustCanonicalWasmSession({
    sequenceId: `client-single-pass:${testCase.captureId}`,
    schema: "halpe26",
    image: {
      widthPx: runtimeVideo.videoWidth,
      heightPx: runtimeVideo.videoHeight,
      rotationDegrees: 0,
      mirrored: false,
    },
    stabilization: "fusion",
    setLifecycleMode: "preview",
  }, rustWasm);
  const profile = {
    ...testCase.profile,
    contentHash: BigInt(testCase.profile.contentHash),
  } as RustExerciseProfileData;
  const installedProfile = motion.installExerciseProfileData(profile);
  motion.beginSet();
  const startMs = testCase.evaluationWindow?.startMs ?? 0;
  const endMs = Math.min(
    testCase.evaluationWindow?.endMs ?? runtimeVideo.duration * 1_000,
    runtimeVideo.duration * 1_000,
  );
  await seekVideo(runtimeVideo, startMs / 1_000);
  runtimeVideo.muted = true;
  const frames = [];
  const startedAt = performance.now();
  let processedFrames = 0;
  let emptyCandidateFrames = 0;
  let maximumInferenceMs = 0;
  let sumInferenceMs = 0;
  let maximumEquipmentAdapterMs = 0;
  let sumEquipmentAdapterMs = 0;
  let maximumClientPipelineMs = 0;
  let sumClientPipelineMs = 0;
  let lastCapturedTimestampMs = Number.NEGATIVE_INFINITY;
  const sealedReps = new Map<string, typeof motion.lastCompletedReps[number]>();

  await runtimeVideo.play();
  try {
    while (!runtimeVideo.ended && runtimeVideo.currentTime * 1_000 <= endMs) {
      // A real camera adapter keeps only the newest frame while inference is
      // busy. Mirror that behavior here: if playback advanced during the last
      // inference, capture the currently presented frame immediately instead
      // of waiting one extra display interval for another callback.
      const presentedTimestampMs = runtimeVideo.currentTime * 1_000;
      const decodedMediaTime = presentedTimestampMs >= lastCapturedTimestampMs + CLIENT_MINIMUM_SAMPLE_INTERVAL_MS
        ? runtimeVideo.currentTime
        : await nextVideoFrame(runtimeVideo);
      // Camera clients must timestamp inference with the captured frame, not
      // with the wall clock observed after an async callback. Chromium's
      // mediaTime is the presentation timestamp of the decoded frame and is
      // the closest replay equivalent to Android/iOS camera image timestamps.
      const timestampMs = (decodedMediaTime ?? runtimeVideo.currentTime) * 1_000;
      if (timestampMs > endMs) break;
      if (timestampMs < lastCapturedTimestampMs + CLIENT_MINIMUM_SAMPLE_INTERVAL_MS) continue;
      lastCapturedTimestampMs = timestampMs;
      const framePipelineStartedAt = performance.now();
      const candidates = await engine.estimateCapturedFrame(runtimeVideo, timestampMs);
      const equipmentAdapterStartedAt = performance.now();
      const visualEquipmentFrame = testCase.exerciseId === "barbell_bench_press"
        ? engine.readCapturedLumaFrame()
        : undefined;
      const equipmentAdapterMs = performance.now() - equipmentAdapterStartedAt;
      const canonical = motion.processCandidates(candidates, timestampMs, [], visualEquipmentFrame);
      for (const rep of motion.lastCompletedReps) sealedReps.set(rep.repId.toString(), rep);
      processedFrames += 1;
      if (candidates.length === 0) emptyCandidateFrames += 1;
      maximumInferenceMs = Math.max(maximumInferenceMs, engine.latestInferenceMs);
      sumInferenceMs += engine.latestInferenceMs;
      const selected = motion.lastTarget.selectedCandidateId === null
        ? undefined
        : candidates.find((candidate) => BigInt(candidate.candidateId) === motion.lastTarget.selectedCandidateId);
      const frameResult = {
        timestampMs: Math.round(timestampMs),
        candidateCount: candidates.length,
        selectedCandidateId: motion.lastTarget.selectedCandidateId,
        targetState: motion.lastTarget.state,
        phase: motion.lastRepState.phase,
        frameValid: motion.lastFrameValid,
        canonicalQuality: canonical.overallQuality,
        inferenceMs: engine.latestInferenceMs,
        rustMotionCoreMs: motion.lastTiming.coreMs,
        equipmentAdapterMs,
        clientPipelineMs: 0,
        visualBarbellAxis: motion.lastVisualBarbellAxis,
        selectedBbox: selected?.bbox ?? null,
        selectedLandmarks: selected?.landmarks.map((landmark) => ({
          x: landmark.x,
          y: landmark.y,
          z: landmark.z,
          visibility: landmark.visibility,
        })) ?? [],
        selectedJointConfidence: selected ? {
          leftShoulder: selected.landmarks[5]?.visibility ?? 0,
          rightShoulder: selected.landmarks[6]?.visibility ?? 0,
          leftElbow: selected.landmarks[7]?.visibility ?? 0,
          rightElbow: selected.landmarks[8]?.visibility ?? 0,
          leftWrist: selected.landmarks[9]?.visibility ?? 0,
          rightWrist: selected.landmarks[10]?.visibility ?? 0,
          leftHip: selected.landmarks[11]?.visibility ?? 0,
          rightHip: selected.landmarks[12]?.visibility ?? 0,
        } : null,
        rustCanonical: canonical.landmarks.map((landmark, index) => ({
          index,
          x: Number.isFinite(landmark.x) ? landmark.x : null,
          y: Number.isFinite(landmark.y) ? landmark.y : null,
          confidence: landmark.canonicalConfidence,
          source: landmark.source,
          renderable: landmark.renderable,
        })),
        rustJointAngles: motion.lastDecodedPacket?.jointAngles.map((angle) => ({
          kind: angle.kind,
          side: angle.side,
          valueDeg: angle.valueDeg,
          confidence: angle.confidence,
          source: angle.source,
          judgeable: angle.judgeable,
        })) ?? [],
        rustEquipment: motion.lastDecodedPacket?.equipment ?? null,
      };
      frames.push(frameResult);
      frameResult.clientPipelineMs = performance.now() - framePipelineStartedAt;
      maximumEquipmentAdapterMs = Math.max(maximumEquipmentAdapterMs, equipmentAdapterMs);
      sumEquipmentAdapterMs += equipmentAdapterMs;
      maximumClientPipelineMs = Math.max(maximumClientPipelineMs, frameResult.clientPipelineMs);
      sumClientPipelineMs += frameResult.clientPipelineMs;
    }
  } finally {
    runtimeVideo.pause();
  }
  motion.finishSet();
  for (const rep of motion.lastCompletedReps) sealedReps.set(rep.repId.toString(), rep);
  const reps = [...sealedReps.values()].map((rep) => ({
    repId: rep.repId,
    startMs: rep.startTimestampMs,
    peakMs: rep.peakTimestampMs,
    endMs: rep.endTimestampMs,
    disposition: rep.disposition,
    recoveredAcrossGap: rep.recoveredAcrossGap,
    evidenceReason: rep.evidenceReason,
    observationFindings: rep.observationFindings,
    canonicalSliceHash: rep.canonicalSliceHash,
  }));
  const caseResult = {
    captureId: testCase.captureId,
    sourceCaptureId: testCase.sourceCaptureId,
    preset: { exerciseId: testCase.exerciseId, capturePosition: testCase.capturePosition },
    profileIdentity: installedProfile.identity,
    video: { width: runtimeVideo.videoWidth, height: runtimeVideo.videoHeight, durationMs: Math.round(runtimeVideo.duration * 1_000) },
    window: { startMs, endMs },
    runtime: {
      wallClockMs: performance.now() - startedAt,
      processedFrames,
      effectiveObservationFps: processedFrames / Math.max(0.001, (endMs - startMs) / 1_000),
      emptyCandidateFrames,
      meanInferenceMs: processedFrames ? sumInferenceMs / processedFrames : null,
      maximumInferenceMs,
      meanEquipmentAdapterMs: processedFrames ? sumEquipmentAdapterMs / processedFrames : null,
      maximumEquipmentAdapterMs,
      meanClientPipelineMs: processedFrames ? sumClientPipelineMs / processedFrames : null,
      maximumClientPipelineMs,
    },
    reps,
    frames,
  };
  const qualityPacket = motion.lastDecodedPacket;
  if (!qualityPacket) throw new Error(`${testCase.captureId}: Rust did not emit a final MotionPacket`);
  const executionAssessment = projectRustQualityProposals({
    lineage: qualityPacket.lineage,
    qualityProposals: motion.lastQualityProposals,
  });
  motion.close();
  return { ...caseResult, executionAssessment };
}

function nextVideoFrame(runtimeVideo: HTMLVideoElement): Promise<number | null> {
  if (runtimeVideo.ended) return Promise.resolve(null);
  const videoFrameRuntime = runtimeVideo as HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number;
    cancelVideoFrameCallback?: (handle: number) => void;
  };
  if (typeof videoFrameRuntime.requestVideoFrameCallback === "function") {
    return new Promise((resolve) => {
      let callbackId = 0;
      let settled = false;
      const settle = (mediaTime: number | null) => {
        if (settled) return;
        settled = true;
        runtimeVideo.removeEventListener("ended", onEnded);
        if (typeof videoFrameRuntime.cancelVideoFrameCallback === "function" && callbackId) {
          videoFrameRuntime.cancelVideoFrameCallback(callbackId);
        }
        resolve(mediaTime);
      };
      const onEnded = () => settle(null);
      const onVideoFrame: VideoFrameRequestCallback = (_now, metadata) => settle(metadata.mediaTime);
      runtimeVideo.addEventListener("ended", onEnded, { once: true });
      callbackId = videoFrameRuntime.requestVideoFrameCallback(onVideoFrame);
    });
  }
  return new Promise((resolve) => {
    const settle = () => {
      runtimeVideo.removeEventListener("ended", settle);
      resolve(runtimeVideo.currentTime);
    };
    runtimeVideo.addEventListener("ended", settle, { once: true });
    requestAnimationFrame(settle);
  });
}

export async function buildPredictionIdentity(
  input: PredictionIdentityInput,
): Promise<FrozenPredictionIdentity> {
  const identity = Object.freeze({
    schemaVersion: "maxpower-client-prediction-identity/v1" as const,
    packSha256: input.packSha256,
    profileArchiveSha256: input.profileArchiveSha256,
    models: Object.freeze({
      yolox: Object.freeze({ ...input.models.yolox }),
      rtmpose: Object.freeze({ ...input.models.rtmpose }),
    }),
    rustWasm: Object.freeze({ ...input.rustWasm }),
    profiles: Object.freeze([...input.profiles]
      .map((profile) => Object.freeze({ ...profile, contentHash: String(profile.contentHash) }))
      .sort((left, right) => {
        const capture = left.captureId.localeCompare(right.captureId);
        return capture || left.profileIdentity.localeCompare(right.profileIdentity);
      })),
    runtime: Object.freeze({ ...input.runtime }),
  });
  return Object.freeze({
    identity,
    sha256: await sha256Text(canonicalJson(identity)),
  });
}

export function canReuseFrozenPrediction(
  frozen: FrozenClientPrediction | null,
  expected: FrozenPredictionIdentity,
): boolean {
  return frozen?.schemaVersion === "maxpower-client-single-pass-prediction/v2"
    && frozen.packSha256 === expected.identity.packSha256
    && frozen.predictionIdentitySha256 === expected.sha256
    && canonicalJson(frozen.predictionIdentity) === canonicalJson(expected.identity);
}

/**
 * Projects the immutable Rust QLT1 envelope only. No host-side quality rule,
 * aggregation, score, or conclusion is allowed at this boundary.
 */
export function projectRustQualityProposals<T extends readonly unknown[]>(packet: {
  readonly lineage: { readonly contract: { readonly major: number; readonly minor: number } };
  readonly qualityProposals: T;
}) {
  const { major, minor } = packet.lineage.contract;
  if (major !== 1 || minor < 8) {
    throw new Error(`Rust quality output requires MOTN/1.8+QLT1; received MOTN/${major}.${minor}`);
  }
  return Object.freeze({
    schemaVersion: "maxpower-rust-quality-proposal-projection/v1",
    owner: "rust-motion-sdk" as const,
    packetContract: `MOTN/${major}.${minor}+QLT1`,
    proposals: packet.qualityProposals,
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

async function sha256Text(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function loadVideo(runtimeVideo: HTMLVideoElement, url: string): Promise<void> {
  runtimeVideo.pause();
  runtimeVideo.removeAttribute("src");
  runtimeVideo.load();
  runtimeVideo.src = url;
  runtimeVideo.preload = "auto";
  runtimeVideo.load();
  return waitForEvent(runtimeVideo, "loadedmetadata");
}

async function seekVideo(runtimeVideo: HTMLVideoElement, seconds: number): Promise<void> {
  if (Math.abs(runtimeVideo.currentTime - seconds) < 0.001) return;
  const settled = waitForEvent(runtimeVideo, "seeked");
  runtimeVideo.currentTime = seconds;
  await settled;
}

function waitForEvent(target: EventTarget, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEvent = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error(`video ${event} failed`)); };
    const cleanup = () => {
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function fetchOptionalJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function postJson(url: string, value: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value, jsonReplacer),
  });
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`client harness page is missing ${selector}`);
  return element;
}
