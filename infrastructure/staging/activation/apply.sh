#!/usr/bin/env bash
set -euo pipefail
umask 077

activation_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec node "${activation_root}/apply.mjs" "$@"
