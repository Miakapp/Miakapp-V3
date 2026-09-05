provider "google" {
  project               = local.profile.project_id
  region                = local.profile.region
  billing_project       = local.profile.project_id
  user_project_override = true

  default_labels = local.labels
}
