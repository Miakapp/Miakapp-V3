resource "google_service_account" "build" {
  project      = local.project_id
  account_id   = local.build_account_id
  display_name = "Miakapp V4 staging control-plane builder"
  description  = "Build-only identity for the private staging control-plane package."

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.deployment_guard]
}

resource "google_service_account" "probe" {
  project      = local.project_id
  account_id   = local.probe_account_id
  display_name = "Miakapp V4 staging synthetic probe"
  description  = "Keyless identity allowed to invoke only the private staging control plane."

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.deployment_guard]
}

resource "google_storage_bucket" "source" {
  project                     = local.project_id
  name                        = local.source_bucket_name
  location                    = local.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = false
  }

  soft_delete_policy {
    retention_duration_seconds = 0
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.deployment_guard]
}

resource "google_artifact_registry_repository" "function" {
  project       = local.project_id
  location      = local.region
  repository_id = local.artifact_repository
  description   = "Private images built for the Miakapp V4 staging control plane."
  format        = "DOCKER"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.deployment_guard]
}

resource "google_storage_bucket_object" "source" {
  bucket       = google_storage_bucket.source.name
  name         = "sources/${var.source_archive_sha256}.zip"
  source       = var.source_archive_path
  content_type = "application/zip"

  metadata = {
    repository-commit = local.source_repository_commit
    sha256            = var.source_archive_sha256
  }

  lifecycle {
    ignore_changes = [source]
  }
}

resource "google_cloudfunctions2_function" "control_plane" {
  project     = local.project_id
  name        = local.function_name
  location    = local.region
  description = "Private Miakapp V4 staging control plane."

  build_config {
    runtime           = "nodejs22"
    entry_point       = local.function_entry_point
    docker_repository = google_artifact_registry_repository.function.id
    service_account   = google_service_account.build.id

    source {
      storage_source {
        bucket     = google_storage_bucket.source.name
        object     = google_storage_bucket_object.source.name
        generation = google_storage_bucket_object.source.generation
      }
    }

    on_deploy_update_policy {}
  }

  service_config {
    available_memory                 = "256M"
    available_cpu                    = "1"
    timeout_seconds                  = 30
    min_instance_count               = 0
    max_instance_count               = 1
    max_instance_request_concurrency = 16
    ingress_settings                 = "ALLOW_INTERNAL_ONLY"
    all_traffic_on_latest_revision   = true
    service_account_email            = data.google_service_account.runtime.email

    environment_variables = {
      MIAKAPP_DEPLOYMENT_COMMIT     = var.repository_commit
      MIAKAPP_RUNTIME_CONFIG_JSON   = local.runtime_config_json
      MIAKAPP_SOURCE_ARCHIVE_SHA256 = var.source_archive_sha256
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    google_artifact_registry_repository_iam_member.build_writer,
    google_project_iam_member.build_gcf_source_reader,
    google_project_iam_member.build_logs,
    google_project_iam_member.runtime_fcm,
    google_storage_bucket_iam_member.build_source_reader,
  ]
}
