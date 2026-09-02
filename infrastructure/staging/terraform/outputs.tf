output "staging_foundation" {
  description = "Non-secret identifiers for review; this output is not deployment evidence."
  value = {
    project_id              = local.project_id
    project_number          = local.project_number
    region                  = local.region
    runtime_service_account = data.google_service_account.control_plane.email
    firestore_database      = google_firestore_database.default.name
    component_bucket        = data.google_storage_bucket.components.name
    signing_key             = google_kms_crypto_key.access_token_signing.id
    secret_ids              = sort(tolist(local.secret_ids))
  }
}
