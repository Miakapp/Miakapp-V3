mock_provider "google" {}

mock_provider "google-beta" {}

run "registers_only_the_exact_browser_app_check_provider" {
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
      google_recaptcha_enterprise_key.browser_app_check.project == "miakapp-v4-staging" &&
      google_recaptcha_enterprise_key.browser_app_check.display_name == "Miakapp V4 staging browser App Check" &&
      google_recaptcha_enterprise_key.browser_app_check.deletion_policy == "DELETE" &&
      length(google_recaptcha_enterprise_key.browser_app_check.web_settings) == 1 &&
      google_recaptcha_enterprise_key.browser_app_check.web_settings[0].integration_type == "SCORE" &&
      google_recaptcha_enterprise_key.browser_app_check.web_settings[0].allow_all_domains == false &&
      google_recaptcha_enterprise_key.browser_app_check.web_settings[0].allow_amp_traffic == false &&
      google_recaptcha_enterprise_key.browser_app_check.web_settings[0].allowed_domains == tolist(["miakapp-v4-staging.web.app"]) &&
      length(google_recaptcha_enterprise_key.browser_app_check.testing_options) == 0 &&
      length(google_recaptcha_enterprise_key.browser_app_check.waf_settings) == 0 &&
      output.staging_browser_app_check_key.recaptcha_api_enabled == true &&
      output.staging_browser_app_check_key.recaptcha_key_created == true &&
      google_firebase_app_check_recaptcha_enterprise_config.browser_app_check.project == "miakapp-v4-staging" &&
      google_firebase_app_check_recaptcha_enterprise_config.browser_app_check.app_id == "1:1072737219170:web:5053ca93bf25d7373cd73b" &&
      google_firebase_app_check_recaptcha_enterprise_config.browser_app_check.token_ttl == "3600s" &&
      output.staging_browser_app_check_key.schema == "miakapp.staging-browser-app-check-registration/1" &&
      output.staging_browser_app_check_key.app_check_registered == true &&
      output.staging_browser_app_check_key.app_check_token_ttl == "3600s" &&
      output.staging_browser_app_check_key.app_check_enforcement == false &&
      output.staging_browser_app_check_key.debug_tokens == 0 &&
      output.staging_browser_app_check_key.public_endpoints_created == 0 &&
      output.staging_browser_app_check_key.fixed_cost_services == 0
    )
    error_message = "The registration phase must bind only the exact domain-restricted score key without enforcing App Check."
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
