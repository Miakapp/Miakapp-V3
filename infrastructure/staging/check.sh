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
node infrastructure/staging/activation/guard.mjs \
  "${repository_root}/infrastructure/staging/activation"
node infrastructure/staging/bootstrap/guard.mjs \
  "${repository_root}/infrastructure/staging/bootstrap"
node --check infrastructure/staging/bootstrap/bootstrap-execution.mjs
node --check infrastructure/staging/bootstrap/saved-plan.mjs
node --check infrastructure/staging/automation/validate-foundation-plan.mjs
node --check infrastructure/staging/activation/apply.mjs
node --check infrastructure/staging/activation/cloud.mjs
node --check infrastructure/staging/activation/contract.mjs
node --check infrastructure/staging/activation/evidence.mjs
node --check infrastructure/staging/activation/plan.mjs
node infrastructure/staging/activation/evidence.mjs \
  infrastructure/staging/activation/result.json \
  infrastructure/staging/activation/runtime-config.json
node --check infrastructure/staging/terraform/foundation-state.mjs
node infrastructure/staging/terraform/guard.mjs \
  "${repository_root}/infrastructure/staging/terraform"
node infrastructure/staging/workload/guard.mjs \
  "${repository_root}/infrastructure/staging/workload"
node --check infrastructure/staging/workload/apply.mjs
node --check infrastructure/staging/workload/contract.mjs
node --check infrastructure/staging/workload/evidence.mjs
node --check infrastructure/staging/workload/guard.mjs
node --check infrastructure/staging/workload/inventory.mjs
node --check infrastructure/staging/workload/plan.mjs
node --check infrastructure/staging/workload/validate-plan.mjs
node infrastructure/staging/workload/evidence.mjs \
  infrastructure/staging/workload/result.json
node infrastructure/staging/probe/guard.mjs \
  "${repository_root}/infrastructure/staging/probe"
node --check infrastructure/staging/probe/apply.mjs
node --check infrastructure/staging/probe/contract.mjs
node --check infrastructure/staging/probe/guard.mjs
node --check infrastructure/staging/probe/invoke.mjs
node --check infrastructure/staging/probe/plan.mjs
node --check infrastructure/staging/probe/validate-plan.mjs
bash -n \
  infrastructure/staging/automation/apply.sh \
  infrastructure/staging/automation/inspect-plan.sh \
  infrastructure/staging/automation/plan.sh \
  infrastructure/staging/activation/apply.sh \
  infrastructure/staging/activation/plan.sh \
  infrastructure/staging/bootstrap/apply-and-migrate.sh \
  infrastructure/staging/bootstrap/inspect-plan.sh \
  infrastructure/staging/bootstrap/plan.sh \
  infrastructure/staging/bootstrap/save-plan.sh \
  infrastructure/staging/terraform/initialize-state.sh \
  infrastructure/staging/terraform/plan.sh \
  infrastructure/staging/workload/apply.sh \
  infrastructure/staging/workload/plan.sh \
  infrastructure/staging/probe/apply.sh \
  infrastructure/staging/probe/invoke.sh \
  infrastructure/staging/probe/plan.sh
node --test \
  infrastructure/staging/test/activation.test.mjs \
  infrastructure/staging/test/bootstrap.test.mjs \
  infrastructure/staging/test/foundation-state.test.mjs \
  infrastructure/staging/test/github-policy.test.mjs \
  infrastructure/staging/test/probe.test.mjs \
  infrastructure/staging/test/validate.test.mjs \
  infrastructure/staging/test/terraform.test.mjs \
  infrastructure/staging/test/workload.test.mjs

for terraform_root in bootstrap terraform workload probe; do
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
