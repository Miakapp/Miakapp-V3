provider "google" {
  project                         = local.project_id
  region                          = local.region
  billing_project                 = local.project_id
  user_project_override           = true
  add_terraform_attribution_label = false

  default_labels = local.labels
}

provider "google-beta" {
  project                         = local.project_id
  region                          = local.region
  billing_project                 = local.project_id
  user_project_override           = true
  add_terraform_attribution_label = false

  default_labels = local.labels
}
