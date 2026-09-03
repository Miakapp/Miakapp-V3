#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "$#" -ne 2 ]]; then
  echo "Usage: MIAKAPP_STAGING_BOOTSTRAP_MIGRATION_AUTHORIZATION=... ./migrate-recovered-state.sh <private-plan-bundle> <private-complete-state>" >&2
  exit 2
fi

bootstrap_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd "${bootstrap_root}/../../.." && pwd -P)"
bundle_helper="${bootstrap_root}/saved-plan.mjs"
execution_helper="${bootstrap_root}/bootstrap-execution.mjs"
approved_configuration_commit="e9f410c58c8cbbf8f5f7a17170c9e8ed55a10501"
approved_migration_configuration_commit="b2daada96d4f5f669bb80fd3cdfc0e0f9fb48286"
approved_recovery_state_sha256="07fc7412e35efaff288e2efd30f786c2871d9fa836fb813a178d247ccb1efe5a"
approved_plan_sha256="12927b270f2bfa78c8f8c8c7e7071ce9cfec18d5e848165c04b585260bd5f7da"
completed_state_sha256="c083e7a05f2ccf273abda98c0739584336d2cbaffd8ea836b65b0790f94833a2"
project_id="miakapp-v4-staging"
state_bucket="miakapp-v4-staging-tfstate-1072737219170"
state_object="terraform/bootstrap/default.tfstate"

migration_authorization="${MIAKAPP_STAGING_BOOTSTRAP_MIGRATION_AUTHORIZATION:-}"
unset MIAKAPP_STAGING_BOOTSTRAP_MIGRATION_AUTHORIZATION

for credential_variable in \
  GOOGLE_APPLICATION_CREDENTIALS \
  GOOGLE_CREDENTIALS \
  GOOGLE_CLOUD_KEYFILE_JSON \
  GOOGLE_CLOUD_CREDENTIALS \
  GCLOUD_KEYFILE_JSON; do
  if [[ -n "${!credential_variable:-}" ]]; then
    echo "Credential-file environment variables are forbidden; use local User ADC for bootstrap state migration." >&2
    exit 1
  fi
done

while IFS='=' read -r -d '' environment_name environment_value; do
  if [[ -z "$environment_value" ]]; then
    continue
  fi
  case "$environment_name" in
    TF_*)
      echo "Terraform override environment variables are forbidden by the bootstrap state-migration wrapper." >&2
      exit 1
      ;;
    GOOGLE_*|CLOUDSDK_*)
      echo "Google credential and endpoint overrides are forbidden; use local User ADC for bootstrap state migration." >&2
      exit 1
      ;;
    GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_CEILING_DIRECTORIES|GIT_CONFIG|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_*|GIT_CONFIG_VALUE_*)
      echo "Git repository overrides are forbidden by the bootstrap state-migration wrapper." >&2
      exit 1
      ;;
    HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy)
      echo "Network proxy overrides are forbidden by the bootstrap state-migration wrapper." >&2
      exit 1
      ;;
  esac
done < <(env -0)

for required_command in cp find gcloud git grep node terraform; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Bootstrap state migration requires ${required_command}." >&2
    exit 1
  fi
done

observed_repository_root="$(git -C "$repository_root" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$observed_repository_root" || "$(cd "$observed_repository_root" && pwd -P)" != "$repository_root" ]]; then
  echo "Bootstrap state migration must run from the reviewed repository." >&2
  exit 1
fi
current_commit="$(git -C "$repository_root" rev-parse HEAD)"
if [[ ! "$current_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Bootstrap state migration requires a canonical repository commit." >&2
  exit 1
fi
node "$execution_helper" verify-migration-authorization \
  "$migration_authorization" \
  "$current_commit"
unset migration_authorization
if [[ -n "$(git -C "$repository_root" status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "Bootstrap state migration requires a clean Git checkout." >&2
  exit 1
fi
if ! git -C "$repository_root" merge-base --is-ancestor \
  "$approved_migration_configuration_commit" \
  "$current_commit"; then
  echo "The reviewed bootstrap migration configuration is not an ancestor of this checkout." >&2
  exit 1
fi

reviewed_configuration=(
  infrastructure/staging/bootstrap/.terraform.lock.hcl
  infrastructure/staging/bootstrap/backend.gcs.tf.example
  infrastructure/staging/bootstrap/billing.tf
  infrastructure/staging/bootstrap/iam.tf
  infrastructure/staging/bootstrap/identity.tf
  infrastructure/staging/bootstrap/imports.tf
  infrastructure/staging/bootstrap/locals.tf
  infrastructure/staging/bootstrap/outputs.tf
  infrastructure/staging/bootstrap/providers.tf
  infrastructure/staging/bootstrap/state.tf
  infrastructure/staging/bootstrap/terraform-cli.tfrc
  infrastructure/staging/bootstrap/variables.tf
  infrastructure/staging/bootstrap/versions.tf
)
if ! git -C "$repository_root" diff --quiet --no-ext-diff \
  "$approved_configuration_commit" "$current_commit" -- "${reviewed_configuration[@]}"; then
  echo "The current bootstrap Terraform configuration differs from the configuration that produced the preserved state." >&2
  exit 1
fi

node "${repository_root}/infrastructure/staging/validate.mjs" \
  "${repository_root}/infrastructure/staging/manifest.json"
node "${bootstrap_root}/guard.mjs" "$bootstrap_root"

node "$bundle_helper" verify \
  "$1" \
  "$approved_configuration_commit" \
  "$approved_recovery_state_sha256" >/dev/null
bundle="$(cd "$1" && pwd -P)"
metadata_file="${bundle}/metadata.json"
plan_file="${bundle}/bootstrap.tfplan"
actual_plan_sha256="$(node "$bundle_helper" sha256 "$plan_file")"
if [[ "$actual_plan_sha256" != "$approved_plan_sha256" ]]; then
  echo "The private saved plan is not the plan that produced the preserved complete state." >&2
  exit 1
fi
unset actual_plan_sha256

node "$execution_helper" verify-completed-state \
  "$2" \
  "$metadata_file" \
  "$repository_root" \
  "$completed_state_sha256" >/dev/null
completed_state="$(cd "$(dirname "$2")" && pwd -P)/$(basename "$2")"

bundle_lock="${bundle}.migration-lock"
if ! mkdir -m 700 -- "$bundle_lock" 2>/dev/null; then
  echo "This exact private bootstrap bundle already has an active migration lock." >&2
  exit 1
fi
state_lock="${completed_state}.migration-lock"
if ! mkdir -m 700 -- "$state_lock" 2>/dev/null; then
  rmdir -- "$bundle_lock"
  echo "The exact completed bootstrap state already has an active migration lock." >&2
  exit 1
fi

execution=''
execution_complete=false
cleanup() {
  if [[ "$execution_complete" == true && -n "$execution" && -d "$execution" ]]; then
    rm -rf -- "$execution"
  elif [[ -n "$execution" && -d "$execution" ]]; then
    chmod -R go-rwx "$execution" 2>/dev/null || true
    echo "Bootstrap state migration did not complete; private recovery material was preserved at ${execution}." >&2
  fi
  if ! rmdir -- "$bundle_lock" 2>/dev/null; then
    echo "The private bootstrap bundle migration lock could not be removed; inspect ${bundle_lock} before another run." >&2
  fi
  if ! rmdir -- "$state_lock" 2>/dev/null; then
    echo "The completed-state migration lock could not be removed; inspect ${state_lock} before another run." >&2
  fi
}
trap cleanup EXIT

terraform_version="$(terraform version -json | node -e 'let value=""; process.stdin.on("data", (chunk) => { value += chunk; }); process.stdin.on("end", () => { const parsed = JSON.parse(value); process.stdout.write(typeof parsed.terraform_version === "string" ? parsed.terraform_version : ""); });')"
if [[ "$terraform_version" != "1.11.3" ]]; then
  echo "Bootstrap state migration requires Terraform 1.11.3; found ${terraform_version:-unknown}." >&2
  exit 1
fi

execution="$(node "$execution_helper" create-directory "$bundle" "$repository_root")"
cloud_log="${execution}/cloud.log"
migration_log="${execution}/terraform-migration.log"
provider_data="${execution}/terraform-data"
remote_state="${execution}/remote-bootstrap.tfstate"
apply_root="${execution}/apply"
local_state="${apply_root}/terraform.tfstate"
mkdir -m 700 "$provider_data" "$apply_root"
cp -p -- "$completed_state" "$local_state"
chmod 600 "$local_state"
node "$execution_helper" verify-completed-state \
  "$local_state" \
  "$metadata_file" \
  "$repository_root" \
  "$completed_state_sha256" >/dev/null

run_gcloud_json() {
  local output_file="$1"
  shift
  if ! gcloud "$@" --format=json --quiet >"$output_file" 2>>"$cloud_log"; then
    echo "A bounded bootstrap cloud-inventory query failed; details remain in the private recovery directory." >&2
    return 1
  fi
}

run_gcloud_json "${execution}/project.json" projects describe "$project_id"
node "$execution_helper" verify-project <"${execution}/project.json"
run_gcloud_json "${execution}/billing.json" billing projects describe "$project_id"
billing_account_id="$(node "$execution_helper" verify-billing-link <"${execution}/billing.json")"
if ! gcloud billing budgets list \
  "--billing-account=${billing_account_id}" \
  "--billing-project=${project_id}" \
  --format=json \
  --quiet >"${execution}/budgets.json" 2>>"$cloud_log"; then
  echo "The bootstrap budget could not be queried with the staging quota project." >&2
  exit 1
fi
node "$execution_helper" verify-provisioned-targets budgets <"${execution}/budgets.json"
unset billing_account_id

run_gcloud_json "${execution}/services.json" services list \
  --enabled \
  "--project=${project_id}"
node "$execution_helper" verify-enabled-bootstrap-services <"${execution}/services.json"
run_gcloud_json "${execution}/buckets.json" storage buckets list "--project=${project_id}"
node "$execution_helper" verify-provisioned-targets storage-buckets <"${execution}/buckets.json"
run_gcloud_json "${execution}/service-accounts.json" iam service-accounts list "--project=${project_id}"
node "$execution_helper" verify-provisioned-targets service-accounts \
  <"${execution}/service-accounts.json"
run_gcloud_json "${execution}/workload-identity-pools.json" iam workload-identity-pools list \
  "--project=${project_id}" \
  --location=global
node "$execution_helper" verify-provisioned-targets workload-identity-pools \
  <"${execution}/workload-identity-pools.json"
run_gcloud_json "${execution}/workload-identity-providers.json" iam workload-identity-pools providers list \
  --workload-identity-pool=miakapp-github \
  "--project=${project_id}" \
  --location=global
node "$execution_helper" verify-provisioned-targets workload-identity-providers \
  <"${execution}/workload-identity-providers.json"

if ! gcloud storage ls \
  --recursive \
  --json \
  "gs://${state_bucket}" >"${execution}/state-bucket-before.json" 2>>"$cloud_log"; then
  echo "The private state bucket could not be inspected before migration." >&2
  exit 1
fi
node "$execution_helper" verify-empty-state-bucket <"${execution}/state-bucket-before.json"

for source_name in \
  billing.tf \
  iam.tf \
  identity.tf \
  imports.tf \
  locals.tf \
  outputs.tf \
  providers.tf \
  state.tf \
  variables.tf \
  versions.tf \
  .terraform.lock.hcl \
  terraform-cli.tfrc; do
  cp -p -- "${bootstrap_root}/${source_name}" "${apply_root}/${source_name}"
done

export TF_CLI_CONFIG_FILE="${apply_root}/terraform-cli.tfrc"
export TF_DATA_DIR="$provider_data"
export TF_IN_AUTOMATION=1
terraform -chdir="$apply_root" fmt -check -recursive
terraform -chdir="$apply_root" init \
  -backend=false \
  -input=false \
  -lockfile=readonly \
  -no-color >"$migration_log" 2>&1
terraform -chdir="$apply_root" validate -no-color >>"$migration_log" 2>&1
if ! terraform -chdir="$apply_root" show -json "$plan_file" 2>>"$migration_log" \
  | node "$bundle_helper" verify-plan "$metadata_file"; then
  echo "The saved Terraform plan no longer decodes to the metadata that produced the preserved state." >&2
  exit 1
fi

node "$execution_helper" verify-completed-state \
  "$completed_state" \
  "$metadata_file" \
  "$repository_root" \
  "$completed_state_sha256" >/dev/null
cp -p -- "${bootstrap_root}/backend.gcs.tf.example" "${apply_root}/backend.tf"
if ! terraform -chdir="$apply_root" init \
  -migrate-state \
  -force-copy \
  -input=false \
  -lock-timeout=5m \
  -lockfile=readonly \
  -no-color >>"$migration_log" 2>&1; then
  echo "Bootstrap state migration failed; the protected complete state was preserved." >&2
  exit 1
fi

if ! terraform -chdir="$apply_root" state pull >"$remote_state" 2>>"$migration_log"; then
  echo "The migrated bootstrap state could not be read back; the protected complete state was preserved." >&2
  exit 1
fi
chmod 600 "$remote_state"
run_gcloud_json "${execution}/state-object.json" storage objects describe \
  "gs://${state_bucket}/${state_object}"
node "$execution_helper" verify-state-object <"${execution}/state-object.json"
node "$execution_helper" reconcile-state \
  "$completed_state" \
  "$remote_state" \
  "$metadata_file" \
  migrated-complete
node "$execution_helper" verify-completed-state \
  "$completed_state" \
  "$metadata_file" \
  "$repository_root" \
  "$completed_state_sha256" >/dev/null

if [[ -n "$(git -C "$repository_root" status --porcelain=v1 --untracked-files=all)" ]] \
  || find "${repository_root}/infrastructure/staging" -type f \
    \( -name '*.tfstate' -o -name '*.tfstate.*' -o -name '*.tfplan' \) -print -quit | grep -q .; then
  echo "Bootstrap state migration contaminated the repository; private recovery material was preserved." >&2
  exit 1
fi

execution_complete=true
echo "The exact preserved bootstrap state was migrated and reconciled in the private GCS backend."
echo "The authoritative private source state remains unchanged outside the repository."
