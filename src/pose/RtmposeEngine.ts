import { loadOrt, type OrtModule, type OrtSession } from "../shims/onnxRuntime";
import type { PoseEstimate, PoseLandmark } from "./PoseEngine";

// RTMPose 输入尺寸(宽 x 高)与 SimCC 分桶(split ratio = 2)
const INPUT_W = 192;
const INPUT_H = 256;
const SIMCC_BINS_X = INPUT_W * 2;
const SIMCC_BINS_Y = INPUT_H * 2;
const NUM_KEYPOINTS = 17; // COCO-17

// 注意:这个 ONNX 导出把归一化融进了图里,输入直接给 RGB 0-255 原值。
// (实测:ImageNet 归一化后输出接近均匀分布,原值输入峰值 logit 4+)

/** 人均分接近此值时认为这一帧没检测到人,返回空骨架(放大后的量纲) */
const MIN_MEAN_SCORE = 0.15;

/**
 * RTMPose (ONNX, SimCC) wrapper — 与 PoseEngine 同接口。
 *
 * top-down 结构需要紧凑人体框:不接独立人形检测器,改用追踪式 bbox——
 * 用上一帧的高分关键点外扩 40% 作为本帧裁剪框,首帧/丢失时用整帧。
 * 整帧直接喂模型时人只占输入的一小部分,SimCC 峰值过弱不可用。
 *
 * estimate() 是同步接口而 onnxruntime 推理是异步的:内部串行排队推理,
 * estimate 返回最近一次完成的结果(首帧完成前返回 null)。
 */
export class RtmposeEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly inputData: Float32Array;
  private busy = false;
  private latest: PoseEstimate | null = null;
  /** 当前裁剪框(原图坐标),null = 整帧 */
  private bbox: { x: number; y: number; w: number; h: number } | null = null;

  private constructor(
    private readonly ort: OrtModule,
    private readonly session: OrtSession,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = INPUT_W;
    this.canvas.height = INPUT_H;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("无法创建 2D canvas context");
    this.ctx = ctx;
    this.inputData = new Float32Array(3 * INPUT_H * INPUT_W);
  }

  static async create(modelPath: string): Promise<RtmposeEngine> {
    const ort = await loadOrt();
    // WebGPU 优先,WASM(simd+多线程)兜底
    let session: OrtSession;
    try {
      session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ["webgpu"],
      });
    } catch {
      session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ["wasm"],
      });
    }
    return new RtmposeEngine(ort, session);
  }

  estimate(video: HTMLVideoElement, timestampMs: number): PoseEstimate | null {
    if (video.readyState < 2 || video.videoWidth === 0) return null;
    if (!this.busy) {
      this.busy = true;
      // 同一帧内完成采集,避免异步后视频已推进
      this.preprocess(video);
      void this.session
        .run({
          [this.session.inputNames[0]]: new this.ort.Tensor(
            "float32",
            this.inputData,
            [1, 3, INPUT_H, INPUT_W],
          ),
        })
        .then((outputs) => {
          this.latest = this.decode(outputs, video, timestampMs);
        })
        .catch(() => {
          // 单帧失败不致命,保留上一帧结果
        })
        .finally(() => {
          this.busy = false;
        });
    }
    return this.latest;
  }

  /** 裁剪框 letterbox 到 192x256,记录本帧用的框供解码反映射 */
  private frameBBox: { x: number; y: number; w: number; h: number } | null = null;

  /** 初始框:假设被摄者在画面中心(健身自拍场景成立),中心 85% 高度、按输入宽高比裁剪 */
  private initialBBox(vw: number, vh: number): { x: number; y: number; w: number; h: number } {
    const h = vh * 0.85;
    const w = Math.min(vw, (h * INPUT_W) / INPUT_H);
    return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
  }

  private preprocess(video: HTMLVideoElement): void {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const bbox = this.bbox ?? this.initialBBox(vw, vh);
    this.frameBBox = bbox;
    const scale = Math.min(INPUT_W / bbox.w, INPUT_H / bbox.h);
    const drawW = Math.max(1, Math.round(bbox.w * scale));
    const drawH = Math.max(1, Math.round(bbox.h * scale));
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, INPUT_W, INPUT_H);
    this.ctx.drawImage(video, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, drawW, drawH);
    const { data } = this.ctx.getImageData(0, 0, INPUT_W, INPUT_H);
    const plane = INPUT_H * INPUT_W;
    for (let i = 0; i < plane; i += 1) {
      const rgba = i * 4;
      this.inputData[i] = data[rgba];
      this.inputData[plane + i] = data[rgba + 1];
      this.inputData[plane * 2 + i] = data[rgba + 2];
    }
  }

  /** 从上一帧高分关键点更新追踪 bbox(外扩 40%,限制在画面内) */
  private updateBBox(landmarks: PoseLandmark[], vw: number, vh: number): void {
    const good = landmarks.filter((l) => l.visibility >= 0.4);
    if (good.length < 3) {
      this.bbox = null; // 丢失目标,回初始中心框
      return;
    }
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (const l of good) {
      minX = Math.min(minX, l.x);
      minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x);
      maxY = Math.max(maxY, l.y);
    }
    const cx = ((minX + maxX) / 2) * vw;
    const cy = ((minY + maxY) / 2) * vh;
    const w = Math.max((maxX - minX) * vw * 1.4, 1);
    const h = Math.max((maxY - minY) * vh * 1.4, 1);
    this.bbox = {
      x: Math.max(0, Math.min(vw - 1, cx - w / 2)),
      y: Math.max(0, Math.min(vh - 1, cy - h / 2)),
      w: Math.min(w, vw),
      h: Math.min(h, vh),
    };
  }

  /** SimCC 解码:每个关键点在 x/y 两个一维分布上 argmax,softmax 最大值作分数 */
  private decode(
    outputs: Record<string, { data: Float32Array; dims: readonly number[] }>,
    video: HTMLVideoElement,
    timestampMs: number,
  ): PoseEstimate {
    const tensors = Object.values(outputs);
    const simccX =
      outputs["simcc_x"] ??
      tensors.find((t) => t.dims[t.dims.length - 1] === SIMCC_BINS_X) ??
      tensors[0];
    const simccY =
      outputs["simcc_y"] ??
      tensors.find((t) => t.dims[t.dims.length - 1] === SIMCC_BINS_Y) ??
      tensors[1];
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const bbox = this.frameBBox ?? { x: 0, y: 0, w: vw, h: vh };
    const scale = Math.min(INPUT_W / bbox.w, INPUT_H / bbox.h);

    const landmarks: PoseLandmark[] = [];
    let scoreSum = 0;
    for (let k = 0; k < NUM_KEYPOINTS; k += 1) {
      const xOff = k * SIMCC_BINS_X;
      const yOff = k * SIMCC_BINS_Y;
      let xIdx = 0;
      let xMax = -Infinity;
      for (let i = 0; i < SIMCC_BINS_X; i += 1) {
        const v = simccX.data[xOff + i];
        if (v > xMax) {
          xMax = v;
          xIdx = i;
        }
      }
      let yIdx = 0;
      let yMax = -Infinity;
      for (let i = 0; i < SIMCC_BINS_Y; i += 1) {
        const v = simccY.data[yOff + i];
        if (v > yMax) {
          yMax = v;
          yIdx = i;
        }
      }
      // softmax 最大值作为置信度,并放大到近似 visibility 的量纲:
      // SimCC 分桶多(384/512),可见点的典型 softmax 峰值只有 0.05-0.3
      const rawScore = (softmaxMax(simccX.data, xOff, SIMCC_BINS_X, xMax) +
        softmaxMax(simccY.data, yOff, SIMCC_BINS_Y, yMax)) / 2;
      const score = Math.min(1, rawScore * 6);
      scoreSum += score;
      // SimCC 坐标(/2)→ 输入图坐标 → 反 letterbox 到裁剪框 → 原图归一化
      landmarks.push({
        x: (bbox.x + (xIdx / 2) / scale) / vw,
        y: (bbox.y + (yIdx / 2) / scale) / vh,
        z: 0,
        visibility: score,
      });
    }
    // RTMPose 无伪 3D 输出,躯干倾角指标会自然显示"无法判断"
    const meanScore = scoreSum / NUM_KEYPOINTS;
    // debug: 观察实际分数分布以确定阈值
    if (Math.random() < 0.03) {
      const over50 = landmarks.filter((l) => l.visibility >= 0.5).length;
      console.log(
        `[rtmpose] mean=${meanScore.toFixed(3)} >0.5:${over50}/17 bbox=${this.bbox ? "track" : "full"}`,
      );
    }
    if (meanScore < MIN_MEAN_SCORE) {
      this.bbox = null;
      return { timestampMs, landmarks: [], worldLandmarks: [] };
    }
    this.updateBBox(landmarks, vw, vh);
    return { timestampMs, landmarks, worldLandmarks: [] };
  }

  close(): void {
    this.bbox = null;
    this.frameBBox = null;
    void this.session.release();
  }
}

function softmaxMax(
  data: Float32Array,
  offset: number,
  length: number,
  max: number,
): number {
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum += Math.exp(data[offset + i] - max);
  }
  return 1 / sum;
}
