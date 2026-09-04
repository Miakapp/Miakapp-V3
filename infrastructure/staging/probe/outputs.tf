output "staging_probe" {
  description = "Non-secret identifiers for the fixed private invocation path."
  value = {
    schema                   = "miakapp.staging-probe/1"
    project_id               = local.project_id
    project_number           = local.project_number
    region                   = local.region
    workflow_name            = google_workflows_workflow.private_probe.name
    workflow_revision        = google_workflows_workflow.private_probe.revision_id
    workflow_service_account = google_workflows_workflow.private_probe.service_account
    workflow_source_sha256   = sha256(local.workflow_source)
    function_name            = local.function_name
    function_uri             = local.function_uri
    discovery_path           = local.discovery_path
    call_log_level           = google_workflows_workflow.private_probe.call_log_level
    execution_history_level  = google_workflows_workflow.private_probe.execution_history_level
    scheduled                = false
    retry                    = false
  }
}
