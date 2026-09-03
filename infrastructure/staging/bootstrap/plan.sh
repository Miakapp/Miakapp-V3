#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "Usage: MIAKAPP_STAGING_BILLING_ACCOUNT_ID=... MIAKAPP_STAGING_BOOTSTRAP_CONFIRMATION=miakapp-v4-staging ./plan.sh <private-recovery-state>" >&2
  exit 2
fi

bootstrap_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${bootstrap_root}/../../.." && pwd)"
bundle_helper="${bootstrap_root}/saved-plan.mjs"
execution_helper="${bootstrap_root}/bootstrap-execution.mjs"

if [[ "${MIAKAPP_STAGING_BOOTSTRAP_CONFIRMATION:-}" != "miakapp-v4-staging" ]]; then
  echo "Set MIAKAPP_STAGING_BOOTSTRAP_CONFIRMATION=miakapp-v4-staging to acknowledge the exact bootstrap target." >&2
  exit 1
fi

if [[ -z "${MIAKAPP_STAGING_BILLING_ACCOUNT_ID:-}" ]]; then
  echo "MIAKAPP_STAGING_BILLING_ACCOUNT_ID is required for the approved account." >&2
  exit 1
fi

for credential_variable in \
  GOOGLE_APPLICATION_CREDENTIALS \
  GOOGLE_CREDENTIALS \
  GOOGLE_CLOUD_KEYFILE_JSON \
  GOOGLE_CLOUD_CREDENTIALS \
  GCLOUD_KEYFILE_JSON; do
  if [[ -n "${!credential_variable:-}" ]]; then
    echo "Credential-file environment variables are forbidden; use local User ADC for bootstrap planning." >&2
    exit 1
  fi
done

while IFS='=' read -r -d '' environment_name environment_value; do
  if [[ -z "$environment_value" ]]; then
    continue
  fi
  case "$environment_name" in
    TF_*)
      echo "Terraform override environment variables are forbidden by the bootstrap plan wrapper." >&2
      exit 1
      ;;
    GOOGLE_*|CLOUDSDK_*)
      echo "Google credential and endpoint overrides are forbidden; use local User ADC for bootstrap planning." >&2
      exit 1
      ;;
  esac
done < <(env -0)

approved_fingerprint="4557923f1be719b78ee844b14bfa4654be3eb3fa785a2cb5a2624c3f85d12270"
actual_fingerprint="$(node -e 'const { createHash } = require("node:crypto"); process.stdout.write(createHash("sha256").update(process.env.MIAKAPP_STAGING_BILLING_ACCOUNT_ID).digest("hex"));')"
if [[ "$actual_fingerprint" != "$approved_fingerprint" ]]; then
  echo "The supplied billing account is not the reviewed staging account." >&2
  exit 1
fi

node "${repository_root}/infrastructure/staging/validate.mjs" \
  "${repository_root}/infrastructure/staging/manifest.json"
node "${bootstrap_root}/guard.mjs" "${bootstrap_root}"
node "$execution_helper" verify-recovery-state "$1" "$repository_root" >/dev/null
recovery_state="$(cd "$(dirname "$1")" && pwd -P)/$(basename "$1")"
recovery_state_sha256="$(node "$bundle_helper" sha256 "$recovery_state")"

cd "$bootstrap_root"
export TF_CLI_CONFIG_FILE="${bootstrap_root}/terraform-cli.tfrc"
terraform fmt -check -recursive
terraform init -backend=false -input=false -lockfile=readonly
terraform validate -no-color

export TF_IN_AUTOMATION=1
export TF_VAR_billing_account_id="$MIAKAPP_STAGING_BILLING_ACCOUNT_ID"
unset MIAKAPP_STAGING_BILLING_ACCOUNT_ID

set +e
terraform plan \
  -input=false \
  -lock=false \
  -no-color \
  -detailed-exitcode \
  -state="$recovery_state"
plan_status="$?"
set -e

if [[ "$(node "$bundle_helper" sha256 "$recovery_state")" != "$recovery_state_sha256" ]]; then
  echo "Terraform changed the preserved recovery state while planning." >&2
  exit 1
fi

if [[ "$plan_status" -eq 0 || "$plan_status" -eq 2 ]]; then
  exit 0
fi
exit "$plan_status"
