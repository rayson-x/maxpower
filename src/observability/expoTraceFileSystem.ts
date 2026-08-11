import type { TraceFileSystem } from "./LocalFileTraceSink";

/**
 * TraceFileSystem 的 Expo 实现（expo-file-system 新 API，SDK 57）。
 * 延迟 require：node 单测环境不加载该模块（与 captureStore 同一模式）。
 * JSONL 追加用「读全文 + 重写」——debug 日志量级下可接受，长期真相在账本。
 */

type ExpoFS = typeof import("expo-file-system");

declare function require(name: string): unknown;

function loadFs(): ExpoFS {
  return require("expo-file-system") as ExpoFS;
}

function dirOf(fs: ExpoFS, path: string) {
  const segments = path.split("/").filter(Boolean);
  return new fs.Directory(fs.Paths.document, ...segments);
}

export function createExpoTraceFileSystem(): TraceFileSystem {
  return {
    async ensureDirectory(path) {
      const fs = loadFs();
      const dir = dirOf(fs, path);
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    },
    async list(directory) {
      const fs = loadFs();
      const dir = dirOf(fs, directory);
      if (!dir.exists) return [];
      return dir.list().map((entry) => entry.name);
    },
    async size(path) {
      const fs = loadFs();
      const file = fileOf(fs, path);
      return file.exists ? (file.size ?? 0) : 0;
    },
    async append(path, chunk) {
      const fs = loadFs();
      const file = fileOf(fs, path);
      const existing = file.exists ? file.textSync() : "";
      file.write(existing + chunk);
    },
    async read(path) {
      const fs = loadFs();
      const file = fileOf(fs, path);
      return file.exists ? file.textSync() : "";
    },
    async rename(from, to) {
      const fs = loadFs();
      const source = fileOf(fs, from);
      if (!source.exists) return;
      source.move(fileOf(fs, to));
    },
    async delete(path) {
      const fs = loadFs();
      const file = fileOf(fs, path);
      if (file.exists) file.delete();
    },
  };
}

function fileOf(fs: ExpoFS, path: string) {
  const segments = path.split("/").filter(Boolean);
  const name = segments.pop()!;
  return new fs.File(fs.Paths.document, ...segments, name);
}
