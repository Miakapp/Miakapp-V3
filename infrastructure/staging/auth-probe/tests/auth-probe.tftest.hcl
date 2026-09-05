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
        config_name               = "projects/1072737219170/config"
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
          source_sha256         = "6674c0353ec9c73fcfe0d3a63d17850f057a5f2a547a5855989e28f011249b1e"
          repository_commit     = "022f10e2dc15f32a8a6679b38ce7f1a04582e450"
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
      google_project_iam_member.auth_probe[0].role == "projects/miakapp-v4-staging/roles/miakapp.stagingUserRelayAuthProbe2" &&
      google_project_iam_member.auth_probe[0].member == "serviceAccount:miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com" &&
      google_project_iam_member.auth_probe_firestore[0].role == "projects/miakapp-v4-staging/roles/miakapp.stagingUserRelayFirestore2" &&
      google_service_account_iam_member.auth_probe_self_signer[0].role == "projects/miakapp-v4-staging/roles/miakapp.stagingUserRelaySigner2" &&
      google_service_account_iam_member.auth_probe_self_signer[0].member == "serviceAccount:miakapp-staging-probe@miakapp-v4-staging.iam.gserviceaccount.com"
    )
    error_message = "Only the exact temporary probe identity bindings may be armed."
  }

  assert {
    condition = (
      toset(google_project_iam_custom_role.auth_probe_generation_2.permissions) == toset([
        "firebase.clients.get",
        "firebaseappcheck.tokens.mint",
        "firebaseauth.users.get",
        "serviceusage.services.use",
      ]) &&
      google_project_iam_custom_role.auth_probe_generation_2.stage == "GA" &&
      google_project_iam_custom_role.auth_probe_firestore_generation_2.stage == "GA" &&
      google_project_iam_custom_role.auth_probe_signer_generation_2.stage == "GA" &&
      google_project_iam_custom_role.auth_probe_generation_1.stage == "DISABLED" &&
      google_project_iam_custom_role.auth_probe_firestore_generation_1.stage == "DISABLED" &&
      google_project_iam_custom_role.auth_probe_signer_generation_1.stage == "DISABLED" &&
      output.staging_auth_probe.schema == "miakapp.staging-auth-probe/2" &&
      output.staging_auth_probe.role_generation == 2 &&
      strcontains(google_workflows_workflow.auth_probe[0].source_contents, "X-Serverless-Authorization") &&
      strcontains(google_workflows_workflow.auth_probe[0].source_contents, "X-Firebase-AppCheck") &&
      !strcontains(google_workflows_workflow.auth_probe[0].source_contents, "retry:")
    )
    error_message = "The Auth and App Check probe contract must remain narrow and retry-free."
  }

  assert {
    condition = (
      google_cloud_run_v2_service.auth_probe_verifier[0].ingress == "INGRESS_TRAFFIC_INTERNAL_ONLY" &&
      google_cloud_run_v2_service.auth_probe_verifier[0].invoker_iam_disabled == false &&
      google_cloud_run_v2_service.auth_probe_verifier[0].template[0].service_account == "miakapp-staging-verifier@miakapp-v4-staging.iam.gserviceaccount.com" &&
      google_cloud_run_v2_service.auth_probe_verifier[0].template[0].scaling[0].min_instance_count == 0 &&
      google_cloud_run_v2_service.auth_probe_verifier[0].template[0].scaling[0].max_instance_count == 1 &&
      google_cloud_run_v2_service.auth_probe_verifier[0].template[0].max_instance_request_concurrency == 1 &&
      google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker[0].role == "roles/run.servicesInvoker"
    )
    error_message = "The verifier must remain internal, isolated, single-instance and have the exact probe service binding."
  }

  assert {
    condition = (
      google_project_service.auth_probe_asset_inventory.service == "cloudasset.googleapis.com" &&
      google_project_service.auth_probe_asset_inventory.disable_on_destroy == false
    )
    error_message = "The no-role verifier assertion requires durable all-resource IAM policy search."
  }
}

run "rejects_the_project_id_firebase_auth_config_name" {
  command = plan

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
          source_sha256         = "6674c0353ec9c73fcfe0d3a63d17850f057a5f2a547a5855989e28f011249b1e"
          repository_commit     = "022f10e2dc15f32a8a6679b38ce7f1a04582e450"
          ingress               = "ALLOW_INTERNAL_ONLY"
          unauthenticated       = false
          minimum_instances     = 0
          maximum_instances     = 1
        }
      }
    }
  }

  expect_failures = [terraform_data.auth_probe_guard]
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
          source_sha256         = "6674c0353ec9c73fcfe0d3a63d17850f057a5f2a547a5855989e28f011249b1e"
          repository_commit     = "022f10e2dc15f32a8a6679b38ce7f1a04582e450"
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
      length(google_project_iam_member.auth_probe_firestore) == 0 &&
      length(google_service_account_iam_member.auth_probe_self_signer) == 0 &&
      length(google_cloud_run_v2_service.auth_probe_verifier) == 0 &&
      length(google_cloud_run_v2_service_iam_member.auth_probe_verifier_invoker) == 0 &&
      length(google_workflows_workflow.auth_probe) == 0 &&
      google_project_iam_custom_role.auth_probe_generation_2.stage == "DISABLED" &&
      google_project_iam_custom_role.auth_probe_firestore_generation_2.stage == "DISABLED" &&
      google_project_iam_custom_role.auth_probe_signer_generation_2.stage == "DISABLED" &&
      google_project_iam_custom_role.auth_probe_generation_1.stage == "DISABLED" &&
      google_project_iam_custom_role.auth_probe_firestore_generation_1.stage == "DISABLED" &&
      google_project_iam_custom_role.auth_probe_signer_generation_1.stage == "DISABLED" &&
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
          source_sha256         = "6674c0353ec9c73fcfe0d3a63d17850f057a5f2a547a5855989e28f011249b1e"
          repository_commit     = "022f10e2dc15f32a8a6679b38ce7f1a04582e450"
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
