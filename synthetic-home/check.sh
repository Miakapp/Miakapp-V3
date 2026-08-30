#!/usr/bin/env bash

set -euo pipefail

fixture_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "${fixture_root}"
bun install --frozen-lockfile --no-progress
bun run check
