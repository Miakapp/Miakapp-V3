#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 0 ]]; then
  echo "Usage: apply.sh" >&2
  exit 2
fi

echo "The one-shot staging foundation recovery apply entrypoint is retired." >&2
exit 1
