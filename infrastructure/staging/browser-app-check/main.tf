data "terraform_remote_state" "foundation" {
  backend = "gcs"

  config = {
    bucket = local.state_bucket_name
    prefix = local.foundation_prefix
  }
}

data "google_firebase_web_app" "staging" {
  provider = google-beta

  project = local.project_id
  app_id  = local.firebase_app_id
}

resource "terraform_data" "browser_app_check_guard" {
  input = {
    foundation = data.terraform_remote_state.foundation.outputs.staging_foundation
    web_app = {
      app_id       = data.google_firebase_web_app.staging.app_id
      display_name = data.google_firebase_web_app.staging.display_name
      name         = data.google_firebase_web_app.staging.name
    }
  }

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
      error_message = "The remote foundation state does not match the reviewed browser App Check boundary."
    }

    precondition {
      condition = try(
        data.google_firebase_web_app.staging.app_id == local.firebase_app_id &&
        data.google_firebase_web_app.staging.display_name == local.firebase_display_name &&
        data.google_firebase_web_app.staging.name == local.firebase_app_name,
        false,
      )
      error_message = "The live Firebase Web app does not match the reviewed browser App Check boundary."
    }
  }
}

resource "google_project_service" "recaptcha_enterprise" {
  project                    = local.project_id
  service                    = local.recaptcha_api
  disable_on_destroy         = false
  disable_dependent_services = false
  deletion_policy            = "PREVENT"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.browser_app_check_guard]
}

resource "google_recaptcha_enterprise_key" "browser_app_check" {
  project         = local.project_id
  display_name    = local.recaptcha_display_name
  labels          = local.labels
  deletion_policy = "DELETE"

  web_settings {
    integration_type  = "SCORE"
    allow_all_domains = false
    allowed_domains   = [local.hosting_domain]
    allow_amp_traffic = false
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.recaptcha_enterprise]
}

resource "google_firebase_app_check_recaptcha_enterprise_config" "browser_app_check" {
  provider = google-beta

  project   = local.project_id
  app_id    = data.google_firebase_web_app.staging.app_id
  site_key  = google_recaptcha_enterprise_key.browser_app_check.name
  token_ttl = "3600s"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_recaptcha_enterprise_key.browser_app_check]
}
