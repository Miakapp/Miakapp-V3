#!/usr/bin/env bash
set -euo pipefail

project_id='miakapp-v4-staging'
site_id='miakapp-v4-staging'
expected_confirmation="deploy-browser-host:${project_id}"

if [[ "${MIAKAPP_STAGING_DEPLOY_CONFIRMATION:-}" != "${expected_confirmation}" ]]; then
  echo "Set MIAKAPP_STAGING_DEPLOY_CONFIRMATION=${expected_confirmation} to deploy the V4 browser host." >&2
  exit 1
fi

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repository_root}"
export GOOGLE_CLOUD_QUOTA_PROJECT="${project_id}"

# The shell validates this configuration in the browser, once the bundle is
# already live. Applying the same rules here is the last point where a wrong
# value costs a correction instead of a deployment.
bun scripts/preflight-staging-env.ts staging

bun run build --mode staging
firebase deploy \
  --config firebase.staging.json \
  --project "${project_id}" \
  --only "hosting:${site_id}" \
  --non-interactive
