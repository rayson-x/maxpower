import type { TraceEnvelope } from "./model";
import type { TraceSink } from "./TraceRecorder";

/**
 * 本地 JSONL sink 的文件端口。抽成端口是为了让轮转/保留策略在内存实现上被
 * 确定性测试，生产侧再接 expo-file-system。
 */
export interface TraceFileSystem {
  ensureDirectory(path: string): Promise<void>;
  /** 目录内的文件名（不含路径）。 */
  list(directory: string): Promise<readonly string[]>;
  /** 文件不存在时返回 0。 */
  size(path: string): Promise<number>;
  append(path: string, chunk: string): Promise<void>;
  /** 文件不存在时返回 ""。 */
  read(path: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  delete(path: string): Promise<void>;
}

export interface LocalFileTraceSinkOptions {
  directory: string;
  /** 单文件上限；超过后轮转。 */
  maxBytes?: number;
  /** 保留的文件总数（当前文件 + 已轮转文件）。 */
  maxFiles?: number;
  baseName?: string;
}

export const DEFAULT_TRACE_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_TRACE_FILE_MAX_FILES = 5;
const DEFAULT_TRACE_FILE_BASE_NAME = "trace";

/**
 * 本地 JSONL sink：一行一个 envelope，5MB 轮转、最多保留 5 个文件。
 *
 * 由 debug 开关控制是否装配——不装配时 TraceRecorder 根本没有 sink，零成本。
 */
export class LocalFileTraceSink implements TraceSink {
  readonly name = "local_file";

  private readonly directory: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly baseName: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly files: TraceFileSystem,
    options: LocalFileTraceSinkOptions,
  ) {
    this.directory = options.directory;
    this.maxBytes = options.maxBytes ?? DEFAULT_TRACE_FILE_MAX_BYTES;
    this.maxFiles = Math.max(1, options.maxFiles ?? DEFAULT_TRACE_FILE_MAX_FILES);
    this.baseName = options.baseName ?? DEFAULT_TRACE_FILE_BASE_NAME;
  }

  get currentPath(): string {
    return `${this.directory}/${this.baseName}.jsonl`;
  }

  rotatedPath(index: number): string {
    return `${this.directory}/${this.baseName}.${index}.jsonl`;
  }

  /** 当前保留的全部文件路径，新到旧。 */
  retainedPaths(): readonly string[] {
    return [
      this.currentPath,
      ...Array.from({ length: this.maxFiles - 1 }, (_unused, index) => this.rotatedPath(index + 1)),
    ];
  }

  async write(envelope: TraceEnvelope): Promise<void> {
    // 串行化：轮转是「读大小 → 改名 → 追加」的复合操作，并发写会撕裂它。
    const task = this.queue.then(() => this.appendLine(envelope));
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async appendLine(envelope: TraceEnvelope): Promise<void> {
    await this.files.ensureDirectory(this.directory);
    const line = `${JSON.stringify(envelope)}\n`;
    const size = await this.files.size(this.currentPath);
    if (size > 0 && size + byteLength(line) > this.maxBytes) {
      await this.rotate();
    }
    await this.files.append(this.currentPath, line);
  }

  private async rotate(): Promise<void> {
    const oldest = this.maxFiles - 1;
    if (oldest >= 1) await this.files.delete(this.rotatedPath(oldest));
    for (let index = oldest - 1; index >= 1; index -= 1) {
      const from = this.rotatedPath(index);
      if ((await this.files.size(from)) > 0) {
        await this.files.rename(from, this.rotatedPath(index + 1));
      }
    }
    if (oldest >= 1) {
      await this.files.rename(this.currentPath, this.rotatedPath(1));
    } else {
      await this.files.delete(this.currentPath);
    }
  }
}

function byteLength(value: string): number {
  // RN 与 Node 都有 TextEncoder；避免依赖 Buffer。
  return new TextEncoder().encode(value).length;
}

/** 测试与开发工具用的内存文件系统。 */
export class InMemoryTraceFileSystem implements TraceFileSystem {
  private readonly contents = new Map<string, string>();

  async ensureDirectory(): Promise<void> {}

  async list(directory: string): Promise<readonly string[]> {
    const prefix = `${directory}/`;
    return [...this.contents.keys()]
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .sort();
  }

  async size(path: string): Promise<number> {
    const value = this.contents.get(path);
    return value === undefined ? 0 : new TextEncoder().encode(value).length;
  }

  async append(path: string, chunk: string): Promise<void> {
    this.contents.set(path, `${this.contents.get(path) ?? ""}${chunk}`);
  }

  async read(path: string): Promise<string> {
    return this.contents.get(path) ?? "";
  }

  async rename(from: string, to: string): Promise<void> {
    const value = this.contents.get(from);
    if (value === undefined) return;
    this.contents.set(to, value);
    this.contents.delete(from);
  }

  async delete(path: string): Promise<void> {
    this.contents.delete(path);
  }
}
