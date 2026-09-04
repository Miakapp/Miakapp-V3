terraform {
  required_version = "= 1.11.3"

  backend "gcs" {
    bucket = "miakapp-v4-staging-tfstate-1072737219170"
    prefix = "terraform/firebase-auth"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 8.1.0"
    }
  }
}
