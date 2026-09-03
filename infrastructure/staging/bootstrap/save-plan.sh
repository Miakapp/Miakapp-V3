#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "$#" -ne 1 ]]; then
  echo "Usage: MIAKAPP_STAGING_BILLING_ACCOUNT_ID=... MIAKAPP_STAGING_BOOTSTRAP_CONFIRMATION=miakapp-v4-staging ./save-plan.sh <private-parent-directory>" >&2
  exit 2
fi

bootstrap_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd "${bootstrap_root}/../../.." && pwd -P)"
bundle_helper="${bootstrap_root}/saved-plan.mjs"

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
      echo "Terraform override environment variables are forbidden by the saved bootstrap plan wrapper." >&2
      exit 1
      ;;
    GOOGLE_*|CLOUDSDK_*)
      echo "Google credential and endpoint overrides are forbidden; use local User ADC for bootstrap planning." >&2
      exit 1
      ;;
    GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_CEILING_DIRECTORIES|GIT_CONFIG|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_*|GIT_CONFIG_VALUE_*)
      echo "Git repository overrides are forbidden by the saved bootstrap plan wrapper." >&2
      exit 1
      ;;
  esac
done < <(env -0)

for required_command in git node terraform; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Saved bootstrap planning requires ${required_command}." >&2
    exit 1
  fi
done

approved_fingerprint="4557923f1be719b78ee844b14bfa4654be3eb3fa785a2cb5a2624c3f85d12270"
actual_fingerprint="$(node -e 'const { createHash } = require("node:crypto"); process.stdout.write(createHash("sha256").update(process.env.MIAKAPP_STAGING_BILLING_ACCOUNT_ID).digest("hex"));')"
if [[ "$actual_fingerprint" != "$approved_fingerprint" ]]; then
  echo "The supplied billing account is not the reviewed staging account." >&2
  exit 1
fi
billing_account_id="$MIAKAPP_STAGING_BILLING_ACCOUNT_ID"
unset MIAKAPP_STAGING_BILLING_ACCOUNT_ID

observed_repository_root="$(git -C "$repository_root" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$observed_repository_root" || "$(cd "$observed_repository_root" && pwd -P)" != "$repository_root" ]]; then
  echo "The saved bootstrap plan must run from the reviewed repository." >&2
  exit 1
fi
if [[ -n "$(git -C "$repository_root" status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "The saved bootstrap plan requires a clean Git checkout." >&2
  exit 1
fi
configuration_commit="$(git -C "$repository_root" rev-parse HEAD)"
if [[ ! "$configuration_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "The saved bootstrap plan requires a canonical Git commit." >&2
  exit 1
fi

for local_artifact in terraform.tfstate terraform.tfstate.backup; do
  if [[ -e "${bootstrap_root}/${local_artifact}" || -L "${bootstrap_root}/${local_artifact}" ]]; then
    echo "The bootstrap source directory must not contain local Terraform state." >&2
    exit 1
  fi
done

node "${repository_root}/infrastructure/staging/validate.mjs" \
  "${repository_root}/infrastructure/staging/manifest.json"
node "${bootstrap_root}/guard.mjs" "$bootstrap_root"

terraform_version="$(terraform version -json | node -e 'let value=""; process.stdin.on("data", (chunk) => { value += chunk; }); process.stdin.on("end", () => { const parsed = JSON.parse(value); process.stdout.write(typeof parsed.terraform_version === "string" ? parsed.terraform_version : ""); });')"
if [[ "$terraform_version" != "1.11.3" ]]; then
  echo "Saved bootstrap planning requires Terraform 1.11.3; found ${terraform_version:-unknown}." >&2
  exit 1
fi

bundle="$(node "$bundle_helper" create-bundle "$1" "$repository_root")"
plan_file="${bundle}/bootstrap.tfplan"
metadata_file="${bundle}/metadata.json"
state_file="${bundle}/bootstrap.tfstate"
private_log="${bundle}/terraform.log"
terraform_data_dir="${bundle}/terraform-data"
completed=false
cleanup() {
  rm -f -- "$private_log"
  rm -rf -- "$terraform_data_dir"
  if [[ "$completed" != true ]]; then
    rm -f -- "$metadata_file" "$plan_file" "$state_file" "${state_file}.backup"
    rmdir -- "$bundle" 2>/dev/null || true
  fi
}
trap cleanup EXIT

export TF_CLI_CONFIG_FILE="${bootstrap_root}/terraform-cli.tfrc"
export TF_DATA_DIR="$terraform_data_dir"
export TF_IN_AUTOMATION=1

terraform -chdir="$bootstrap_root" fmt -check -recursive
terraform -chdir="$bootstrap_root" init -backend=false -input=false -lockfile=readonly -no-color
terraform -chdir="$bootstrap_root" validate -no-color

export TF_VAR_billing_account_id="$billing_account_id"
unset billing_account_id
set +e
terraform -chdir="$bootstrap_root" plan \
  -input=false \
  -lock=false \
  -no-color \
  -detailed-exitcode \
  -state="$state_file" \
  -out="$plan_file" >"$private_log" 2>&1
plan_status="$?"
set -e
unset TF_VAR_billing_account_id
if [[ "$plan_status" -ne 0 && "$plan_status" -ne 2 ]]; then
  echo "Terraform bootstrap planning failed; detailed output was discarded with the private bundle." >&2
  exit 1
fi
if [[ -e "$state_file" || -L "$state_file" || -e "${state_file}.backup" || -L "${state_file}.backup" ]]; then
  echo "Terraform unexpectedly created local state while planning; the private bundle was discarded." >&2
  exit 1
fi
if [[ ! -f "$plan_file" || -L "$plan_file" ]]; then
  echo "Terraform did not create a regular saved bootstrap plan." >&2
  exit 1
fi
chmod 600 "$plan_file"

plan_sha256="$(node "$bundle_helper" sha256 "$plan_file")"
created_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
if ! terraform -chdir="$bootstrap_root" show -json "$plan_file" 2>>"$private_log" \
  | node "$bundle_helper" create-metadata \
    "$metadata_file" \
    "$plan_sha256" \
    "$configuration_commit" \
    "$created_at" >/dev/null; then
  echo "The saved bootstrap plan does not match the reviewed import-and-create inventory; the private bundle was discarded." >&2
  exit 1
fi

if [[ "$(git -C "$repository_root" rev-parse HEAD)" != "$configuration_commit" \
      || -n "$(git -C "$repository_root" status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "The repository changed while Terraform was planning; the private bundle was discarded." >&2
  exit 1
fi

rm -f -- "$private_log"
rm -rf -- "$terraform_data_dir"
unset TF_DATA_DIR
summary="$(node "$bundle_helper" verify "$bundle" "$configuration_commit")"
completed=true
printf '%s\n' "$summary"
printf 'Private bundle: %s\n' "$bundle"
echo "No apply or state migration was authorized or executed."
