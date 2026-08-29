#!/usr/bin/env bash

set -euo pipefail

protocol_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

(
  cd "${protocol_root}/typescript"
  bun install --frozen-lockfile --no-progress
  bun run check
)

unformatted="$(gofmt -l "${protocol_root}/go")"
if [[ -n "${unformatted}" ]]; then
  echo "Go files require gofmt:"
  echo "${unformatted}"
  exit 1
fi

(
  cd "${protocol_root}/go"
  go test ./...
)
