import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "../..");
const apiBaseUrl = process.env.EXPO_PUBLIC_MAXPOWER_API_BASE_URL?.trim();
if (!apiBaseUrl || !apiBaseUrl.startsWith("https://")) {
  throw new Error("EXPO_PUBLIC_MAXPOWER_API_BASE_URL must be an HTTPS URL");
}

const outputDir = mkdtempSync(join(tmpdir(), "maxpower-android-release-"));
const expo = resolve(projectRoot, "node_modules/.bin/expo");
const result = spawnSync(expo, ["export", "--platform", "android", "--output-dir", outputDir], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    EXPO_PUBLIC_FOLDER: ".native-public",
    EXPO_PUBLIC_MAXPOWER_API_BASE_URL: apiBaseUrl,
  },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const files = listFiles(outputDir);
for (const path of files) {
  if (/confirmed-captures|\.(?:mp4|mov|webm)$/i.test(path)) {
    throw new Error(`Native release contains non-product media: ${path}`);
  }
}

const forbiddenStrings = [
  "EXPO_PUBLIC_MAXPOWER_LLM_API_KEY",
  "EXPO_PUBLIC_MAXPOWER_LLM_ENDPOINT",
  "EXPO_PUBLIC_MAXPOWER_LLM_MODEL",
  "RemoteModelSetupSheet",
  "embeddedRemoteLlm",
  "localRemoteLlmProviderSettings",
  "bettermeet",
  "openrouter",
];
for (const path of files) {
  const stat = statSync(path);
  if (stat.size > 16 * 1024 * 1024) continue;
  const contents = readFileSync(path);
  const text = contents.toString("latin1");
  const leakedLabel = forbiddenStrings.find((candidate) => text.includes(candidate));
  if (leakedLabel) throw new Error(`Native release contains forbidden label ${leakedLabel}: ${path}`);
  if (/sk-(?:proj|live|test)-[A-Za-z0-9_-]{20,}/.test(text)) {
    throw new Error(`Native release contains a Provider-shaped secret: ${path}`);
  }
}

console.log(`Android release bundle verified: ${outputDir}`);

function listFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}
