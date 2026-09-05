locals {
  project_id           = "miakapp-v4-staging"
  project_number       = "1072737219170"
  region               = "europe-west9"
  state_bucket_name    = "miakapp-v4-staging-tfstate-1072737219170"
  workload_prefix      = "terraform/workload"
  firebase_auth_prefix = "terraform/firebase-auth"

  workflow_name         = "miakapp-user-relay-probe"
  probe_service_account = "miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com"
  verifier_account_id   = "miakapp-staging-verifier"
  verifier_account      = "${local.verifier_account_id}@${local.project_id}.iam.gserviceaccount.com"
  verifier_service_name = "miakapp-user-relay-verifier"
  verifier_service_uri  = "https://${local.verifier_service_name}-${local.project_number}.${local.region}.run.app"
  function_name         = "control-plane"
  function_uri          = "https://control-plane-aczhngqraq-od.a.run.app"
  firebase_app_id       = "1:1072737219170:web:5053ca93bf25d7373cd73b"
  destination_path      = "/v1/user-relay-tokens:exchange"

  expected_workload_source_sha256 = "6674c0353ec9c73fcfe0d3a63d17850f057a5f2a547a5855989e28f011249b1e"
  expected_workload_commit        = "022f10e2dc15f32a8a6679b38ce7f1a04582e450"
  expected_workload_image         = "europe-west9-docker.pkg.dev/miakapp-v4-staging/miakapp-control-plane/miakapp--v4--staging__europe--west9__control--plane@sha256:a650ae228afd9443e1bf0090b5b1e6e9203d08d8de5e24a894701d82a5db4503"
  capability_expiry               = "2026-09-06T18:00:00Z"

  custom_role_id                 = "miakapp.stagingUserRelayAuthProbe3"
  custom_role_name               = "projects/${local.project_id}/roles/${local.custom_role_id}"
  signer_role_id                 = "miakapp.stagingUserRelaySigner3"
  signer_role_name               = "projects/${local.project_id}/roles/${local.signer_role_id}"
  firestore_role_id              = "miakapp.stagingUserRelayFirestore3"
  firestore_role_name            = "projects/${local.project_id}/roles/${local.firestore_role_id}"
  retired_custom_role_id         = "miakapp.stagingAuthProbe"
  retired_signer_role_id         = "miakapp.stagingProbeSigner"
  retired_firestore_role_id      = "miakapp.stagingProbeFirestore"
  generation_2_custom_role_id    = "miakapp.stagingUserRelayAuthProbe2"
  generation_2_signer_role_id    = "miakapp.stagingUserRelaySigner2"
  generation_2_firestore_role_id = "miakapp.stagingUserRelayFirestore2"
  workflow_source                = file("${path.module}/workflow.yaml")
  verifier_source                = file("${path.module}/verifier.mjs")
  verifier_startup_source        = "${local.verifier_source}\nstart();"

  labels = {
    environment = "staging"
    managed-by  = "terraform"
    product     = "miakapp-v4"
    purpose     = "user-relay-probe"
  }

  verifier_labels = {
    environment = "staging"
    managed-by  = "terraform"
    product     = "miakapp-v4"
    purpose     = "user-relay-jwt-verifier"
  }
}
