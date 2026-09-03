#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "$#" -ne 1 ]]; then
  echo "Usage: MIAKAPP_STAGING_FOUNDATION_STATE_AUTHORIZATION=... ./initialize-state.sh <private-execution-parent>" >&2
  exit 2
fi

terraform_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd "${terraform_root}/../../.." && pwd -P)"
helper="${terraform_root}/foundation-state.mjs"
approved_foundation_configuration_commit="efa877835dde2f5eedc3d950b2e4c514e606751d"
approved_initialization_configuration_commit="f820b9004052863d0f9dee5ef203844dec0d4374"
project_id="miakapp-v4-staging"
state_bucket="miakapp-v4-staging-tfstate-1072737219170"
bootstrap_object="terraform/bootstrap/default.tfstate"
bootstrap_generation="1788439334043522"
foundation_object="terraform/foundation/default.tfstate"

initialization_authorization="${MIAKAPP_STAGING_FOUNDATION_STATE_AUTHORIZATION:-}"
unset MIAKAPP_STAGING_FOUNDATION_STATE_AUTHORIZATION

for credential_variable in \
  GOOGLE_APPLICATION_CREDENTIALS \
  GOOGLE_CREDENTIALS \
  GOOGLE_CLOUD_KEYFILE_JSON \
  GOOGLE_CLOUD_CREDENTIALS \
  GCLOUD_KEYFILE_JSON; do
  if [[ -n "${!credential_variable:-}" ]]; then
    echo "Credential-file environment variables are forbidden; use local User ADC for foundation-state initialization." >&2
    exit 1
  fi
done

while IFS='=' read -r -d '' environment_name environment_value; do
  if [[ -z "$environment_value" ]]; then
    continue
  fi
  case "$environment_name" in
    TF_*)
      echo "Terraform override environment variables are forbidden by the foundation-state initializer." >&2
      exit 1
      ;;
    GOOGLE_*|CLOUDSDK_*)
      echo "Google credential and endpoint overrides are forbidden; use local User ADC for foundation-state initialization." >&2
      exit 1
      ;;
    GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_CEILING_DIRECTORIES|GIT_CONFIG|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_*|GIT_CONFIG_VALUE_*)
      echo "Git repository overrides are forbidden by the foundation-state initializer." >&2
      exit 1
      ;;
    HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy)
      echo "Network proxy overrides are forbidden by the foundation-state initializer." >&2
      exit 1
      ;;
  esac
done < <(env -0)

for required_command in cp find gcloud git grep node terraform; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Foundation-state initialization requires ${required_command}." >&2
    exit 1
  fi
done

observed_repository_root="$(git -C "$repository_root" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$observed_repository_root" || "$(cd "$observed_repository_root" && pwd -P)" != "$repository_root" ]]; then
  echo "Foundation-state initialization must run from the reviewed repository." >&2
  exit 1
fi
current_commit="$(git -C "$repository_root" rev-parse HEAD)"
if [[ ! "$current_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Foundation-state initialization requires a canonical repository commit." >&2
  exit 1
fi
node "$helper" verify-authorization "$initialization_authorization" "$current_commit"
unset initialization_authorization
if [[ -n "$(git -C "$repository_root" status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "Foundation-state initialization requires a clean Git checkout." >&2
  exit 1
fi
if ! git -C "$repository_root" merge-base --is-ancestor \
  "$approved_initialization_configuration_commit" \
  "$current_commit"; then
  echo "The reviewed foundation-state initializer is not an ancestor of this checkout." >&2
  exit 1
fi

reviewed_foundation_configuration=(
  infrastructure/staging/terraform/.terraform.lock.hcl
  infrastructure/staging/terraform/terraform-cli.tfrc
  infrastructure/staging/terraform/versions.tf
)
if ! git -C "$repository_root" diff --quiet --no-ext-diff \
  "$approved_foundation_configuration_commit" "$current_commit" \
  -- "${reviewed_foundation_configuration[@]}"; then
  echo "The foundation backend configuration differs from the reviewed staging configuration." >&2
  exit 1
fi

node "${repository_root}/infrastructure/staging/validate.mjs" \
  "${repository_root}/infrastructure/staging/manifest.json"
node "${terraform_root}/guard.mjs" "$terraform_root"

terraform_version="$(terraform version -json | node -e 'let value=""; process.stdin.on("data", (chunk) => { value += chunk; }); process.stdin.on("end", () => { const parsed = JSON.parse(value); process.stdout.write(typeof parsed.terraform_version === "string" ? parsed.terraform_version : ""); });')"
if [[ "$terraform_version" != "1.11.3" ]]; then
  echo "Foundation-state initialization requires Terraform 1.11.3; found ${terraform_version:-unknown}." >&2
  exit 1
fi

execution="$(node "$helper" create-directory "$1" "$repository_root")"
execution_complete=false
cleanup() {
  if [[ "$execution_complete" == true && -d "$execution" ]]; then
    rm -rf -- "$execution"
  elif [[ -d "$execution" ]]; then
    chmod -R go-rwx "$execution" 2>/dev/null || true
    echo "Foundation-state initialization did not complete; private diagnostic material was preserved at ${execution}." >&2
  fi
}
trap cleanup EXIT

cloud_log="${execution}/cloud.log"
terraform_log="${execution}/terraform.log"
initializer_root="${execution}/initializer"
provider_data="${execution}/terraform-data"
empty_plan="${execution}/empty-foundation.tfplan"
pulled_state="${execution}/pulled-foundation.tfstate"
object_state="${execution}/object-foundation.tfstate"
bootstrap_state="${execution}/bootstrap.tfstate"
mkdir -m 700 "$initializer_root" "$provider_data"

run_gcloud_json() {
  local output_file="$1"
  shift
  if ! gcloud "$@" --format=json --quiet >"$output_file" 2>>"$cloud_log"; then
    echo "A bounded foundation-state cloud query failed; details remain in the private diagnostic directory." >&2
    return 1
  fi
}

run_state_inventory() {
  local output_file="$1"
  if ! gcloud storage ls \
    --recursive \
    --json \
    "gs://${state_bucket}" >"$output_file" 2>>"$cloud_log"; then
    echo "The private state bucket could not be inspected." >&2
    return 1
  fi
  node "$helper" inspect-bucket <"$output_file"
}

run_gcloud_json "${execution}/project.json" projects describe "$project_id"
node "$helper" verify-project <"${execution}/project.json"
before_inventory="$(run_state_inventory "${execution}/state-bucket-before.json")"
before_state="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.state);' "$before_inventory")"
if [[ "$before_state" != "absent" && "$before_state" != "present" ]]; then
  echo "The foundation-state preflight returned an invalid classification." >&2
  exit 1
fi

if ! gcloud storage cat \
  "gs://${state_bucket}/${bootstrap_object}#${bootstrap_generation}" \
  >"$bootstrap_state" 2>>"$cloud_log"; then
  echo "The reconciled bootstrap state generation could not be read." >&2
  exit 1
fi
chmod 600 "$bootstrap_state"
node "$helper" verify-bootstrap-state "$bootstrap_state" >/dev/null

for source_name in versions.tf .terraform.lock.hcl terraform-cli.tfrc; do
  cp -p -- "${terraform_root}/${source_name}" "${initializer_root}/${source_name}"
done

export TF_CLI_CONFIG_FILE="${initializer_root}/terraform-cli.tfrc"
export TF_DATA_DIR="$provider_data"
export TF_IN_AUTOMATION=1
terraform -chdir="$initializer_root" fmt -check -recursive
terraform -chdir="$initializer_root" init \
  -reconfigure \
  -input=false \
  -lock-timeout=5m \
  -lockfile=readonly \
  -no-color >"$terraform_log" 2>&1
terraform -chdir="$initializer_root" validate -no-color >>"$terraform_log" 2>&1

post_init_inventory="$(run_state_inventory "${execution}/state-bucket-post-init.json")"
post_init_state="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.state);' "$post_init_inventory")"
if [[ "$post_init_state" != "present" ]]; then
  echo "Terraform backend initialization did not create the canonical empty foundation state." >&2
  exit 1
fi
foundation_generation="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.generation);' "$post_init_inventory")"
foundation_size="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(String(value.size));' "$post_init_inventory")"
if [[ "$before_state" == "present" ]]; then
  before_generation="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.generation);' "$before_inventory")"
  before_size="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(String(value.size));' "$before_inventory")"
  if [[ "$foundation_generation" != "$before_generation" || "$foundation_size" != "$before_size" ]]; then
    echo "Existing foundation state changed during backend initialization." >&2
    exit 1
  fi
fi

if ! terraform -chdir="$initializer_root" state pull >"$pulled_state" 2>>"$terraform_log"; then
  echo "The foundation state could not be read back through Terraform." >&2
  exit 1
fi
chmod 600 "$pulled_state"
node "$helper" verify-empty-state "$pulled_state" >/dev/null

after_inventory="$(run_state_inventory "${execution}/state-bucket-after.json")"
after_state="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.state);' "$after_inventory")"
after_generation="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.generation ?? "");' "$after_inventory")"
after_size="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(String(value.size ?? ""));' "$after_inventory")"
if [[ "$after_state" != "present" \
  || "$after_generation" != "$foundation_generation" \
  || "$after_size" != "$foundation_size" ]]; then
  echo "Foundation state changed during Terraform read-back." >&2
  exit 1
fi

if ! gcloud storage cat \
  "gs://${state_bucket}/${foundation_object}#${foundation_generation}" \
  >"$object_state" 2>>"$cloud_log"; then
  echo "The current foundation state generation could not be read for reconciliation." >&2
  exit 1
fi
chmod 600 "$object_state"
reconciliation="$(node "$helper" reconcile-empty-states "$pulled_state" "$object_state")"
reconciled_size="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(String(value.size));' "$reconciliation")"
if [[ "$reconciled_size" != "$foundation_size" ]]; then
  echo "Foundation state size differs between GCS inventory and the reconciled object." >&2
  exit 1
fi

if [[ "$before_state" == "absent" ]]; then
  terraform -chdir="$initializer_root" plan \
    -refresh-only \
    -input=false \
    -lock-timeout=5m \
    -no-color \
    -out="$empty_plan" >>"$terraform_log" 2>&1
  plan_fingerprint="$(node "$helper" fingerprint-plan "$empty_plan")"
  if ! terraform -chdir="$initializer_root" show -json "$empty_plan" 2>>"$terraform_log" \
    | node "$helper" verify-empty-plan >/dev/null; then
    echo "The post-initialization plan was not exactly empty; the initialized state requires review." >&2
    exit 1
  fi

  post_plan_inventory="$(run_state_inventory "${execution}/state-bucket-post-plan.json")"
  post_plan_state="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.state);' "$post_plan_inventory")"
  post_plan_generation="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.generation ?? "");' "$post_plan_inventory")"
  post_plan_size="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(String(value.size ?? ""));' "$post_plan_inventory")"
  if [[ "$post_plan_state" != "present" \
    || "$post_plan_generation" != "$foundation_generation" \
    || "$post_plan_size" != "$foundation_size" ]]; then
    echo "Foundation state changed while verifying the post-initialization plan." >&2
    exit 1
  fi
  if [[ "$(node "$helper" fingerprint-plan "$empty_plan")" != "$plan_fingerprint" ]]; then
    echo "The verified post-initialization plan changed during inspection." >&2
    exit 1
  fi
fi

final_inventory="$(run_state_inventory "${execution}/state-bucket-final.json")"
final_state="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.state);' "$final_inventory")"
final_generation="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.generation ?? "");' "$final_inventory")"
final_size="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(String(value.size ?? ""));' "$final_inventory")"
if [[ "$final_state" != "present" \
  || "$final_generation" != "$foundation_generation" \
  || "$final_size" != "$foundation_size" ]]; then
  echo "Foundation state changed during final reconciliation." >&2
  exit 1
fi

if [[ -n "$(git -C "$repository_root" status --porcelain=v1 --untracked-files=all)" ]] \
  || find "${repository_root}/infrastructure/staging" -type f \
    \( -name '*.tfstate' -o -name '*.tfstate.*' -o -name '*.tfplan' \) -print -quit | grep -q .; then
  echo "Foundation-state initialization contaminated the repository; private diagnostic material was preserved." >&2
  exit 1
fi

foundation_sha256="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.sha256);' "$reconciliation")"
foundation_lineage_sha256="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.lineageSha256);' "$reconciliation")"
execution_complete=true
if [[ "$before_state" == "absent" ]]; then
  echo "Terraform initialized and reconciled the canonical empty staging foundation state."
  echo "The post-initialization refresh-only plan was verified and was not applied."
else
  echo "The existing canonical empty staging foundation state was reconciled without mutation."
fi
echo "Foundation state generation: ${foundation_generation}; bytes: ${foundation_size}; SHA-256: ${foundation_sha256}."
echo "Foundation state serial: 1; managed resources: 0; lineage SHA-256: ${foundation_lineage_sha256}."
