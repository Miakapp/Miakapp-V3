locals {
  project_id        = "miakapp-v4-staging"
  project_number    = "1072737219170"
  region            = "europe-west9"
  state_bucket_name = "miakapp-v4-staging-tfstate-1072737219170"
  foundation_prefix = "terraform/foundation"

  expected_secret_ids = [
    "miakapp-audit-hmac",
    "miakapp-component-hmac",
    "miakapp-home-key-pepper",
    "miakapp-network-hmac",
    "miakapp-push-hmac",
  ]

  labels = {
    environment = "staging"
    managed-by  = "terraform"
    product     = "miakapp-v4"
    purpose     = "firebase-auth"
  }
}
