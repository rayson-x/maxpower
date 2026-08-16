import { lstat, readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type ReleaseScanRule =
  | "configured_secret"
  | "openai_api_key"
  | "anthropic_api_key"
  | "aws_access_key"
  | "google_api_key"
  | "github_token"
  | "private_key";

export interface ReleaseScanFinding {
  /** File name only; the matched credential is deliberately never returned. */
  file: string;
  rule: ReleaseScanRule;
}

export interface ReleaseArtifactScanOptions {
  roots: readonly string[];
  forbiddenValues?: readonly string[];
}

const CREDENTIAL_PATTERNS: readonly [ReleaseScanRule, RegExp][] = [
  ["openai_api_key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["anthropic_api_key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["aws_access_key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["google_api_key", /\bAIza[A-Za-z0-9_-]{35}\b/],
  ["github_token", /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/],
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

/** Scans text release artifacts without retaining or reporting matched credential values. */
export async function scanReleaseArtifacts(
  options: ReleaseArtifactScanOptions,
): Promise<ReleaseScanFinding[]> {
  if (options.roots.length === 0) throw new Error("At least one release artifact root is required.");
  const forbiddenValues = [...new Set(
    (options.forbiddenValues ?? []).map((value) => value.trim()).filter((value) => value.length > 0),
  )];
  const findings: ReleaseScanFinding[] = [];

  for (const root of options.roots) {
    const absoluteRoot = resolve(root);
    for (const file of await filesUnder(absoluteRoot)) {
      const source = await readFile(file, "utf8");
      const displayFile = relative(process.cwd(), file) || file;
      for (const [rule, pattern] of CREDENTIAL_PATTERNS) {
        if (pattern.test(source)) findings.push({ file: displayFile, rule });
      }
      if (forbiddenValues.some((value) => source.includes(value))) {
        findings.push({ file: displayFile, rule: "configured_secret" });
      }
    }
  }

  return uniqueFindings(findings);
}

async function filesUnder(path: string): Promise<string[]> {
  const target = await lstat(path);
  if (target.isSymbolicLink()) return [];
  if (target.isFile()) return [path];
  if (!target.isDirectory()) return [];
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) return filesUnder(child);
    if (entry.isFile()) return [child];
    // Never follow symlinks out of an explicitly selected artifact root.
    return [];
  }));
  return nested.flat().sort();
}

function uniqueFindings(findings: readonly ReleaseScanFinding[]): ReleaseScanFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.file}\u0000${finding.rule}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function configuredRuntimeSecrets(environment: NodeJS.ProcessEnv): string[] {
  const directSecrets = [
    "DATABASE_URL",
    "RATE_LIMIT_REDIS_URL",
    "STREAM_REDIS_URL",
    "AUTH_SECRET",
    "GOOGLE_CLIENT_SECRET",
    "APPLE_CLIENT_SECRET",
    "OTP_DELIVERY_BEARER_TOKEN",
    "LLM_COACH_PROVIDER_API_KEY",
    "LLM_FINGERPRINT_SECRET",
    "MAXPOWER_STAGING_ACCESS_TOKEN",
    "MAXPOWER_STAGING_SCENARIO_ACCESS_TOKEN",
    "MAXPOWER_STAGING_DATABASE_URL",
    "MAXPOWER_STAGING_SCENARIO_DATABASE_URL",
  ].flatMap((name) => environment[name] ?? []);
  const urlCredentials = [
    environment.DATABASE_URL,
    environment.RATE_LIMIT_REDIS_URL,
    environment.STREAM_REDIS_URL,
  ].flatMap((value) => credentialParts(value));
  return [...new Set([...directSecrets, ...urlCredentials])];
}

function credentialParts(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const url = new URL(value);
    return [url.username, url.password]
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
  } catch {
    return [];
  }
}

function scanRoots(environment: NodeJS.ProcessEnv, arguments_: readonly string[]): string[] {
  if (arguments_.length > 0) return [...arguments_];
  const configured = environment.MAXPOWER_RELEASE_SCAN_PATHS;
  if (configured !== undefined) {
    const paths = configured.split(",").map((value) => value.trim()).filter(Boolean);
    if (paths.length === 0) throw new Error("MAXPOWER_RELEASE_SCAN_PATHS must name an artifact root.");
    return paths;
  }
  return [resolve("dist")];
}

async function main(): Promise<void> {
  const findings = await scanReleaseArtifacts({
    roots: scanRoots(process.env, process.argv.slice(2)),
    forbiddenValues: configuredRuntimeSecrets(process.env),
  });
  process.stdout.write(`${JSON.stringify({
    event: "maxpower_release_secret_scan",
    status: findings.length === 0 ? "passed" : "failed",
    findings,
  })}\n`);
  if (findings.length > 0) process.exitCode = 1;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  void main().catch(() => {
    process.stderr.write(`${JSON.stringify({
      event: "maxpower_release_secret_scan",
      status: "failed",
      reason: "scan_failed",
    })}\n`);
    process.exitCode = 1;
  });
}
