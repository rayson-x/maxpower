import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("发布客户端没有 Provider 配置、直连凭据或本地模型 bootstrap，Pi 仅作为云协议 runtime", () => {
  for (const path of [
    "src/agent/defaultCredentials.ts",
    "src/agent/coach.ts",
    "src/mobile/ui/RemoteModelSetupSheet.tsx",
    "src/mobile/ui/embeddedRemoteLlm.ts",
    "tools/mobile/run-with-bettermeet-llm.sh",
  ]) {
    assert.equal(existsSync(join(root, path)), false, `${path} must not ship`);
  }

  const shippedSource = ["src", "modules"].flatMap((directory) => readTextFiles(join(root, directory)));
  const joined = shippedSource.join("\n");
  assert.doesNotMatch(joined, /EXPO_PUBLIC_MAXPOWER_LLM_(?:API_KEY|ENDPOINT|MODEL)/);
  assert.doesNotMatch(joined, /localRemoteLlmProviderSettings|configureRemoteLlmProvider|readLocalRemoteLlmProviderSettings/);
  assert.doesNotMatch(joined, /DEFAULT_ZHIPU_API_KEY|provider:\s*ZHIPU|open\.bigmodel\.cn/);

  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  assert.equal(packageJson.dependencies?.["@mariozechner/pi-ai"], "0.73.1");
  assert.equal(packageJson.dependencies?.["@mariozechner/pi-agent-core"], "0.73.1");

  const piProvider = readFileSync(
    join(root, "src/mobile/cloud/MaxPowerPiLlmProvider.ts"),
    "utf8",
  );
  assert.match(piProvider, /maxpower\/coach-v1/);
  assert.match(piProvider, /accessTokenFor\(this\.accountId\)/);
  assert.doesNotMatch(piProvider, /OPENAI_API_KEY|ANTHROPIC_API_KEY|openai\.com|openrouter\.ai/);
});

test("云端 LLM 只暴露文本 Coach alias，V1 不包含营养识别模型", () => {
  const coach = readFileSync(
    join(root, "src/mobile/cloud/MaxPowerPiLlmProvider.ts"),
    "utf8",
  );
  assert.match(coach, /maxpower\/coach-v1/);
  assert.match(coach, /accessTokenFor\(this\.accountId/);
  assert.equal(existsSync(join(root, "src/mobile/cloud/CloudNutritionObservationProvider.ts")), false);
  assert.equal(existsSync(join(root, "src/mobile/cloud/MaxPowerCloudLlmProvider.ts")), false);
  assert.doesNotMatch(coach, /nutrition-vision|Nutrition Vision|image_url|data:image/);
  assert.doesNotMatch(coach, /OPENAI_API_KEY|ANTHROPIC_API_KEY|credentialRef|provider\.example/);
});

test("Android release harness excludes the web public corpus and scans the emitted bytecode", () => {
  const harness = readFileSync(join(root, "tools/mobile/exportAndroidRelease.mjs"), "utf8");
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.["release:client"], "node tools/mobile/exportAndroidRelease.mjs");
  assert.match(harness, /EXPO_PUBLIC_FOLDER:\s*"\.native-public"/);
  assert.match(harness, /confirmed-captures/);
  assert.match(harness, /EXPO_PUBLIC_MAXPOWER_LLM_API_KEY/);
  assert.match(harness, /EXPO_PUBLIC_MAXPOWER_API_BASE_URL/);
});

function readTextFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const output: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      output.push(...readTextFiles(path));
    } else if (/\.(?:ts|tsx|js|jsx|json)$/.test(name)) {
      output.push(readFileSync(path, "utf8"));
    }
  }
  return output;
}
