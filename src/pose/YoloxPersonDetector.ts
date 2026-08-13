import type { OrtModule, OrtSession } from "../shims/onnxRuntime";

const INPUT_SIZE = 416;
// HumanArt nano misses small, edge-of-frame exercisers above 0.30. Keep the
// visual adapter permissive and let the Rust subject tracker reject mirror,
// equipment and bystander candidates using pose quality and continuity.
export const MIN_PERSON_SCORE = 0.15;

export interface PersonDetection {
  bbox: readonly [number, number, number, number];
  score: number;
}

/** Person-detection Adapter for the official end-to-end HumanArt YOLOX nano. */
export class YoloxPersonDetector {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly input = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);

  private constructor(
    private readonly ort: OrtModule,
    private readonly session: OrtSession,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = INPUT_SIZE;
    this.canvas.height = INPUT_SIZE;
    const context = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法创建 YOLOX canvas context");
    this.context = context;
  }

  static async create(ort: OrtModule, modelPath: string): Promise<YoloxPersonDetector> {
    let session: OrtSession;
    try {
      session = await ort.InferenceSession.create(modelPath, { executionProviders: ["webgpu"] });
    } catch {
      session = await ort.InferenceSession.create(modelPath, { executionProviders: ["wasm"] });
    }
    return new YoloxPersonDetector(ort, session);
  }

  async detect(
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
  ): Promise<PersonDetection[]> {
    const ratio = Math.min(INPUT_SIZE / sourceWidth, INPUT_SIZE / sourceHeight);
    const drawWidth = Math.max(1, Math.round(sourceWidth * ratio));
    const drawHeight = Math.max(1, Math.round(sourceHeight * ratio));
    this.context.fillStyle = "rgb(114, 114, 114)";
    this.context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    this.context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, drawWidth, drawHeight);
    const pixels = this.context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
    const plane = INPUT_SIZE * INPUT_SIZE;
    writeRgbaPixelsAsBgrChw(pixels, this.input, 0, plane);
    const outputs = await this.session.run({
      [this.session.inputNames[0]]: new this.ort.Tensor(
        "float32",
        this.input,
        [1, 3, INPUT_SIZE, INPUT_SIZE],
      ),
    });
    const dets = outputs.dets ?? Object.values(outputs).find((output) => output.dims.at(-1) === 5);
    const labels = outputs.labels ?? Object.values(outputs).find((output) => output.dims.length === 2 && output !== dets);
    if (!dets) return [];
    const data = dets.data as Float32Array;
    const count = dets.dims.length >= 2 ? Number(dets.dims[dets.dims.length - 2]) : 0;
    const detections: PersonDetection[] = [];
    for (let index = 0; index < count; index += 1) {
      const offset = index * 5;
      const score = Number(data[offset + 4]);
      const labelValue = labels ? Number(labels.data[index]) : 0;
      if (labelValue !== 0 || score < MIN_PERSON_SCORE) continue;
      const x1 = clamp(Number(data[offset]) / ratio, 0, sourceWidth - 1);
      const y1 = clamp(Number(data[offset + 1]) / ratio, 0, sourceHeight - 1);
      const x2 = clamp(Number(data[offset + 2]) / ratio, x1 + 1, sourceWidth);
      const y2 = clamp(Number(data[offset + 3]) / ratio, y1 + 1, sourceHeight);
      detections.push({ bbox: [x1, y1, x2, y2], score });
    }
    return detections.sort((left, right) => right.score - left.score);
  }

  close(): void {
    void this.session.release();
  }
}

/** The RTMLib checkpoints are exported from an OpenCV BGR pipeline. */
export function writeRgbaPixelsAsBgrChw(
  pixels: Uint8ClampedArray | Uint8Array,
  output: Float32Array,
  outputOffset: number,
  plane: number,
  mean: readonly [number, number, number] = [0, 0, 0],
  std: readonly [number, number, number] = [1, 1, 1],
): void {
  for (let index = 0; index < plane; index += 1) {
    const rgba = index * 4;
    output[outputOffset + index] = (pixels[rgba + 2] - mean[0]) / std[0];
    output[outputOffset + plane + index] = (pixels[rgba + 1] - mean[1]) / std[1];
    output[outputOffset + plane * 2 + index] = (pixels[rgba] - mean[2]) / std[2];
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
