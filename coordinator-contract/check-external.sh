#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "Usage: ./coordinator-contract/check-external.sh <subject-module>" >&2
  exit 64
fi

contract_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
subject_directory="$(cd "$(dirname "$1")" && pwd)"
subject_module="${subject_directory}/$(basename "$1")"

cd "${contract_root}/../synthetic-home"
bun install --frozen-lockfile --no-progress
bun run build

cd "${contract_root}"
bun install --frozen-lockfile --no-progress
bun run build
exec node ./bin/check-subject.mjs "${subject_module}"
