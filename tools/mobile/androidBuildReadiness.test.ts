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
    expo?: { autolinking?: { android?: { exclude?: readonly string[] } } };
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
  assert.ok(!app.expo.android?.permissions?.includes("android.permission.CAMERA"));
  assert.ok(packageJson.expo?.autolinking?.android?.exclude?.includes("pose-camera"));
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
  assert.match(compositionRoot, /EXPO_PUBLIC_MAXPOWER_API_BASE_URL/);
  assert.match(compositionRoot, /http:\/\/54\.151\.241\.139:3000/);
  assert.match(compositionRoot, /createMobileAccountRuntimeFactory\(\{ apiBaseUrl: baseUrl \}\)/);
});

test("authenticated Android runtime enables the complete Agent tool harness", () => {
  const runtime = readFileSync(resolve(root, "src/mobile/runtime/createMobileAccountRuntime.ts"), "utf8");

  assert.match(runtime, /pi: cloudCoach\.pi/);
  assert.match(runtime, /new PiAgentConversationModule/);
  assert.match(runtime, /createLocalConversationAdapters\(\{ kernel, records \}\)/);
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

  assert.equal(modules["pose-camera"], undefined);
  assert.deepEqual(modules["health-connect"]?.config?.android?.modules, [
    "expo.modules.maxpowerhealthconnect.MaxPowerHealthConnectModule",
  ]);
});

test("Android V1 admits Health Connect but does not package a camera surface", () => {
  const healthManifest = readFileSync(resolve(root, "modules/health-connect/android/src/main/AndroidManifest.xml"), "utf8");
  const applicationManifest = readFileSync(resolve(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
  const healthModule = readFileSync(resolve(root, "modules/health-connect/android/src/main/java/expo/modules/maxpowerhealthconnect/MaxPowerHealthConnectModule.kt"), "utf8");

  assert.match(healthManifest, /android\.permission\.health\.READ_SLEEP/);
  assert.match(healthManifest, /android\.permission\.health\.READ_HEART_RATE_VARIABILITY/);
  assert.match(healthModule, /Name\("MaxPowerHealthConnect"\)/);
  assert.match(applicationManifest, /<data android:scheme="maxpower"\/>/);
  assert.doesNotMatch(applicationManifest, /android\.permission\.CAMERA/);
});

test("fresh Android install opens the shared SQLite file sequentially before creating isolated connections", () => {
  const persistence = readFileSync(resolve(root, "src/mobile/native/ExpoMaxPowerPersistence.ts"), "utf8");
  const connectionPolicy = readFileSync(
    resolve(root, "src/mobile/native/ExpoDatabaseConnections.ts"),
    "utf8",
  );
  const opens = [...persistence.matchAll(/await openIsolatedDatabaseConnection\(databaseName, SQLite\.openDatabaseAsync\)/g)];
  // The durable Coach Ledger and transient shell presentation state each own
  // an isolated handle. There is no cloud projection cache in the local-first
  // MVP.
  assert.equal(opens.length, 2);
  assert.doesNotMatch(persistence, /Promise\.all\([\s\S]*openDatabaseAsync/);
  assert.match(connectionPolicy, /useNewConnection: true/);
});

test("native SQLite persistence has no legacy database migration path", () => {
  const persistence = readFileSync(
    resolve(root, "src/mobile/native/ExpoMaxPowerPersistence.ts"),
    "utf8",
  );

  assert.doesNotMatch(persistence, /legacy|migrat|new File\(/i);
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

test("Coach drawer renders only durable Pi Conversation items and local cards", () => {
  const drawer = readFileSync(resolve(root, "src/coach/ui/CoachDrawer.tsx"), "utf8");

  assert.match(drawer, /<FlatList/);
  assert.match(drawer, /data=\{conversationItems\}/);
  assert.match(drawer, /ConversationItemView/);
  assert.match(drawer, /record_confirmation/);
  assert.doesNotMatch(drawer, /CoachStreamProjection|StreamPart|ArtifactState/);
});
