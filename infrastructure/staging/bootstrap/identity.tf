resource "google_service_account" "planner" {
  project      = local.project_id
  account_id   = local.planner_account_id
  display_name = "Miakapp V4 staging Terraform planner"
  description  = "Keyless CI identity: state access and infrastructure reads only."

  deletion_policy = "PREVENT"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    google_billing_budget.staging,
    google_project_service.bootstrap["iam.googleapis.com"],
  ]
}

resource "google_service_account" "deployer" {
  project      = local.project_id
  account_id   = local.deployer_account_id
  display_name = "Miakapp V4 staging Terraform deployer"
  description  = "Keyless CI identity: protected-environment foundation mutation only."

  deletion_policy = "PREVENT"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    google_billing_budget.staging,
    google_project_service.bootstrap["iam.googleapis.com"],
  ]
}

resource "google_service_account" "control_plane" {
  project      = local.project_id
  account_id   = local.runtime_account_id
  display_name = "Miakapp V4 staging control plane"
  description  = "Dedicated scale-to-zero control-plane runtime identity."

  deletion_policy = "PREVENT"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    google_billing_budget.staging,
    google_project_service.bootstrap["iam.googleapis.com"],
  ]
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = local.project_id
  workload_identity_pool_id = local.workload_identity_pool_id
  display_name              = "Miakapp GitHub Actions"
  description               = "GitHub Actions identities restricted to the immutable Miakapp repository IDs."
  disabled                  = false
  deletion_policy           = "PREVENT"

  depends_on = [
    google_billing_budget.staging,
    google_project_service.bootstrap["iam.googleapis.com"],
    google_project_service.bootstrap["sts.googleapis.com"],
  ]
}

resource "google_iam_workload_identity_pool_provider" "plan" {
  project                            = local.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = local.plan_provider_id
  display_name                       = "Staging Terraform plan"
  description                        = "Main-branch plan workflow in the protected staging plan environment."
  # Recovery automation is retired. Keep the reviewed trust definition in
  # state, but prevent historical workflow reruns from minting credentials.
  disabled        = true
  deletion_policy = "PREVENT"

  attribute_mapping = local.github_attribute_mapping
  attribute_condition = join(" && ", [
    "assertion.repository_id == '${local.github_repository_id}'",
    "assertion.repository_owner_id == '${local.github_repository_owner_id}'",
    "assertion.ref == '${local.github_ref}'",
    "assertion.environment == '${local.github_plan_environment}'",
    "assertion.workflow_ref == '${local.github_workflow_ref}'",
  ])

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_iam_workload_identity_pool_provider" "apply" {
  project                            = local.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = local.apply_provider_id
  display_name                       = "Staging Terraform apply"
  description                        = "Main-branch apply workflow in the reviewed staging apply environment."
  # Recovery automation is retired. Keep the reviewed trust definition in
  # state, but prevent historical workflow reruns from minting credentials.
  disabled        = true
  deletion_policy = "PREVENT"

  attribute_mapping = local.github_attribute_mapping
  attribute_condition = join(" && ", [
    "assertion.repository_id == '${local.github_repository_id}'",
    "assertion.repository_owner_id == '${local.github_repository_owner_id}'",
    "assertion.ref == '${local.github_ref}'",
    "assertion.environment == '${local.github_apply_environment}'",
    "assertion.workflow_ref == '${local.github_workflow_ref}'",
  ])

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "planner_federation" {
  service_account_id = google_service_account.planner.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.environment/${local.github_plan_environment}"

  depends_on = [google_iam_workload_identity_pool_provider.plan]
}

resource "google_service_account_iam_member" "deployer_federation" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.environment/${local.github_apply_environment}"

  depends_on = [google_iam_workload_identity_pool_provider.apply]
}
