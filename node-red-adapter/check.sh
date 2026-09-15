#!/usr/bin/env bash

set -euo pipefail

adapter_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "${adapter_root}"

# npm rather than bun: the subject is a Node-RED runtime and the published v3
# node, so the harness runs on Node and pins its tree with package-lock.json.
npm ci --no-audit --no-fund

npm test
