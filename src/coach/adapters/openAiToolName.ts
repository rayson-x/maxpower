import { stableHash } from "../stable";

/** OpenAI-compatible providers accept only a restricted function-name alphabet. */
export function openAiCompatibleToolName(name: string): string {
  const readable = name.replace(/[^a-zA-Z0-9_-]/g, "_") || "tool";
  const suffix = stableHash(name);
  return `${readable.slice(0, 64 - suffix.length - 1)}_${suffix}`;
}
