#!/bin/sh
set -eu

package_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "${package_root}/../../.." && pwd)

for source in contract.mjs guard.mjs internal.mjs publisher.mjs testing.mjs
do
  node --check "${package_root}/${source}"
done

node "${package_root}/guard.mjs" "${package_root}"
node --test "${repository_root}/infrastructure/staging/test/browser-relay-hosting-publisher.test.mjs"
node "${repository_root}/infrastructure/staging/validate.mjs" \
  "${repository_root}/infrastructure/staging/manifest.json"

cd "${repository_root}"
git diff --check
