/**
 * Runtime loader for @mediapipe/tasks-vision.
 *
 * Metro (Expo) cannot transform the package's opaque dynamic imports, so the
 * prebuilt ESM bundle is served as a static asset from public/vendor/ and
 * imported natively by the browser. The Function-constructor indirection
 * hides the import() call from Metro's static analysis.
 */
export interface TasksVisionModule {
  FilesetResolver: {
    forVisionTasks(basePath: string): Promise<unknown>;
  };
  PoseLandmarker: {
    createFromOptions(vision: unknown, options: unknown): Promise<PoseLandmarkerInstance>;
  };
}

export interface PoseLandmarkerInstance {
  detectForVideo(
    video: HTMLVideoElement,
    timestampMs: number,
  ): {
    landmarks: Array<Array<{ x: number; y: number; z: number; visibility?: number }>>;
    worldLandmarks: Array<Array<{ x: number; y: number; z: number; visibility?: number }>>;
  };
  close(): void;
}

let modulePromise: Promise<TasksVisionModule> | null = null;

export function loadTasksVision(): Promise<TasksVisionModule> {
  if (!modulePromise) {
    const nativeImport = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<TasksVisionModule>;
    modulePromise = nativeImport("/vendor/vision_bundle.mjs");
  }
  return modulePromise;
}
