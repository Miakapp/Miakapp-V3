output "staging_browser_relays" {
  description = "Non-secret lifecycle and endpoint inventory for the bounded relay services."
  value = {
    schema                = "miakapp.staging-browser-relay-services/1"
    deployment_phase      = var.deployment_phase
    project_id            = local.profile.project_id
    project_number        = local.profile.project_number
    region                = local.profile.region
    relay_source_commit   = local.profile.pins.miakapp_server_commit
    relay_image           = local.relay_image
    runtime_identity      = local.enabled ? google_service_account.relay["runtime"].email : null
    runtime_project_roles = local.profile.runtime_identity.project_roles
    services = {
      for id, service in google_cloud_run_v2_service.relay : id => {
        name                = service.name
        uri                 = service.uri
        audience            = local.selected_audiences[id]
        public_invoker      = contains(keys(google_cloud_run_v2_service_iam_member.public), id)
        minimum_instances   = local.profile.cloud_run.minimum_instances
        maximum_instances   = local.profile.cloud_run.maximum_instances
        concurrency         = local.profile.cloud_run.concurrency
        timeout_seconds     = local.profile.cloud_run.request_timeout_seconds
        deletion_protection = local.profile.cloud_run.deletion_protection
      }
    }
  }
}
