#!/usr/bin/env bash

set -euo pipefail

contract_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

(
  cd "${contract_root}/typescript"
  bun install --frozen-lockfile --no-progress
  bun run check
)

unformatted="$(gofmt -l "${contract_root}/go")"
if [[ -n "${unformatted}" ]]; then
  echo "Go files require gofmt:"
  echo "${unformatted}"
  exit 1
fi

(
  cd "${contract_root}/go"
  # The shared fixture lives outside the Go package directory, so bypass Go's
  # test cache to ensure every fixture edit is consumed by this implementation.
  go test -count=1 ./...
)
