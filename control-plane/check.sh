#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

bun install --frozen-lockfile --no-progress
bun run typecheck
bun run test:unit
bun run build
