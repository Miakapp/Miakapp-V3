#!/usr/bin/env bash

set -euo pipefail

runtime_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "${runtime_root}"
bun install --frozen-lockfile --no-progress
bun run typecheck
bun run test:unit
bun run test:browser
