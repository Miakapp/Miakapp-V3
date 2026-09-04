mock_provider "google" {}

variables {
  armed = true
}

override_data {
  target = data.terraform_remote_state.firebase_auth
  values = {
    outputs = {
      staging_firebase_auth = {
        schema                    = "miakapp.staging-firebase-auth/1"
        project_id                = "miakapp-v4-staging"
        project_number            = "1072737219170"
        config_name               = "projects/miakapp-v4-staging/config"
        anonymous_sign_in         = false
        email_sign_in             = false
        phone_sign_in             = false
        duplicate_emails          = false
        user_signup_disabled      = false
        user_deletion_disabled    = false
        anonymous_user_autodelete = true
        multi_tenant              = false
        mfa                       = "DISABLED"
        request_logging           = false
      }
    }
  }
}

run "arms_only_the_bounded_private_probe" {
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
          source_sha256         = "86f4818dfcb4021e5578638d6fb1e9b7da31ea245528cbdc8573dabecdfca358"
          repository_commit     = "60322c69c92b8ccf5f3d1bc87ba264a00e5dca05"
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
      length(google_workflows_workflow.auth_probe) == 1 &&
      google_workflows_workflow.auth_probe[0].service_account == "miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com" &&
      google_workflows_workflow.auth_probe[0].call_log_level == "LOG_NONE" &&
      google_workflows_workflow.auth_probe[0].execution_history_level == "EXECUTION_HISTORY_BASIC" &&
      google_workflows_workflow.auth_probe[0].deletion_protection == false
    )
    error_message = "The temporary Workflow must retain the exact private low-logging boundary."
  }

  assert {
    condition = (
      google_project_iam_member.auth_probe[0].role == "projects/miakapp-v4-staging/roles/miakapp.stagingAuthProbe" &&
      google_project_iam_member.auth_probe[0].member == "serviceAccount:miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com" &&
      google_service_account_iam_member.auth_probe_self_signer[0].role == "roles/iam.serviceAccountTokenCreator" &&
      google_service_account_iam_member.auth_probe_self_signer[0].member == "serviceAccount:miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com"
    )
    error_message = "Only the exact temporary probe identity bindings may be armed."
  }

  assert {
    condition = (
      toset(google_project_iam_custom_role.auth_probe.permissions) == toset([
        "firebase.clients.get",
        "firebaseappcheck.tokens.mint",
        "firebaseauth.users.get",
        "serviceusage.services.use",
      ]) &&
      strcontains(google_workflows_workflow.auth_probe[0].source_contents, "X-Serverless-Authorization") &&
      strcontains(google_workflows_workflow.auth_probe[0].source_contents, "X-Firebase-AppCheck") &&
      !strcontains(google_workflows_workflow.auth_probe[0].source_contents, "retry:")
    )
    error_message = "The Auth and App Check probe contract must remain narrow and retry-free."
  }
}

run "keeps_the_default_state_dormant" {
  command = plan

  variables {
    armed = false
  }

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
          source_sha256         = "86f4818dfcb4021e5578638d6fb1e9b7da31ea245528cbdc8573dabecdfca358"
          repository_commit     = "60322c69c92b8ccf5f3d1bc87ba264a00e5dca05"
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
      length(google_project_iam_member.auth_probe) == 0 &&
      length(google_service_account_iam_member.auth_probe_self_signer) == 0 &&
      length(google_workflows_workflow.auth_probe) == 0 &&
      output.staging_auth_probe.armed == false
    )
    error_message = "The default Auth-probe state must have no Workflow or temporary IAM binding."
  }
}

run "rejects_a_changed_or_public_workload" {
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
          source_sha256         = "86f4818dfcb4021e5578638d6fb1e9b7da31ea245528cbdc8573dabecdfca358"
          repository_commit     = "60322c69c92b8ccf5f3d1bc87ba264a00e5dca05"
          ingress               = "ALLOW_ALL"
          unauthenticated       = true
          minimum_instances     = 0
          maximum_instances     = 1
        }
      }
    }
  }

  expect_failures = [terraform_data.auth_probe_guard]
}
