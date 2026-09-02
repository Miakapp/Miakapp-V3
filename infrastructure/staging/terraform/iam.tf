resource "google_storage_bucket_iam_member" "component_objects" {
  for_each = local.component_storage_roles

  bucket = data.google_storage_bucket.components.name
  role   = each.value
  member = data.google_service_account.control_plane.member
}

resource "google_kms_crypto_key_iam_member" "access_token_signer" {
  crypto_key_id = google_kms_crypto_key.access_token_signing.id
  role          = "roles/cloudkms.signerVerifier"
  member        = data.google_service_account.control_plane.member
}

resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each = google_secret_manager_secret.runtime

  project   = local.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = data.google_service_account.control_plane.member
}
