data "terraform_remote_state" "foundation" {
  backend = "gcs"

  config = {
    bucket = local.state_bucket_name
    prefix = local.foundation_prefix
  }
}

resource "terraform_data" "firebase_auth_guard" {
  input = data.terraform_remote_state.foundation.outputs.staging_foundation

  lifecycle {
    prevent_destroy = true

    precondition {
      condition = try(
        data.terraform_remote_state.foundation.outputs.staging_foundation.project_id == local.project_id &&
        data.terraform_remote_state.foundation.outputs.staging_foundation.project_number == local.project_number &&
        data.terraform_remote_state.foundation.outputs.staging_foundation.region == local.region &&
        data.terraform_remote_state.foundation.outputs.staging_foundation.runtime_service_account == "miakapp-control-plane@${local.project_id}.iam.gserviceaccount.com" &&
        data.terraform_remote_state.foundation.outputs.staging_foundation.firestore_database == "(default)" &&
        data.terraform_remote_state.foundation.outputs.staging_foundation.component_bucket == "miakapp-v4-staging-components" &&
        data.terraform_remote_state.foundation.outputs.staging_foundation.signing_key == "projects/${local.project_id}/locations/${local.region}/keyRings/${local.project_id}/cryptoKeys/access-token-signing" &&
        length(data.terraform_remote_state.foundation.outputs.staging_foundation.secret_ids) == length(local.expected_secret_ids) &&
        toset(data.terraform_remote_state.foundation.outputs.staging_foundation.secret_ids) == toset(local.expected_secret_ids),
        false,
      )
      error_message = "The remote foundation state does not match the reviewed Firebase Auth boundary."
    }
  }
}

resource "google_identity_platform_config" "firebase_auth" {
  project                    = local.project_id
  autodelete_anonymous_users = true

  client {
    permissions {
      disabled_user_deletion = false
      disabled_user_signup   = false
    }
  }

  mfa {
    state = "DISABLED"
  }

  monitoring {
    request_logging {
      enabled = false
    }
  }

  multi_tenant {
    allow_tenants = false
  }

  sign_in {
    allow_duplicate_emails = false

    anonymous {
      enabled = false
    }

    email {
      enabled           = false
      password_required = true
    }

    phone_number {
      enabled = false
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.firebase_auth_guard]
}
