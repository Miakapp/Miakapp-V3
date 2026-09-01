#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

node_version="$(node --version)"
node_major="${node_version#v}"
node_major="${node_major%%.*}"
if [[ "$node_major" != "22" ]]; then
  echo "The staging manifest gate requires Node.js 22; found ${node_version}." >&2
  exit 1
fi

node infrastructure/staging/validate.mjs infrastructure/staging/manifest.json
node --test infrastructure/staging/test/validate.test.mjs
