#!/usr/bin/env bash
set -euo pipefail

CONTROL_PLANE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$CONTROL_PLANE_DIR"

if ! command -v bun >/dev/null 2>&1 || [[ "$(bun --version)" != "1.2.23" ]]; then
  echo "Bun 1.2.23 is required." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 is required." >&2
  exit 1
fi
NODE_VERSION="$(node --version)"
if [[ "$NODE_VERSION" != v22.* ]]; then
  echo "Node.js 22 is required; found ${NODE_VERSION:-an unknown version}." >&2
  exit 1
fi

if [[ -z "${JAVA_HOME:-}" ]]; then
  for candidate in \
    /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
    /usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home; do
    if [[ -x "$candidate/bin/java" ]]; then
      export JAVA_HOME="$candidate"
      export PATH="$JAVA_HOME/bin:$PATH"
      break
    fi
  done
fi

if ! java -version >/dev/null 2>&1; then
  echo "Java 21 is required by the Firebase Local Emulator Suite." >&2
  exit 1
fi
JAVA_VERSION="$(java -version 2>&1 | awk -F '"' 'NR == 1 { print $2 }')"
if [[ "$JAVA_VERSION" != 21 && "$JAVA_VERSION" != 21.* ]]; then
  echo "Java 21 is required; found ${JAVA_VERSION:-an unknown version}." >&2
  exit 1
fi

export CI=1
export FIREBASE_CLI_DISABLE_UPDATE_CHECK=true
export GCLOUD_PROJECT=demo-miakapp-v35
export GOOGLE_CLOUD_PROJECT=demo-miakapp-v35
export FUNCTIONS_EMULATOR_HOST=127.0.0.1:5001

bun install --frozen-lockfile --no-progress
bun run typecheck
bun run test:unit
bun run build

bunx firebase emulators:exec \
  --non-interactive \
  --project demo-miakapp-v35 \
  --config firebase.json \
  --only auth,firestore,functions,storage \
  "bun run test:emulator"
