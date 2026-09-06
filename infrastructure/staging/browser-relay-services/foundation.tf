data "terraform_remote_state" "workload" {
  count   = local.enabled ? 1 : 0
  backend = "gcs"

  config = {
    bucket = local.profile.state_backend.bucket
    prefix = "terraform/workload"
  }
}

resource "terraform_data" "deployment_guard" {
  for_each = local.enabled ? { active = true } : {}

  input = {
    deployment_phase    = var.deployment_phase
    profile_sha256      = local.profile.operation.converged_profile_sha256
    relay_audiences     = local.selected_audiences
    relay_image         = local.relay_image
    relay_source_commit = local.profile.pins.miakapp_server_commit
  }

  lifecycle {
    precondition {
      condition = try(
        data.terraform_remote_state.workload[0].outputs.staging_workload.schema == "miakapp.staging-workload/1" &&
        data.terraform_remote_state.workload[0].outputs.staging_workload.project_id == local.profile.project_id &&
        data.terraform_remote_state.workload[0].outputs.staging_workload.project_number == local.profile.project_number &&
        data.terraform_remote_state.workload[0].outputs.staging_workload.region == local.profile.region &&
        data.terraform_remote_state.workload[0].outputs.staging_workload.repository_commit == local.profile.pins.deployed_control_plane_commit &&
        data.terraform_remote_state.workload[0].outputs.staging_workload.source_sha256 == local.profile.pins.deployed_control_plane_source_sha256 &&
        data.terraform_remote_state.workload[0].outputs.staging_workload.artifact_repository == "projects/${local.profile.project_id}/locations/${local.profile.region}/repositories/miakapp-control-plane" &&
        data.terraform_remote_state.workload[0].outputs.staging_workload.ingress == "ALLOW_INTERNAL_ONLY" &&
        data.terraform_remote_state.workload[0].outputs.staging_workload.unauthenticated == false &&
        data.terraform_remote_state.workload[0].outputs.staging_workload.minimum_instances == 0 &&
        data.terraform_remote_state.workload[0].outputs.staging_workload.maximum_instances == 1,
        false,
      )
      error_message = "The deployed private control-plane workload does not match the reviewed relay baseline."
    }

    precondition {
      condition = (
        var.deployment_phase == "private_bootstrap" ?
        var.relay_audiences == local.bootstrap_audiences :
        local.ready_audiences
      )
      error_message = "The lifecycle phase and exact relay audiences are inconsistent."
    }

    precondition {
      condition = (
        local.relay_image == local.profile.image.digest_reference &&
        startswith(local.relay_image, "${local.profile.image.repository}@sha256:") &&
        length(regexall("@", local.relay_image)) == 1 &&
        local.profile.image.digest_required == true &&
        local.profile.image.mutable_tags_allowed == false
      )
      error_message = "The relay container must remain digest-pinned in the reviewed repository."
    }

    precondition {
      condition     = local.terraform_source_sha256 == local.profile.terraform_source_sha256
      error_message = "The operational Terraform source does not match the reviewed relay-services profile."
    }
  }
}
