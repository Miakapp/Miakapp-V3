mock_provider "google" {}

run "creates_only_the_closed_firebase_auth_baseline" {
  command = plan

  override_data {
    target = data.terraform_remote_state.foundation
    values = {
      outputs = {
        staging_foundation = {
          schema                  = "miakapp.staging-foundation/1"
          project_id              = "miakapp-v4-staging"
          project_number          = "1072737219170"
          region                  = "europe-west9"
          runtime_service_account = "miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com"
          firestore_database      = "(default)"
          component_bucket        = "miakapp-v4-staging-components"
          signing_key             = "projects/miakapp-v4-staging/locations/europe-west9/keyRings/miakapp-v4-staging/cryptoKeys/access-token-signing"
          secret_ids = [
            "miakapp-audit-hmac",
            "miakapp-component-hmac",
            "miakapp-home-key-pepper",
            "miakapp-network-hmac",
            "miakapp-push-hmac",
          ]
        }
      }
    }
  }

  assert {
    condition = (
      google_identity_platform_config.firebase_auth.project == "miakapp-v4-staging" &&
      google_identity_platform_config.firebase_auth.autodelete_anonymous_users == true &&
      google_identity_platform_config.firebase_auth.client[0].permissions[0].disabled_user_signup == false &&
      google_identity_platform_config.firebase_auth.client[0].permissions[0].disabled_user_deletion == false
    )
    error_message = "Firebase Auth must permit only the bounded synthetic user lifecycle."
  }

  assert {
    condition = (
      google_identity_platform_config.firebase_auth.sign_in[0].anonymous[0].enabled == false &&
      google_identity_platform_config.firebase_auth.sign_in[0].email[0].enabled == false &&
      google_identity_platform_config.firebase_auth.sign_in[0].phone_number[0].enabled == false &&
      google_identity_platform_config.firebase_auth.sign_in[0].allow_duplicate_emails == false &&
      google_identity_platform_config.firebase_auth.mfa[0].state == "DISABLED" &&
      google_identity_platform_config.firebase_auth.multi_tenant[0].allow_tenants == false &&
      google_identity_platform_config.firebase_auth.monitoring[0].request_logging[0].enabled == false
    )
    error_message = "No public sign-in, tenancy, MFA, or request logging may be enabled."
  }
}

run "rejects_a_changed_foundation" {
  command = plan

  override_data {
    target = data.terraform_remote_state.foundation
    values = {
      outputs = {
        staging_foundation = {
          schema                  = "miakapp.staging-foundation/1"
          project_id              = "miakapp-v4-staging"
          project_number          = "1072737219170"
          region                  = "europe-west1"
          runtime_service_account = "miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com"
          firestore_database      = "(default)"
          component_bucket        = "miakapp-v4-staging-components"
          signing_key             = "projects/miakapp-v4-staging/locations/europe-west9/keyRings/miakapp-v4-staging/cryptoKeys/access-token-signing"
          secret_ids = [
            "miakapp-audit-hmac",
            "miakapp-component-hmac",
            "miakapp-home-key-pepper",
            "miakapp-network-hmac",
            "miakapp-push-hmac",
          ]
        }
      }
    }
  }

  expect_failures = [terraform_data.firebase_auth_guard]
}
