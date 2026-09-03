#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 0 ]]; then
  echo "Usage: plan.sh" >&2
  exit 2
fi

echo "The one-shot staging foundation recovery plan entrypoint is retired." >&2
exit 1
