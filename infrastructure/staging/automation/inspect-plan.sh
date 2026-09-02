#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "Usage: inspect-plan.sh <gs://.../foundation.tfplan> <sha256>" >&2
  exit 2
fi

plan_object="$1"
expected_sha256="$2"
if [[ ! "$plan_object" =~ ^gs://miakapp-v4-staging-tfstate-1072737219170/plans/[0-9a-f]{40}/[0-9]+/[0-9]+/foundation\.tfplan$ || \
      ! "$expected_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "The plan reference is not a canonical Miakapp staging plan." >&2
  exit 1
fi

for required_command in gcloud terraform; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Plan inspection requires ${required_command}." >&2
    exit 1
  fi
done

terraform_version="$(terraform version -json | node -e 'let value=""; process.stdin.on("data", (chunk) => { value += chunk; }); process.stdin.on("end", () => { process.stdout.write(JSON.parse(value).terraform_version); });')"
if [[ "$terraform_version" != "1.11.3" ]]; then
  echo "Plan inspection requires Terraform 1.11.3; found ${terraform_version}." >&2
  exit 1
fi

inspection_root="$(mktemp -d)"
plan_file="${inspection_root}/foundation.tfplan"
cleanup() {
  rm -f "$plan_file"
  rmdir "$inspection_root"
}
trap cleanup EXIT

gcloud storage cp "$plan_object" "$plan_file" --quiet
actual_sha256="$(shasum -a 256 "$plan_file" | awk '{print $1}')"
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
  echo "The downloaded plan digest does not match." >&2
  exit 1
fi
terraform show -no-color "$plan_file"
