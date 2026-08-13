#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
developer_dir=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
export DEVELOPER_DIR="$developer_dir"
sdk=$(/usr/bin/xcrun --sdk iphonesimulator --show-sdk-path)
build_dir=$(mktemp -d /tmp/maxpower-ios-halpe-parity.XXXXXX)
trap 'rm -rf "$build_dir"' EXIT

# Rebuild the same Rust static library used by the client before compiling the
# bridge harness. This keeps parity reproducible from a clean checkout instead
# of silently accepting a stale target-native-apple archive.
sh "$repo_root/tools/motion-sdk/build-native.sh" apple "$build_dir/apple-products"

simulator_id=${IOS_SIMULATOR_ID:-}
if [ -z "$simulator_id" ]; then
  simulator_id=$(/usr/bin/xcrun simctl list devices available -j \
    | /usr/bin/python3 -c 'import json,sys; value=json.load(sys.stdin); devices=[device for runtime in value["devices"].values() for device in runtime if device.get("isAvailable") and device.get("name", "").startswith("iPhone")]; booted=next((device for device in devices if device.get("state") == "Booted"), None); print((booted or devices[0])["udid"] if devices else "")')
fi
if [ -z "$simulator_id" ]; then
  echo "no available iPhone simulator" >&2
  exit 3
fi
if ! /usr/bin/xcrun simctl list devices booted -j \
  | /usr/bin/python3 -c 'import json,sys; expected=sys.argv[1]; value=json.load(sys.stdin); raise SystemExit(0 if any(device.get("udid") == expected for runtime in value["devices"].values() for device in runtime) else 1)' "$simulator_id"; then
  /usr/bin/xcrun simctl boot "$simulator_id" 2>/dev/null || true
  /usr/bin/xcrun simctl bootstatus "$simulator_id" -b
fi

case $(uname -m) in
  arm64)
    simulator_target=arm64-apple-ios16.4-simulator
    ;;
  x86_64)
    simulator_target=x86_64-apple-ios16.4-simulator
    ;;
  *)
    echo "unsupported macOS architecture: $(uname -m)" >&2
    exit 4
    ;;
esac

/usr/bin/xcrun --sdk iphonesimulator clang++ \
  -target "$simulator_target" \
  -isysroot "$sdk" \
  -mios-simulator-version-min=16.4 \
  -fobjc-arc \
  -std=c++17 \
  -I "$repo_root/modules/pose-camera/ios" \
  -I "$repo_root/modules/pose-camera/common" \
  "$repo_root/tools/motion-sdk/ios/RealHalpe26BridgeParity.mm" \
  "$repo_root/modules/pose-camera/ios/MotionBridge.mm" \
  "$repo_root/target-native-apple/ios-simulator-universal/libmaxpower_motion_sdk.a" \
  -framework Foundation \
  -o "$build_dir/RealHalpe26BridgeParity"

/usr/bin/xcrun simctl spawn "$simulator_id" \
  "$build_dir/RealHalpe26BridgeParity" \
  "$repo_root/tools/motion-sdk/fixtures/front-bench-mirror-halpe26-multi-candidate-v1.json" \
  "$repo_root/tools/motion-sdk/fixtures/front-bench-mirror-halpe26-multi-candidate-v1.rust-oracle.json"
