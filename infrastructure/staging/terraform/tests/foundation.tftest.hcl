mock_provider "google" {}
mock_provider "google-beta" {}

run "accepts_the_exact_bootstrap_identity" {
  command = plan

  override_data {
    target = data.terraform_remote_state.bootstrap
    values = {
      outputs = {
        foundation_activation = {
          schema                     = "miakapp.staging-bootstrap/1"
          project_id                 = "miakapp-v4-staging"
          project_number             = "1072737219170"
          region                     = "europe-west9"
          state_bucket               = "miakapp-v4-staging-tfstate-1072737219170"
          bootstrap_prefix           = "terraform/bootstrap"
          foundation_prefix          = "terraform/foundation"
          planner_service_account    = "miakapp-tf-plan@miakapp-v4-staging.iam.gserviceaccount.com"
          deployer_service_account   = "miakapp-tf-apply@miakapp-v4-staging.iam.gserviceaccount.com"
          runtime_service_account    = "miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com"
          component_bucket           = "miakapp-v4-staging-components"
          plan_provider              = "projects/1072737219170/locations/global/workloadIdentityPools/miakapp-github/providers/staging-plan"
          apply_provider             = "projects/1072737219170/locations/global/workloadIdentityPools/miakapp-github/providers/staging-apply"
          github_repository_id       = "354682190"
          github_repository_owner_id = "83046838"
        }
      }
    }
  }

  assert {
    condition     = terraform_data.bootstrap_guard.input.project_id == "miakapp-v4-staging"
    error_message = "The exact bootstrap identity must unlock the foundation graph."
  }
}

run "rejects_a_foreign_bootstrap_identity" {
  command = plan

  override_data {
    target = data.terraform_remote_state.bootstrap
    values = {
      outputs = {
        foundation_activation = {
          schema                     = "miakapp.staging-bootstrap/1"
          project_id                 = "miakapp-3"
          project_number             = "1072737219170"
          region                     = "europe-west9"
          state_bucket               = "miakapp-v4-staging-tfstate-1072737219170"
          bootstrap_prefix           = "terraform/bootstrap"
          foundation_prefix          = "terraform/foundation"
          planner_service_account    = "miakapp-tf-plan@miakapp-v4-staging.iam.gserviceaccount.com"
          deployer_service_account   = "miakapp-tf-apply@miakapp-v4-staging.iam.gserviceaccount.com"
          runtime_service_account    = "miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com"
          component_bucket           = "miakapp-v4-staging-components"
          plan_provider              = "projects/1072737219170/locations/global/workloadIdentityPools/miakapp-github/providers/staging-plan"
          apply_provider             = "projects/1072737219170/locations/global/workloadIdentityPools/miakapp-github/providers/staging-apply"
          github_repository_id       = "354682190"
          github_repository_owner_id = "83046838"
        }
      }
    }
  }

  expect_failures = [terraform_data.bootstrap_guard]
}
