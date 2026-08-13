#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
destination="$project_root/data/external/mm-fit/rgb"
record_id=7672767
split="train"
execute=0
reserve_bytes=$((8 * 1024 * 1024 * 1024))

usage() {
  cat <<'EOF'
Usage: tools/external-datasets/fetch-mmfit-rgb.sh [--split SPLIT] [--execute]

Splits: train, validation, test, unseen_test, all

Downloads the official CC-BY-4.0 MM-Fit RGB MP4 files from Zenodo record
7672767. The default is a dry run. Completed files are checked against the
official byte length and MD5; partial `.part` files are retained for resume.
EOF
}

while (($#)); do
  case "$1" in
    --split) split="${2:-}"; shift 2 ;;
    --execute) execute=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$split" in
  train) subjects=(01 02 03 04 06 07 08 16 17 18) ;;
  validation) subjects=(14 15 19) ;;
  test) subjects=(09 10 11) ;;
  unseen_test) subjects=(00 05 12 13 20) ;;
  all) subjects=(00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20) ;;
  *) printf 'Unknown MM-Fit split: %s\n' "$split" >&2; usage >&2; exit 2 ;;
esac

command -v curl >/dev/null || { printf 'curl is required\n' >&2; exit 1; }
command -v jq >/dev/null || { printf 'jq is required\n' >&2; exit 1; }
if command -v aria2c >/dev/null; then
  download_client="aria2c"
else
  download_client="curl"
fi

mkdir -p "$destination"
manifest="$destination/zenodo-record-${record_id}.json"
manifest_tmp="$manifest.tmp"
curl --fail --location --silent --show-error \
  "https://zenodo.org/api/records/$record_id" > "$manifest_tmp"
jq -e '.metadata.license.id == "cc-by-4.0" and (.files | length == 21)' \
  "$manifest_tmp" >/dev/null
mv "$manifest_tmp" "$manifest"

required_bytes=0
for subject in "${subjects[@]}"; do
  filename="w${subject}_rgb.mp4"
  size="$(jq -r --arg key "$filename" '.files[] | select(.key == $key) | .size' "$manifest")"
  if [[ -z "$size" || "$size" == "null" ]]; then
    printf 'Official manifest is missing %s\n' "$filename" >&2
    exit 1
  fi
  current=0
  [[ -f "$destination/$filename" ]] && current="$(stat -f '%z' "$destination/$filename")"
  if [[ -f "$destination/$filename.part.aria2" ]]; then
    # aria2 writes ranges into a sparse file. Neither logical nor allocated
    # size is a reliable completed-byte count, so reserve the full file size.
    current=0
  elif [[ -f "$destination/$filename.part" ]]; then
    current="$(stat -f '%z' "$destination/$filename.part")"
  fi
  if ((current < size)); then
    required_bytes=$((required_bytes + size - current))
  fi
done

free_bytes="$(df -k "$destination" | awk 'NR == 2 { print $4 * 1024 }')"
printf 'MM-Fit RGB split=%s files=%s remaining_bytes=%s free_bytes=%s reserve_bytes=%s\n' \
  "$split" "${#subjects[@]}" "$required_bytes" "$free_bytes" "$reserve_bytes"
if ((free_bytes < required_bytes + reserve_bytes)); then
  printf 'Insufficient disk space for this split while preserving the safety reserve.\n' >&2
  exit 1
fi
if ((execute == 0)); then
  printf 'Dry run only; pass --execute to download.\n'
  exit 0
fi

checksum_file="$destination/MD5SUMS.official"
: > "$checksum_file.tmp"
for subject in "${subjects[@]}"; do
  filename="w${subject}_rgb.mp4"
  checksum="$(jq -r --arg key "$filename" '.files[] | select(.key == $key) | .checksum' "$manifest")"
  printf '%s  %s\n' "${checksum#md5:}" "$filename" >> "$checksum_file.tmp"
done
mv "$checksum_file.tmp" "$checksum_file"

download_subject() {
  local subject="$1"
  local filename="w${subject}_rgb.mp4"
  local file="$destination/$filename"
  local partial="$file.part"
  local size checksum expected_md5 url actual_md5 actual_size
  file="$destination/$filename"
  partial="$file.part"
  size="$(jq -r --arg key "$filename" '.files[] | select(.key == $key) | .size' "$manifest")"
  checksum="$(jq -r --arg key "$filename" '.files[] | select(.key == $key) | .checksum' "$manifest")"
  expected_md5="${checksum#md5:}"
  url="$(jq -r --arg key "$filename" '.files[] | select(.key == $key) | .links.self' "$manifest")"

  if [[ -f "$file" ]] && [[ "$(stat -f '%z' "$file")" == "$size" ]]; then
    actual_md5="$(md5 -q "$file")"
    if [[ "$actual_md5" == "$expected_md5" ]]; then
      printf 'verified existing %s\n' "$filename"
      return
    fi
    printf 'Checksum mismatch for completed %s; refusing to overwrite it.\n' "$filename" >&2
    exit 1
  fi

  printf 'downloading %s (%s bytes)\n' "$filename" "$size"
  if [[ "$download_client" == "aria2c" ]]; then
    env -u all_proxy -u ALL_PROXY aria2c \
      --allow-overwrite=false \
      --auto-file-renaming=false \
      --connect-timeout=30 \
      --console-log-level=warn \
      --continue=true \
      --dir="$destination" \
      --file-allocation=none \
      --max-connection-per-server=8 \
      --max-tries=0 \
      --min-split-size=4M \
      --out="$filename.part" \
      --retry-wait=10 \
      --show-console-readout=false \
      --split=8 \
      --summary-interval=60 \
      --timeout=60 \
      "$url"
  else
    curl --fail --location --http1.1 --continue-at - --retry 20 --retry-all-errors --retry-delay 10 \
      --speed-time 120 --speed-limit 1024 --silent --show-error --output "$partial" "$url"
  fi
  actual_size="$(stat -f '%z' "$partial")"
  if [[ "$actual_size" != "$size" ]]; then
    printf 'Size mismatch for %s: expected %s, got %s; partial retained.\n' \
      "$filename" "$size" "$actual_size" >&2
    exit 1
  fi
  actual_md5="$(md5 -q "$partial")"
  if [[ "$actual_md5" != "$expected_md5" ]]; then
    printf 'MD5 mismatch for %s; partial retained for inspection.\n' "$filename" >&2
    exit 1
  fi
  mv "$partial" "$file"
  printf 'verified %s\n' "$filename"
}

# Each MP4 stays independently resumable and verifiable. The train split has
# ten files, and parallel sessions are needed because Zenodo throttles each
# connection heavily on this network.
parallelism=10
pids=()
for subject in "${subjects[@]}"; do
  download_subject "$subject" &
  pids+=("$!")
  if ((${#pids[@]} == parallelism)); then
    for pid in "${pids[@]}"; do wait "$pid"; done
    pids=()
  fi
done
if ((${#pids[@]} > 0)); then
  for pid in "${pids[@]}"; do wait "$pid"; done
fi
printf 'MM-Fit RGB split %s is complete in %s\n' "$split" "$destination"
