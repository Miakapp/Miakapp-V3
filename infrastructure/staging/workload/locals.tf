locals {
  project_id           = "miakapp-v4-staging"
  project_number       = "1072737219170"
  region               = "europe-west9"
  state_bucket_name    = "miakapp-v4-staging-tfstate-1072737219170"
  bootstrap_prefix     = "terraform/bootstrap"
  foundation_prefix    = "terraform/foundation"
  workload_prefix      = "terraform/workload"
  runtime_account_id   = "miakapp-control-plane"
  runtime_account      = "miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com"
  build_account_id     = "miakapp-control-build"
  probe_account_id     = "miakapp-staging-probe"
  source_bucket_name   = "miakapp-v4-staging-function-source-1072737219170"
  gcf_source_bucket    = "gcf-v2-sources-1072737219170-europe-west9"
  artifact_repository  = "miakapp-control-plane"
  function_name        = "control-plane"
  function_entry_point = "controlPlane"
  fcm_role_id          = "miakapp.controlPlaneFcmSender"

  operator_user_sha256 = "d1c8514ac6eb5c13205cfec40dd6cc2072f33eb4279172df17273aa7c54a181c"
  source_repository_commit = (
    var.browser_relay_rotation_entry
    ? "9f217da102b394734adba7ccef3f8f70d0317306"
    : var.repository_commit
  )
  runtime_config_path = (
    var.browser_relay_rotation_entry
    ? "${path.module}/runtime-config-version-1-current.json"
    : "${path.module}/runtime-config.json"
  )
  runtime_config_sha256 = (
    var.browser_relay_rotation_entry
    ? "c018708786fc23a15f7701093b5148c0e415a2df8045af8e170e4308c2deae37"
    : "40e2f83fbe8e3d27b7e53c4a666f424519fc6972ef19a7598ab9e093be0c70f7"
  )
  runtime_config_json = file(local.runtime_config_path)
  expected_foundation_secret_ids = [
    "miakapp-audit-hmac",
    "miakapp-component-hmac",
    "miakapp-home-key-pepper",
    "miakapp-network-hmac",
    "miakapp-push-hmac",
  ]

  labels = {
    environment = "staging"
    managed-by  = "terraform"
    product     = "miakapp-v4"
  }
}
