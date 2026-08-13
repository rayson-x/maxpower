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
    ios?: { bundleIdentifier?: string; requireFullScreen?: boolean };
  };
};

type AutolinkedModule = {
  config?: { apple?: { modules?: readonly string[] } };
};

const root = process.cwd();

function readAppConfig(): AppConfig {
  return JSON.parse(readFileSync(resolve(root, "app.json"), "utf8")) as AppConfig;
}

function pluginName(plugin: string | readonly [string, Record<string, unknown>]): string {
  return typeof plugin === "string" ? plugin : plugin[0];
}

function findAutolinkedAppleModules(): Record<string, AutolinkedModule> {
  const rootRequire = createRequire(resolve(root, "package.json"));
  const cli = rootRequire.resolve("expo-modules-autolinking/bin/expo-modules-autolinking");
  const output = execFileSync(process.execPath, [cli, "search", "--platform", "ios", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  return JSON.parse(output) as Record<string, AutolinkedModule>;
}

test("iOS production shell declares the stable app identity and HealthKit read capability", () => {
  const app = readAppConfig();
  const plugins = new Set((app.expo.plugins ?? []).map(pluginName));
  const entitlements = readFileSync(resolve(root, "ios/maxpower/maxpower.entitlements"), "utf8");
  const infoPlist = readFileSync(resolve(root, "ios/maxpower/Info.plist"), "utf8");
  const healthPlugin = readFileSync(resolve(root, "plugins/withMaxPowerHealthKit.js"), "utf8");

  assert.equal(app.expo.scheme, "maxpower");
  assert.equal(app.expo.orientation, "portrait");
  assert.equal(app.expo.ios?.bundleIdentifier, "com.maxpower.app");
  assert.equal(app.expo.ios?.requireFullScreen, true);
  assert.ok(plugins.has("./plugins/withMaxPowerHealthKit"));
  assert.match(healthPlugin, /com\.apple\.developer\.healthkit/);
  assert.match(healthPlugin, /NSHealthShareUsageDescription/);
  assert.match(entitlements, /<key>com\.apple\.developer\.healthkit<\/key>\s*<true\/>/);
  assert.match(infoPlist, /<key>NSHealthShareUsageDescription<\/key>/);
  assert.doesNotMatch(infoPlist, /<key>NSHealthUpdateUsageDescription<\/key>/);
});

test("iOS native shell stays upright portrait on iPhone and iPad", () => {
  const infoPlist = readFileSync(resolve(root, "ios/maxpower/Info.plist"), "utf8");

  assert.match(infoPlist, /<key>UIRequiresFullScreen<\/key>\s*<true\/>/);
  assert.equal((infoPlist.match(/UIInterfaceOrientationPortrait<\/string>/g) ?? []).length, 2);
  assert.doesNotMatch(infoPlist, /UIInterfaceOrientationPortraitUpsideDown/);
  assert.doesNotMatch(infoPlist, /UIInterfaceOrientationLandscape(?:Left|Right)/);
});

test("iOS HealthKit bridge is autolinked and keeps native HealthKit APIs outside the shared adapter", () => {
  const modules = findAutolinkedAppleModules();
  const podspec = readFileSync(resolve(root, "modules/health-connect/ios/MaxPowerHealthKit.podspec"), "utf8");
  const nativeModule = readFileSync(resolve(root, "modules/health-connect/ios/MaxPowerHealthKitModule.swift"), "utf8");
  const sharedAdapter = readFileSync(resolve(root, "src/mobile/native/AppleHealthKitPort.ts"), "utf8");

  assert.deepEqual(modules["health-connect"]?.config?.apple?.modules, ["MaxPowerHealthKitModule"]);
  assert.match(podspec, /s\.frameworks = 'HealthKit'/);
  assert.match(nativeModule, /import HealthKit/);
  assert.match(nativeModule, /Name\("MaxPowerHealthKit"\)/);
  assert.match(nativeModule, /HKAnchoredObjectQuery/);
  assert.doesNotMatch(sharedAdapter, /import HealthKit/);
});
