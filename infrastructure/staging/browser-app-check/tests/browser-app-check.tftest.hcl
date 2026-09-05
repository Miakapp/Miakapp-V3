mock_provider "google" {}

mock_provider "google-beta" {}

run "enables_only_the_recaptcha_enterprise_api_prerequisite" {
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

  override_data {
    target = data.google_firebase_web_app.staging
    values = {
      app_id       = "1:1072737219170:web:5053ca93bf25d7373cd73b"
      display_name = "Miakapp V4 Staging Web"
      name         = "projects/miakapp-v4-staging/webApps/1:1072737219170:web:5053ca93bf25d7373cd73b"
    }
  }

  assert {
    condition = (
      google_project_service.recaptcha_enterprise.service == "recaptchaenterprise.googleapis.com" &&
      google_project_service.recaptcha_enterprise.disable_on_destroy == false &&
      google_project_service.recaptcha_enterprise.disable_dependent_services == false &&
      google_project_service.recaptcha_enterprise.deletion_policy == "PREVENT"
    )
    error_message = "The reCAPTCHA API must be enabled without destructive service teardown semantics."
  }

  assert {
    condition = (
      output.staging_browser_app_check_api.recaptcha_api_enabled == true &&
      output.staging_browser_app_check_api.recaptcha_keys_created == 0 &&
      output.staging_browser_app_check_api.app_check_registered == false &&
      output.staging_browser_app_check_api.app_check_enforcement == false &&
      output.staging_browser_app_check_api.debug_tokens == 0 &&
      output.staging_browser_app_check_api.public_endpoints_created == 0 &&
      output.staging_browser_app_check_api.fixed_cost_services == 0
    )
    error_message = "The prerequisite must not create a key, register App Check, enable enforcement, or expose a service."
  }
}

run "rejects_a_foreign_web_app" {
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

  override_data {
    target = data.google_firebase_web_app.staging
    values = {
      app_id       = "1:1072737219170:web:5053ca93bf25d7373cd73b"
      display_name = "Foreign app"
      name         = "projects/miakapp-v4-staging/webApps/1:1072737219170:web:5053ca93bf25d7373cd73b"
    }
  }

  expect_failures = [terraform_data.browser_app_check_guard]
}
