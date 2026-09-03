output "staging_workload" {
  description = "Non-secret identifiers for independent private-deployment inventory."
  value = {
    schema                  = "miakapp.staging-workload/1"
    project_id              = local.project_id
    project_number          = local.project_number
    region                  = local.region
    function_name           = google_cloudfunctions2_function.control_plane.name
    function_uri            = google_cloudfunctions2_function.control_plane.service_config[0].uri
    function_service        = google_cloudfunctions2_function.control_plane.service_config[0].service
    runtime_service_account = data.google_service_account.runtime.email
    build_service_account   = google_service_account.build.email
    probe_service_account   = google_service_account.probe.email
    source_bucket           = google_storage_bucket.source.name
    source_object           = google_storage_bucket_object.source.name
    source_generation       = google_storage_bucket_object.source.generation
    source_sha256           = var.source_archive_sha256
    repository_commit       = var.repository_commit
    artifact_repository     = google_artifact_registry_repository.function.id
    fcm_role                = google_project_iam_custom_role.fcm_sender.name
    ingress                 = "ALLOW_INTERNAL_ONLY"
    unauthenticated         = false
    minimum_instances       = 0
    maximum_instances       = 1
  }
}
