mock_provider "google" {}

run "accepts_the_exact_private_workload" {
  command = plan

  override_data {
    target = data.terraform_remote_state.workload
    values = {
      outputs = {
        staging_workload = {
          schema                = "miakapp.staging-workload/1"
          project_id            = "miakapp-v4-staging"
          project_number        = "1072737219170"
          region                = "europe-west9"
          function_name         = "control-plane"
          function_uri          = "https://control-plane-aczhngqraq-od.a.run.app"
          probe_service_account = "miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com"
          source_sha256         = "d2a9ffae2bd85106f782f9c75a10b6fb398682ead65dada2a1cf8ab5c65b7eb4"
          repository_commit     = "3f5a94dfcdfc0984487a558d966bbeaa769b18eb"
          ingress               = "ALLOW_INTERNAL_ONLY"
          unauthenticated       = false
          minimum_instances     = 0
          maximum_instances     = 1
        }
      }
    }
  }

  assert {
    condition = (
      google_workflows_workflow.private_probe.service_account == "miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com" &&
      google_workflows_workflow.private_probe.call_log_level == "LOG_NONE" &&
      google_workflows_workflow.private_probe.execution_history_level == "EXECUTION_HISTORY_BASIC" &&
      google_workflows_workflow.private_probe.deletion_protection == true
    )
    error_message = "The Workflow must retain the exact private, low-logging execution boundary."
  }

  assert {
    condition = (
      strcontains(google_workflows_workflow.private_probe.source_contents, "call: http.get") &&
      strcontains(google_workflows_workflow.private_probe.source_contents, "type: OIDC") &&
      !strcontains(google_workflows_workflow.private_probe.source_contents, "retry:")
    )
    error_message = "The Workflow must contain one OIDC GET and no retry policy."
  }
}

run "rejects_a_public_or_changed_workload" {
  command = plan

  override_data {
    target = data.terraform_remote_state.workload
    values = {
      outputs = {
        staging_workload = {
          schema                = "miakapp.staging-workload/1"
          project_id            = "miakapp-v4-staging"
          project_number        = "1072737219170"
          region                = "europe-west9"
          function_name         = "control-plane"
          function_uri          = "https://control-plane-aczhngqraq-od.a.run.app"
          probe_service_account = "miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com"
          source_sha256         = "d2a9ffae2bd85106f782f9c75a10b6fb398682ead65dada2a1cf8ab5c65b7eb4"
          repository_commit     = "3f5a94dfcdfc0984487a558d966bbeaa769b18eb"
          ingress               = "ALLOW_ALL"
          unauthenticated       = true
          minimum_instances     = 0
          maximum_instances     = 1
        }
      }
    }
  }

  expect_failures = [terraform_data.probe_guard]
}
