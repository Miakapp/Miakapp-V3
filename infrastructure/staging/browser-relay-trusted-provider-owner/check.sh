#!/bin/sh
set -eu

package_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "${package_root}/../../.." && pwd)

for source in \
  browser.mjs \
  bundle.mjs \
  contract.mjs \
  entry.mjs \
  guard.mjs \
  internal.mjs \
  operation.mjs \
  owner.mjs \
  page-host.mjs \
  source-truth.mjs \
  testing.mjs \
  ../test/browser-relay-trusted-provider-owner.test.mjs \
  ../test/browser-relay-trusted-provider-owner-bundle.test.mjs \
  ../test/browser-relay-trusted-provider-owner-browser.mjs
do
  node --check "${package_root}/${source}"
done

node "${package_root}/guard.mjs" "${package_root}"
node --test \
  "${package_root}/../test/browser-relay-trusted-provider-owner.test.mjs" \
  "${package_root}/../test/browser-relay-trusted-provider-owner-bundle.test.mjs"

if [ "${MIAKAPP_RUN_TRUSTED_PROVIDER_OWNER_BROWSER:-0}" = "1" ]; then
  node "${package_root}/../test/browser-relay-trusted-provider-owner-browser.mjs"
fi

cd "${repository_root}"
git diff --check
