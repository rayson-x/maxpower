#!/usr/bin/env node

import { stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "../..");

const requiredArtifacts = {
  android: [
    "armeabi-v7a/libmaxpower_motion_sdk.so",
    "arm64-v8a/libmaxpower_motion_sdk.so",
    "x86/libmaxpower_motion_sdk.so",
    "x86_64/libmaxpower_motion_sdk.so",
  ],
  apple: [
    "MotionSdk.xcframework/Info.plist",
    "MotionSdk.xcframework/ios-arm64/libmaxpower_motion_sdk.a",
    "MotionSdk.xcframework/ios-arm64/Headers/motion_sdk.h",
    "MotionSdk.xcframework/ios-arm64_x86_64-simulator/libmaxpower_motion_sdk.a",
    "MotionSdk.xcframework/ios-arm64_x86_64-simulator/Headers/motion_sdk.h",
  ],
};

function parseArguments(argv) {
  const platform = argv[0];
  if (!(platform in requiredArtifacts)) {
    throw new Error(
      "usage: node tools/motion-sdk/preflight-native.mjs <android|apple> --artifacts <directory>",
    );
  }
  if (argv[1] !== "--artifacts" || !argv[2] || argv.length !== 3) {
    throw new Error(
      "usage: node tools/motion-sdk/preflight-native.mjs <android|apple> --artifacts <directory>",
    );
  }
  return { platform, artifacts: resolve(argv[2]) };
}

async function isNonEmptyFile(path) {
  try {
    const metadata = await stat(path);
    return metadata.isFile() && metadata.size > 0;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function displayPath(path) {
  const relation = relative(projectRoot, path);
  return relation && !relation.startsWith("..") && !isAbsolute(relation)
    ? relation
    : path;
}

function remediation(platform, artifacts) {
  return `sh tools/motion-sdk/build-native.sh ${platform} ${displayPath(artifacts)}`;
}

export async function verifyNativeArtifacts(platform, artifacts) {
  const missing = [];
  for (const relativePath of requiredArtifacts[platform]) {
    if (!(await isNonEmptyFile(resolve(artifacts, relativePath)))) {
      missing.push(relativePath);
    }
  }
  return missing;
}

export async function main(argv = process.argv.slice(2)) {
  const { platform, artifacts } = parseArguments(argv);
  const missing = await verifyNativeArtifacts(platform, artifacts);
  if (missing.length > 0) {
    console.error(`missing generated Rust ${platform} artifacts:`);
    for (const path of missing) console.error(`- ${path}`);
    console.error(`Run: ${remediation(platform, artifacts)}`);
    return 1;
  }
  console.log(`verified Rust ${platform} artifacts in ${displayPath(artifacts)}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main()
    .then((status) => {
      process.exitCode = status;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
