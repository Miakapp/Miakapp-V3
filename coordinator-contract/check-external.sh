#!/usr/bin/env bash

set -euo pipefail

profile="all"
subject_argument=""
if [[ "$#" -eq 1 ]]; then
  subject_argument="$1"
elif [[ "$#" -eq 3 && "$1" == "--profile" ]]; then
  profile="$2"
  subject_argument="$3"
fi

if [[ -z "${subject_argument}" || ! "${profile}" =~ ^(sdk|migration|all)$ ]]; then
  echo "Usage: ./coordinator-contract/check-external.sh [--profile sdk|migration|all] <subject-module>" >&2
  exit 64
fi

contract_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
subject_directory="$(cd "$(dirname "${subject_argument}")" && pwd)"
subject_module="${subject_directory}/$(basename "${subject_argument}")"

cd "${contract_root}/../synthetic-home"
bun install --frozen-lockfile --no-progress
bun run build

cd "${contract_root}"
bun install --frozen-lockfile --no-progress
bun run build
exec node ./bin/check-subject.mjs --profile "${profile}" "${subject_module}"
