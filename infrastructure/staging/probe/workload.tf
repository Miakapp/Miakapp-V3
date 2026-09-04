data "terraform_remote_state" "workload" {
  backend = "gcs"

  config = {
    bucket = local.state_bucket_name
    prefix = local.workload_prefix
  }
}

resource "terraform_data" "probe_guard" {
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
    workflow_source_sha256 = sha256(local.workflow_source)
  }

  lifecycle {
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
        data.terraform_remote_state.workload.outputs.staging_workload.maximum_instances == 1,
        false,
      )
      error_message = "The deployed workload no longer matches the reviewed private-probe boundary."
    }
  }
}

resource "google_project_service" "workflows" {
  project            = local.project_id
  service            = "workflows.googleapis.com"
  disable_on_destroy = false

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.probe_guard]
}

resource "google_workflows_workflow" "private_probe" {
  project                 = local.project_id
  region                  = local.region
  name                    = local.workflow_name
  description             = "Single-purpose private discovery probe for the Miakapp V4 staging control plane."
  service_account         = local.probe_service_account
  source_contents         = local.workflow_source
  call_log_level          = "LOG_NONE"
  execution_history_level = "EXECUTION_HISTORY_BASIC"
  deletion_protection     = true
  labels                  = local.labels

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.workflows]
}
