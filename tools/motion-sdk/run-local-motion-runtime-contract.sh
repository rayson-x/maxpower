#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

sh tools/motion-sdk/build-wasm.sh
"$repo_root/node_modules/.bin/tsc" -p tools/motion-sdk/tsconfig.local-motion-runtime-contract.json
node --test \
  .local-motion-runtime-contract-build/tools/motion-sdk/crossRuntimeLocalMotionParity.test.js \
  .local-motion-runtime-contract-build/tools/motion-sdk/realtimePerformanceContract.test.js
