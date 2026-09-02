data "google_service_account" "control_plane" {
  project    = local.project_id
  account_id = local.runtime_service_account_id

  depends_on = [terraform_data.bootstrap_guard]

  lifecycle {
    postcondition {
      condition = (
        self.email == local.runtime_service_account &&
        self.disabled == false
      )
      error_message = "The bootstrap runtime service account is missing, disabled or foreign."
    }
  }
}

data "google_storage_bucket" "components" {
  name = local.component_bucket_name

  depends_on = [terraform_data.bootstrap_guard]

  lifecycle {
    postcondition {
      condition = (
        self.project == local.project_id &&
        lower(self.location) == local.region &&
        self.storage_class == "STANDARD" &&
        self.uniform_bucket_level_access == true &&
        self.public_access_prevention == "enforced" &&
        length(self.cors) == 0 &&
        try(self.versioning[0].enabled == false, false) &&
        try(self.soft_delete_policy[0].retention_duration_seconds == 0, false)
      )
      error_message = "The bootstrap component bucket is missing or violates the private staging profile."
    }
  }
}

resource "google_firestore_database" "default" {
  project     = local.project_id
  name        = "(default)"
  location_id = local.region
  type        = "FIRESTORE_NATIVE"

  database_edition                  = "STANDARD"
  app_engine_integration_mode       = "DISABLED"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_DISABLED"
  delete_protection_state           = "DELETE_PROTECTION_ENABLED"
  deletion_policy                   = "ABANDON"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    terraform_data.bootstrap_guard,
    google_project_service.required["firestore.googleapis.com"],
  ]
}

resource "google_firestore_field" "ttl" {
  for_each = local.firestore_ttl_fields

  project    = local.project_id
  database   = google_firestore_database.default.name
  collection = each.key
  field      = each.value

  ttl_config {}
  index_config {}
}

resource "google_kms_key_ring" "access_tokens" {
  project  = local.project_id
  name     = local.kms_key_ring_name
  location = local.region

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    terraform_data.bootstrap_guard,
    google_project_service.required["cloudkms.googleapis.com"],
  ]
}

resource "google_kms_crypto_key" "access_token_signing" {
  name            = local.kms_signing_key_name
  key_ring        = google_kms_key_ring.access_tokens.id
  purpose         = "ASYMMETRIC_SIGN"
  deletion_policy = "PREVENT"

  version_template {
    algorithm        = "EC_SIGN_ED25519"
    protection_level = "SOFTWARE"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret" "runtime" {
  for_each = local.secret_ids

  project             = local.project_id
  secret_id           = each.value
  deletion_protection = true

  replication {
    auto {}
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    terraform_data.bootstrap_guard,
    google_project_service.required["secretmanager.googleapis.com"],
  ]
}
