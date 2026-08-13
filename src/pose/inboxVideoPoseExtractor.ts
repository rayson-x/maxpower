import { loadRustMotionWasm, RustCanonicalWasmSession } from "../motion/rustCanonicalWasm";
import { buildRecordingFixture } from "./recordingFixture";
import { PoseEngine } from "./PoseEngine";
import type { AnnotationInboxItem, InboxPoseFixture } from "./annotationInbox";

const REVIEW_MODEL = "/models/pose_landmarker_heavy.task";

/** Runs the same BlazePose33 -> Rust subject-lock path used by the live Web view. */
export async function extractInboxVideoPoseFixture(input: {
  item: AnnotationInboxItem;
  videoUrl: string;
  onProgress?: (ratio: number) => void;
}): Promise<InboxPoseFixture> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = input.videoUrl;
  await waitForVideoMetadata(video);

  const engine = await PoseEngine.create(REVIEW_MODEL);
  const wasm = await loadRustMotionWasm();
  const session = new RustCanonicalWasmSession({
    sequenceId: `annotation-inbox:${input.item.id}:${Date.now()}`,
    schema: "blazepose33",
    image: {
      widthPx: Math.max(1, video.videoWidth),
      heightPx: Math.max(1, video.videoHeight),
      rotationDegrees: 0,
      mirrored: false,
    },
    stabilization: "fusion",
    setLifecycleMode: "replay",
  }, wasm);
  const poses = [] as ReturnType<typeof session.processCandidates>[];
  let lastMediaTime = -1;
  let lastInferenceTimestampMs = -1;
  let frameHandle: number | null = null;
  let rafHandle = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      const resumePlayback = () => {
        void video.play().catch((error: unknown) => {
          // Pausing inside a frame callback intentionally interrupts the
          // outstanding play request in some browsers. That interruption is
          // part of controlled extraction, not a decode failure.
          if (error instanceof DOMException && error.name === "AbortError") return;
          reject(error);
        });
      };
      const processFrame = (mediaTime: number): boolean => {
        if (mediaTime <= lastMediaTime) return false;
        lastMediaTime = mediaTime;
        const timestampMs = Math.max(0, Math.round(mediaTime * 1000));
        try {
          if (session.schedule(timestampMs) === "skip-frame") return false;
          // Inference is synchronous and can be much slower than playback.
          // Freeze media time while it runs so background throttling or a busy
          // main thread cannot let the video finish with most frames unvisited.
          video.pause();
          const inferenceTimestampMs = Math.max(Math.round(performance.now()), lastInferenceTimestampMs + 1);
          lastInferenceTimestampMs = inferenceTimestampMs;
          const candidates = engine.estimateCandidates(video, inferenceTimestampMs) ?? [];
          // Empty observations are canonical evidence too: Rust must see the
          // gap so target state can become uncertain/lost instead of keeping a
          // stale person lock across rack or bar occlusion.
          poses.push(session.processCandidates(candidates, timestampMs));
          input.onProgress?.(video.duration > 0 ? Math.min(1, mediaTime / video.duration) : 0);
          return true;
        } catch (error) {
          reject(error);
          return false;
        }
      };
      const schedule = () => {
        if (video.ended) return;
        if (typeof video.requestVideoFrameCallback === "function") {
          frameHandle = video.requestVideoFrameCallback((_now, metadata) => {
            frameHandle = null;
            const pausedForInference = processFrame(metadata.mediaTime);
            schedule();
            if (pausedForInference && !video.ended) resumePlayback();
          });
          return;
        }
        rafHandle = requestAnimationFrame(() => {
          const pausedForInference = processFrame(video.currentTime);
          schedule();
          if (pausedForInference && !video.ended) resumePlayback();
        });
      };
      video.addEventListener("ended", () => {
        input.onProgress?.(1);
        resolve();
      }, { once: true });
      video.addEventListener("error", () => reject(new Error("待标注视频无法解码。")), { once: true });
      schedule();
      resumePlayback();
    });
    if (poses.length < 2) throw new Error("整段视频没有形成可标注的 canonical 骨架序列。");
    return buildRecordingFixture({
      video: input.item.filename,
      fallbackDurationSec: video.duration,
      model: `mediapipe:${REVIEW_MODEL}`,
      poses,
    })[0];
  } finally {
    video.pause();
    if (frameHandle !== null && typeof video.cancelVideoFrameCallback === "function") {
      video.cancelVideoFrameCallback(frameHandle);
    }
    cancelAnimationFrame(rafHandle);
    video.removeAttribute("src");
    video.load();
    session.close();
    engine.close();
  }
}

function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 1 && video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error("待标注视频元数据不可读。")), { once: true });
  });
}
