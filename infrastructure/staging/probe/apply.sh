#!/usr/bin/env bash
set -euo pipefail

probe_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec node "${probe_root}/apply.mjs" "$@"
