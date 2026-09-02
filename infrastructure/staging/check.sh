#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

node_version="$(node --version)"
node_major="${node_version#v}"
node_major="${node_major%%.*}"
if [[ "$node_major" != "22" ]]; then
  echo "The staging manifest gate requires Node.js 22; found ${node_version}." >&2
  exit 1
fi

if ! command -v terraform >/dev/null 2>&1; then
  echo "The staging plan gate requires Terraform 1.11.3." >&2
  exit 1
fi

terraform_version="$(terraform version -json | node -e 'let value=""; process.stdin.on("data", (chunk) => { value += chunk; }); process.stdin.on("end", () => { process.stdout.write(JSON.parse(value).terraform_version); });')"
if [[ "$terraform_version" != "1.11.3" ]]; then
  echo "The staging plan gate requires Terraform 1.11.3; found ${terraform_version}." >&2
  exit 1
fi

node infrastructure/staging/validate.mjs infrastructure/staging/manifest.json
node infrastructure/staging/automation/validate-policy.mjs \
  infrastructure/staging/automation/github-policy.json
node infrastructure/staging/automation/guard.mjs \
  "${repository_root}/infrastructure/staging/automation"
node infrastructure/staging/bootstrap/guard.mjs \
  "${repository_root}/infrastructure/staging/bootstrap"
node infrastructure/staging/terraform/guard.mjs \
  "${repository_root}/infrastructure/staging/terraform"
bash -n \
  infrastructure/staging/automation/apply.sh \
  infrastructure/staging/automation/inspect-plan.sh \
  infrastructure/staging/automation/plan.sh \
  infrastructure/staging/bootstrap/plan.sh \
  infrastructure/staging/terraform/plan.sh
node --test \
  infrastructure/staging/test/bootstrap.test.mjs \
  infrastructure/staging/test/github-policy.test.mjs \
  infrastructure/staging/test/validate.test.mjs \
  infrastructure/staging/test/terraform.test.mjs

for terraform_root in bootstrap terraform; do
  terraform_path="infrastructure/staging/${terraform_root}"
  terraform -chdir="$terraform_path" fmt -check -recursive
  export TF_CLI_CONFIG_FILE="${repository_root}/${terraform_path}/terraform-cli.tfrc"
  lock_before="$(node -e 'const { createHash } = require("node:crypto"); const { readFileSync } = require("node:fs"); process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));' "${terraform_path}/.terraform.lock.hcl")"
  terraform -chdir="$terraform_path" providers lock \
    -platform=darwin_arm64 \
    -platform=linux_amd64
  lock_after="$(node -e 'const { createHash } = require("node:crypto"); const { readFileSync } = require("node:fs"); process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));' "${terraform_path}/.terraform.lock.hcl")"
  if [[ "$lock_before" != "$lock_after" ]]; then
    echo "The ${terraform_root} provider lock did not contain the exact reviewed platform checksums." >&2
    exit 1
  fi
  terraform -chdir="$terraform_path" init \
    -backend=false \
    -input=false \
    -lockfile=readonly \
    -no-color
  terraform -chdir="$terraform_path" validate -no-color
  terraform -chdir="$terraform_path" test -no-color
done
