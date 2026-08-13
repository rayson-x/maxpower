import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

type AppConfig = {
  expo: {
    orientation?: string;
    scheme?: string;
    plugins?: readonly (string | readonly [string, Record<string, unknown>])[];
    android?: {
      package?: string;
      permissions?: readonly string[];
    };
  };
};

type AutolinkedModule = {
  config?: {
    android?: {
      modules?: readonly string[];
    };
  };
};

const root = process.cwd();

function readAppConfig(): AppConfig {
  return JSON.parse(readFileSync(resolve(root, "app.json"), "utf8")) as AppConfig;
}

function pluginName(plugin: string | readonly [string, Record<string, unknown>]): string {
  return typeof plugin === "string" ? plugin : plugin[0];
}

function findAutolinkedAndroidModules(): Record<string, AutolinkedModule> {
  // Tests compile to a temporary directory, so resolve the CLI as the Android
  // project would instead of relative to the emitted test file.
  const rootRequire = createRequire(resolve(root, "package.json"));
  const cli = rootRequire.resolve("expo-modules-autolinking/bin/expo-modules-autolinking");
  const output = execFileSync(process.execPath, [cli, "search", "--platform", "android", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  return JSON.parse(output) as Record<string, AutolinkedModule>;
}

test("Android production composition keeps Expo SDK 57 native prerequisites declared", () => {
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const app = readAppConfig();
  const pluginNames = new Set((app.expo.plugins ?? []).map(pluginName));

  assert.match(packageJson.dependencies?.expo ?? "", /^~57\./);
  assert.equal(app.expo.orientation, "portrait");
  assert.equal(app.expo.scheme, "maxpower");
  assert.equal(app.expo.android?.package, "com.maxpower.app");
  assert.deepEqual(
    new Set(["expo-sqlite", "expo-background-task", "expo-notifications", "expo-secure-store"]),
    new Set(["expo-sqlite", "expo-background-task", "expo-notifications", "expo-secure-store"].filter((name) => pluginNames.has(name))),
  );
  assert.ok(app.expo.android?.permissions?.includes("android.permission.CAMERA"));
  assert.ok(app.expo.android?.permissions?.includes("android.permission.health.READ_SLEEP"));
});

test("Android native shell stays portrait instead of following device rotation", () => {
  const manifest = readFileSync(resolve(root, "android/app/src/main/AndroidManifest.xml"), "utf8");

  assert.match(manifest, /android:name="\.MainActivity"[^>]*android:screenOrientation="portrait"/);
  assert.doesNotMatch(manifest, /android:screenOrientation="(?:sensor|fullSensor|unspecified|user|fullUser)"/);
});

test("Android MVP shell can reach the deployed cloud-developer HTTP API", () => {
  const manifest = readFileSync(resolve(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
  const compositionRoot = readFileSync(resolve(root, "src/mobile/ui/MaxPowerApp.tsx"), "utf8");

  assert.match(manifest, /<application[^>]*android:usesCleartextTraffic="true"/);
  assert.match(compositionRoot, /const MVP_API_ENDPOINT = "http:\/\/54\.151\.241\.139:3000"/);
  assert.match(compositionRoot, /createMobileAccountRuntimeFactory\(\{ apiBaseUrl: baseUrl, allowInsecureHttp: true \}\)/);
});

test("authenticated Android runtime enables the complete Agent tool harness", () => {
  const runtime = readFileSync(resolve(root, "src/mobile/runtime/createMobileAccountRuntime.ts"), "utf8");

  assert.match(runtime, /llmProviderResolver: cloudCoach\.llmProviderResolver/);
  assert.match(runtime, /knowledgeToolsEnabled: true/);
  assert.match(runtime, /actionToolsEnabled: true/);
  assert.match(runtime, /behaviorDecisionRecorder: new BehaviorDecisionTraceRecorder/);
});

test("shared native shell uses the Expo SDK 57 safe-area primitive instead of fixed system-bar padding", () => {
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const compositionRoot = readFileSync(resolve(root, "src/mobile/ui/MaxPowerApp.tsx"), "utf8");

  assert.equal(packageJson.dependencies?.["react-native-safe-area-context"], "~5.7.0");
  assert.match(compositionRoot, /SafeAreaProvider, SafeAreaView, initialWindowMetrics/);
  assert.match(compositionRoot, /<SafeAreaProvider initialMetrics=\{initialWindowMetrics\}>/);
  assert.match(compositionRoot, /<SafeAreaView style=\{\{ flex: 1, backgroundColor: colors\.paper \}\}>/);
});

test("Android local native modules are discoverable by Expo Autolinking with their JS bridge names", () => {
  const modules = findAutolinkedAndroidModules();

  assert.deepEqual(modules["pose-camera"]?.config?.android?.modules, [
    "expo.modules.posecamera.PoseCameraModule",
  ]);
  assert.deepEqual(modules["health-connect"]?.config?.android?.modules, [
    "expo.modules.maxpowerhealthconnect.MaxPowerHealthConnectModule",
  ]);
});

test("Android module manifests keep camera and Health Connect permissions in native module scope", () => {
  const poseManifest = readFileSync(resolve(root, "modules/pose-camera/android/src/main/AndroidManifest.xml"), "utf8");
  const healthManifest = readFileSync(resolve(root, "modules/health-connect/android/src/main/AndroidManifest.xml"), "utf8");
  const applicationManifest = readFileSync(resolve(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
  const poseModule = readFileSync(resolve(root, "modules/pose-camera/android/src/main/java/expo/modules/posecamera/PoseCameraModule.kt"), "utf8");
  const healthModule = readFileSync(resolve(root, "modules/health-connect/android/src/main/java/expo/modules/maxpowerhealthconnect/MaxPowerHealthConnectModule.kt"), "utf8");

  assert.match(poseManifest, /android\.permission\.CAMERA/);
  assert.match(poseManifest, /android\.hardware\.camera\.any/);
  assert.match(healthManifest, /android\.permission\.health\.READ_SLEEP/);
  assert.match(healthManifest, /android\.permission\.health\.READ_HEART_RATE_VARIABILITY/);
  assert.match(poseModule, /Name\("PoseCamera"\)/);
  assert.match(healthModule, /Name\("MaxPowerHealthConnect"\)/);
  assert.match(applicationManifest, /<data android:scheme="maxpower"\/>/);
});

test("pose-camera packages Rust libraries from one generated source only", () => {
  const build = readFileSync(resolve(root, "modules/pose-camera/android/build.gradle"), "utf8");

  assert.match(build, /jniLibs\.srcDirs = \[rustJniDir\]/);
  assert.doesNotMatch(build, /jniLibs\.srcDirs \+= rustJniDir/);
});

test("fresh Android install opens the shared SQLite file sequentially before creating isolated connections", () => {
  const persistence = readFileSync(resolve(root, "src/mobile/native/ExpoMaxPowerPersistence.ts"), "utf8");
  const opens = [...persistence.matchAll(/await SQLite\.openDatabaseAsync\(databaseName\)/g)];
  // One connection owns the durable Coach Ledger and one owns transient shell
  // presentation state. The removed cloud-product cache no longer opens a
  // third connection to this local-authoritative MVP database.
  assert.equal(opens.length, 2);
  assert.doesNotMatch(persistence, /Promise\.all\([\s\S]*openDatabaseAsync/);
});

test("native SQLite directory is converted to an absolute file URI before legacy-file inspection", () => {
  const persistence = readFileSync(
    resolve(root, "src/mobile/native/ExpoMaxPowerPersistence.ts"),
    "utf8",
  );

  assert.match(persistence, /const fileDirectory = absoluteFileUri\(directory\)/);
  assert.match(persistence, /return `file:\/\/\$\{directory\.startsWith\("\/"\) \? "" : "\/"\}\$\{directory\}`/);
  assert.doesNotMatch(persistence, /new File\(directory, (?:databaseName|legacyName)\)/);
});

test("native workout and result surfaces translate planner identifiers and render completion time locally", () => {
  const shell = readFileSync(resolve(root, "src/mobile/ui/ProductShell.tsx"), "utf8");

  assert.match(shell, /readablePlanSessionTitle\(workout\.frozenPrescription\.title\)/);
  assert.match(shell, /exerciseDisplayName\(pending\.task\.exerciseVariantId\)/);
  assert.match(shell, /readablePlanSessionTitle\(summary\.title\)/);
  assert.match(shell, /localDateTime\(summary\.completedAt\)/);
  assert.doesNotMatch(shell, />\{pending\.task\.exerciseVariantId\}<\/Text>/);
  assert.doesNotMatch(shell, />\{summary\.title\}<\/Text>/);
});

test("Coach drawer keeps transient and failed tool feedback without stacking completed rows", () => {
  const drawer = readFileSync(resolve(root, "src/coach/ui/CoachDrawer.tsx"), "utf8");

  assert.match(drawer, /if \(part\.state === "output-available"\) return null;/);
  assert.match(drawer, /part\.state === "output-error" \? "未能完成" : "正在读取与整理"/);
  assert.doesNotMatch(drawer, /: "已完成"/);
});
