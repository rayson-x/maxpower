#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
developer_dir=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
export DEVELOPER_DIR="$developer_dir"
sdk=$(/usr/bin/xcrun --sdk iphonesimulator --show-sdk-path)
build_dir=$(mktemp -d /tmp/maxpower-ios-halpe-parity.XXXXXX)
trap 'rm -rf "$build_dir"' EXIT
fixture_path="$repo_root/tools/motion-sdk/fixtures/front-bench-mirror-halpe26-multi-candidate-v1.json"
oracle_path=${RUST_ORACLE_PATH:-}
if [ -z "$oracle_path" ]; then
  oracle_path="$build_dir/current-host-rust-oracle.json"
  cargo run \
    --manifest-path "$repo_root/rust/motion-sdk/Cargo.toml" \
    --release \
    --bin real_halpe26_bridge_oracle \
    -- \
    --fixture "$fixture_path" \
    --output "$oracle_path"
fi

case $(uname -m) in
  arm64)
    rust_target=aarch64-apple-ios-sim
    simulator_target=arm64-apple-ios16.4-simulator
    ;;
  x86_64)
    rust_target=x86_64-apple-ios
    simulator_target=x86_64-apple-ios16.4-simulator
    ;;
  *)
    echo "unsupported macOS architecture: $(uname -m)" >&2
    exit 4
    ;;
esac

# Build only the SDK library for the current simulator architecture. Building
# device + both simulator architectures (and every Rust binary) adds no parity
# coverage here and can exhaust a developer machine before the bridge runs.
cargo_bin=$(rustup which cargo)
RUSTC=$(rustup which rustc)
export RUSTC
DEVELOPER_DIR="$developer_dir" CARGO_TARGET_DIR="$build_dir/rust-target" \
  "$cargo_bin" build \
    --manifest-path "$repo_root/Cargo.toml" \
    -p maxpower-motion-sdk \
    --release \
    --target "$rust_target" \
    --lib
rust_library="$build_dir/rust-target/$rust_target/release/libmaxpower_motion_sdk.a"

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
  "$rust_library" \
  -framework Foundation \
  -o "$build_dir/RealHalpe26BridgeParity"

/usr/bin/xcrun simctl spawn "$simulator_id" \
  "$build_dir/RealHalpe26BridgeParity" \
  "$fixture_path" \
  "$oracle_path"
