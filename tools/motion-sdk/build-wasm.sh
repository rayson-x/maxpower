#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
target_dir="$repo_root/target-wasm"
output_dir="$repo_root/public/motion-sdk"

RUSTC="${RUSTC:-/Users/Ruihan/.cargo/bin/rustc}" \
CARGO_TARGET_DIR="$target_dir" \
  /Users/Ruihan/.cargo/bin/cargo build \
  --manifest-path "$repo_root/Cargo.toml" \
  -p maxpower-motion-sdk \
  --target wasm32-unknown-unknown \
  --release

mkdir -p "$output_dir"
cp "$target_dir/wasm32-unknown-unknown/release/maxpower_motion_sdk.wasm" "$output_dir/"
