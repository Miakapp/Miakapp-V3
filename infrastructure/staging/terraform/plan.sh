#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "$#" -ne 0 ]]; then
  echo "Usage: MIAKAPP_STAGING_PLAN_CONFIRMATION=miakapp-v4-staging ./plan.sh" >&2
  exit 2
fi

terraform_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd "${terraform_root}/../../.." && pwd -P)"

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

terraform_data="$(mktemp -d "${TMPDIR:-/tmp}/miakapp-staging-foundation-plan.XXXXXX")"
cleanup() {
  chmod -R u+rwX,go-rwx "$terraform_data" 2>/dev/null || true
  rm -rf -- "$terraform_data"
}
trap cleanup EXIT
terraform_data="$(cd "$terraform_data" && pwd -P)"
if [[ "$terraform_data" == "$repository_root" || "$terraform_data" == "$repository_root"/* ]]; then
  echo "Terraform working data must remain outside the repository." >&2
  exit 1
fi

cd "$terraform_root"
export TF_CLI_CONFIG_FILE="${terraform_root}/terraform-cli.tfrc"
export TF_DATA_DIR="$terraform_data"
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
