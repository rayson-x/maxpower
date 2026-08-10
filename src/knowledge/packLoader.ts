import { createInstalledKnowledgePack } from "./installedPack";
import { KnowledgePackRegistry, validateKnowledgePack } from "./KnowledgePackRegistry";
import type { KnowledgePack } from "./model";

/**
 * 知识包加载器（ticket 02）：内置包兜底 + 本地安装的数据包覆盖。
 * 数据包必须通过 schema 兼容性、reviewed_digest 签名与内容 hash 校验；
 * 任一失败回退内置包并返回拒绝原因（不静默加载未审核内容）。
 */
export type KnowledgePackLoadSource = "builtin" | "installed";

export interface KnowledgePackLoadResult {
  pack: KnowledgePack;
  source: KnowledgePackLoadSource;
  rejectionReason?: string;
}

/** 本地数据包来源端口；Expo 侧可用 FileSystem 实现，测试用内存实现。 */
export interface KnowledgePackSourcePort {
  readInstalledPackJson(): string | null;
}

export function loadKnowledgePack(
  installedJson: string | null | undefined,
  appSchemaVersion = 1,
): KnowledgePackLoadResult {
  const builtin = createInstalledKnowledgePack();
  if (!installedJson) return { pack: builtin, source: "builtin" };
  let parsed: KnowledgePack;
  try {
    parsed = JSON.parse(installedJson) as KnowledgePack;
  } catch {
    return { pack: builtin, source: "builtin", rejectionReason: "parse_error" };
  }
  try {
    validateKnowledgePack(parsed, appSchemaVersion);
  } catch (error) {
    return {
      pack: builtin,
      source: "builtin",
      rejectionReason: error instanceof Error ? error.message : "validation_error",
    };
  }
  return { pack: parsed, source: "installed" };
}

export function createKnowledgePackRegistry(
  source?: KnowledgePackSourcePort,
  appSchemaVersion = 1,
): { registry: KnowledgePackRegistry; load: KnowledgePackLoadResult } {
  const load = loadKnowledgePack(source?.readInstalledPackJson(), appSchemaVersion);
  return { registry: new KnowledgePackRegistry(load.pack, appSchemaVersion), load };
}
