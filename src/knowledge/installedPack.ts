import { validateKnowledgePack } from "./KnowledgePackRegistry";
import type { KnowledgePack } from "./model";
import builtinPackJson from "./packs/core-fitness-knowledge.v1.json";

/**
 * 内置知识包（ticket 02）：单一事实来源是随包发布的 JSON 数据资源
 * `packs/core-fitness-knowledge.v1.json`（由 tools/knowledge/buildCorePack.ts 生成）。
 * 加载即校验（schema/签名/hash/catalog lint），校验不过直接抛错——内置包损坏是构建事故，
 * 不应该静默降级。
 */
export function createInstalledKnowledgePack(): KnowledgePack {
  const pack = builtinPackJson as unknown as KnowledgePack;
  validateKnowledgePack(pack);
  return pack;
}
