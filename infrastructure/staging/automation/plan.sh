#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 0 ]]; then
  echo "Usage: plan.sh" >&2
  exit 2
fi

automation_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${automation_root}/../../.." && pwd -P)"
terraform_root="${repository_root}/infrastructure/staging/terraform"

if [[ "${GITHUB_ACTIONS:-}" != "true" || \
      "${GITHUB_REPOSITORY:-}" != "Miakapp/Miakapp-V3" || \
      "${GITHUB_REPOSITORY_ID:-}" != "354682190" || \
      "${GITHUB_REPOSITORY_OWNER_ID:-}" != "83046838" || \
      "${GITHUB_REF:-}" != "refs/heads/main" || \
      "${GITHUB_WORKFLOW_REF:-}" != "Miakapp/Miakapp-V3/.github/workflows/staging-terraform.yml@refs/heads/main" || \
      "${MIAKAPP_GITHUB_ENVIRONMENT:-}" != "miakapp-v4-staging-plan" ]]; then
  echo "The GitHub Actions plan context does not match the reviewed staging identity." >&2
  exit 1
fi

if [[ ! "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ || \
      ! "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ || \
      ! "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]]; then
  echo "The GitHub Actions run identifiers are not canonical." >&2
  exit 1
fi

if [[ -z "${GITHUB_OUTPUT:-}" || ! -f "$GITHUB_OUTPUT" || -L "$GITHUB_OUTPUT" ]]; then
  echo "GITHUB_OUTPUT must be a regular non-symlink runner file." >&2
  exit 1
fi

for required_name in GOOGLE_APPLICATION_CREDENTIALS CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE GOOGLE_GHA_CREDS_PATH; do
  if [[ -z "${!required_name:-}" || ! -f "${!required_name}" || -L "${!required_name}" ]]; then
    echo "The keyless Google credential file is missing." >&2
    exit 1
  fi
done

credential_path="$(cd "$(dirname "$GOOGLE_APPLICATION_CREDENTIALS")" && pwd)/$(basename "$GOOGLE_APPLICATION_CREDENTIALS")"
if [[ "$credential_path" != "$repository_root"/gha-creds-*.json || \
      "$CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE" != "$GOOGLE_APPLICATION_CREDENTIALS" || \
      "$GOOGLE_GHA_CREDS_PATH" != "$GOOGLE_APPLICATION_CREDENTIALS" ]]; then
  echo "The Google credential path was not created by the reviewed keyless action." >&2
  exit 1
fi

for project_name in GOOGLE_CLOUD_PROJECT GCLOUD_PROJECT GCP_PROJECT CLOUDSDK_PROJECT CLOUDSDK_CORE_PROJECT; do
  if [[ -n "${!project_name:-}" && "${!project_name}" != "miakapp-v4-staging" ]]; then
    echo "The Google project environment does not match the staging target." >&2
    exit 1
  fi
done
if [[ -n "${CLOUDSDK_CORE_DISABLE_PROMPTS:-}" && "$CLOUDSDK_CORE_DISABLE_PROMPTS" != "1" ]]; then
  echo "Interactive gcloud behavior is forbidden in staging automation." >&2
  exit 1
fi
if [[ "${CLOUDSDK_METRICS_ENVIRONMENT:-}" != "github-actions-setup-gcloud" || \
      "${CLOUDSDK_METRICS_ENVIRONMENT_VERSION:-}" != "3.0.1" ]]; then
  echo "The pinned setup-gcloud identity does not match the reviewed action." >&2
  exit 1
fi

while IFS='=' read -r -d '' environment_name environment_value; do
  if [[ -z "$environment_value" ]]; then
    continue
  fi
  case "$environment_name" in
    GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_GHA_CREDS_PATH|GOOGLE_CLOUD_PROJECT|GCLOUD_PROJECT|GCP_PROJECT|CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE|CLOUDSDK_PROJECT|CLOUDSDK_CORE_PROJECT|CLOUDSDK_CORE_DISABLE_PROMPTS|CLOUDSDK_METRICS_ENVIRONMENT|CLOUDSDK_METRICS_ENVIRONMENT_VERSION|TF_IN_AUTOMATION)
      ;;
    TF_*|GOOGLE_*|CLOUDSDK_*)
      echo "Unreviewed Terraform or Google overrides are forbidden in staging automation." >&2
      exit 1
      ;;
  esac
done < <(env -0)

for required_command in gcloud terraform node; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "The staging plan runner is missing ${required_command}." >&2
    exit 1
  fi
done

node "${repository_root}/infrastructure/staging/validate.mjs" \
  "${repository_root}/infrastructure/staging/manifest.json"
node "${terraform_root}/guard.mjs" "$terraform_root"

plan_file="${RUNNER_TEMP:?RUNNER_TEMP is required}/foundation.tfplan"
plan_log="${RUNNER_TEMP}/foundation-plan.log"
plan_object="gs://miakapp-v4-staging-tfstate-1072737219170/plans/${GITHUB_SHA}/${GITHUB_RUN_ID}/${GITHUB_RUN_ATTEMPT}/foundation.tfplan"
cleanup() {
  rm -f "$plan_file" "$plan_log"
}
trap cleanup EXIT

export TF_CLI_CONFIG_FILE="${terraform_root}/terraform-cli.tfrc"
export TF_IN_AUTOMATION=1
export CLOUDSDK_CORE_PROJECT="miakapp-v4-staging"
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

terraform -chdir="$terraform_root" fmt -check -recursive
terraform -chdir="$terraform_root" init -reconfigure -input=false -lockfile=readonly -no-color
terraform -chdir="$terraform_root" validate -no-color
if ! terraform -chdir="$terraform_root" plan \
  -input=false \
  -lock-timeout=5m \
  -no-color \
  -out="$plan_file" >"$plan_log" 2>&1; then
  echo "Terraform plan failed; detailed output remains private to the discarded runner file." >&2
  exit 1
fi

terraform -chdir="$terraform_root" show -json "$plan_file" \
  | node "${automation_root}/summarize-plan.mjs"

plan_sha256="$(shasum -a 256 "$plan_file" | awk '{print $1}')"
gcloud storage cp \
  "$plan_file" \
  "$plan_object" \
  --if-generation-match=0 \
  --quiet

printf 'plan-object=%s\nplan-sha256=%s\n' "$plan_object" "$plan_sha256" >>"$GITHUB_OUTPUT"
printf 'Private plan: %s\nSHA-256: %s\n' "$plan_object" "$plan_sha256"
