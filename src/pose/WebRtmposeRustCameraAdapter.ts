import type { CanonicalPoseFrame } from "./canonicalPose";
import type { PoseCandidateEstimate } from "./PoseEngine";
import type { CapturedLumaFrame, RtmposeEngine } from "./RtmposeEngine";
import type {
  RustCanonicalWasmSession,
  RustRepState,
  RustSealedRep,
  RustTargetSnapshot,
  RustVisualBarbellAxis,
} from "../motion/rustCanonicalWasm";

export interface WebVideoFrameMetadata {
  readonly mediaTime: number;
}

export type WebVideoFrameCallback = (
  now: number,
  metadata: WebVideoFrameMetadata,
) => void;

export type WebVideoFrameSource = HTMLVideoElement;

export interface WebVideoFrameScheduler {
  request(video: WebVideoFrameSource, callback: WebVideoFrameCallback): number;
  cancel(video: WebVideoFrameSource, handle: number): void;
}

export interface WebRtmposeObservationSource {
  resetTracking(): void;
  estimateCapturedFrame(
    video: HTMLVideoElement,
    timestampMs: number,
  ): Promise<PoseCandidateEstimate[]>;
  readCapturedLumaFrame(maximumDimension?: number): CapturedLumaFrame;
  readonly latestInferenceMs: number;
}

export interface WebRustMotionSink {
  beginSet(): void;
  finishSet(): void;
  processCandidates(
    candidates: readonly PoseCandidateEstimate[],
    timestampMs: number,
    equipment?: readonly [],
    visualEquipmentFrame?: CapturedLumaFrame,
  ): CanonicalPoseFrame;
  readonly lastTarget: RustTargetSnapshot;
  readonly lastRepState: RustRepState;
  readonly lastCompletedReps: readonly RustSealedRep[];
  readonly lastVisualBarbellAxis: RustVisualBarbellAxis | null;
  readonly lastFrameValid: boolean;
  readonly lastTiming: { readonly coreMs: number; readonly decodeMs: number };
}

export interface WebCausalMotionFrame {
  readonly timestampMs: number;
  readonly candidates: readonly PoseCandidateEstimate[];
  readonly canonical: CanonicalPoseFrame;
  readonly target: RustTargetSnapshot;
  readonly repState: RustRepState;
  readonly completedReps: readonly RustSealedRep[];
  readonly visualBarbellAxis: RustVisualBarbellAxis | null;
  readonly frameValid: boolean;
  readonly timing: {
    readonly inferenceMs: number;
    readonly rustCoreMs: number;
    readonly rustDecodeMs: number;
    readonly totalMs: number;
  };
}

export interface WebCausalCameraOptions {
  /** Only enabled for a preset that is known to use a barbell. */
  readonly detectBarbellAxis?: boolean;
  readonly equipmentLumaMaximumDimension?: number;
  readonly manageSetLifecycle?: boolean;
  readonly onFrame?: (frame: WebCausalMotionFrame) => void;
  readonly onError?: (error: Error) => void;
  readonly scheduler?: WebVideoFrameScheduler;
}

/**
 * Browser camera/file Adapter for the accepted client pipeline:
 *
 * decoded frame -> ONNX Runtime Web YOLOX -> RTMPose Halpe-26 candidates
 *               -> optional frame-local luma -> Rust/WASM single causal pass
 *
 * It registers the next video-frame callback only after the current inference
 * has completed. Displayed frames may therefore be dropped under load, but no
 * frame is inferred twice and an async result can never be attached to a newer
 * camera timestamp.
 */
export class WebRtmposeRustCameraAdapter {
  private readonly scheduler: WebVideoFrameScheduler;
  private running = false;
  private scheduledHandle: number | null = null;
  private inFlight: Promise<void> | null = null;
  private lastTimestampMs = -1;
  private managedSetActive = false;

  constructor(
    private readonly video: WebVideoFrameSource,
    private readonly vision: WebRtmposeObservationSource,
    private readonly motion: WebRustMotionSink,
    private readonly options: WebCausalCameraOptions = {},
  ) {
    this.scheduler = options.scheduler ?? browserVideoFrameScheduler;
  }

  static create(
    video: WebVideoFrameSource,
    vision: RtmposeEngine,
    motion: RustCanonicalWasmSession,
    options: WebCausalCameraOptions = {},
  ): WebRtmposeRustCameraAdapter {
    return new WebRtmposeRustCameraAdapter(video, vision, motion, options);
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    if (this.video.readyState < 2 || this.video.videoWidth <= 0 || this.video.videoHeight <= 0) {
      throw new Error("Web camera source has no decoded frame");
    }
    this.vision.resetTracking();
    this.lastTimestampMs = -1;
    this.running = true;
    if (this.options.manageSetLifecycle !== false) {
      this.motion.beginSet();
      this.managedSetActive = true;
    }
    this.scheduleNextFrame();
  }

  async stop(): Promise<void> {
    if (!this.running && !this.inFlight && !this.managedSetActive) return;
    this.running = false;
    if (this.scheduledHandle !== null) {
      this.scheduler.cancel(this.video, this.scheduledHandle);
      this.scheduledHandle = null;
    }
    const active = this.inFlight;
    if (active) {
      try {
        await active;
      } catch {
        // The error has already been delivered through onError.
      }
    }
    if (this.managedSetActive) {
      this.motion.finishSet();
      this.managedSetActive = false;
    }
  }

  private scheduleNextFrame(): void {
    if (!this.running || this.scheduledHandle !== null || this.inFlight) return;
    this.scheduledHandle = this.scheduler.request(this.video, (_now, metadata) => {
      this.scheduledHandle = null;
      if (!this.running) return;
      const mediaTimestampMs = Number.isFinite(metadata.mediaTime)
        ? metadata.mediaTime * 1_000
        : this.video.currentTime * 1_000;
      const timestampMs = Math.max(
        this.lastTimestampMs + 1,
        Math.max(0, Math.round(mediaTimestampMs)),
      );
      this.lastTimestampMs = timestampMs;
      const task = this.processFrame(timestampMs);
      this.inFlight = task;
      void task
        .catch((cause) => {
          this.running = false;
          this.options.onError?.(asError(cause));
        })
        .finally(() => {
          if (this.inFlight === task) this.inFlight = null;
          this.scheduleNextFrame();
        });
    });
  }

  private async processFrame(timestampMs: number): Promise<void> {
    const startedAt = performance.now();
    const candidates = await this.vision.estimateCapturedFrame(this.video, timestampMs);
    if (!this.running) return;
    const luma = this.options.detectBarbellAxis
      ? this.vision.readCapturedLumaFrame(this.options.equipmentLumaMaximumDimension)
      : undefined;
    const canonical = this.motion.processCandidates(candidates, timestampMs, [], luma);
    this.options.onFrame?.(Object.freeze({
      timestampMs,
      candidates: Object.freeze([...candidates]),
      canonical,
      target: this.motion.lastTarget,
      repState: this.motion.lastRepState,
      completedReps: Object.freeze([...this.motion.lastCompletedReps]),
      visualBarbellAxis: this.motion.lastVisualBarbellAxis,
      frameValid: this.motion.lastFrameValid,
      timing: Object.freeze({
        inferenceMs: this.vision.latestInferenceMs,
        rustCoreMs: this.motion.lastTiming.coreMs,
        rustDecodeMs: this.motion.lastTiming.decodeMs,
        totalMs: performance.now() - startedAt,
      }),
    }));
  }
}

export const browserVideoFrameScheduler: WebVideoFrameScheduler = Object.freeze({
  request(video: WebVideoFrameSource, callback: WebVideoFrameCallback) {
    if (typeof video.requestVideoFrameCallback === "function") {
      return video.requestVideoFrameCallback(callback);
    }
    return requestAnimationFrame((now) => {
      callback(now, { mediaTime: video.currentTime });
    });
  },
  cancel(video: WebVideoFrameSource, handle: number) {
    if (typeof video.cancelVideoFrameCallback === "function") {
      video.cancelVideoFrameCallback(handle);
    } else {
      cancelAnimationFrame(handle);
    }
  },
});

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
