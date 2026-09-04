#!/usr/bin/env bash
set -euo pipefail

CONTROL_PLANE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$CONTROL_PLANE_DIR"

if ! command -v bun >/dev/null 2>&1 || [[ "$(bun --version)" != "1.2.23" ]]; then
  echo "Bun 1.2.23 is required." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.12 or newer within major 22 is required." >&2
  exit 1
fi
NODE_VERSION="$(node --version)"
if ! node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  process.exit(major === 22 && minor >= 12 ? 0 : 1);
'; then
  echo "Node.js 22.12 or newer within major 22 is required; found ${NODE_VERSION:-an unknown version}." >&2
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
export GCLOUD_PROJECT=demo-miakapp-v4
export GOOGLE_CLOUD_PROJECT=demo-miakapp-v4
export FUNCTIONS_EMULATOR_HOST=127.0.0.1:5001

readonly FIRESTORE_EMULATOR_VERSION='1.19.4'
readonly FIRESTORE_EMULATOR_SIZE_BYTES='65913000'
readonly FIRESTORE_EMULATOR_SHA256='15acd294f527ecd1ab1b109e2e037e6612c4e5f3d52eeff2f1c33651b3058429'
readonly EMULATOR_CACHE_DIR="$CONTROL_PLANE_DIR/.firebase/emulators"
readonly FIRESTORE_EMULATOR_JAR="$EMULATOR_CACHE_DIR/cloud-firestore-emulator-v${FIRESTORE_EMULATOR_VERSION}.jar"

export FIRESTORE_EMULATOR_VERSION
export FIREBASE_EMULATORS_PATH="$EMULATOR_CACHE_DIR"

bun install --frozen-lockfile --no-progress
bun run typecheck
bun run test:unit
bun run build
node --check scripts/relay-integration-server.mjs
node --check scripts/setup-relay-integration.mjs
node deployment/check.mjs

mkdir -p "$EMULATOR_CACHE_DIR"
bunx firebase setup:emulators:firestore --non-interactive

if [[ ! -f "$FIRESTORE_EMULATOR_JAR" ]]; then
  echo "Pinned Firestore Emulator was not downloaded to $FIRESTORE_EMULATOR_JAR." >&2
  exit 1
fi

ACTUAL_FIRESTORE_EMULATOR_SIZE_BYTES="$(wc -c < "$FIRESTORE_EMULATOR_JAR" | tr -d '[:space:]')"
ACTUAL_FIRESTORE_EMULATOR_SHA256="$(
  node -e '
    const { createHash } = require("node:crypto");
    const { readFileSync } = require("node:fs");
    process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));
  ' "$FIRESTORE_EMULATOR_JAR"
)"

if [[ "$ACTUAL_FIRESTORE_EMULATOR_SIZE_BYTES" != "$FIRESTORE_EMULATOR_SIZE_BYTES" ]] || \
   [[ "$ACTUAL_FIRESTORE_EMULATOR_SHA256" != "$FIRESTORE_EMULATOR_SHA256" ]]; then
  echo "Pinned Firestore Emulator integrity verification failed." >&2
  echo "Expected ${FIRESTORE_EMULATOR_SIZE_BYTES} bytes and SHA-256 ${FIRESTORE_EMULATOR_SHA256}." >&2
  echo "Found ${ACTUAL_FIRESTORE_EMULATOR_SIZE_BYTES} bytes and SHA-256 ${ACTUAL_FIRESTORE_EMULATOR_SHA256}." >&2
  exit 1
fi

readonly -a ADMISSION_TEST_PATTERNS=(
  'atomically admits only the exact concurrent limit and records one saturation marker'
  'isolates subjects and resets the exact fixed window'
  'coalesces audit saturation into one bounded marker'
  'charges byte budgets by exact units rather than request count'
  'keeps early source-limit responses readable to an allowed browser origin'
  'keeps syntactically valid but unverified credentials anonymous in audit'
  'returns a correlated 429 before another Home Key reservation or signing effect'
  'keeps every admission, audit, and ring-state document server-only'
)
readonly -a EMULATOR_TEST_FILES=(
  'test/emulator/component-vertical-slice.test.ts'
  'test/emulator/push-vertical-slice.test.ts'
  'test/emulator/vertical-slice.test.ts'
)

run_emulator_test() {
  local test_command="$1"
  bunx firebase emulators:exec \
    --non-interactive \
    --project demo-miakapp-v4 \
    --config firebase.json \
    --only auth,firestore,functions,storage \
    "$test_command"
}

# Every case retains its real concurrent operations. Only the emulator process
# boundary is fresh, preventing an emulator-only lock from contaminating the
# next independent scenario.
for pattern in "${ADMISSION_TEST_PATTERNS[@]}"; do
  printf -v test_command \
    'node ./node_modules/vitest/vitest.mjs run --no-file-parallelism ./test/emulator/admission-vertical-slice.test.ts --testNamePattern %q' \
    "$pattern"
  run_emulator_test "$test_command"
done

for test_file in "${EMULATOR_TEST_FILES[@]}"; do
  run_emulator_test "node ./node_modules/vitest/vitest.mjs run --no-file-parallelism ./${test_file}"
done
