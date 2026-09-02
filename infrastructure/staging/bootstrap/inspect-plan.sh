#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "$#" -ne 1 ]]; then
  echo "Usage: MIAKAPP_STAGING_BOOTSTRAP_INSPECTION_CONFIRMATION=miakapp-v4-staging ./inspect-plan.sh <private-plan-bundle>" >&2
  exit 2
fi

bootstrap_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd "${bootstrap_root}/../../.." && pwd -P)"
bundle_helper="${bootstrap_root}/saved-plan.mjs"

if [[ "${MIAKAPP_STAGING_BOOTSTRAP_INSPECTION_CONFIRMATION:-}" != "miakapp-v4-staging" ]]; then
  echo "Set MIAKAPP_STAGING_BOOTSTRAP_INSPECTION_CONFIRMATION=miakapp-v4-staging before rendering the sensitive bootstrap plan." >&2
  exit 1
fi

while IFS='=' read -r -d '' environment_name environment_value; do
  if [[ -z "$environment_value" ]]; then
    continue
  fi
  case "$environment_name" in
    TF_*|GOOGLE_*|CLOUDSDK_*)
      echo "Terraform and Google environment overrides are forbidden during saved-plan inspection." >&2
      exit 1
      ;;
    GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_CEILING_DIRECTORIES|GIT_CONFIG|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_*|GIT_CONFIG_VALUE_*)
      echo "Git repository overrides are forbidden during saved-plan inspection." >&2
      exit 1
      ;;
  esac
done < <(env -0)

for required_command in git mktemp node terraform; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Saved bootstrap plan inspection requires ${required_command}." >&2
    exit 1
  fi
done

if [[ -n "$(git -C "$repository_root" status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "Saved bootstrap plan inspection requires the clean checkout that created the plan." >&2
  exit 1
fi
configuration_commit="$(git -C "$repository_root" rev-parse HEAD)"
if [[ ! "$configuration_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Saved bootstrap plan inspection requires a canonical Git commit." >&2
  exit 1
fi

node "${repository_root}/infrastructure/staging/validate.mjs" \
  "${repository_root}/infrastructure/staging/manifest.json"
node "${bootstrap_root}/guard.mjs" "$bootstrap_root"

terraform_version="$(terraform version -json | node -e 'let value=""; process.stdin.on("data", (chunk) => { value += chunk; }); process.stdin.on("end", () => { const parsed = JSON.parse(value); process.stdout.write(typeof parsed.terraform_version === "string" ? parsed.terraform_version : ""); });')"
if [[ "$terraform_version" != "1.11.3" ]]; then
  echo "Saved bootstrap plan inspection requires Terraform 1.11.3; found ${terraform_version:-unknown}." >&2
  exit 1
fi

node "$bundle_helper" verify "$1" "$configuration_commit"
bundle="$(cd "$1" && pwd -P)"
inspection_root="$(mktemp -d "${TMPDIR:-/tmp}/miakapp-bootstrap-inspection.XXXXXXXX")"
mkdir -m 700 "${inspection_root}/terraform-data"
cleanup() {
  rm -rf -- "$inspection_root"
}
trap cleanup EXIT

export TF_CLI_CONFIG_FILE="${bootstrap_root}/terraform-cli.tfrc"
export TF_DATA_DIR="${inspection_root}/terraform-data"
export TF_IN_AUTOMATION=1
if ! terraform -chdir="$bootstrap_root" show -json "${bundle}/bootstrap.tfplan" 2>/dev/null \
  | node "$bundle_helper" verify-plan "${bundle}/metadata.json"; then
  echo "The Terraform plan binary does not match its reviewed metadata." >&2
  exit 1
fi
echo "The complete plan below is sensitive and must not be copied to a public log or artifact." >&2
terraform -chdir="$bootstrap_root" show -no-color "${bundle}/bootstrap.tfplan"
