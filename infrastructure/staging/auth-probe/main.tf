data "terraform_remote_state" "workload" {
  backend = "gcs"

  config = {
    bucket = local.state_bucket_name
    prefix = local.workload_prefix
  }
}

data "terraform_remote_state" "firebase_auth" {
  backend = "gcs"

  config = {
    bucket = local.state_bucket_name
    prefix = local.firebase_auth_prefix
  }
}

resource "terraform_data" "auth_probe_guard" {
  input = {
    project_id             = data.terraform_remote_state.workload.outputs.staging_workload.project_id
    project_number         = data.terraform_remote_state.workload.outputs.staging_workload.project_number
    region                 = data.terraform_remote_state.workload.outputs.staging_workload.region
    function_name          = data.terraform_remote_state.workload.outputs.staging_workload.function_name
    function_uri           = data.terraform_remote_state.workload.outputs.staging_workload.function_uri
    probe_service_account  = data.terraform_remote_state.workload.outputs.staging_workload.probe_service_account
    source_sha256          = data.terraform_remote_state.workload.outputs.staging_workload.source_sha256
    repository_commit      = data.terraform_remote_state.workload.outputs.staging_workload.repository_commit
    ingress                = data.terraform_remote_state.workload.outputs.staging_workload.ingress
    unauthenticated        = data.terraform_remote_state.workload.outputs.staging_workload.unauthenticated
    minimum_instances      = data.terraform_remote_state.workload.outputs.staging_workload.minimum_instances
    maximum_instances      = data.terraform_remote_state.workload.outputs.staging_workload.maximum_instances
    firebase_auth          = data.terraform_remote_state.firebase_auth.outputs.staging_firebase_auth
    firebase_app_id        = local.firebase_app_id
    workflow_source_sha256 = sha256(local.workflow_source)
  }

  lifecycle {
    prevent_destroy = true

    precondition {
      condition = try(
        data.terraform_remote_state.workload.outputs.staging_workload.schema == "miakapp.staging-workload/1" &&
        data.terraform_remote_state.workload.outputs.staging_workload.project_id == local.project_id &&
        data.terraform_remote_state.workload.outputs.staging_workload.project_number == local.project_number &&
        data.terraform_remote_state.workload.outputs.staging_workload.region == local.region &&
        data.terraform_remote_state.workload.outputs.staging_workload.function_name == local.function_name &&
        data.terraform_remote_state.workload.outputs.staging_workload.function_uri == local.function_uri &&
        data.terraform_remote_state.workload.outputs.staging_workload.probe_service_account == local.probe_service_account &&
        data.terraform_remote_state.workload.outputs.staging_workload.source_sha256 == local.expected_workload_source_sha256 &&
        data.terraform_remote_state.workload.outputs.staging_workload.repository_commit == local.expected_workload_commit &&
        data.terraform_remote_state.workload.outputs.staging_workload.ingress == "ALLOW_INTERNAL_ONLY" &&
        data.terraform_remote_state.workload.outputs.staging_workload.unauthenticated == false &&
        data.terraform_remote_state.workload.outputs.staging_workload.minimum_instances == 0 &&
        data.terraform_remote_state.workload.outputs.staging_workload.maximum_instances == 1 &&
        data.terraform_remote_state.firebase_auth.outputs.staging_firebase_auth.schema == "miakapp.staging-firebase-auth/1" &&
        data.terraform_remote_state.firebase_auth.outputs.staging_firebase_auth.project_id == local.project_id &&
        data.terraform_remote_state.firebase_auth.outputs.staging_firebase_auth.project_number == local.project_number &&
        data.terraform_remote_state.firebase_auth.outputs.staging_firebase_auth.config_name == "projects/${local.project_id}/config" &&
        data.terraform_remote_state.firebase_auth.outputs.staging_firebase_auth.anonymous_sign_in == false &&
        data.terraform_remote_state.firebase_auth.outputs.staging_firebase_auth.email_sign_in == false &&
        data.terraform_remote_state.firebase_auth.outputs.staging_firebase_auth.phone_sign_in == false &&
        data.terraform_remote_state.firebase_auth.outputs.staging_firebase_auth.duplicate_emails == false &&
        data.terraform_remote_state.firebase_auth.outputs.staging_firebase_auth.user_signup_disabled == false &&
        data.terraform_remote_state.firebase_auth.outputs.staging_firebase_auth.user_deletion_disabled == false &&
        data.terraform_remote_state.firebase_auth.outputs.staging_firebase_auth.anonymous_user_autodelete == true &&
        data.terraform_remote_state.firebase_auth.outputs.staging_firebase_auth.multi_tenant == false &&
        data.terraform_remote_state.firebase_auth.outputs.staging_firebase_auth.mfa == "DISABLED" &&
        data.terraform_remote_state.firebase_auth.outputs.staging_firebase_auth.request_logging == false,
        false,
      )
      error_message = "The deployed workload or Firebase Auth baseline no longer matches the reviewed Auth probe boundary."
    }
  }
}

resource "google_project_iam_custom_role" "auth_probe" {
  project     = local.project_id
  role_id     = local.custom_role_id
  title       = "Miakapp staging Auth probe"
  description = "Dormant least-privilege role for the bounded staging Auth and App Check probe."
  permissions = [
    "firebase.clients.get",
    "firebaseappcheck.tokens.mint",
    "firebaseauth.users.get",
    "serviceusage.services.use",
  ]
  stage = "GA"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.auth_probe_guard]
}

resource "google_project_iam_member" "auth_probe" {
  count = var.armed ? 1 : 0

  project = local.project_id
  role    = local.custom_role_name
  member  = "serviceAccount:${local.probe_service_account}"

  depends_on = [google_project_iam_custom_role.auth_probe]
}

resource "google_service_account_iam_member" "auth_probe_self_signer" {
  count = var.armed ? 1 : 0

  service_account_id = "projects/${local.project_id}/serviceAccounts/${local.probe_service_account}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${local.probe_service_account}"

  depends_on = [
    google_project_iam_custom_role.auth_probe,
    terraform_data.auth_probe_guard,
  ]
}

resource "google_workflows_workflow" "auth_probe" {
  count = var.armed ? 1 : 0

  project                 = local.project_id
  region                  = local.region
  name                    = local.workflow_name
  description             = "One-shot private Firebase Auth and custom-provider App Check probe for Miakapp V4 staging."
  service_account         = local.probe_service_account
  source_contents         = local.workflow_source
  call_log_level          = "LOG_NONE"
  execution_history_level = "EXECUTION_HISTORY_BASIC"
  deletion_protection     = false
  labels                  = local.labels

  depends_on = [
    google_project_iam_member.auth_probe,
    google_service_account_iam_member.auth_probe_self_signer,
  ]
}
