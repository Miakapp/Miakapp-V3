#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 0 ]]; then
  echo "Usage: MIAKAPP_STAGING_PLAN_CONFIRMATION=miakapp-v4-staging ./plan.sh" >&2
  exit 2
fi

terraform_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${terraform_root}/../../.." && pwd)"

if [[ "${MIAKAPP_STAGING_PLAN_CONFIRMATION:-}" != "miakapp-v4-staging" ]]; then
  echo "Set MIAKAPP_STAGING_PLAN_CONFIRMATION=miakapp-v4-staging to acknowledge the exact plan target." >&2
  exit 1
fi

for credential_variable in \
  GOOGLE_APPLICATION_CREDENTIALS \
  GOOGLE_CREDENTIALS \
  GOOGLE_CLOUD_KEYFILE_JSON \
  GOOGLE_CLOUD_CREDENTIALS \
  GCLOUD_KEYFILE_JSON; do
  if [[ -n "${!credential_variable:-}" ]]; then
    echo "Credential-file environment variables are forbidden; use local User ADC for read-only planning." >&2
    exit 1
  fi
done

while IFS='=' read -r -d '' environment_name environment_value; do
  if [[ -z "$environment_value" ]]; then
    continue
  fi
  case "$environment_name" in
    TF_*)
      echo "Terraform override environment variables are forbidden by the staging plan wrapper." >&2
      exit 1
      ;;
    GOOGLE_*|CLOUDSDK_*)
      echo "Google credential and endpoint overrides are forbidden; use local User ADC for read-only planning." >&2
      exit 1
      ;;
  esac
done < <(env -0)

node "${repository_root}/infrastructure/staging/validate.mjs" \
  "${repository_root}/infrastructure/staging/manifest.json"
node "${terraform_root}/guard.mjs" "${terraform_root}"

cd "$terraform_root"
export TF_CLI_CONFIG_FILE="${terraform_root}/terraform-cli.tfrc"
terraform fmt -check -recursive
terraform init -reconfigure -input=false -lockfile=readonly
terraform validate -no-color

export TF_IN_AUTOMATION=1

set +e
terraform plan -input=false -lock-timeout=5m -no-color -detailed-exitcode
plan_status="$?"
set -e

if [[ "$plan_status" -eq 0 || "$plan_status" -eq 2 ]]; then
  exit 0
fi
exit "$plan_status"
