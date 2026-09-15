#!/usr/bin/env bash
# Decide whether the staging manifest safety gate has to do its work on this
# revision, and report the answer as the `changed` step output.
#
# This exists instead of an `on: paths:` filter because the gate's job name is a
# required status check on `main`. A filtered-out workflow reports no check at
# all, and an unreported required check blocks a pull request forever rather
# than passing it. The job therefore always runs; only its expensive steps are
# conditional.
#
# Every failure mode below runs the gate. Skipping is an optimisation, so an
# unknown change set has to fall back to the safe answer, never to the cheap
# one.
set -euo pipefail

# Every repository path whose change can alter this gate's verdict. A trailing
# slash means "this directory and everything under it".
# `infrastructure/staging/test/terraform.test.mjs` asserts that this list covers
# every file the gate actually reads.
INPUTS=(
  '.github/workflows/staging-manifest.yml'
  '.github/workflows/staging-manifest-scope.sh'
  'infrastructure/staging/'
  'package.json'
  'bun.lock'
)

run_the_gate() {
  echo "$1 — running the gate."
  echo 'changed=true' >>"${GITHUB_OUTPUT:-/dev/stdout}"
  exit 0
}

base="${BASE_SHA:-}"
head="${HEAD_SHA:-HEAD}"

if [ -z "$base" ] || [ "$base" = "0000000000000000000000000000000000000000" ]; then
  run_the_gate 'No comparable base revision'
fi

if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  run_the_gate "Base revision ${base} is not present in this checkout"
fi

if ! changed_files="$(git diff --name-only "$base" "$head" 2>&1)"; then
  run_the_gate "Could not diff ${base}..${head}: ${changed_files}"
fi

while IFS= read -r file; do
  [ -n "$file" ] || continue
  for input in "${INPUTS[@]}"; do
    case "$input" in
      */)
        if [ "${file#"$input"}" != "$file" ]; then
          run_the_gate "${file} is a gate input"
        fi
        ;;
      *)
        if [ "$file" = "$input" ]; then
          run_the_gate "${file} is a gate input"
        fi
        ;;
    esac
  done
done <<<"$changed_files"

echo "No staging manifest input changed between ${base} and ${head}."
echo 'changed=false' >>"${GITHUB_OUTPUT:-/dev/stdout}"
