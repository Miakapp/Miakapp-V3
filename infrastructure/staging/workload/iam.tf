resource "google_storage_bucket_iam_member" "build_source_reader" {
  bucket = google_storage_bucket.source.name
  role   = "roles/storage.objectViewer"
  member = google_service_account.build.member
}

resource "google_artifact_registry_repository_iam_member" "build_writer" {
  project    = local.project_id
  location   = google_artifact_registry_repository.function.location
  repository = google_artifact_registry_repository.function.name
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.build.member
}

resource "google_project_iam_member" "build_logs" {
  project = local.project_id
  role    = "roles/logging.logWriter"
  member  = google_service_account.build.member
}

resource "google_project_iam_custom_role" "fcm_sender" {
  project     = local.project_id
  role_id     = local.fcm_role_id
  title       = "Miakapp control-plane FCM sender"
  description = "Allows only creation of an FCM message for the staging control plane."
  permissions = ["cloudmessaging.messages.create"]
  stage       = "GA"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.deployment_guard]
}

resource "google_project_iam_member" "runtime_fcm" {
  project = local.project_id
  role    = google_project_iam_custom_role.fcm_sender.name
  member  = data.google_service_account.runtime.member
}

resource "google_service_account_iam_member" "probe_operator" {
  service_account_id = google_service_account.probe.name
  role               = "roles/iam.serviceAccountOpenIdTokenCreator"
  member             = "user:${var.operator_user_email}"
}

resource "google_cloud_run_v2_service_iam_member" "probe_invoker" {
  project  = local.project_id
  location = local.region
  name     = google_cloudfunctions2_function.control_plane.name
  role     = "roles/run.invoker"
  member   = google_service_account.probe.member
}
