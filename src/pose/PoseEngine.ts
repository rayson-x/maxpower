import {
  loadTasksVision,
  type PoseLandmarkerInstance,
} from "../shims/tasksVision";

export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
  /** Legacy compatibility: true when the canonical adapter used tracker prediction. */
  predicted?: boolean;
}

export interface PoseEstimate {
  timestampMs: number;
  /** Image-normalized coordinates (0..1, z relative to hips). */
  landmarks: PoseLandmark[];
  /** Pseudo-3D world coordinates in meters, origin at hip center. */
  worldLandmarks: PoseLandmark[];
}

export interface PoseCandidateEstimate extends PoseEstimate {
  candidateId: number;
  bbox: { x: number; y: number; width: number; height: number };
  /** Reserved for a session-local appearance sample; no biometric storage. */
  torsoColor: readonly [number, number, number];
}

/**
 * MediaPipe Pose Landmarker wrapper (web, VIDEO mode).
 * Synchronous per-frame inference — call from a requestAnimationFrame loop.
 */
export class PoseEngine {
  private readonly appearanceCanvas: HTMLCanvasElement;
  private readonly appearanceContext: CanvasRenderingContext2D | null;

  private constructor(private readonly landmarker: PoseLandmarkerInstance) {
    this.appearanceCanvas = document.createElement("canvas");
    this.appearanceCanvas.width = 64;
    this.appearanceCanvas.height = 64;
    this.appearanceContext = this.appearanceCanvas.getContext("2d", { willReadFrequently: true });
  }

  static async create(modelPath: string): Promise<PoseEngine> {
    const { FilesetResolver, PoseLandmarker } = await loadTasksVision();
    const vision = await FilesetResolver.forVisionTasks("/wasm");
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: modelPath, delegate },
      runningMode: "VIDEO",
      numPoses: 4,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    let landmarker: PoseLandmarkerInstance;
    try {
      landmarker = await PoseLandmarker.createFromOptions(vision, options("GPU"));
    } catch {
      landmarker = await PoseLandmarker.createFromOptions(vision, options("CPU"));
    }
    return new PoseEngine(landmarker);
  }

  estimate(video: HTMLVideoElement, timestampMs: number): PoseEstimate | null {
    return this.estimateCandidates(video, timestampMs)?.[0] ?? null;
  }

  estimateCandidates(video: HTMLVideoElement, timestampMs: number): PoseCandidateEstimate[] | null {
    if (video.readyState < 2 || video.videoWidth === 0) return null;
    const result = this.landmarker.detectForVideo(video, timestampMs);
    const map = (landmark: { x: number; y: number; z: number; visibility?: number }) => ({
      x: landmark.x,
      y: landmark.y,
      z: landmark.z,
      visibility: landmark.visibility ?? 0,
    });
    const mappedPoses = result.landmarks.map((pose) => pose.map(map));
    const torsoColors = this.sampleTorsoColors(video, mappedPoses);
    return mappedPoses.map((landmarks, candidateId) => {
      return {
        timestampMs,
        candidateId,
        landmarks,
        worldLandmarks: (result.worldLandmarks[candidateId] ?? []).map(map),
        bbox: landmarkBounds(landmarks),
        torsoColor: torsoColors[candidateId] ?? ([0, 0, 0] as const),
      };
    });
  }

  /**
   * Samples a tiny session-local torso descriptor. It is used only for target
   * continuity and is never written to MotionPacket or capture storage.
   */
  private sampleTorsoColors(
    video: HTMLVideoElement,
    poses: readonly (readonly PoseLandmark[])[],
  ): Array<readonly [number, number, number]> {
    const context = this.appearanceContext;
    if (!context) return poses.map(() => [0, 0, 0] as const);
    try {
      context.drawImage(video, 0, 0, 64, 64);
      const pixels = context.getImageData(0, 0, 64, 64).data;
      return poses.map((pose) => sampleTorsoColor(pixels, 64, 64, pose));
    } catch {
      return poses.map(() => [0, 0, 0] as const);
    }
  }

  close(): void {
    this.landmarker.close();
  }
}

function sampleTorsoColor(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  landmarks: readonly PoseLandmark[],
): readonly [number, number, number] {
  const torso = [landmarks[11], landmarks[12], landmarks[23], landmarks[24]];
  if (torso.some((landmark) => !landmark || landmark.visibility < 0.2)) return [0, 0, 0];
  const xs = torso.map((landmark) => landmark.x);
  const ys = torso.map((landmark) => landmark.y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const halfWidth = Math.max(0.015, (Math.max(...xs) - Math.min(...xs)) * 0.25);
  const halfHeight = Math.max(0.02, (Math.max(...ys) - Math.min(...ys)) * 0.25);
  const left = Math.max(0, Math.floor((centerX - halfWidth) * width));
  const right = Math.min(width - 1, Math.ceil((centerX + halfWidth) * width));
  const top = Math.max(0, Math.floor((centerY - halfHeight) * height));
  const bottom = Math.min(height - 1, Math.ceil((centerY + halfHeight) * height));
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const offset = (y * width + x) * 4;
      red += pixels[offset];
      green += pixels[offset + 1];
      blue += pixels[offset + 2];
      count += 1;
    }
  }
  return count === 0 ? [0, 0, 0] : [red / count / 255, green / count / 255, blue / count / 255];
}

function landmarkBounds(landmarks: readonly PoseLandmark[]) {
  const visible = landmarks.filter((landmark) =>
    Number.isFinite(landmark.x) && Number.isFinite(landmark.y) && landmark.visibility >= 0.2,
  );
  if (visible.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = visible.map((landmark) => landmark.x);
  const ys = visible.map((landmark) => landmark.y);
  const x = Math.max(0, Math.min(...xs));
  const y = Math.max(0, Math.min(...ys));
  const right = Math.min(1, Math.max(...xs));
  const bottom = Math.min(1, Math.max(...ys));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}
