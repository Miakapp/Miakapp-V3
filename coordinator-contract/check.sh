#!/usr/bin/env bash

set -euo pipefail

contract_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "${contract_root}/../synthetic-home"
bun install --frozen-lockfile --no-progress
bun run build

cd "${contract_root}"
bun install --frozen-lockfile --no-progress
bun run check
