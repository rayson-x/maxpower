#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python_runtime="$project_root/data/workflows/motion-profile/runtime/mmfit-mediapipe/.venv/bin/python"
extractor="$project_root/tools/external-fitness-data/extract_mmfit_rgb_pose.py"
merger="$project_root/tools/external-fitness-data/merge_mmfit_rgb_pose_shards.py"
rgb_root="$project_root/data/external/mm-fit/rgb"
native_root="$project_root/data/external/mm-fit/native-mediapipe33-heavy"
shards_root="$native_root/shards"
official_manifest="$rgb_root/zenodo-record-7672767.json"
parallelism=4

while (($#)); do
  case "$1" in
    --parallel) parallelism="${2:-}"; shift 2 ;;
    -h|--help)
      printf 'Usage: tools/external-fitness-data/extract_mmfit_rgb_train.sh [--parallel N]\n'
      exit 0
      ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[[ "$parallelism" =~ ^[1-9][0-9]*$ ]] || { printf 'parallelism must be a positive integer\n' >&2; exit 2; }
[[ -x "$python_runtime" ]] || { printf 'Run npm run setup:mmfit:rgb-runtime first\n' >&2; exit 1; }
[[ -f "$official_manifest" ]] || { printf 'Missing official Zenodo manifest: %s\n' "$official_manifest" >&2; exit 1; }
command -v jq >/dev/null || { printf 'jq is required\n' >&2; exit 1; }
command -v md5 >/dev/null || { printf 'md5 is required\n' >&2; exit 1; }

subjects=(01 02 03 04 06 07 08 16 17 18)
for subject in "${subjects[@]}"; do
  filename="w${subject}_rgb.mp4"
  file="$rgb_root/$filename"
  expected_size="$(jq -r --arg key "$filename" '.files[] | select(.key == $key) | .size' "$official_manifest")"
  expected_md5="$(jq -r --arg key "$filename" '.files[] | select(.key == $key) | .checksum' "$official_manifest")"
  if [[ ! -f "$file" ]] || [[ "$(stat -f '%z' "$file" 2>/dev/null || true)" != "$expected_size" ]]; then
    printf 'MM-Fit train RGB is incomplete: %s\n' "$filename" >&2
    exit 1
  fi
  if [[ "$(md5 -q "$file")" != "${expected_md5#md5:}" ]]; then
    printf 'MM-Fit train RGB failed official MD5: %s\n' "$filename" >&2
    exit 1
  fi
done

mkdir -p "$shards_root"
pids=()
labels=()
wait_batch() {
  local index
  for index in "${!pids[@]}"; do
    if ! wait "${pids[$index]}"; then
      printf 'MM-Fit RGB extraction failed for %s; inspect %s/%s/extract.log\n' \
        "${labels[$index]}" "$shards_root" "${labels[$index]}" >&2
      exit 1
    fi
  done
  pids=()
  labels=()
}

for subject in "${subjects[@]}"; do
  session="w$subject"
  shard="$shards_root/$session"
  if [[ -f "$shard/manifest.json" ]]; then
    printf 'reusing completed shard %s\n' "$session"
    continue
  fi
  mkdir -p "$shard"
  printf 'extracting shard %s\n' "$session"
  "$python_runtime" "$extractor" \
    --splits train \
    --sessions "$session" \
    --output "$shard" \
    > "$shard/extract.log" 2>&1 &
  pids+=("$!")
  labels+=("$session")
  if ((${#pids[@]} == parallelism)); then
    wait_batch
  fi
done
if ((${#pids[@]})); then wait_batch; fi

"$python_runtime" "$merger" \
  --shards-root "$shards_root" \
  --normalized-manifest "$project_root/data/external/mm-fit/normalized/manifest.json" \
  --output "$native_root"
