output "staging_auth_probe" {
  description = "Non-secret identifiers for the temporary Auth and App Check probe."
  value = {
    schema                   = "miakapp.staging-auth-probe/1"
    project_id               = local.project_id
    project_number           = local.project_number
    region                   = local.region
    armed                    = var.armed
    custom_role              = google_project_iam_custom_role.auth_probe.name
    workflow_name            = var.armed ? google_workflows_workflow.auth_probe[0].name : null
    workflow_revision        = var.armed ? google_workflows_workflow.auth_probe[0].revision_id : null
    workflow_service_account = var.armed ? google_workflows_workflow.auth_probe[0].service_account : null
    workflow_source_sha256   = sha256(local.workflow_source)
    function_name            = local.function_name
    function_uri             = local.function_uri
    firebase_app_id          = local.firebase_app_id
    destination_path         = local.destination_path
    scheduled                = false
    retry                    = false
  }
}
