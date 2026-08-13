#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
developer_dir=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
export DEVELOPER_DIR="$developer_dir"
sdk=$(/usr/bin/xcrun --sdk iphonesimulator --show-sdk-path)
simulator_id=$(/usr/bin/xcrun simctl list devices booted -j \
  | /usr/bin/python3 -c 'import json,sys; value=json.load(sys.stdin); print(next(device["udid"] for runtime in value["devices"].values() for device in runtime if device.get("state") == "Booted"))')
build_dir=$(mktemp -d /tmp/maxpower-ios-halpe-parity.XXXXXX)
trap 'rm -rf "$build_dir"' EXIT

/usr/bin/xcrun --sdk iphonesimulator clang++ \
  -target arm64-apple-ios16.4-simulator \
  -isysroot "$sdk" \
  -mios-simulator-version-min=16.4 \
  -fobjc-arc \
  -std=c++17 \
  -I "$repo_root/modules/pose-camera/ios" \
  -I "$repo_root/modules/pose-camera/common" \
  "$repo_root/tools/motion-sdk/ios/RealHalpe26BridgeParity.mm" \
  "$repo_root/modules/pose-camera/ios/MotionBridge.mm" \
  "$repo_root/target-native-apple/aarch64-apple-ios-sim/release/libmaxpower_motion_sdk.a" \
  -framework Foundation \
  -o "$build_dir/RealHalpe26BridgeParity"

/usr/bin/xcrun simctl spawn "$simulator_id" \
  "$build_dir/RealHalpe26BridgeParity" \
  "$repo_root/tools/motion-sdk/fixtures/front-bench-mirror-halpe26-multi-candidate-v1.json" \
  "$repo_root/tools/motion-sdk/fixtures/front-bench-mirror-halpe26-multi-candidate-v1.rust-oracle.json"
