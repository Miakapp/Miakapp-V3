data "terraform_remote_state" "bootstrap" {
  backend = "gcs"

  config = {
    bucket = local.state_bucket_name
    prefix = local.bootstrap_prefix
  }
}

resource "terraform_data" "bootstrap_guard" {
  input = data.terraform_remote_state.bootstrap.outputs.foundation_activation

  lifecycle {
    precondition {
      condition = try(
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.schema == local.expected_bootstrap.schema &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.project_id == local.project_id &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.project_number == local.project_number &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.region == local.region &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.state_bucket == local.state_bucket_name &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.bootstrap_prefix == local.bootstrap_prefix &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.foundation_prefix == local.foundation_prefix &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.planner_service_account == local.planner_service_account &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.deployer_service_account == local.deployer_service_account &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.runtime_service_account == local.runtime_service_account &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.component_bucket == local.component_bucket_name &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.plan_provider == local.plan_provider &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.apply_provider == local.apply_provider &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.github_repository_id == local.github_repository_id &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.github_repository_owner_id == local.github_repository_owner_id,
        false,
      )
      error_message = "The remote bootstrap state is missing or does not match the reviewed staging identity."
    }
  }
}
