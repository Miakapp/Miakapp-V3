data "terraform_remote_state" "bootstrap" {
  backend = "gcs"

  config = {
    bucket = local.state_bucket_name
    prefix = local.bootstrap_prefix
  }
}

data "terraform_remote_state" "foundation" {
  backend = "gcs"

  config = {
    bucket = local.state_bucket_name
    prefix = local.foundation_prefix
  }
}

data "google_service_account" "runtime" {
  project    = local.project_id
  account_id = local.runtime_account_id
}

resource "terraform_data" "deployment_guard" {
  input = {
    bootstrap      = data.terraform_remote_state.bootstrap.outputs.foundation_activation
    foundation     = data.terraform_remote_state.foundation.outputs.staging_foundation
    runtime_config = local.runtime_config_sha256
    source_archive = var.source_archive_sha256
    source_commit  = var.repository_commit
  }

  lifecycle {
    precondition {
      condition = try(
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.schema == "miakapp.staging-bootstrap/1" &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.project_id == local.project_id &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.project_number == local.project_number &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.region == local.region &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.state_bucket == local.state_bucket_name &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.bootstrap_prefix == local.bootstrap_prefix &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.foundation_prefix == local.foundation_prefix &&
        data.terraform_remote_state.bootstrap.outputs.foundation_activation.runtime_service_account == local.runtime_account,
        false,
      )
      error_message = "The remote bootstrap identity does not match the reviewed staging workload boundary."
    }

    precondition {
      condition = try(
        data.terraform_remote_state.foundation.outputs.staging_foundation.project_id == local.project_id &&
        data.terraform_remote_state.foundation.outputs.staging_foundation.project_number == local.project_number &&
        data.terraform_remote_state.foundation.outputs.staging_foundation.region == local.region &&
        data.terraform_remote_state.foundation.outputs.staging_foundation.runtime_service_account == local.runtime_account &&
        data.terraform_remote_state.foundation.outputs.staging_foundation.firestore_database == "(default)" &&
        data.terraform_remote_state.foundation.outputs.staging_foundation.component_bucket == "miakapp-v4-staging-components" &&
        data.terraform_remote_state.foundation.outputs.staging_foundation.signing_key == "projects/${local.project_id}/locations/${local.region}/keyRings/${local.project_id}/cryptoKeys/access-token-signing" &&
        data.terraform_remote_state.foundation.outputs.staging_foundation.secret_ids == local.expected_foundation_secret_ids,
        false,
      )
      error_message = "The remote foundation state does not match the reviewed staging workload boundary."
    }

    precondition {
      condition = (
        filesha256(local.runtime_config_path) == local.runtime_config_sha256 &&
        filesha256(var.source_archive_path) == var.source_archive_sha256 &&
        data.google_service_account.runtime.email == local.runtime_account &&
        data.google_service_account.runtime.disabled == false
      )
      error_message = "Runtime configuration, source archive, operator or runtime identity does not match the reviewed deployment inputs."
    }
  }
}
