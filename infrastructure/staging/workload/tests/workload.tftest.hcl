mock_provider "google" {
  override_data {
    target = data.google_service_account.runtime
    values = {
      email    = "miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com"
      member   = "serviceAccount:miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com"
      disabled = false
    }
  }

  override_resource {
    target = google_service_account.build
    values = {
      email  = "miakapp-control-build@miakapp-v4-staging.iam.gserviceaccount.com"
      member = "serviceAccount:miakapp-control-build@miakapp-v4-staging.iam.gserviceaccount.com"
      name   = "projects/miakapp-v4-staging/serviceAccounts/miakapp-control-build@miakapp-v4-staging.iam.gserviceaccount.com"
    }
  }

  override_resource {
    target = google_service_account.probe
    values = {
      email  = "miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com"
      member = "serviceAccount:miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com"
      name   = "projects/miakapp-v4-staging/serviceAccounts/miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com"
    }
  }
}

mock_provider "google-beta" {}

variables {
  source_archive_path   = "tests/synthetic-source.txt"
  source_archive_sha256 = "d47677ba5cfc3702c4184e29ee09bda88e581856a01f48df305a970751d06fa1"
  repository_commit     = "1111111111111111111111111111111111111111"
  operator_user_email   = "operator@example.test"
}

run "accepts_the_exact_foundation_and_private_workload_shape" {
  command = plan

  override_data {
    target = data.terraform_remote_state.bootstrap
    values = {
      outputs = {
        foundation_activation = {
          schema                  = "miakapp.staging-bootstrap/1"
          project_id              = "miakapp-v4-staging"
          project_number          = "1072737219170"
          region                  = "europe-west9"
          state_bucket            = "miakapp-v4-staging-tfstate-1072737219170"
          bootstrap_prefix        = "terraform/bootstrap"
          foundation_prefix       = "terraform/foundation"
          runtime_service_account = "miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com"
        }
      }
    }
  }

  override_data {
    target = data.terraform_remote_state.foundation
    values = {
      outputs = {
        staging_foundation = {
          project_id              = "miakapp-v4-staging"
          project_number          = "1072737219170"
          region                  = "europe-west9"
          runtime_service_account = "miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com"
          firestore_database      = "(default)"
          component_bucket        = "miakapp-v4-staging-components"
          signing_key             = "projects/miakapp-v4-staging/locations/europe-west9/keyRings/miakapp-v4-staging/cryptoKeys/access-token-signing"
          secret_ids = [
            "miakapp-push-hmac",
            "miakapp-network-hmac",
            "miakapp-home-key-pepper",
            "miakapp-component-hmac",
            "miakapp-audit-hmac",
          ]
        }
      }
    }
  }

  override_resource {
    target = terraform_data.deployment_guard
    values = {
      input = {
        source_archive = "d47677ba5cfc3702c4184e29ee09bda88e581856a01f48df305a970751d06fa1"
      }
    }
  }

  assert {
    condition     = google_cloudfunctions2_function.control_plane.service_config[0].min_instance_count == 0
    error_message = "The private workload must scale to zero."
  }

  assert {
    condition     = google_cloudfunctions2_function.control_plane.service_config[0].max_instance_count == 1
    error_message = "The private workload must remain capped at one instance."
  }

  assert {
    condition     = google_cloudfunctions2_function.control_plane.service_config[0].ingress_settings == "ALLOW_INTERNAL_ONLY"
    error_message = "The first workload must reject public-network ingress."
  }

  assert {
    condition     = google_project_iam_custom_role.fcm_sender.permissions == toset(["cloudmessaging.messages.create"])
    error_message = "The runtime FCM role must contain exactly one permission."
  }

  assert {
    condition = (
      google_service_account.probe.account_id == "miakapp-staging-probe" &&
      google_cloud_run_v2_service_iam_member.probe_invoker.role == "roles/run.invoker"
    )
    error_message = "Only the dedicated synthetic probe may invoke the private service."
  }
}
