#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
external_root="$project_root/data/external"
dataset=""
execute=0
allow_large=0
keep_archive=0

usage() {
  cat <<'EOF'
Usage: tools/external-datasets/fetch.sh --dataset DATASET [--execute] [--allow-large] [--keep-archive]

Datasets:
  mm-fit-pose-labels  Download the 1.74 GB official multimodal archive and keep only 2D/3D pose + labels.
  repcount-pose       9.52 GB archive. Refused unless --execute --allow-large and enough free space exist.

The default is a dry run. Downloads are resumable and external data lives under git-ignored data/external/.
EOF
}

while (($#)); do
  case "$1" in
    --dataset) dataset="${2:-}"; shift 2 ;;
    --execute) execute=1; shift ;;
    --allow-large) allow_large=1; shift ;;
    --keep-archive) keep_archive=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$dataset" ]]; then
  usage >&2
  exit 2
fi

mkdir -p "$external_root"

free_bytes() {
  df -k "$external_root" | awk 'NR == 2 { print $4 * 1024 }'
}

require_space() {
  local required="$1"
  local free
  free="$(free_bytes)"
  if ((free < required)); then
    printf 'Insufficient disk space: need %s bytes, free %s bytes.\n' "$required" "$free" >&2
    exit 1
  fi
}

download() {
  local url="$1"
  local output="$2"
  local expected_bytes="$3"
  mkdir -p "$(dirname "$output")"
  printf 'Source: %s\nDestination: %s\nExpected bytes: %s\n' "$url" "$output" "$expected_bytes"
  if ((execute == 0)); then
    printf 'Dry run only; pass --execute to download.\n'
    return
  fi
  curl --fail --location --continue-at - --output "$output" "$url"
  local actual_bytes
  actual_bytes="$(stat -f '%z' "$output")"
  if [[ "$actual_bytes" != "$expected_bytes" ]]; then
    printf 'Size mismatch: expected %s, got %s. Partial file retained for resume.\n' "$expected_bytes" "$actual_bytes" >&2
    exit 1
  fi
  shasum -a 256 "$output" | tee "$output.sha256"
}

case "$dataset" in
  mm-fit-pose-labels)
    archive="$external_root/mm-fit/raw/mm-fit.zip"
    destination="$external_root/mm-fit/pose-labels"
    expected_bytes=1742309258
    # Preserve at least 2 GiB after the compressed archive and selective extraction.
    require_space $((expected_bytes + 2 * 1024 * 1024 * 1024))
    download 'https://s3.eu-west-2.amazonaws.com/vradu.uk/mm-fit.zip' "$archive" "$expected_bytes"
    if ((execute == 0)); then exit 0; fi
    mkdir -p "$destination"
    unzip -o "$archive" \
      'mm-fit/*/*_pose_2d.npy' \
      'mm-fit/*/*_pose_3d.npy' \
      'mm-fit/*/*_labels.csv' \
      -d "$destination"
    find "$destination/mm-fit" -type f -exec shasum -a 256 {} \; > "$destination/SHA256SUMS.tmp"
    mv "$destination/SHA256SUMS.tmp" "$destination/SHA256SUMS"
    if ((keep_archive == 0)); then
      if [[ -f "$archive" ]]; then unlink "$archive"; fi
    fi
    ;;
  repcount-pose)
    expected_bytes=9517369897
    if ((allow_large == 0)); then
      printf 'Refusing the 9.52 GB RepCount-pose archive. Re-run with --allow-large only after freeing disk and confirming dataset rights.\n' >&2
      exit 1
    fi
    # Archive plus extraction headroom and a 2 GiB safety reserve.
    require_space $((expected_bytes * 2 + 2 * 1024 * 1024 * 1024))
    download 'https://drive.usercontent.google.com/download?id=1k9LLzOsJVh6ACXSX8iKbGNxTY9-L6X_x&export=download&confirm=t' \
      "$external_root/repcount-pose/raw/RepCount_pose.tar.gz" "$expected_bytes"
    ;;
  *)
    printf 'Unknown dataset: %s\n' "$dataset" >&2
    usage >&2
    exit 2
    ;;
esac
