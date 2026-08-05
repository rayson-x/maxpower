#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cargo_bin=$(rustup which cargo)
RUSTC=$(rustup which rustc)
RUSTDOC=$(rustup which rustdoc)
CARGO_TARGET_DIR="$repo_root/target-native"
export RUSTC RUSTDOC CARGO_TARGET_DIR

exec "$cargo_bin" test --manifest-path "$repo_root/Cargo.toml" -p form-coach-motion-sdk
