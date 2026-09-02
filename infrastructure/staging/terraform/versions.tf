terraform {
  required_version = "= 1.11.3"

  backend "gcs" {
    bucket = "miakapp-v4-staging-tfstate-1072737219170"
    prefix = "terraform/foundation"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 8.1.0"
    }

    google-beta = {
      source  = "hashicorp/google-beta"
      version = "= 8.1.0"
    }
  }
}
