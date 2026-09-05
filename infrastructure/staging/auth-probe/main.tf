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
    verifier_source_sha256 = sha256(local.verifier_source)
    verifier_service_uri   = local.verifier_service_uri
    verifier_identity      = local.verifier_account
    verifier_image         = local.expected_workload_image
    capability_expiry      = local.capability_expiry
    role_generation        = 3
    custom_role_name       = local.custom_role_name
    firestore_role_name    = local.firestore_role_name
    signer_role_name       = local.signer_role_name
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
        data.terraform_remote_state.firebase_auth.outputs.staging_firebase_auth.config_name == "projects/${local.project_number}/config" &&
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

resource "google_project_service" "auth_probe_asset_inventory" {
  project = local.project_id
  service = "cloudasset.googleapis.com"

  disable_dependent_services = false
  disable_on_destroy         = false

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.auth_probe_guard]
}

moved {
  from = google_project_iam_custom_role.auth_probe
  to   = google_project_iam_custom_role.auth_probe_generation_1
}

moved {
  from = google_project_iam_custom_role.auth_probe_firestore
  to   = google_project_iam_custom_role.auth_probe_firestore_generation_1
}

moved {
  from = google_project_iam_custom_role.auth_probe_signer
  to   = google_project_iam_custom_role.auth_probe_signer_generation_1
}

resource "google_project_iam_custom_role" "auth_probe_generation_1" {
  project     = local.project_id
  role_id     = local.retired_custom_role_id
  title       = "Miakapp staging Auth probe"
  description = "Dormant least-privilege role for the bounded staging Auth and App Check probe."
  permissions = [
    "firebase.clients.get",
    "firebaseappcheck.tokens.mint",
    "firebaseauth.users.get",
    "serviceusage.services.use",
  ]
  stage = "DISABLED"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    google_project_service.auth_probe_asset_inventory,
    terraform_data.auth_probe_guard,
  ]
}

resource "google_project_iam_custom_role" "auth_probe_signer_generation_1" {
  project     = local.project_id
  role_id     = local.retired_signer_role_id
  title       = "Miakapp staging probe signer"
  description = "Dormant self-scoped signing role for bounded staging probes."
  permissions = [
    "iam.serviceAccounts.getOpenIdToken",
    "iam.serviceAccounts.signJwt",
  ]
  stage = "DISABLED"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.auth_probe_guard]
}

resource "google_project_iam_custom_role" "auth_probe_firestore_generation_1" {
  project     = local.project_id
  role_id     = local.retired_firestore_role_id
  title       = "Miakapp staging probe Firestore access"
  description = "Dormant database-scoped CRUD role for bounded staging probe fixtures."
  permissions = [
    "datastore.entities.create",
    "datastore.entities.delete",
    "datastore.entities.get",
    "datastore.entities.update",
  ]
  stage = "DISABLED"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.auth_probe_guard]
}

resource "google_project_iam_custom_role" "auth_probe_generation_2" {
  project     = local.project_id
  role_id     = local.generation_2_custom_role_id
  title       = "Miakapp staging user-relay Auth probe 2"
  description = "Generation 2 least-privilege role for the bounded staging user-relay probe."
  permissions = [
    "firebase.clients.get",
    "firebaseappcheck.tokens.mint",
    "firebaseauth.users.get",
    "serviceusage.services.use",
  ]
  stage = "DISABLED"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    google_project_service.auth_probe_asset_inventory,
    terraform_data.auth_probe_guard,
  ]
}

resource "google_project_iam_custom_role" "auth_probe_signer_generation_2" {
  project     = local.project_id
  role_id     = local.generation_2_signer_role_id
  title       = "Miakapp staging user-relay signer probe 2"
  description = "Generation 2 self-scoped signing role for the bounded staging user-relay probe."
  permissions = [
    "iam.serviceAccounts.getOpenIdToken",
    "iam.serviceAccounts.signJwt",
  ]
  stage = "DISABLED"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.auth_probe_guard]
}

resource "google_project_iam_custom_role" "auth_probe_firestore_generation_2" {
  project     = local.project_id
  role_id     = local.generation_2_firestore_role_id
  title       = "Miakapp staging user-relay Firestore probe 2"
  description = "Generation 2 database-scoped CRUD role for bounded staging user-relay fixtures."
  permissions = [
    "datastore.entities.create",
    "datastore.entities.delete",
    "datastore.entities.get",
    "datastore.entities.update",
  ]
  stage = "DISABLED"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.auth_probe_guard]
}

resource "google_project_iam_custom_role" "auth_probe_generation_3" {
  project     = local.project_id
  role_id     = local.custom_role_id
  title       = "Miakapp staging user-relay Auth probe 3"
  description = "Generation 3 least-privilege role for the bounded staging user-relay probe."
  permissions = [
    "firebase.clients.get",
    "firebaseappcheck.tokens.mint",
    "firebaseauth.users.get",
    "serviceusage.services.use",
  ]
  stage = var.armed ? "GA" : "DISABLED"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    google_project_service.auth_probe_asset_inventory,
    terraform_data.auth_probe_guard,
  ]
}

resource "google_project_iam_custom_role" "auth_probe_signer_generation_3" {
  project     = local.project_id
  role_id     = local.signer_role_id
  title       = "Miakapp staging user-relay signer probe 3"
  description = "Generation 3 self-scoped signing role for the bounded staging user-relay probe."
  permissions = [
    "iam.serviceAccounts.getOpenIdToken",
    "iam.serviceAccounts.signJwt",
  ]
  stage = var.armed ? "GA" : "DISABLED"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.auth_probe_guard]
}

resource "google_project_iam_custom_role" "auth_probe_firestore_generation_3" {
  project     = local.project_id
  role_id     = local.firestore_role_id
  title       = "Miakapp staging user-relay Firestore probe 3"
  description = "Generation 3 database-scoped CRUD role for bounded staging user-relay fixtures."
  permissions = [
    "datastore.entities.create",
    "datastore.entities.delete",
    "datastore.entities.get",
    "datastore.entities.update",
  ]
  stage = var.armed ? "GA" : "DISABLED"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.auth_probe_guard]
}

resource "google_service_account" "auth_probe_verifier" {
  project      = local.project_id
  account_id   = local.verifier_account_id
  display_name = "Miakapp V4 staging probe verifier"
  description  = "Keyless no-role identity for the temporary internal JWT verifier."

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    google_project_service.auth_probe_asset_inventory,
    terraform_data.auth_probe_guard,
  ]
}

resource "google_project_iam_member" "auth_probe" {
  count = var.armed ? 1 : 0

  project = local.project_id
  role    = local.custom_role_name
  member  = "serviceAccount:${local.probe_service_account}"

  condition {
    title       = "temporary_user_relay_probe"
    description = "Expires the user-relay probe Firebase capability independently of cleanup."
    expression  = "request.time < timestamp(\"${local.capability_expiry}\")"
  }

  depends_on = [google_project_iam_custom_role.auth_probe_generation_3]
}

resource "google_service_account_iam_member" "auth_probe_self_signer" {
  count = var.armed ? 1 : 0

  service_account_id = "projects/${local.project_id}/serviceAccounts/${local.probe_service_account}"
  role               = local.signer_role_name
  member             = "serviceAccount:${local.probe_service_account}"

  condition {
    title       = "temporary_user_relay_probe"
    description = "Expires the user-relay probe self-signing capability independently of cleanup."
    expression  = "request.time < timestamp(\"${local.capability_expiry}\")"
  }

  depends_on = [
    google_project_iam_custom_role.auth_probe_signer_generation_3,
    terraform_data.auth_probe_guard,
  ]
}

resource "google_project_iam_member" "auth_probe_firestore" {
  count = var.armed ? 1 : 0

  project = local.project_id
  role    = local.firestore_role_name
  member  = "serviceAccount:${local.probe_service_account}"

  condition {
    title       = "temporary_user_relay_probe_default_database"
    description = "Limits the temporary probe fixture capability to the default database and arm window."
    expression  = "resource.name == \"projects/${local.project_id}/databases/(default)\" && request.time < timestamp(\"${local.capability_expiry}\")"
  }

  depends_on = [google_project_iam_custom_role.auth_probe_firestore_generation_3]
}

resource "google_cloud_run_v2_service" "auth_probe_verifier" {
  count = var.armed ? 1 : 0

  project              = local.project_id
  location             = local.region
  name                 = local.verifier_service_name
  description          = "Temporary internal verifier for the bounded staging user-relay probe."
  ingress              = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  default_uri_disabled = false
  invoker_iam_disabled = false
  deletion_protection  = false
  labels               = local.verifier_labels

  template {
    service_account                  = local.verifier_account
    timeout                          = "30s"
    max_instance_request_concurrency = 1
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"

    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    containers {
      name    = "verifier"
      image   = local.expected_workload_image
      command = ["node"]
      args    = ["--input-type=module", "--eval", local.verifier_startup_source]

      ports {
        name           = "http1"
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = false
      }
    }
  }

  depends_on = [
    google_service_account.auth_probe_verifier,
    terraform_data.auth_probe_guard,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "auth_probe_verifier_invoker" {
  count = var.armed ? 1 : 0

  project  = local.project_id
  location = local.region
  name     = google_cloud_run_v2_service.auth_probe_verifier[0].name
  role     = "roles/run.servicesInvoker"
  member   = "serviceAccount:${local.probe_service_account}"

  condition {
    title       = "temporary_user_relay_probe"
    description = "Expires invocation of the temporary verifier independently of cleanup."
    expression  = "request.time < timestamp(\"${local.capability_expiry}\")"
  }
}

resource "google_workflows_workflow" "auth_probe" {
  count = var.armed ? 1 : 0

  project                 = local.project_id
  region                  = local.region
  name                    = local.workflow_name
  description             = "One-shot private audience-bound user-relay credential probe for Miakapp V4 staging."
  service_account         = local.probe_service_account
  source_contents         = local.workflow_source
  call_log_level          = "LOG_NONE"
  execution_history_level = "EXECUTION_HISTORY_BASIC"
  deletion_protection     = false
  labels                  = local.labels

  depends_on = [
    google_project_iam_member.auth_probe,
    google_project_iam_member.auth_probe_firestore,
    google_service_account_iam_member.auth_probe_self_signer,
    google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker,
  ]
}
