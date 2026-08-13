import { loadOrt, type OrtModule, type OrtSession } from "../shims/onnxRuntime";
import type { PoseCandidateEstimate, PoseEstimate, PoseLandmark } from "./PoseEngine";
import {
  createVerifiedOnnxSession,
  fetchAndVerifyBinaryArtifact,
  YoloxPersonDetector,
  writeRgbaPixelsAsBgrChw,
  type BinaryArtifactFetcher,
  type PersonDetection,
  type PinnedBinaryArtifact,
  type VerifiedBinaryArtifact,
  type VerifiedBinaryIdentity,
} from "./YoloxPersonDetector";

const INPUT_WIDTH = 192;
const INPUT_HEIGHT = 256;
const SIMCC_BINS_X = INPUT_WIDTH * 2;
const SIMCC_BINS_Y = INPUT_HEIGHT * 2;
const KEYPOINT_COUNT = 26;
const BBOX_PADDING = 1.25;
const MAX_PERSON_CANDIDATES = 4;
const CANDIDATE_IDENTITY_MEMORY_MS = 1_500;
const MEAN = [123.675, 116.28, 103.53] as const;
const STD = [58.395, 57.12, 57.375] as const;

export const WEB_VISION_MODEL_MANIFEST = Object.freeze({
  schemaVersion: "maxpower-web-vision-model-manifest/v1",
  runtime: "onnxruntime-web@1.22.0",
  models: Object.freeze({
    yolox: Object.freeze({
      id: "yolox-nano-humanart-416x416",
      publicPath: "/models/yolox-nano-humanart-416x416.onnx",
      bytes: 3_722_395,
      sha256: "1450966de24902b18aada1a78913d7efd8fc8dcd51bd4d0d5591476bd4a38821",
    }),
    rtmpose: Object.freeze({
      id: "rtmpose-m-halpe26-256x192",
      publicPath: "/models/rtmpose-m-halpe26-256x192.onnx",
      bytes: 55_685_444,
      sha256: "26f3a19e61304a600dfb82d1001d41d24343b89fc70a33ffc84657e0b0bf2ecf",
    }),
  }),
  rustWasm: Object.freeze({
    id: "maxpower-motion-sdk-wasm",
    publicPath: "/motion-sdk/maxpower_motion_sdk.wasm",
    bytes: 495_415,
    sha256: "176da2451d029e170243cac4f2df6a92aeb9464c901bef75586066fa93a7c8b6",
  }),
});

export interface WebVisionModelIdentity {
  readonly yolox: Readonly<VerifiedBinaryIdentity>;
  readonly rtmpose: Readonly<VerifiedBinaryIdentity>;
}

export interface WebVisionRuntimeIdentity {
  readonly onnxRuntime: string;
  readonly yoloxExecutionProvider: "webgpu" | "wasm";
  readonly rtmposeExecutionProvider: "webgpu" | "wasm";
}

interface TrackedDetection extends PersonDetection {
  candidateId: number;
}

export interface CapturedLumaFrame {
  readonly width: number;
  readonly height: number;
  readonly luma: Uint8Array;
}

/**
 * Deep visual-observation Module: frozen frame -> YOLOX people -> batched
 * RTMPose Halpe-26 candidates. It emits raw model observations only. Subject
 * selection, temporal repair, phase and rep truth remain in Rust.
 */
export class RtmposeEngine {
  private readonly frameCanvas = document.createElement("canvas");
  private readonly frameContext: CanvasRenderingContext2D;
  private readonly cropCanvas = document.createElement("canvas");
  private readonly cropContext: CanvasRenderingContext2D;
  private readonly equipmentCanvas = document.createElement("canvas");
  private readonly equipmentContext: CanvasRenderingContext2D;
  private busy = false;
  private closed = false;
  private unreadCandidates: PoseCandidateEstimate[] | null = null;
  private unreadInferenceMs = 0;
  private trackedDetections: TrackedDetection[] = [];
  private lastDetectorObservationMs: number | null = null;
  private nextCandidateId = 0;

  private constructor(
    private readonly ort: OrtModule,
    private readonly session: OrtSession,
    private readonly detector: YoloxPersonDetector,
    readonly modelIdentity: Readonly<WebVisionModelIdentity>,
    readonly runtimeIdentity: Readonly<WebVisionRuntimeIdentity>,
  ) {
    const frameContext = this.frameCanvas.getContext("2d", { willReadFrequently: true });
    if (!frameContext) throw new Error("无法创建 RTMPose frame canvas context");
    this.frameContext = frameContext;
    this.cropCanvas.width = INPUT_WIDTH;
    this.cropCanvas.height = INPUT_HEIGHT;
    const cropContext = this.cropCanvas.getContext("2d", { willReadFrequently: true });
    if (!cropContext) throw new Error("无法创建 RTMPose crop canvas context");
    this.cropContext = cropContext;
    const equipmentContext = this.equipmentCanvas.getContext("2d", { willReadFrequently: true });
    if (!equipmentContext) throw new Error("无法创建器械识别 frame canvas context");
    this.equipmentContext = equipmentContext;
  }

  static async create(
    poseModel: string | VerifiedBinaryArtifact,
    detectorModel: string | VerifiedBinaryArtifact,
    fetcher: BinaryArtifactFetcher = globalThis.fetch.bind(globalThis),
  ): Promise<RtmposeEngine> {
    const [ort, verifiedPose, verifiedDetector] = await Promise.all([
      loadOrt(),
      resolveVerifiedModel(poseModel, WEB_VISION_MODEL_MANIFEST.models.rtmpose, fetcher),
      resolveVerifiedModel(detectorModel, WEB_VISION_MODEL_MANIFEST.models.yolox, fetcher),
    ]);
    const [detector, poseSession] = await Promise.all([
      YoloxPersonDetector.create(ort, verifiedDetector),
      createVerifiedOnnxSession(ort, verifiedPose),
    ]);
    return new RtmposeEngine(
      ort,
      poseSession.session,
      detector,
      Object.freeze({
        yolox: verifiedDetector.identity,
        rtmpose: verifiedPose.identity,
      }),
      Object.freeze({
        onnxRuntime: WEB_VISION_MODEL_MANIFEST.runtime,
        yoloxExecutionProvider: detector.executionProvider,
        rtmposeExecutionProvider: poseSession.executionProvider,
      }),
    );
  }

  get latestInferenceMs(): number {
    return this.unreadInferenceMs;
  }

  estimate(video: HTMLVideoElement, timestampMs: number): PoseEstimate | null {
    return this.estimateCandidates(video, timestampMs)?.[0] ?? null;
  }

  estimateCandidates(
    video: HTMLVideoElement,
    timestampMs: number,
  ): PoseCandidateEstimate[] | null {
    if (video.readyState < 2 || video.videoWidth === 0 || this.closed) return null;
    const completed = this.unreadCandidates;
    this.unreadCandidates = null;
    if (!this.busy) {
      this.busy = true;
      this.captureFrame(video);
      const startedAt = performance.now();
      void this.inferCapturedFrame(timestampMs)
        .then((candidates) => {
          if (this.closed) return;
          this.unreadInferenceMs = performance.now() - startedAt;
          this.unreadCandidates = candidates;
        })
        .catch((error) => {
          console.warn("YOLOX + RTMPose frame failed", error);
        })
        .finally(() => {
          this.busy = false;
        });
    }
    return completed;
  }

  /**
   * Captures the video element's current decoded frame and resolves with the
   * observations produced from that exact frame. This is the deterministic
   * client-runtime path used by causal replay and native parity tests: unlike
   * `estimateCandidates`, it never returns a result belonging to an earlier
   * asynchronous request.
   *
   * The caller must keep calls sequential. A live camera loop may let the
   * video advance while inference is running; the supplied timestamp remains
   * the capture timestamp, so dropped frames do not shift pose evidence onto
   * a newer image.
   */
  async estimateCapturedFrame(
    video: HTMLVideoElement,
    timestampMs: number,
  ): Promise<PoseCandidateEstimate[]> {
    if (video.readyState < 2 || video.videoWidth === 0 || this.closed) return [];
    if (this.busy) throw new Error("YOLOX + RTMPose already has an in-flight frame");
    this.busy = true;
    this.captureFrame(video);
    const startedAt = performance.now();
    try {
      const candidates = await this.inferCapturedFrame(timestampMs);
      this.unreadInferenceMs = performance.now() - startedAt;
      return candidates;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Returns a downscaled luma copy of the exact frame most recently captured
   * for YOLOX/RTMPose. Pixel conversion is the browser Adapter's only job;
   * detection and causal trajectory state execute in shared Rust/WASM.
   */
  readCapturedLumaFrame(maximumDimension = 480): CapturedLumaFrame {
    if (this.frameCanvas.width === 0 || this.frameCanvas.height === 0 || this.closed) {
      throw new Error("RTMPose has no captured frame for Rust equipment recognition");
    }
    const scale = Math.min(
      1,
      maximumDimension / Math.max(this.frameCanvas.width, this.frameCanvas.height),
    );
    const width = Math.max(8, Math.round(this.frameCanvas.width * scale));
    const height = Math.max(8, Math.round(this.frameCanvas.height * scale));
    if (this.equipmentCanvas.width !== width || this.equipmentCanvas.height !== height) {
      this.equipmentCanvas.width = width;
      this.equipmentCanvas.height = height;
    }
    this.equipmentContext.drawImage(this.frameCanvas, 0, 0, width, height);
    const rgba = this.equipmentContext.getImageData(0, 0, width, height).data;
    const luma = new Uint8Array(width * height);
    for (let pixel = 0, offset = 0; pixel < luma.length; pixel += 1, offset += 4) {
      luma[pixel] = Math.round(
        rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114,
      );
    }
    return { width, height, luma };
  }

  /** Starts a new camera/file sequence without reloading the ONNX models. */
  resetTracking(): void {
    if (this.busy) throw new Error("Cannot reset RTMPose tracking during inference");
    this.unreadCandidates = null;
    this.unreadInferenceMs = 0;
    this.trackedDetections = [];
    this.lastDetectorObservationMs = null;
    this.nextCandidateId = 0;
  }

  private captureFrame(video: HTMLVideoElement): void {
    if (
      this.frameCanvas.width !== video.videoWidth ||
      this.frameCanvas.height !== video.videoHeight
    ) {
      this.frameCanvas.width = video.videoWidth;
      this.frameCanvas.height = video.videoHeight;
    }
    this.frameContext.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
  }

  private async inferCapturedFrame(timestampMs: number): Promise<PoseCandidateEstimate[]> {
    const width = this.frameCanvas.width;
    const height = this.frameCanvas.height;
    const detections = (await this.detector.detect(this.frameCanvas, width, height))
      .slice(0, MAX_PERSON_CANDIDATES);
    if (detections.length === 0) return [];
    if (
      this.lastDetectorObservationMs !== null
      && timestampMs - this.lastDetectorObservationMs > CANDIDATE_IDENTITY_MEMORY_MS
    ) {
      this.trackedDetections = [];
    }
    const association = associatePersonCandidateIds(
      detections,
      this.trackedDetections,
      width,
      height,
      this.nextCandidateId,
    );
    this.trackedDetections = association.detections;
    this.lastDetectorObservationMs = timestampMs;
    this.nextCandidateId = association.nextCandidateId;
    const poseDetections = association.detections;
    if (poseDetections.length === 0) return [];
    const input = this.preprocessBatch(poseDetections);
    const outputs = await this.session.run({
      [this.session.inputNames[0]]: new this.ort.Tensor(
        "float32",
        input,
        [poseDetections.length, 3, INPUT_HEIGHT, INPUT_WIDTH],
      ),
    });
    return this.decode(outputs, poseDetections, timestampMs, width, height);
  }

  private preprocessBatch(detections: readonly TrackedDetection[]): Float32Array {
    const plane = INPUT_WIDTH * INPUT_HEIGHT;
    const input = new Float32Array(detections.length * 3 * plane);
    detections.forEach((detection, batchIndex) => {
      const crop = paddedCrop(detection.bbox);
      this.cropContext.fillStyle = "black";
      this.cropContext.fillRect(0, 0, INPUT_WIDTH, INPUT_HEIGHT);
      this.cropContext.drawImage(
        this.frameCanvas,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        INPUT_WIDTH,
        INPUT_HEIGHT,
      );
      const pixels = this.cropContext.getImageData(0, 0, INPUT_WIDTH, INPUT_HEIGHT).data;
      const batchOffset = batchIndex * 3 * plane;
      writeRgbaPixelsAsBgrChw(pixels, input, batchOffset, plane, MEAN, STD);
    });
    return input;
  }

  private decode(
    outputs: Record<string, { data: Float32Array | BigInt64Array | Int32Array; dims: readonly number[] }>,
    detections: readonly TrackedDetection[],
    timestampMs: number,
    width: number,
    height: number,
  ): PoseCandidateEstimate[] {
    const tensors = Object.values(outputs);
    const simccX = outputs.simcc_x ?? tensors.find((tensor) => tensor.dims.at(-1) === SIMCC_BINS_X);
    const simccY = outputs.simcc_y ?? tensors.find((tensor) => tensor.dims.at(-1) === SIMCC_BINS_Y);
    if (!simccX || !simccY) return [];
    const xData = simccX.data as Float32Array;
    const yData = simccY.data as Float32Array;
    return detections.map((detection, batchIndex) => {
      const crop = paddedCrop(detection.bbox);
      const landmarks: PoseLandmark[] = [];
      for (let keypoint = 0; keypoint < KEYPOINT_COUNT; keypoint += 1) {
        const keypointOffset = batchIndex * KEYPOINT_COUNT + keypoint;
        const xOffset = keypointOffset * SIMCC_BINS_X;
        const yOffset = keypointOffset * SIMCC_BINS_Y;
        const [xIndex, xScore] = argmax(xData, xOffset, SIMCC_BINS_X);
        const [yIndex, yScore] = argmax(yData, yOffset, SIMCC_BINS_Y);
        landmarks.push({
          x: (crop.x + (xIndex / 2 / INPUT_WIDTH) * crop.width) / width,
          y: (crop.y + (yIndex / 2 / INPUT_HEIGHT) * crop.height) / height,
          z: 0,
          visibility: clamp((xScore + yScore) / 2, 0, 1),
        });
      }
      return {
        timestampMs,
        candidateId: detection.candidateId,
        landmarks,
        worldLandmarks: [],
        bbox: {
          x: detection.bbox[0] / width,
          y: detection.bbox[1] / height,
          width: (detection.bbox[2] - detection.bbox[0]) / width,
          height: (detection.bbox[3] - detection.bbox[1]) / height,
        },
        torsoColor: sampleTorsoColor(this.frameContext, landmarks, width, height),
      };
    });
  }

  close(): void {
    this.closed = true;
    this.unreadCandidates = null;
    this.trackedDetections = [];
    this.lastDetectorObservationMs = null;
    this.detector.close();
    void this.session.release();
  }
}

export interface PersonCandidateAssociation {
  detections: TrackedDetection[];
  nextCandidateId: number;
}

/**
 * Associates current YOLOX boxes with prior frame-local identities without
 * choosing the workout subject. Every retained candidate is sent through
 * RTMPose and then to Rust, which remains the sole subject-selection owner.
 */
export function associatePersonCandidateIds(
  current: readonly PersonDetection[],
  previous: readonly TrackedDetection[],
  width: number,
  height: number,
  initialNextCandidateId: number,
): PersonCandidateAssociation {
  const diagonal = Math.max(1, Math.hypot(width, height));
  const available = new Set(previous.map((_, index) => index));
  let nextCandidateId = initialNextCandidateId;
  const detections = current.map((detection) => {
    const ranked = [...available].map((index) => {
      const prior = previous[index];
      const iou = bboxIou(detection.bbox, prior.bbox);
      const center = bboxCenterDistance(detection.bbox, prior.bbox, diagonal);
      const scale = Math.abs(Math.log(
        Math.max(1, bboxArea(detection.bbox)) / Math.max(1, bboxArea(prior.bbox)),
      ));
      return { index, iou, center, cost: (1 - iou) * 0.65 + center * 2.5 + scale * 0.10 };
    }).sort((left, right) => left.cost - right.cost);
    const match = ranked[0];
    if (match && (match.iou >= 0.05 || match.center <= 0.12)) {
      available.delete(match.index);
      return { ...detection, candidateId: previous[match.index].candidateId };
    }
    return { ...detection, candidateId: nextCandidateId++ };
  });
  return { detections, nextCandidateId };
}

function paddedCrop(bbox: readonly [number, number, number, number]) {
  const centerX = (bbox[0] + bbox[2]) / 2;
  const centerY = (bbox[1] + bbox[3]) / 2;
  let width = (bbox[2] - bbox[0]) * BBOX_PADDING;
  let height = (bbox[3] - bbox[1]) * BBOX_PADDING;
  const inputAspect = INPUT_WIDTH / INPUT_HEIGHT;
  if (width > height * inputAspect) height = width / inputAspect;
  else width = height * inputAspect;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

export interface DominantContinuousPersonSelection {
  detection: PersonDetection | null;
  reason:
    | "no_detection"
    | "initial_dominant_centered"
    | "continuous_iou_center"
    | "dominant_subject_reacquired"
    | "identity_mismatch_rejected";
  score: number;
}

/**
 * Client port of the frozen `dominant-continuous-person/v5` corpus policy.
 * It is deliberately frame-causal and uses only YOLOX boxes. Python remains
 * an offline oracle; Web, Android and iOS execute this policy themselves.
 */
export function selectDominantContinuousPerson(
  detections: readonly PersonDetection[],
  previous: PersonDetection["bbox"] | null,
  width: number,
  height: number,
): DominantContinuousPersonSelection {
  if (detections.length === 0) return { detection: null, reason: "no_detection", score: 0 };
  const frameArea = width * height;
  const diagonal = Math.hypot(width, height);
  const centerBox = [width * 0.45, height * 0.45, width * 0.55, height * 0.55] as const;
  const largestArea = Math.max(...detections.map((detection) => bboxArea(detection.bbox)));

  if (previous) {
    const previousArea = Math.max(1, bboxArea(previous));
    const dominant = [...detections].sort((left, right) => bboxArea(right.bbox) - bboxArea(left.bbox))[0];
    const dominantArea = bboxArea(dominant.bbox);
    const dominantCenterDistance = bboxCenterDistance(dominant.bbox, centerBox, diagonal);
    if (
      previousArea < frameArea * 0.05
      && dominantArea >= Math.max(previousArea * 3, frameArea * 0.08)
      && dominantCenterDistance <= 0.35
    ) {
      return { detection: dominant, reason: "dominant_subject_reacquired", score: 1 };
    }
  }

  const ranked = detections.map((detection) => {
    const area = bboxArea(detection.bbox);
    const areaRelative = largestArea > 0 ? area / largestArea : 0;
    const frameAreaRatio = Math.min(1, area / Math.max(frameArea * 0.35, 1));
    const imageCenter = 1 - Math.min(1, bboxCenterDistance(detection.bbox, centerBox, diagonal));
    const continuity = previous ? bboxIou(detection.bbox, previous) : 0;
    const centerContinuity = previous
      ? 1 - Math.min(1, bboxCenterDistance(detection.bbox, previous, diagonal) * 3)
      : 0;
    const score = previous
      ? continuity * 0.58 + centerContinuity * 0.25 + areaRelative * 0.12 + imageCenter * 0.05
      : areaRelative * 0.55 + frameAreaRatio * 0.20 + imageCenter * 0.25;
    return { detection, score, continuity };
  }).sort((left, right) => right.score - left.score);
  const selected = ranked[0];
  if (previous) {
    const previousArea = Math.max(1, bboxArea(previous));
    const selectedArea = bboxArea(selected.detection.bbox);
    const sizeRatio = selectedArea / previousArea;
    const centerJump = bboxCenterDistance(selected.detection.bbox, previous, diagonal);
    const identityJump = selected.continuity < 0.12 && centerJump > 0.10;
    const implausibleScaleJump = selected.continuity < 0.05 && !(sizeRatio >= 0.45 && sizeRatio <= 2.5);
    if (identityJump || implausibleScaleJump) {
      return { detection: null, reason: "identity_mismatch_rejected", score: selected.score };
    }
  }
  return {
    detection: selected.detection,
    reason: previous ? "continuous_iou_center" : "initial_dominant_centered",
    score: selected.score,
  };
}

function bboxIou(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): number {
  const intersectionWidth = Math.max(0, Math.min(left[2], right[2]) - Math.max(left[0], right[0]));
  const intersectionHeight = Math.max(0, Math.min(left[3], right[3]) - Math.max(left[1], right[1]));
  const intersection = intersectionWidth * intersectionHeight;
  const union = bboxArea(left) + bboxArea(right) - intersection;
  return union > 0 ? intersection / union : 0;
}

function bboxArea(bbox: readonly [number, number, number, number]): number {
  return Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]);
}

function bboxCenterDistance(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
  diagonal: number,
): number {
  const leftX = (left[0] + left[2]) / 2;
  const leftY = (left[1] + left[3]) / 2;
  const rightX = (right[0] + right[2]) / 2;
  const rightY = (right[1] + right[3]) / 2;
  return Math.hypot(leftX - rightX, leftY - rightY) / diagonal;
}

function argmax(data: Float32Array, offset: number, length: number): readonly [number, number] {
  let index = 0;
  let maximum = -Infinity;
  for (let cursor = 0; cursor < length; cursor += 1) {
    const value = data[offset + cursor];
    if (value > maximum) {
      maximum = value;
      index = cursor;
    }
  }
  return [index, maximum];
}

function sampleTorsoColor(
  context: CanvasRenderingContext2D,
  landmarks: readonly PoseLandmark[],
  width: number,
  height: number,
): readonly [number, number, number] {
  const torso = [landmarks[5], landmarks[6], landmarks[11], landmarks[12]];
  if (torso.some((landmark) => !landmark || landmark.visibility < 0.2)) return [0, 0, 0];
  const left = clamp(Math.floor(Math.min(...torso.map((point) => point.x)) * width), 0, width - 1);
  const right = clamp(Math.ceil(Math.max(...torso.map((point) => point.x)) * width), left + 1, width);
  const top = clamp(Math.floor(Math.min(...torso.map((point) => point.y)) * height), 0, height - 1);
  const bottom = clamp(Math.ceil(Math.max(...torso.map((point) => point.y)) * height), top + 1, height);
  const pixels = context.getImageData(left, top, right - left, bottom - top).data;
  let red = 0;
  let green = 0;
  let blue = 0;
  const count = pixels.length / 4;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    red += pixels[offset];
    green += pixels[offset + 1];
    blue += pixels[offset + 2];
  }
  return count > 0 ? [red / count / 255, green / count / 255, blue / count / 255] : [0, 0, 0];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

async function resolveVerifiedModel(
  input: string | VerifiedBinaryArtifact,
  pinned: PinnedBinaryArtifact,
  fetcher: BinaryArtifactFetcher,
): Promise<VerifiedBinaryArtifact> {
  if (typeof input === "string") {
    if (input !== pinned.publicPath) {
      throw new Error(`${input} is not the pinned ${pinned.id} model path`);
    }
    return fetchAndVerifyBinaryArtifact(pinned, fetcher);
  }
  const identity = input.identity;
  if (
    identity.id !== pinned.id
    || identity.publicPath !== pinned.publicPath
    || identity.bytes !== pinned.bytes
    || identity.sha256 !== pinned.sha256
  ) {
    throw new Error(`${pinned.id} verified identity does not match the pinned Web manifest`);
  }
  return input;
}
