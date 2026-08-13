/**
 * CaptureStore：把一组训练期间的 canonical packet 流录制为单个 JSON 文件，
 * 落盘到应用文档目录 captures/（文件名 = yyyymmdd_hhmmss_<exerciseId>.json），
 * 可经 adb pull / 系统文件管理器导出，供离线工具链复盘。
 *
 * 字段命名尽量对齐 public/archives/confirmed-captures 既有采集档案的习惯
 * （model / timestampMs / landmarks 等），但文件格式是本模块自有的
 * "capture-store/v1"，不与 field-capture 档案互相兼容。
 *
 * expo-file-system 选型说明：SDK 57 默认导出的是新 API（File / Directory / Paths 类，
 * 同步读写），legacy API（writeAsStringAsync 等）已迁移到 'expo-file-system/legacy'
 * 并标记废弃。本模块选用新 API——官方推荐路径、同步调用语义与"攒帧后一次性写盘"
 * 的模型天然契合。注意 expo-file-system 的 package.json main 指向 TS 源码，
 * node 单测环境无法直接加载，因此只在 finalize 真正落盘时才延迟 require；
 * Metro 对字面量 require 可以正常静态打包。
 */

/** expo-file-system 仅取类型；运行时通过 loadFileSystem() 延迟加载。 */
type ExpoFileSystem = typeof import("expo-file-system");

// Metro 与 node 都提供 CJS require；这里本地声明，避免依赖 @types/node 的全局类型。
declare function require(name: string): unknown;

function loadFileSystem(): ExpoFileSystem {
  return require("expo-file-system") as ExpoFileSystem;
}

/** 落盘 JSON 的格式版本，沿用 manifest 的 "<名字>/v<序号>" 风格。 */
export const CAPTURE_FILE_VERSION = "capture-store/v1";

/** 单帧关键点的四元组：[x, y, z, visibility]，与原生 onPose 事件的 landmarks 对齐。 */
export type CaptureLandmark = [x: number, y: number, z: number, visibility: number];

/** 开始录制时的会话元数据（动作 / 机位 / 镜头朝向 / 模型 / 开始时间）。 */
export interface CaptureSessionMeta {
  exerciseId: string;
  /** 八向机位（kebab-case，如 "rear" / "front-left-45"）。 */
  capturePosition: string;
  lensFacing: "front" | "back";
  /** Versioned visual-observation model id (for example `rtmpose-m-halpe26`). */
  model: string;
  /** Date.now() 毫秒时间戳，同时用于生成文件名。 */
  startedAtMs: number;
}

/** 录制的一帧：canonical packet 的 base64 原文 + 可选关键点。 */
export interface CaptureFrame {
  timestampMs: number;
  packetBase64: string;
  landmarks?: CaptureLandmark[];
}

/** 落盘 JSON 的顶层结构。 */
export interface CaptureFileDocument {
  version: typeof CAPTURE_FILE_VERSION;
  session: CaptureSessionMeta;
  frames: CaptureFrame[];
  summary: {
    frames: number;
    /** 首末帧时间差（与事件时间戳同源）；不足两帧时为 0。 */
    durationMs: number;
  };
}

/** finalize 成功后返回的文件引用。 */
export interface CaptureFileRef {
  /** file:// 绝对 uri（内存 fake 为 memory://captures/<fileName>）。 */
  uri: string;
  /** 去掉 scheme 的纯路径，adb pull 直接用它；内存 fake 为 captures/<fileName>。 */
  path: string;
  fileName: string;
  summary: CaptureFileDocument["summary"];
}

export interface CaptureStore {
  /** 开始一次录制会话；已有进行中的会话时抛错。 */
  begin(session: CaptureSessionMeta): void;
  /** 追加一帧；不在录制中时抛错。 */
  append(frame: CaptureFrame): void;
  /** 结束会话并落盘，返回文件引用；不在录制中时抛错。 */
  finalize(): Promise<CaptureFileRef>;
  /** 放弃本次会话，不落盘；幂等。 */
  abort(): void;
}

const FILE_NAME_INVALID_CHARS = /[^a-zA-Z0-9_-]/g;

/**
 * 生成落盘文件名：yyyymmdd_hhmmss_<exerciseId>.json（本机时区）。
 * exerciseId 中的非法字符替换为 "-"，全被清洗掉时退化为 "unknown"。
 */
export function formatCaptureFileName(
  session: Pick<CaptureSessionMeta, "exerciseId" | "startedAtMs">,
): string {
  const date = new Date(session.startedAtMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const hms = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  // 非法字符替换为 "-"；清洗后一个字母数字都不剩（如纯中文 id）时退化为 "unknown"。
  const cleaned = session.exerciseId.replace(FILE_NAME_INVALID_CHARS, "-");
  const exerciseId = /[a-zA-Z0-9]/.test(cleaned) ? cleaned : "unknown";
  return `${ymd}_${hms}_${exerciseId}.json`;
}

/** 组装落盘 JSON 文档（纯函数，便于单测）。 */
export function buildCaptureDocument(
  session: CaptureSessionMeta,
  frames: CaptureFrame[],
): CaptureFileDocument {
  const durationMs =
    frames.length >= 2
      ? Math.max(0, frames[frames.length - 1].timestampMs - frames[0].timestampMs)
      : 0;
  return {
    version: CAPTURE_FILE_VERSION,
    session,
    frames,
    summary: { frames: frames.length, durationMs },
  };
}

/**
 * 会话状态机的公共部分：缓冲帧 + 组文档。
 * 一组训练约几十秒、几十帧，packet 每帧几 KB，全程内存缓冲、finalize 时一次性
 * 写盘足够轻量，也避免写出半截 JSON。
 */
abstract class BaseCaptureStore implements CaptureStore {
  private session: CaptureSessionMeta | null = null;
  private frames: CaptureFrame[] = [];

  begin(session: CaptureSessionMeta): void {
    if (this.session) {
      throw new Error("CaptureStore: 已有进行中的录制会话，请先 finalize 或 abort");
    }
    this.session = session;
    this.frames = [];
  }

  append(frame: CaptureFrame): void {
    if (!this.session) {
      throw new Error("CaptureStore: 当前没有录制会话，append 前请先 begin");
    }
    this.frames.push(frame);
  }

  async finalize(): Promise<CaptureFileRef> {
    if (!this.session) {
      throw new Error("CaptureStore: 当前没有录制会话，无法 finalize");
    }
    const session = this.session;
    const document = buildCaptureDocument(session, this.frames);
    const fileName = formatCaptureFileName(session);
    // 先清状态再落盘：写盘失败后 UI 侧可以立刻开始下一段，不用先 abort。
    this.session = null;
    this.frames = [];
    const persisted = await this.persist(fileName, document);
    return { ...persisted, fileName, summary: document.summary };
  }

  abort(): void {
    this.session = null;
    this.frames = [];
  }

  /** 由子类实现真正的落盘（或记录），返回文件 uri 与纯路径。 */
  protected abstract persist(
    fileName: string,
    document: CaptureFileDocument,
  ): Promise<{ uri: string; path: string }>;
}

/**
 * 生产实现：写入应用文档目录 captures/ 下。
 * 目录由 File.create({ intermediates: true }) 一并创建；同一秒同名重录时覆盖旧文件。
 */
export class FileSystemCaptureStore extends BaseCaptureStore {
  constructor(private readonly directoryName: string = "captures") {
    super();
  }

  protected async persist(
    fileName: string,
    document: CaptureFileDocument,
  ): Promise<{ uri: string; path: string }> {
    const { File, Paths } = loadFileSystem();
    const file = new File(Paths.document, this.directoryName, fileName);
    file.create({ intermediates: true, overwrite: true });
    file.write(JSON.stringify(document));
    return { uri: file.uri, path: file.uri.replace(/^file:\/\//, "") };
  }
}

/** 单次调用记录，供测试断言写入序列。 */
export type CaptureStoreCall =
  | { type: "begin"; session: CaptureSessionMeta }
  | { type: "append"; frame: CaptureFrame }
  | { type: "finalize"; document: CaptureFileDocument }
  | { type: "abort" };

/**
 * 内存 fake：不落盘，记录全部调用与 finalize 产出的文档，
 * 供单测与 UI 开发（未接原生文件系统时）使用。
 */
export class InMemoryCaptureStore extends BaseCaptureStore {
  readonly calls: CaptureStoreCall[] = [];

  begin(session: CaptureSessionMeta): void {
    super.begin(session);
    this.calls.push({ type: "begin", session });
  }

  append(frame: CaptureFrame): void {
    super.append(frame);
    this.calls.push({ type: "append", frame });
  }

  abort(): void {
    super.abort();
    this.calls.push({ type: "abort" });
  }

  protected async persist(
    fileName: string,
    document: CaptureFileDocument,
  ): Promise<{ uri: string; path: string }> {
    this.calls.push({ type: "finalize", document });
    return { uri: `memory://captures/${fileName}`, path: `captures/${fileName}` };
  }
}
