#!/bin/sh
set -eu

package_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "${package_root}/../../.." && pwd)

for source in \
  contract.mjs \
  framed-channel.mjs \
  guard.mjs \
  internal.mjs \
  owner-bundle.mjs \
  process.mjs \
  worker.mjs \
  test/helpers.mjs \
  test/contract.test.mjs \
  test/framed-channel.test.mjs \
  test/inert-import.test.mjs \
  test/owner-bundle.test.mjs \
  test/process.test.mjs \
  test/fixtures/hostile-peer.mjs \
  test/fixtures/uncooperative-descendant.mjs
do
  node --check "${package_root}/${source}"
done

node "${package_root}/guard.mjs" "${package_root}"
node --test \
  "${package_root}/test/contract.test.mjs" \
  "${package_root}/test/framed-channel.test.mjs" \
  "${package_root}/test/inert-import.test.mjs" \
  "${package_root}/test/owner-bundle.test.mjs" \
  "${package_root}/test/process.test.mjs"

cd "${repository_root}"
git diff --check
