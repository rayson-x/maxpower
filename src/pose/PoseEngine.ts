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

/**
 * MediaPipe Pose Landmarker wrapper (web, VIDEO mode).
 * Synchronous per-frame inference — call from a requestAnimationFrame loop.
 */
export class PoseEngine {
  private constructor(private readonly landmarker: PoseLandmarkerInstance) {}

  static async create(modelPath: string): Promise<PoseEngine> {
    const { FilesetResolver, PoseLandmarker } = await loadTasksVision();
    const vision = await FilesetResolver.forVisionTasks("/wasm");
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: modelPath, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
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
    if (video.readyState < 2 || video.videoWidth === 0) return null;
    const result = this.landmarker.detectForVideo(video, timestampMs);
    const first = result.landmarks[0];
    if (!first) return { timestampMs, landmarks: [], worldLandmarks: [] };
    const map = (landmark: { x: number; y: number; z: number; visibility?: number }) => ({
      x: landmark.x,
      y: landmark.y,
      z: landmark.z,
      visibility: landmark.visibility ?? 0,
    });
    return {
      timestampMs,
      landmarks: first.map(map),
      worldLandmarks: (result.worldLandmarks[0] ?? []).map(map),
    };
  }

  close(): void {
    this.landmarker.close();
  }
}
