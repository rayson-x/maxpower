#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
platform=${1:-}
output_dir=${2:-}

# Homebrew may put a standalone `rustc` ahead of rustup's proxy. Cargo then
# sees rustup-installed targets but invokes a compiler whose sysroot does not
# contain them. Keep cargo and rustc on the same rustup toolchain explicitly.
cargo_bin=$(rustup which cargo)
RUSTC=$(rustup which rustc)
export RUSTC

if [ -z "$platform" ] || [ -z "$output_dir" ]; then
  echo "usage: build-native.sh <android|apple> <output-dir>" >&2
  exit 2
fi

mkdir -p "$output_dir"

if [ "$platform" = "android" ]; then
  android_sdk=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}
  : "${ANDROID_NDK_HOME:=$android_sdk/ndk/27.1.12297006}"
  export ANDROID_NDK_HOME
  CARGO_TARGET_DIR="$repo_root/target-native-android" \
    "$cargo_bin" ndk \
      -t armeabi-v7a \
      -t arm64-v8a \
      -t x86 \
      -t x86_64 \
      -o "$output_dir" \
      build --manifest-path "$repo_root/Cargo.toml" -p maxpower-motion-sdk --release
  exit 0
fi

if [ "$platform" = "apple" ]; then
  developer_dir=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
  target_dir="$repo_root/target-native-apple"
  DEVELOPER_DIR="$developer_dir" CARGO_TARGET_DIR="$target_dir" \
    "$cargo_bin" build -p maxpower-motion-sdk --release --target aarch64-apple-ios
  DEVELOPER_DIR="$developer_dir" CARGO_TARGET_DIR="$target_dir" \
    "$cargo_bin" build -p maxpower-motion-sdk --release --target aarch64-apple-ios-sim
  DEVELOPER_DIR="$developer_dir" CARGO_TARGET_DIR="$target_dir" \
    "$cargo_bin" build -p maxpower-motion-sdk --release --target x86_64-apple-ios
  simulator_dir="$target_dir/ios-simulator-universal"
  mkdir -p "$simulator_dir"
  DEVELOPER_DIR="$developer_dir" /usr/bin/xcrun lipo -create \
    "$target_dir/aarch64-apple-ios-sim/release/libmaxpower_motion_sdk.a" \
    "$target_dir/x86_64-apple-ios/release/libmaxpower_motion_sdk.a" \
    -output "$simulator_dir/libmaxpower_motion_sdk.a"
  rm -rf "$output_dir/MotionSdk.xcframework"
  DEVELOPER_DIR="$developer_dir" /usr/bin/xcrun xcodebuild -create-xcframework \
    -library "$target_dir/aarch64-apple-ios/release/libmaxpower_motion_sdk.a" \
    -headers "$repo_root/modules/pose-camera/common" \
    -library "$simulator_dir/libmaxpower_motion_sdk.a" \
    -headers "$repo_root/modules/pose-camera/common" \
    -output "$output_dir/MotionSdk.xcframework"
  exit 0
fi

echo "unsupported platform: $platform" >&2
exit 2
