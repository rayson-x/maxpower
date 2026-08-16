const {
  withAndroidManifest,
  withAppBuildGradle,
  withEntitlementsPlist,
  withInfoPlist,
} = require("@expo/config-plugins");

/** Adds the HealthKit entitlement and only the read-purpose string. */
module.exports = function withMaxPowerHealthKit(config) {
  // The single-user MVP connects directly to an HTTP development server.
  // Apply this to release as well as debug manifests so the native shell has
  // one transport policy rather than a hidden debug-only exception.
  config = withAndroidManifest(config, (next) => {
    const application = next.modResults.manifest.application?.[0];
    if (!application) throw new Error("maxpower_android_application_missing");
    application.$["android:usesCleartextTraffic"] = "true";
    return next;
  });
  // Health Connect's stable Android client requires Android 8.0 (API 26).
  // Keep this in the config plugin so every generated native project has the
  // same installable minimum rather than relying on a hand-edited android/ tree.
  config = withAppBuildGradle(config, (next) => {
    next.modResults.contents = next.modResults.contents.replace(
      "minSdkVersion rootProject.ext.minSdkVersion",
      "minSdkVersion 26",
    );
    return next;
  });
  config = withEntitlementsPlist(config, (next) => {
    next.modResults["com.apple.developer.healthkit"] = true;
    return next;
  });
  return withInfoPlist(config, (next) => {
    next.modResults.NSHealthShareUsageDescription = "MaxPower 仅读取你选择的健康记录，用于在本地呈现训练、恢复和趋势；你可以随时停止连接。";
    return next;
  });
};
