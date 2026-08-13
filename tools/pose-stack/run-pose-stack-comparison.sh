#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
comparison_python="${MAXPOWER_POSE_COMPARISON_PYTHON:-${repo_root}/.scratch/rtmpose-runtime/bin/python}"

if [[ ! -x "${comparison_python}" ]]; then
  echo "pose comparison runtime missing: ${comparison_python}" >&2
  exit 2
fi

cd "${repo_root}"
exec "${comparison_python}" tools/pose-stack/run_pose_stack_comparison.py "$@"
