#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "$#" -ne 1 ]]; then
  echo "Usage: MIAKAPP_STAGING_BOOTSTRAP_EXECUTION_AUTHORIZATION=... ./apply-and-migrate.sh <private-plan-bundle>" >&2
  exit 2
fi

bootstrap_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd "${bootstrap_root}/../../.." && pwd -P)"
bundle_helper="${bootstrap_root}/saved-plan.mjs"
execution_helper="${bootstrap_root}/bootstrap-execution.mjs"
approved_configuration_commit="6340bffbddcc4797067ef48170fc5c3524345bf2"
approved_plan_sha256="6fb0b0c15fa04338a40ab59de790c3a4a85f96b418377c4a70570a8dabd5d457"
project_id="miakapp-v4-staging"
state_bucket="miakapp-v4-staging-tfstate-1072737219170"
state_object="terraform/bootstrap/default.tfstate"

node "$execution_helper" verify-authorization \
  "${MIAKAPP_STAGING_BOOTSTRAP_EXECUTION_AUTHORIZATION:-}"
unset MIAKAPP_STAGING_BOOTSTRAP_EXECUTION_AUTHORIZATION

for credential_variable in \
  GOOGLE_APPLICATION_CREDENTIALS \
  GOOGLE_CREDENTIALS \
  GOOGLE_CLOUD_KEYFILE_JSON \
  GOOGLE_CLOUD_CREDENTIALS \
  GCLOUD_KEYFILE_JSON; do
  if [[ -n "${!credential_variable:-}" ]]; then
    echo "Credential-file environment variables are forbidden; use local User ADC for bootstrap execution." >&2
    exit 1
  fi
done

while IFS='=' read -r -d '' environment_name environment_value; do
  if [[ -z "$environment_value" ]]; then
    continue
  fi
  case "$environment_name" in
    TF_*)
      echo "Terraform override environment variables are forbidden by the bootstrap execution wrapper." >&2
      exit 1
      ;;
    GOOGLE_*|CLOUDSDK_*)
      echo "Google credential and endpoint overrides are forbidden; use local User ADC for bootstrap execution." >&2
      exit 1
      ;;
    GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_CEILING_DIRECTORIES|GIT_CONFIG|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_*|GIT_CONFIG_VALUE_*)
      echo "Git repository overrides are forbidden by the bootstrap execution wrapper." >&2
      exit 1
      ;;
    HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy)
      echo "Network proxy overrides are forbidden by the bootstrap execution wrapper." >&2
      exit 1
      ;;
  esac
done < <(env -0)

for required_command in cp find gcloud git node terraform; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Bootstrap execution requires ${required_command}." >&2
    exit 1
  fi
done

observed_repository_root="$(git -C "$repository_root" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$observed_repository_root" || "$(cd "$observed_repository_root" && pwd -P)" != "$repository_root" ]]; then
  echo "Bootstrap execution must run from the reviewed repository." >&2
  exit 1
fi
if [[ -n "$(git -C "$repository_root" status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "Bootstrap execution requires a clean Git checkout." >&2
  exit 1
fi
current_commit="$(git -C "$repository_root" rev-parse HEAD)"
if [[ ! "$current_commit" =~ ^[0-9a-f]{40}$ ]] \
  || ! git -C "$repository_root" merge-base --is-ancestor "$approved_configuration_commit" "$current_commit"; then
  echo "The reviewed bootstrap configuration commit is not an ancestor of this checkout." >&2
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
  echo "The current bootstrap Terraform configuration differs from the configuration that produced the reviewed plan." >&2
  exit 1
fi

node "${repository_root}/infrastructure/staging/validate.mjs" \
  "${repository_root}/infrastructure/staging/manifest.json"
node "${bootstrap_root}/guard.mjs" "$bootstrap_root"

node "$bundle_helper" verify "$1" "$approved_configuration_commit" >/dev/null
bundle="$(cd "$1" && pwd -P)"
execution_lock="${bundle}.execution-lock"
if ! mkdir -m 700 -- "$execution_lock" 2>/dev/null; then
  echo "This exact private bootstrap bundle already has an active execution lock." >&2
  exit 1
fi

execution=''
execution_complete=false
cleanup() {
  if [[ "$execution_complete" == true && -n "$execution" && -d "$execution" ]]; then
    rm -rf -- "$execution"
  elif [[ -n "$execution" && -d "$execution" ]]; then
    chmod -R go-rwx "$execution" 2>/dev/null || true
    echo "Bootstrap execution did not complete; private recovery material was preserved at ${execution}." >&2
  fi
  if ! rmdir -- "$execution_lock" 2>/dev/null; then
    echo "The private bootstrap execution lock could not be removed; inspect ${execution_lock} before another run." >&2
  fi
}
trap cleanup EXIT

terraform_version="$(terraform version -json | node -e 'let value=""; process.stdin.on("data", (chunk) => { value += chunk; }); process.stdin.on("end", () => { const parsed = JSON.parse(value); process.stdout.write(typeof parsed.terraform_version === "string" ? parsed.terraform_version : ""); });')"
if [[ "$terraform_version" != "1.11.3" ]]; then
  echo "Bootstrap execution requires Terraform 1.11.3; found ${terraform_version:-unknown}." >&2
  exit 1
fi

plan_file="${bundle}/bootstrap.tfplan"
metadata_file="${bundle}/metadata.json"
actual_plan_sha256="$(node "$bundle_helper" sha256 "$plan_file")"
if [[ "$actual_plan_sha256" != "$approved_plan_sha256" ]]; then
  echo "The saved Terraform plan is not the exact plan authorized for bootstrap execution." >&2
  exit 1
fi
unset actual_plan_sha256

execution="$(node "$execution_helper" create-directory "$bundle" "$repository_root")"

cloud_log="${execution}/cloud.log"
apply_log="${execution}/terraform-apply.log"
migration_log="${execution}/terraform-migration.log"
provider_data="${execution}/terraform-data"
local_state="${execution}/bootstrap.tfstate"
local_state_backup="${execution}/bootstrap.tfstate.backup"
remote_state="${execution}/remote-bootstrap.tfstate"
apply_root="${execution}/apply"
mkdir -m 700 "$provider_data" "$apply_root"

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

budget_preflight_deferred=false
if gcloud billing budgets list \
  "--billing-account=${billing_account_id}" \
  "--billing-project=${project_id}" \
  --format=json \
  --quiet >"${execution}/budgets-before.json" 2>>"$cloud_log"; then
  node "$execution_helper" verify-absent-targets budgets <"${execution}/budgets-before.json"
else
  run_gcloud_json "${execution}/billing-budget-api-before.json" services list \
    --enabled \
    "--project=${project_id}" \
    --filter=config.name=billingbudgets.googleapis.com
  node "$execution_helper" verify-empty-inventory billing-budget-api \
    <"${execution}/billing-budget-api-before.json"
  budget_preflight_deferred=true
fi
run_gcloud_json "${execution}/buckets.json" storage buckets list "--project=${project_id}"
node "$execution_helper" verify-absent-targets storage-buckets <"${execution}/buckets.json"
run_gcloud_json "${execution}/service-accounts.json" iam service-accounts list "--project=${project_id}"
node "$execution_helper" verify-absent-targets service-accounts <"${execution}/service-accounts.json"
run_gcloud_json "${execution}/workload-identity-pools.json" iam workload-identity-pools list \
  "--project=${project_id}" \
  --location=global
node "$execution_helper" verify-absent-targets workload-identity-pools \
  <"${execution}/workload-identity-pools.json"

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
  echo "The saved Terraform plan no longer decodes to its reviewed metadata." >&2
  exit 1
fi

set +e
terraform -chdir="$apply_root" apply \
  -input=false \
  -lock-timeout=5m \
  -no-color \
  -state="$local_state" \
  -state-out="$local_state" \
  -backup="$local_state_backup" \
  "$plan_file" >"$apply_log" 2>&1
apply_status="$?"
set -e

if [[ "$apply_status" -ne 0 ]]; then
  emergency_state="${apply_root}/errored.tfstate"
  if [[ -f "$emergency_state" && ! -L "$emergency_state" && -s "$emergency_state" ]]; then
    local_state="$emergency_state"
  fi
fi
if [[ ! -f "$local_state" || -L "$local_state" || ! -s "$local_state" ]]; then
  if [[ "$apply_status" -eq 0 ]]; then
    echo "Terraform reported success without producing the protected local bootstrap state." >&2
  else
    echo "Terraform apply failed before producing recoverable local state; details remain private." >&2
  fi
  exit 1
fi
chmod 600 "$local_state"
if [[ -e "$local_state_backup" && ! -L "$local_state_backup" ]]; then
  chmod 600 "$local_state_backup"
fi
if [[ "$apply_status" -ne 0 ]] \
  && ! node "$execution_helper" verify-recoverable-state "$local_state"; then
  echo "Terraform apply failed before creating resources; no remote state migration is possible." >&2
  exit 1
fi

if [[ "$local_state" != "${apply_root}/terraform.tfstate" ]]; then
  cp -p -- "$local_state" "${apply_root}/terraform.tfstate"
fi
chmod 600 "${apply_root}/terraform.tfstate"

if ! gcloud storage ls \
  --recursive \
  --json \
  "gs://${state_bucket}" >"${execution}/state-bucket-before.json" 2>>"$cloud_log"; then
  echo "The private state bucket could not be inspected before migration." >&2
  exit 1
fi
node "$execution_helper" verify-empty-inventory state-bucket \
  <"${execution}/state-bucket-before.json"

cp -p -- "${bootstrap_root}/backend.gcs.tf.example" "${apply_root}/backend.tf"
if ! terraform -chdir="$apply_root" init \
  -migrate-state \
  -force-copy \
  -input=false \
  -lock-timeout=5m \
  -lockfile=readonly \
  -no-color >>"$migration_log" 2>&1; then
  echo "Bootstrap state migration failed; the protected local state was preserved." >&2
  exit 1
fi

if ! terraform -chdir="$apply_root" state pull >"$remote_state" 2>>"$migration_log"; then
  echo "The migrated bootstrap state could not be read back; the protected local state was preserved." >&2
  exit 1
fi
chmod 600 "$remote_state"
run_gcloud_json "${execution}/state-object.json" storage objects describe \
  "gs://${state_bucket}/${state_object}"
node "$execution_helper" verify-state-object <"${execution}/state-object.json"

reconciliation_mode=complete
if [[ "$apply_status" -ne 0 ]]; then
  reconciliation_mode=partial
fi
node "$execution_helper" reconcile-state \
  "$local_state" \
  "$remote_state" \
  "$metadata_file" \
  "$reconciliation_mode"

if [[ "$apply_status" -eq 0 ]]; then
  budget_postcheck_succeeded=false
  for attempt in {1..12}; do
    if gcloud billing budgets list \
      "--billing-account=${billing_account_id}" \
      "--billing-project=${project_id}" \
      --format=json \
      --quiet >"${execution}/budgets-after.json" 2>>"$cloud_log" \
      && node "$execution_helper" verify-provisioned-targets budgets \
        <"${execution}/budgets-after.json" 2>>"$cloud_log"; then
      budget_postcheck_succeeded=true
      break
    fi
    if [[ "$attempt" -lt 12 ]]; then
      sleep 5
    fi
  done
  if [[ "$budget_postcheck_succeeded" != true ]]; then
    echo "Exactly one bootstrap budget could not be verified after the successful apply; recovery material was preserved." >&2
    exit 1
  fi
fi
unset billing_account_id

if [[ -n "$(git -C "$repository_root" status --porcelain=v1 --untracked-files=all)" ]] \
  || find "${repository_root}/infrastructure/staging" -type f \
    \( -name '*.tfstate' -o -name '*.tfstate.*' -o -name '*.tfplan' \) -print -quit | grep -q .; then
  echo "Bootstrap execution contaminated the repository; private recovery material was preserved." >&2
  exit 1
fi

if [[ "$apply_status" -ne 0 ]]; then
  echo "Terraform apply was partial or failed, but its exact state was migrated and reconciled; recovery material was preserved." >&2
  exit 1
fi

execution_complete=true
echo "The exact reviewed bootstrap plan was applied and its state was migrated and reconciled in the private GCS backend."
if [[ "$budget_preflight_deferred" == true ]]; then
  echo "Budget absence was deferred while its API was disabled; exactly one target budget was verified after apply."
fi
echo "The verified temporary local state and private execution logs were removed."
