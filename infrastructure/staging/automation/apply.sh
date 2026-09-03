#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 0 ]]; then
  echo "Usage: apply.sh" >&2
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
      "${MIAKAPP_GITHUB_ENVIRONMENT:-}" != "miakapp-v4-staging-apply" ]]; then
  echo "The GitHub Actions apply context does not match the reviewed staging identity." >&2
  exit 1
fi

if [[ ! "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ || \
      ! "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ || \
      ! "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]]; then
  echo "The GitHub Actions run identifiers are not canonical." >&2
  exit 1
fi

expected_object="gs://miakapp-v4-staging-tfstate-1072737219170/plans/${GITHUB_SHA}/${GITHUB_RUN_ID}/${GITHUB_RUN_ATTEMPT}/foundation.tfplan"
if [[ "${MIAKAPP_PLAN_OBJECT:-}" != "$expected_object" || \
      ! "${MIAKAPP_PLAN_SHA256:-}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "The apply job did not receive the exact plan produced by this workflow attempt." >&2
  exit 1
fi

node "${automation_root}/validate-policy.mjs" \
  --require-apply-activation \
  "${automation_root}/github-policy.json"

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
    echo "The staging apply runner is missing ${required_command}." >&2
    exit 1
  fi
done

node "${repository_root}/infrastructure/staging/validate.mjs" \
  "${repository_root}/infrastructure/staging/manifest.json"
node "${terraform_root}/guard.mjs" "$terraform_root"

plan_file="${RUNNER_TEMP:?RUNNER_TEMP is required}/foundation.tfplan"
apply_log="${RUNNER_TEMP}/foundation-apply.log"
verification_log="${RUNNER_TEMP}/foundation-verification.log"
cleanup() {
  rm -f "$plan_file" "$apply_log" "$verification_log"
}
trap cleanup EXIT

export TF_CLI_CONFIG_FILE="${terraform_root}/terraform-cli.tfrc"
export TF_IN_AUTOMATION=1
export CLOUDSDK_CORE_PROJECT="miakapp-v4-staging"
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

gcloud storage cp "$MIAKAPP_PLAN_OBJECT" "$plan_file" --quiet
actual_sha256="$(shasum -a 256 "$plan_file" | awk '{print $1}')"
if [[ "$actual_sha256" != "$MIAKAPP_PLAN_SHA256" ]]; then
  echo "The private Terraform plan digest does not match the approved digest." >&2
  exit 1
fi

terraform -chdir="$terraform_root" fmt -check -recursive
terraform -chdir="$terraform_root" init -reconfigure -input=false -lockfile=readonly -no-color
terraform -chdir="$terraform_root" validate -no-color
terraform -chdir="$terraform_root" show -json "$plan_file" \
  | node "${automation_root}/validate-foundation-plan.mjs"
terraform -chdir="$terraform_root" show -json "$plan_file" \
  | node "${automation_root}/summarize-plan.mjs"
if ! terraform -chdir="$terraform_root" apply \
  -input=false \
  -lock-timeout=5m \
  -no-color \
  "$plan_file" >"$apply_log" 2>&1; then
  echo "Terraform apply failed; detailed output remains private to the discarded runner file." >&2
  exit 1
fi

set +e
terraform -chdir="$terraform_root" plan \
  -detailed-exitcode \
  -input=false \
  -lock-timeout=5m \
  -no-color >"$verification_log" 2>&1
verification_status="$?"
set -e
case "$verification_status" in
  0)
    echo "The exact reviewed staging foundation plan was applied and converged successfully."
    ;;
  1)
    echo "Post-apply foundation verification failed; detailed output remains private to the discarded runner file." >&2
    exit 1
    ;;
  2)
    echo "The applied staging foundation did not converge to an empty follow-up plan." >&2
    exit 1
    ;;
  *)
    echo "Terraform returned an invalid post-apply verification status." >&2
    exit 1
    ;;
esac
