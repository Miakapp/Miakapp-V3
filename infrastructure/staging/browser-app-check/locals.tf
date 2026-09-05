locals {
  project_id            = "miakapp-v4-staging"
  project_number        = "1072737219170"
  region                = "europe-west9"
  state_bucket_name     = "miakapp-v4-staging-tfstate-1072737219170"
  foundation_prefix     = "terraform/foundation"
  firebase_app_id       = "1:1072737219170:web:5053ca93bf25d7373cd73b"
  firebase_app_name     = "projects/miakapp-v4-staging/webApps/1:1072737219170:web:5053ca93bf25d7373cd73b"
  firebase_display_name = "Miakapp V4 Staging Web"
  recaptcha_api         = "recaptchaenterprise.googleapis.com"

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
    purpose     = "browser-app-check"
  }
}
