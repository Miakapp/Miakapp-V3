provider "google" {
  project = local.project_id
  region  = local.region

  default_labels = local.labels
}

provider "google-beta" {
  project = local.project_id
  region  = local.region

  default_labels = local.labels
}
