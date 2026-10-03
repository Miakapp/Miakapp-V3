#!/usr/bin/env bash
# Two-house local proof: the public miakapp CLI against the real control plane
# in the Firebase emulators. See two-house-cli.mjs.
#
#   MIAKAPP_CLI_BIN=/path/to/MiakAPI/packages/cli/bin/miakapp.js \
#   JAVA_HOME=/path/to/jdk-21 PATH=/path/to/node-22/bin:$PATH \
#     ./test/e2e/run-two-house-cli.sh
set -euo pipefail

CONTROL_PLANE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$CONTROL_PLANE_DIR"

: "${MIAKAPP_CLI_BIN:?MIAKAPP_CLI_BIN must name the built miakapp CLI (packages/cli/bin/miakapp.js)}"
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }
java -version >/dev/null 2>&1 || { echo "Java 21 is required by the emulators" >&2; exit 1; }

export CI=1
export FIREBASE_CLI_DISABLE_UPDATE_CHECK=true
export GCLOUD_PROJECT=demo-miakapp-v4
export GOOGLE_CLOUD_PROJECT=demo-miakapp-v4
export FUNCTIONS_EMULATOR_HOST=127.0.0.1:5001
export FIRESTORE_EMULATOR_VERSION='1.19.4'
export FIREBASE_EMULATORS_PATH="$CONTROL_PLANE_DIR/.firebase/emulators"

bun run build >/dev/null
bunx firebase emulators:exec \
  --non-interactive \
  --project demo-miakapp-v4 \
  --config firebase.json \
  --only auth,firestore,functions,storage \
  "node ./test/e2e/two-house-cli.mjs"
