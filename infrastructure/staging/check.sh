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
node --check infrastructure/staging/workload/update-apply.mjs
node --check infrastructure/staging/workload/update-plan.mjs
node --check infrastructure/staging/workload/validate-plan.mjs
node infrastructure/staging/workload/evidence.mjs \
  infrastructure/staging/workload/result.json
node infrastructure/staging/probe/guard.mjs \
  "${repository_root}/infrastructure/staging/probe"
node --check infrastructure/staging/probe/apply.mjs
node --check infrastructure/staging/probe/contract.mjs
node --check infrastructure/staging/probe/evidence.mjs
node --check infrastructure/staging/probe/guard.mjs
node --check infrastructure/staging/probe/invoke.mjs
node --check infrastructure/staging/probe/plan.mjs
node --check infrastructure/staging/probe/recover.mjs
node --check infrastructure/staging/probe/validate-plan.mjs
node infrastructure/staging/probe/evidence.mjs \
  infrastructure/staging/probe/result.json
node infrastructure/staging/firebase-auth/guard.mjs \
  "${repository_root}/infrastructure/staging/firebase-auth"
node --check infrastructure/staging/firebase-auth/apply.mjs
node --check infrastructure/staging/firebase-auth/cli.mjs
node --check infrastructure/staging/firebase-auth/contract.mjs
node --check infrastructure/staging/firebase-auth/evidence.mjs
node --check infrastructure/staging/firebase-auth/guard.mjs
node --check infrastructure/staging/firebase-auth/plan.mjs
node --check infrastructure/staging/firebase-auth/recovery-adopt.mjs
node --check infrastructure/staging/firebase-auth/recovery-apply.mjs
node --check infrastructure/staging/firebase-auth/recovery-plan.mjs
node --check infrastructure/staging/firebase-auth/recovery.mjs
node --check infrastructure/staging/firebase-auth/validate-plan.mjs
node infrastructure/staging/firebase-auth/evidence.mjs \
  infrastructure/staging/firebase-auth/result.json
node infrastructure/staging/auth-probe/guard.mjs \
  "${repository_root}/infrastructure/staging/auth-probe"
node --check infrastructure/staging/auth-probe/apply.mjs
node --check infrastructure/staging/auth-probe/cli.mjs
node --check infrastructure/staging/auth-probe/contract.mjs
node --check infrastructure/staging/auth-probe/evidence.mjs
node --check infrastructure/staging/auth-probe/guard.mjs
node --check infrastructure/staging/auth-probe/inventory.mjs
node --check infrastructure/staging/auth-probe/invoke.mjs
node --check infrastructure/staging/auth-probe/plan.mjs
node --check infrastructure/staging/auth-probe/retire-apply.mjs
node --check infrastructure/staging/auth-probe/retire-plan.mjs
node --check infrastructure/staging/auth-probe/retire-recovery-apply.mjs
node --check infrastructure/staging/auth-probe/retire-recovery-plan.mjs
node --check infrastructure/staging/auth-probe/retirement-recovery.mjs
node --check infrastructure/staging/auth-probe/validate-plan.mjs
node --check infrastructure/staging/auth-probe/verifier.mjs
node infrastructure/staging/auth-probe/evidence.mjs \
  infrastructure/staging/auth-probe/result.json \
  infrastructure/staging/auth-probe/retirement.json
node infrastructure/staging/browser-relay/guard.mjs \
  "${repository_root}/infrastructure/staging/browser-relay"
node --check infrastructure/staging/browser-relay/contract.mjs
node --check infrastructure/staging/browser-relay/guard.mjs
node --check infrastructure/staging/browser-relay/validate.mjs
node infrastructure/staging/browser-relay/validate.mjs \
  infrastructure/staging/browser-relay/plan.json
node infrastructure/staging/browser-relay-edge/guard.mjs \
  "${repository_root}/infrastructure/staging/browser-relay-edge"
node --check infrastructure/staging/browser-relay-edge/cloud.mjs
node --check infrastructure/staging/browser-relay-edge/guard.mjs
node --check infrastructure/staging/browser-relay-edge/inventory.mjs
node --check infrastructure/staging/browser-relay-edge/runtime.mjs
node --check infrastructure/staging/browser-relay-edge/window.mjs
node infrastructure/staging/browser-relay-runner/guard.mjs \
  "${repository_root}/infrastructure/staging/browser-relay-runner"
node --check infrastructure/staging/browser-relay-runner/contract.mjs
node --check infrastructure/staging/browser-relay-runner/driver.mjs
node --check infrastructure/staging/test/browser-relay-runner-browser.mjs
node -e "import('./infrastructure/staging/browser-relay-runner/contract.mjs').then(({ validateBrowserRelayRunnerProfile }) => validateBrowserRelayRunnerProfile())"
node infrastructure/staging/browser-relay-monitoring/guard.mjs \
  "${repository_root}/infrastructure/staging/browser-relay-monitoring"
node --check infrastructure/staging/browser-relay-monitoring/cloud.mjs
node --check infrastructure/staging/browser-relay-monitoring/contract.mjs
node --check infrastructure/staging/browser-relay-monitoring/guard.mjs
node -e "import('./infrastructure/staging/browser-relay-monitoring/contract.mjs').then(({ validateBrowserRelayMonitoringProfile }) => validateBrowserRelayMonitoringProfile())"
node -e "import('./infrastructure/staging/browser-relay-monitoring/contract.mjs').then(({ validateMonitoringPreflightResult }) => validateMonitoringPreflightResult())"
node infrastructure/staging/browser-relay-rollback/guard.mjs \
  "${repository_root}/infrastructure/staging/browser-relay-rollback"
node --check infrastructure/staging/browser-relay-rollback/cloud.mjs
node --check infrastructure/staging/browser-relay-rollback/contract.mjs
node --check infrastructure/staging/browser-relay-rollback/guard.mjs
node -e "import('./infrastructure/staging/browser-relay-rollback/contract.mjs').then(({ validateBrowserRelayRollbackProfile }) => validateBrowserRelayRollbackProfile())"
node -e "import('./infrastructure/staging/browser-relay-rollback/contract.mjs').then(({ validateRollbackPreflightResult }) => validateRollbackPreflightResult())"
node infrastructure/staging/browser-relay-orchestrator/guard.mjs \
  "${repository_root}/infrastructure/staging/browser-relay-orchestrator"
node --check infrastructure/staging/browser-relay-orchestrator/claim.mjs
node --check infrastructure/staging/browser-relay-orchestrator/contract.mjs
node --check infrastructure/staging/browser-relay-orchestrator/guard.mjs
node --check infrastructure/staging/browser-relay-orchestrator/orchestrator.mjs
node --check infrastructure/staging/browser-relay-orchestrator/preflight.mjs
node -e "import('./infrastructure/staging/browser-relay-orchestrator/contract.mjs').then(({ validateBrowserRelayOrchestratorProfile }) => validateBrowserRelayOrchestratorProfile())"
node -e "import('./infrastructure/staging/browser-relay-orchestrator/contract.mjs').then(({ validateOrchestratorPreflightResult }) => validateOrchestratorPreflightResult())"
node infrastructure/staging/browser-relay-operation/guard.mjs \
  "${repository_root}/infrastructure/staging/browser-relay-operation"
node --check infrastructure/staging/browser-relay-operation/contract.mjs
node --check infrastructure/staging/browser-relay-operation/guard.mjs
node --check infrastructure/staging/browser-relay-operation/operation.mjs
node --check infrastructure/staging/browser-relay-operation/preflight.mjs
node -e "import('./infrastructure/staging/browser-relay-operation/contract.mjs').then(({ validateBrowserRelayOperationProfile, validateOperationPreflightResult }) => { validateBrowserRelayOperationProfile(); validateOperationPreflightResult(); })"
node infrastructure/staging/browser-relay-services/guard.mjs \
  "${repository_root}/infrastructure/staging/browser-relay-services"
node --check infrastructure/staging/browser-relay-services/apply.mjs
node --check infrastructure/staging/browser-relay-services/claim.mjs
node --check infrastructure/staging/browser-relay-services/cli.mjs
node --check infrastructure/staging/browser-relay-services/contract.mjs
node --check infrastructure/staging/browser-relay-services/guard.mjs
node --check infrastructure/staging/browser-relay-services/inventory.mjs
node --check infrastructure/staging/browser-relay-services/plan.mjs
node --check infrastructure/staging/browser-relay-services/recovery-apply.mjs
node --check infrastructure/staging/browser-relay-services/recovery-claim.mjs
node --check infrastructure/staging/browser-relay-services/recovery-plan.mjs
node --check infrastructure/staging/browser-relay-services/ready-apply.mjs
node --check infrastructure/staging/browser-relay-services/ready-claim.mjs
node --check infrastructure/staging/browser-relay-services/ready-plan.mjs
node --check infrastructure/staging/browser-relay-services/validate-plan.mjs
for relay_script in \
  infrastructure/staging/browser-relay-services/apply.sh \
  infrastructure/staging/browser-relay-services/plan.sh \
  infrastructure/staging/browser-relay-services/recovery-apply.sh \
  infrastructure/staging/browser-relay-services/recovery-plan.sh \
  infrastructure/staging/browser-relay-services/ready-apply.sh \
  infrastructure/staging/browser-relay-services/ready-plan.sh; do
  bash -n "$relay_script"
done
node infrastructure/staging/browser-relay-services/contract.mjs \
  infrastructure/staging/browser-relay-services/profile.json
node infrastructure/staging/browser-relay-image/guard.mjs \
  "${repository_root}/infrastructure/staging/browser-relay-image"
node --check infrastructure/staging/browser-relay-image/apply.mjs
node --check infrastructure/staging/browser-relay-image/claim.mjs
node --check infrastructure/staging/browser-relay-image/cloud.mjs
node --check infrastructure/staging/browser-relay-image/contract.mjs
node --check infrastructure/staging/browser-relay-image/guard.mjs
node --check infrastructure/staging/browser-relay-image/inventory.mjs
node --check infrastructure/staging/browser-relay-image/plan.mjs
node --check infrastructure/staging/browser-relay-image/result.mjs
node --check infrastructure/staging/browser-relay-image/source.mjs
node infrastructure/staging/browser-attestation/guard.mjs \
  "${repository_root}/infrastructure/staging/browser-attestation"
node --check infrastructure/staging/browser-attestation/apply.mjs
node --check infrastructure/staging/browser-attestation/artifact.mjs
node --check infrastructure/staging/browser-attestation/browser.mjs
node --check infrastructure/staging/browser-attestation/claim.mjs
node --check infrastructure/staging/browser-attestation/contract.mjs
node --check infrastructure/staging/browser-attestation/guard.mjs
node --check infrastructure/staging/browser-attestation/hosting.mjs
node --check infrastructure/staging/browser-attestation/inventory.mjs
node --check infrastructure/staging/browser-attestation/plan.mjs
node --check infrastructure/staging/browser-attestation/preflight-evidence.mjs
node --check infrastructure/staging/browser-attestation/recovery-apply.mjs
node --check infrastructure/staging/browser-attestation/recovery-plan.mjs
node --check infrastructure/staging/browser-attestation/recovery.mjs
node infrastructure/staging/browser-attestation/preflight-evidence.mjs \
  infrastructure/staging/browser-attestation/preflight-result.json \
  infrastructure/staging/browser-attestation/preflight-v2-result.json \
  infrastructure/staging/browser-attestation/preflight-v3-result.json \
  infrastructure/staging/browser-attestation/preflight-v4-result.json \
  infrastructure/staging/browser-attestation/preflight-v5-result.json \
  infrastructure/staging/browser-attestation/preflight-v6-result.json
node infrastructure/staging/signing-overlap/guard.mjs \
  "${repository_root}/infrastructure/staging/signing-overlap"
node --check infrastructure/staging/signing-overlap/claim.mjs
node --check infrastructure/staging/signing-overlap/cli.mjs
node --check infrastructure/staging/signing-overlap/contract.mjs
node --check infrastructure/staging/signing-overlap/evidence.mjs
node --check infrastructure/staging/signing-overlap/guard.mjs
node --check infrastructure/staging/signing-overlap/inventory.mjs
node --check infrastructure/staging/signing-overlap/key-apply.mjs
node --check infrastructure/staging/signing-overlap/key-plan.mjs
node infrastructure/staging/signing-overlap/evidence.mjs \
  infrastructure/staging/signing-overlap/result.json
node infrastructure/staging/browser-app-check/guard.mjs \
  "${repository_root}/infrastructure/staging/browser-app-check"
node --check infrastructure/staging/browser-app-check/apply.mjs
node --check infrastructure/staging/browser-app-check/attempt-claim.mjs
node --check infrastructure/staging/browser-app-check/cli.mjs
node --check infrastructure/staging/browser-app-check/contract.mjs
node --check infrastructure/staging/browser-app-check/evidence.mjs
node --check infrastructure/staging/browser-app-check/guard.mjs
node --check infrastructure/staging/browser-app-check/inventory.mjs
node --check infrastructure/staging/browser-app-check/key-apply.mjs
node --check infrastructure/staging/browser-app-check/key-contract.mjs
node --check infrastructure/staging/browser-app-check/key-plan.mjs
node --check infrastructure/staging/browser-app-check/plan.mjs
node --check infrastructure/staging/browser-app-check/registration-apply.mjs
node --check infrastructure/staging/browser-app-check/registration-claim.mjs
node --check infrastructure/staging/browser-app-check/registration-contract.mjs
node --check infrastructure/staging/browser-app-check/registration-plan.mjs
node --check infrastructure/staging/browser-app-check/registration-recovery-apply.mjs
node --check infrastructure/staging/browser-app-check/registration-recovery-plan.mjs
node --check infrastructure/staging/browser-app-check/registration-recovery.mjs
node --check infrastructure/staging/browser-app-check/state.mjs
node --check infrastructure/staging/browser-app-check/validate-key-plan.mjs
node --check infrastructure/staging/browser-app-check/validate-plan.mjs
node --check infrastructure/staging/browser-app-check/validate-registration-plan.mjs
node infrastructure/staging/browser-app-check/evidence.mjs \
  infrastructure/staging/browser-app-check/result.json
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
  infrastructure/staging/workload/update-apply.sh \
  infrastructure/staging/workload/update-plan.sh \
  infrastructure/staging/probe/apply.sh \
  infrastructure/staging/probe/invoke.sh \
  infrastructure/staging/probe/recover.sh \
  infrastructure/staging/probe/plan.sh \
  infrastructure/staging/firebase-auth/apply.sh \
  infrastructure/staging/firebase-auth/plan.sh \
  infrastructure/staging/firebase-auth/recovery-adopt.sh \
  infrastructure/staging/firebase-auth/recovery-apply.sh \
  infrastructure/staging/firebase-auth/recovery-plan.sh \
  infrastructure/staging/auth-probe/apply.sh \
  infrastructure/staging/auth-probe/invoke.sh \
  infrastructure/staging/auth-probe/plan.sh \
  infrastructure/staging/auth-probe/retire-apply.sh \
  infrastructure/staging/auth-probe/retire-plan.sh \
  infrastructure/staging/auth-probe/retire-recovery-apply.sh \
  infrastructure/staging/auth-probe/retire-recovery-plan.sh \
  infrastructure/staging/browser-app-check/apply.sh \
  infrastructure/staging/browser-app-check/key-apply.sh \
  infrastructure/staging/browser-app-check/key-plan.sh \
  infrastructure/staging/browser-app-check/plan.sh \
  infrastructure/staging/browser-app-check/registration-apply.sh \
  infrastructure/staging/browser-app-check/registration-plan.sh \
  infrastructure/staging/browser-app-check/registration-recovery-apply.sh \
  infrastructure/staging/browser-app-check/registration-recovery-plan.sh \
  infrastructure/staging/browser-attestation/apply.sh \
  infrastructure/staging/browser-attestation/plan.sh \
  infrastructure/staging/browser-attestation/recovery-apply.sh \
  infrastructure/staging/browser-attestation/recovery-plan.sh \
  infrastructure/staging/browser-relay-image/apply.sh \
  infrastructure/staging/browser-relay-image/plan.sh \
  infrastructure/staging/browser-relay-services/apply.sh \
  infrastructure/staging/browser-relay-services/plan.sh \
  infrastructure/staging/browser-relay-services/recovery-apply.sh \
  infrastructure/staging/browser-relay-services/recovery-plan.sh \
  infrastructure/staging/signing-overlap/key-apply.sh \
  infrastructure/staging/signing-overlap/key-plan.sh
node --test \
  infrastructure/staging/test/activation.test.mjs \
  infrastructure/staging/test/auth-probe.test.mjs \
  infrastructure/staging/test/browser-app-check-api.test.mjs \
  infrastructure/staging/test/browser-app-check-key.test.mjs \
  infrastructure/staging/test/browser-app-check-registration.test.mjs \
  infrastructure/staging/test/browser-attestation.test.mjs \
  infrastructure/staging/test/browser-relay-edge.test.mjs \
  infrastructure/staging/test/browser-relay-image.test.mjs \
  infrastructure/staging/test/browser-relay-monitoring.test.mjs \
  infrastructure/staging/test/browser-relay-operation.test.mjs \
  infrastructure/staging/test/browser-relay-rollback.test.mjs \
  infrastructure/staging/test/browser-relay-runner.test.mjs \
  infrastructure/staging/test/browser-relay-services.test.mjs \
  infrastructure/staging/test/browser-relay.test.mjs \
  infrastructure/staging/test/bootstrap.test.mjs \
  infrastructure/staging/test/firebase-auth.test.mjs \
  infrastructure/staging/test/foundation-state.test.mjs \
  infrastructure/staging/test/github-policy.test.mjs \
  infrastructure/staging/test/probe.test.mjs \
  infrastructure/staging/test/signing-overlap.test.mjs \
  infrastructure/staging/test/validate.test.mjs \
  infrastructure/staging/test/terraform.test.mjs \
  infrastructure/staging/test/user-relay-verifier.test.mjs \
  infrastructure/staging/test/workload.test.mjs

for terraform_root in bootstrap terraform workload probe firebase-auth auth-probe browser-app-check browser-relay-services; do
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
