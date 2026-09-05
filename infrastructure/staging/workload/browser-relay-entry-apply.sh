#!/usr/bin/env bash
set -euo pipefail

workload_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec node "${workload_root}/update-apply.mjs" --browser-relay-rotation-entry "$@"
