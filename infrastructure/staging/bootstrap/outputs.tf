output "foundation_activation" {
  description = "Non-secret bootstrap identity consumed by the staging foundation root."
  value = {
    schema                     = "miakapp.staging-bootstrap/1"
    project_id                 = local.project_id
    project_number             = local.project_number
    region                     = local.region
    state_bucket               = google_storage_bucket.terraform_state.name
    bootstrap_prefix           = local.bootstrap_prefix
    foundation_prefix          = local.foundation_prefix
    planner_service_account    = google_service_account.planner.email
    deployer_service_account   = google_service_account.deployer.email
    runtime_service_account    = google_service_account.control_plane.email
    component_bucket           = google_storage_bucket.components.name
    plan_provider              = google_iam_workload_identity_pool_provider.plan.name
    apply_provider             = google_iam_workload_identity_pool_provider.apply.name
    github_repository_id       = local.github_repository_id
    github_repository_owner_id = local.github_repository_owner_id
  }
}
