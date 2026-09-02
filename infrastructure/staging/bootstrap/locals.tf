locals {
  project_id           = "miakapp-v4-staging"
  project_number       = "1072737219170"
  project_display_name = "Miakapp V4 Staging"
  region               = "europe-west9"

  approved_billing_account_sha256 = "4557923f1be719b78ee844b14bfa4654be3eb3fa785a2cb5a2624c3f85d12270"

  state_bucket_name = "miakapp-v4-staging-tfstate-1072737219170"
  bootstrap_prefix  = "terraform/bootstrap"
  foundation_prefix = "terraform/foundation"
  plan_prefix       = "plans/"

  github_repository          = "Miakapp/Miakapp-V3"
  github_repository_id       = "354682190"
  github_repository_owner_id = "83046838"
  github_ref                 = "refs/heads/main"
  github_workflow_ref        = "Miakapp/Miakapp-V3/.github/workflows/staging-terraform.yml@refs/heads/main"
  github_plan_environment    = "miakapp-v4-staging-plan"
  github_apply_environment   = "miakapp-v4-staging-apply"

  workload_identity_pool_id = "miakapp-github"
  plan_provider_id          = "staging-plan"
  apply_provider_id         = "staging-apply"
  planner_account_id        = "miakapp-tf-plan"
  deployer_account_id       = "miakapp-tf-apply"
  runtime_account_id        = "miakapp-control-plane"
  component_bucket_name     = "miakapp-v4-staging-components"

  labels = {
    environment = "staging"
    managed-by  = "terraform"
    product     = "miakapp-v4"
  }

  bootstrap_service_apis = toset([
    "billingbudgets.googleapis.com",
    "cloudbilling.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "serviceusage.googleapis.com",
    "sts.googleapis.com",
    "storage.googleapis.com",
  ])

  planner_project_roles = toset([
    "roles/iam.securityReviewer",
    "roles/viewer",
  ])

  deployer_project_roles = toset([
    "roles/cloudkms.admin",
    "roles/datastore.owner",
    "roles/secretmanager.admin",
    "roles/serviceusage.serviceUsageAdmin",
  ])

  runtime_project_roles = toset([
    "roles/datastore.user",
    "roles/firebaseappcheck.tokenVerifier",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ])

  github_attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.environment"         = "assertion.environment"
    "attribute.ref"                 = "assertion.ref"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.workflow_ref"        = "assertion.workflow_ref"
  }
}
