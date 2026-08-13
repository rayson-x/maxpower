import { IncrementalSha256 } from "../cloud/media/IncrementalSha256";

/** Collision-resistant, deterministic label for account-scoped local resources. */
export function namespaceDigest(parts: readonly string[]): string {
  const normalized = parts.map((part) => {
    if (!part.trim()) throw new Error("namespace_part_required");
    return `${new TextEncoder().encode(part).byteLength}:${part}`;
  }).join("|");
  return new IncrementalSha256().update(new TextEncoder().encode(normalized)).digestHex();
}
