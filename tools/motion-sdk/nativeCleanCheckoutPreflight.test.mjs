import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();
const node = process.execPath;
const modelTool = resolve(root, "tools/client-realtime-agent/fetch-web-vision-models.mjs");
const nativeTool = resolve(root, "tools/motion-sdk/preflight-native.mjs");

function run(script, args) {
  return spawnSync(node, [script, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

async function withTemporaryDirectory(callback) {
  const directory = await mkdtemp(join(tmpdir(), "maxpower-native-preflight-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("pinned model verification fails closed and prints the deterministic fetch command", async () => {
  await withTemporaryDirectory(async (projectRoot) => {
    const manifestPath = join(projectRoot, "models.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        models: [
          {
            id: "fixture-model",
            destination: "public/models/fixture.onnx",
            bytes: 3,
            sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
          },
        ],
      }),
    );

    const missing = run(modelTool, [
      "--verify",
      "--project-root",
      projectRoot,
      "--manifest",
      manifestPath,
    ]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /missing pinned ONNX model: fixture-model/);
    assert.match(
      missing.stderr,
      /node tools\/client-realtime-agent\/fetch-web-vision-models\.mjs --execute/,
    );

    const modelPath = join(projectRoot, "public/models/fixture.onnx");
    await mkdir(dirname(modelPath), { recursive: true });
    await writeFile(modelPath, "abc");
    const verified = run(modelTool, [
      "--verify",
      "--project-root",
      projectRoot,
      "--manifest",
      manifestPath,
    ]);
    assert.equal(verified.status, 0, verified.stderr);

    await writeFile(modelPath, "abd");
    const invalid = run(modelTool, [
      "--verify",
      "--project-root",
      projectRoot,
      "--manifest",
      manifestPath,
    ]);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /invalid pinned ONNX model: fixture-model/);
  });
});

test("native artifact verification fails closed for every required Android ABI", async () => {
  await withTemporaryDirectory(async (artifacts) => {
    const missing = run(nativeTool, ["android", "--artifacts", artifacts]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /arm64-v8a\/libmaxpower_motion_sdk\.so/);
    assert.match(missing.stderr, /x86_64\/libmaxpower_motion_sdk\.so/);
    assert.match(
      missing.stderr,
      /sh tools\/motion-sdk\/build-native\.sh android/,
    );

    for (const abi of ["armeabi-v7a", "arm64-v8a", "x86", "x86_64"]) {
      const library = join(artifacts, abi, "libmaxpower_motion_sdk.so");
      await mkdir(dirname(library), { recursive: true });
      await writeFile(library, "rust");
    }
    const verified = run(nativeTool, ["android", "--artifacts", artifacts]);
    assert.equal(verified.status, 0, verified.stderr);
  });
});

test("native artifact verification fails closed for both Apple XCFramework slices", async () => {
  await withTemporaryDirectory(async (artifacts) => {
    const missing = run(nativeTool, ["apple", "--artifacts", artifacts]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /MotionSdk\.xcframework\/Info\.plist/);
    assert.match(missing.stderr, /ios-arm64_x86_64-simulator\/libmaxpower_motion_sdk\.a/);
    assert.match(
      missing.stderr,
      /sh tools\/motion-sdk\/build-native\.sh apple/,
    );

    for (const relative of [
      "MotionSdk.xcframework/Info.plist",
      "MotionSdk.xcframework/ios-arm64/libmaxpower_motion_sdk.a",
      "MotionSdk.xcframework/ios-arm64/Headers/motion_sdk.h",
      "MotionSdk.xcframework/ios-arm64_x86_64-simulator/libmaxpower_motion_sdk.a",
      "MotionSdk.xcframework/ios-arm64_x86_64-simulator/Headers/motion_sdk.h",
    ]) {
      const artifact = join(artifacts, relative);
      await mkdir(dirname(artifact), { recursive: true });
      await writeFile(artifact, "rust");
    }
    const verified = run(nativeTool, ["apple", "--artifacts", artifacts]);
    assert.equal(verified.status, 0, verified.stderr);
  });
});

test("standard Android and iOS preparation is bound to both fail-closed preflights", async () => {
  const android = await readFile(
    resolve(root, "modules/pose-camera/android/build.gradle"),
    "utf8",
  );
  const podspec = await readFile(
    resolve(root, "modules/pose-camera/ios/PoseCamera.podspec"),
    "utf8",
  );

  assert.match(android, /tasks\.register\("verifyPinnedPoseModels", Exec\)/);
  assert.match(android, /fetch-web-vision-models\.mjs", "--verify"/);
  assert.match(android, /tasks\.register\("verifyRustAndroidOutputs", Exec\)/);
  assert.match(android, /preflight-native\.mjs", "android", "--artifacts"/);
  assert.match(android, /task\.dependsOn\("preparePoseCameraNative"\)/);

  assert.match(podspec, /fetch-web-vision-models\.mjs/);
  assert.match(podspec, /preflight-native\.mjs/);
  assert.match(podspec, /--verify/);
  assert.match(podspec, /'apple', '--artifacts'/);
  assert.match(podspec, /raise Pod::Informative/);
});

test("Android maps the CameraX frame timestamp once and shares it with Rust and FPS", async () => {
  const view = await readFile(
    resolve(
      root,
      "modules/pose-camera/android/src/main/java/expo/modules/posecamera/PoseCameraView.kt",
    ),
    "utf8",
  );

  assert.match(
    view,
    /val frameTimestampMs = cameraFrameTimestampMapper\.toMonotonicMilliseconds\(\s*imageProxy\.imageInfo\.timestamp\s*\)/,
  );
  assert.match(
    view,
    /processUprightFrame\(bitmap, frameTimestampMs, null, preprocessMs\)/,
  );
  assert.doesNotMatch(
    view,
    /processUprightFrame\(bitmap, SystemClock\.uptimeMillis\(\), null, preprocessMs\)/,
  );
  assert.match(view, /class CameraFrameTimestampMapper/);
  assert.match(view, /sourceTimestampNanos - sourceAnchorNanos/);
  assert.match(view, /maxOf\(lastMappedTimestampMs \+ 1L, derivedTimestampMs\)/);

  const processStart = view.indexOf("private fun processUprightFrame(");
  const processBody = view.slice(
    processStart,
    view.indexOf("// ---- 视频回放识别 ----", processStart),
  );
  assert.match(processBody, /current\.estimate\(bitmap, timestampMs\)/);
  assert.match(processBody, /MotionNative\.processObservations\(\s*timestampMs,/);
  assert.match(processBody, /val elapsedMs = timestampMs - metricsStartedAtMs/);
});
