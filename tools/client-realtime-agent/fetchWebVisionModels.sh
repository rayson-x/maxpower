#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
execute=false
if [[ "${1:-}" == "--execute" ]]; then
  execute=true
elif [[ -n "${1:-}" && "${1:-}" != "--verify" ]]; then
  printf 'usage: %s [--verify|--execute]\n' "$0" >&2
  exit 2
fi

command -v shasum >/dev/null || { printf 'shasum is required\n' >&2; exit 1; }
command -v stat >/dev/null || { printf 'stat is required\n' >&2; exit 1; }
if $execute; then
  command -v curl >/dev/null || { printf 'curl is required\n' >&2; exit 1; }
  command -v unzip >/dev/null || { printf 'unzip is required\n' >&2; exit 1; }
fi

verify_file() {
  local path="$1"
  local expected_bytes="$2"
  local expected_sha="$3"
  [[ -f "$path" ]] || return 1
  local actual_bytes actual_sha
  actual_bytes="$(stat -f '%z' "$path")"
  actual_sha="$(shasum -a 256 "$path" | awk '{print $1}')"
  [[ "$actual_bytes" == "$expected_bytes" && "$actual_sha" == "$expected_sha" ]]
}

fetch_model() {
  local id="$1"
  local url="$2"
  local destination="$3"
  local expected_bytes="$4"
  local expected_sha="$5"
  local destination_path="$project_root/$destination"
  if verify_file "$destination_path" "$expected_bytes" "$expected_sha"; then
    printf 'verified %s %s\n' "$id" "$expected_sha"
    return
  fi
  if ! $execute; then
    printf 'missing-or-invalid %s %s\n' "$id" "$destination" >&2
    return 1
  fi

  local temporary_root archive member
  temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/maxpower-web-vision.XXXXXX")"
  archive="$temporary_root/model.zip"
  trap 'rm -rf "$temporary_root"' RETURN
  curl --fail --location --retry 5 --output "$archive" "$url"
  member="$(unzip -Z1 "$archive" | awk '/\/end2end\.onnx$/ { print; exit }')"
  [[ -n "$member" ]] || { printf 'end2end.onnx missing from %s\n' "$url" >&2; return 1; }
  unzip -p "$archive" "$member" > "$temporary_root/end2end.onnx"
  verify_file "$temporary_root/end2end.onnx" "$expected_bytes" "$expected_sha" || {
    printf 'checksum mismatch for %s\n' "$id" >&2
    return 1
  }
  mkdir -p "$(dirname "$destination_path")"
  install -m 0644 "$temporary_root/end2end.onnx" "$destination_path"
  printf 'installed %s %s\n' "$id" "$destination"
}

fetch_model \
  'yolox-nano-humanart-416x416' \
  'https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/yolox_nano_8xb8-300e_humanart-40f6f0d0.zip' \
  'public/models/yolox-nano-humanart-416x416.onnx' \
  '3722395' \
  '1450966de24902b18aada1a78913d7efd8fc8dcd51bd4d0d5591476bd4a38821'

fetch_model \
  'rtmpose-m-halpe26-256x192' \
  'https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605.zip' \
  'public/models/rtmpose-m-halpe26-256x192.onnx' \
  '55685444' \
  '26f3a19e61304a600dfb82d1001d41d24343b89fc70a33ffc84657e0b0bf2ecf'
