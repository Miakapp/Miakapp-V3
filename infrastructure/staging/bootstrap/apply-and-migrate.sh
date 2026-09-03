#!/usr/bin/env bash
set -euo pipefail

echo "The reviewed bootstrap plan has already been applied and this entry point is permanently retired." >&2
echo "Use migrate-recovered-state.sh with the exact preserved complete state after separate authorization." >&2
exit 1
