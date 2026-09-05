output "staging_auth_probe" {
  description = "Non-secret identifiers for the temporary audience-bound user-relay probe."
  value = {
    schema              = "miakapp.staging-auth-probe/2"
    project_id          = local.project_id
    project_number      = local.project_number
    region              = local.region
    armed               = var.armed
    asset_inventory_api = google_project_service.auth_probe_asset_inventory.service
    custom_role         = google_project_iam_custom_role.auth_probe_generation_2.name
    signer_role         = google_project_iam_custom_role.auth_probe_signer_generation_2.name
    firestore_role      = google_project_iam_custom_role.auth_probe_firestore_generation_2.name
    role_generation     = 2
    retired_custom_roles = [
      google_project_iam_custom_role.auth_probe_generation_1.name,
      google_project_iam_custom_role.auth_probe_firestore_generation_1.name,
      google_project_iam_custom_role.auth_probe_signer_generation_1.name,
    ]
    workflow_name            = var.armed ? google_workflows_workflow.auth_probe[0].name : null
    workflow_revision        = var.armed ? google_workflows_workflow.auth_probe[0].revision_id : null
    workflow_service_account = var.armed ? google_workflows_workflow.auth_probe[0].service_account : null
    workflow_source_sha256   = sha256(local.workflow_source)
    verifier_service_name    = var.armed ? google_cloud_run_v2_service.auth_probe_verifier[0].name : null
    verifier_service_uri     = var.armed ? google_cloud_run_v2_service.auth_probe_verifier[0].uri : null
    verifier_service_account = google_service_account.auth_probe_verifier.email
    verifier_source_sha256   = sha256(local.verifier_source)
    verifier_image           = local.expected_workload_image
    capability_expiry        = local.capability_expiry
    function_name            = local.function_name
    function_uri             = local.function_uri
    firebase_app_id          = local.firebase_app_id
    destination_path         = local.destination_path
    scheduled                = false
    retry                    = false
  }
}
