#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_root="$project_root/data/workflows/motion-profile/runtime/mmfit-mediapipe"
venv="$runtime_root/.venv"
requirements="$project_root/tools/external-fitness-data/mmfit-rgb-runtime-requirements.txt"
bundled_python="${PYTHON:-python3}"

command -v uv >/dev/null || { printf 'uv is required\n' >&2; exit 1; }
command -v ffmpeg >/dev/null || { printf 'ffmpeg is required\n' >&2; exit 1; }
command -v ffprobe >/dev/null || { printf 'ffprobe is required\n' >&2; exit 1; }

if [[ ! -x "$venv/bin/python" ]]; then
  mkdir -p "$runtime_root"
  if [[ -x "$bundled_python" ]]; then
    uv venv --python "$bundled_python" "$venv"
  else
    uv venv --python 3.12 "$venv"
  fi
fi

# Intentionally avoid MediaPipe's unrelated legacy/model-maker dependency set.
uv pip install --no-deps --python "$venv/bin/python" --requirement "$requirements"

PYTHONPATH="$project_root/tools/external-fitness-data" "$venv/bin/python" -c \
  'from extract_mmfit_rgb_pose import load_mediapipe_tasks_runtime; runtime = load_mediapipe_tasks_runtime(); assert runtime.version == "0.10.21"; assert runtime.BaseOptions.Delegate.CPU.name == "CPU"; print("MM-Fit RGB runtime ready: mediapipe=0.10.21 delegate=CPU decoder=ffmpeg")'
