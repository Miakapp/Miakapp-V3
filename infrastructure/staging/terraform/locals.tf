locals {
  project_id           = "miakapp-v4-staging"
  project_number       = "1072737219170"
  project_display_name = "Miakapp V4 Staging"
  region               = "europe-west9"

  runtime_service_account_id = "miakapp-control-plane"
  runtime_service_account    = "miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com"
  component_bucket_name      = "miakapp-v4-staging-components"
  kms_key_ring_name          = "miakapp-v4-staging"
  kms_signing_key_name       = "access-token-signing"

  state_bucket_name          = "miakapp-v4-staging-tfstate-1072737219170"
  bootstrap_prefix           = "terraform/bootstrap"
  foundation_prefix          = "terraform/foundation"
  planner_service_account    = "miakapp-tf-plan@miakapp-v4-staging.iam.gserviceaccount.com"
  deployer_service_account   = "miakapp-tf-apply@miakapp-v4-staging.iam.gserviceaccount.com"
  plan_provider              = "projects/1072737219170/locations/global/workloadIdentityPools/miakapp-github/providers/staging-plan"
  apply_provider             = "projects/1072737219170/locations/global/workloadIdentityPools/miakapp-github/providers/staging-apply"
  github_repository_id       = "354682190"
  github_repository_owner_id = "83046838"

  expected_bootstrap = {
    schema = "miakapp.staging-bootstrap/1"
  }

  labels = {
    environment = "staging"
    managed-by  = "terraform"
    product     = "miakapp-v4"
  }

  required_service_apis = toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudfunctions.googleapis.com",
    "cloudkms.googleapis.com",
    "eventarc.googleapis.com",
    "fcm.googleapis.com",
    "firebaseappcheck.googleapis.com",
    "firestore.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
  ])

  secret_ids = toset([
    "miakapp-audit-hmac",
    "miakapp-component-hmac",
    "miakapp-home-key-pepper",
    "miakapp-network-hmac",
    "miakapp-push-hmac",
  ])

  firestore_ttl_fields = {
    controlAdmissionBuckets = "expires_at"
    controlAudit            = "expires_at"
    pushChallenges          = "expires_at"
  }

  component_storage_roles = toset([
    "roles/storage.objectCreator",
    "roles/storage.objectViewer",
  ])
}
