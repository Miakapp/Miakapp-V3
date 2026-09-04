locals {
  project_id           = "miakapp-v4-staging"
  project_number       = "1072737219170"
  region               = "europe-west9"
  state_bucket_name    = "miakapp-v4-staging-tfstate-1072737219170"
  workload_prefix      = "terraform/workload"
  firebase_auth_prefix = "terraform/firebase-auth"

  workflow_name         = "miakapp-auth-app-check-probe"
  probe_service_account = "miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com"
  function_name         = "control-plane"
  function_uri          = "https://control-plane-aczhngqraq-od.a.run.app"
  firebase_app_id       = "1:1072737219170:web:5053ca93bf25d7373cd73b"
  destination_path      = "/v1/push-destinations"

  expected_workload_source_sha256 = "86f4818dfcb4021e5578638d6fb1e9b7da31ea245528cbdc8573dabecdfca358"
  expected_workload_commit        = "60322c69c92b8ccf5f3d1bc87ba264a00e5dca05"

  custom_role_id   = "miakapp.stagingAuthProbe"
  custom_role_name = "projects/${local.project_id}/roles/${local.custom_role_id}"
  workflow_source  = file("${path.module}/workflow.yaml")

  labels = {
    environment = "staging"
    managed-by  = "terraform"
    product     = "miakapp-v4"
    purpose     = "auth-app-check-probe"
  }
}
