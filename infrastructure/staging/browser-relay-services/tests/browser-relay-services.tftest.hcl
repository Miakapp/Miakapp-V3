mock_provider "google" {
  override_resource {
    target = google_service_account.relay
    values = {
      email  = "miakapp-staging-relay@miakapp-v4-staging.iam.gserviceaccount.com"
      member = "serviceAccount:miakapp-staging-relay@miakapp-v4-staging.iam.gserviceaccount.com"
      name   = "projects/miakapp-v4-staging/serviceAccounts/miakapp-staging-relay@miakapp-v4-staging.iam.gserviceaccount.com"
    }
  }
}

variables {
  deployment_phase = "private_bootstrap"
  relay_audiences = {
    relay-a = "wss://relay-a.bootstrap.invalid/ws"
    relay-b = "wss://relay-b.bootstrap.invalid/ws"
  }
}

run "private_bootstrap_is_bounded_and_not_public" {
  command = plan

  override_data {
    target = data.terraform_remote_state.workload[0]
    values = {
      outputs = {
        staging_workload = {
          schema              = "miakapp.staging-workload/1"
          project_id          = "miakapp-v4-staging"
          project_number      = "1072737219170"
          region              = "europe-west9"
          repository_commit   = "ba4fc9caed566fa39fc66371192fb1821b4232ff"
          source_sha256       = "3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e"
          artifact_repository = "projects/miakapp-v4-staging/locations/europe-west9/repositories/miakapp-control-plane"
          ingress             = "ALLOW_INTERNAL_ONLY"
          unauthenticated     = false
          minimum_instances   = 0
          maximum_instances   = 1
        }
      }
    }
  }

  assert {
    condition = (
      length(google_service_account.relay) == 1 &&
      length(google_cloud_run_v2_service.relay) == 2 &&
      length(google_cloud_run_v2_service_iam_member.public) == 0
    )
    error_message = "Private bootstrap must create exactly one identity and two non-public services."
  }

  assert {
    condition = alltrue([
      for service in values(google_cloud_run_v2_service.relay) :
      service.template[0].scaling[0].min_instance_count == 0 &&
      service.template[0].scaling[0].max_instance_count == 1 &&
      service.template[0].max_instance_request_concurrency == 8 &&
      service.template[0].timeout == "900s" &&
      service.template[0].containers[0].image == "europe-west9-docker.pkg.dev/miakapp-v4-staging/miakapp-control-plane/miakapp-server@sha256:23a19a26e8a24f6434ab8bc557dfa3fa799e0262e3400170e3bf064101a890b1" &&
      service.template[0].containers[0].resources[0].limits.cpu == "1" &&
      service.template[0].containers[0].resources[0].limits.memory == "512Mi" &&
      service.deletion_protection == false
    ])
    error_message = "Every relay must retain the reviewed scale, concurrency, timeout, compute and deletion profile."
  }

  assert {
    condition = alltrue([
      for id, service in google_cloud_run_v2_service.relay :
      { for item in service.template[0].containers[0].env : item.name => item.value }["MIAKAPP_RELAY_AUDIENCE"] == "wss://${id}.bootstrap.invalid/ws"
    ])
    error_message = "Private bootstrap must use only the two invalid bootstrap audiences."
  }

  assert {
    condition = alltrue([
      for service in values(google_cloud_run_v2_service.relay) :
      { for item in service.template[0].containers[0].env : item.name => item.value }["MIAKAPP_MAX_CONNECTIONS"] == "8" &&
      { for item in service.template[0].containers[0].env : item.name => item.value }["MIAKAPP_MAX_CONNECTIONS_PER_IP"] == "8" &&
      { for item in service.template[0].containers[0].env : item.name => item.value }["MIAKAPP_CONNECTION_ATTEMPTS_PER_MINUTE"] == "32" &&
      { for item in service.template[0].containers[0].env : item.name => item.value }["MIAKAPP_MAX_TRACKED_IPS"] == "64" &&
      { for item in service.template[0].containers[0].env : item.name => item.value }["MIAKAPP_MAX_HOMES"] == "16" &&
      { for item in service.template[0].containers[0].env : item.name => item.value }["MIAKAPP_MAX_QUEUED_BYTES"] == "262144" &&
      { for item in service.template[0].containers[0].env : item.name => item.value }["MIAKAPP_MAX_AGGREGATE_QUEUED_BYTES"] == "4194304"
    ])
    error_message = "Every relay must receive the complete finite process-admission profile."
  }
}

run "private_ready_requires_the_two_assigned_service_audiences" {
  command = plan

  variables {
    deployment_phase = "private_ready"
    relay_audiences = {
      relay-a = "wss://miakapp-staging-relay-a-abcdefghij-od.a.run.app/ws"
      relay-b = "wss://miakapp-staging-relay-b-klmnopqrst-od.a.run.app/ws"
    }
  }

  override_data {
    target = data.terraform_remote_state.workload[0]
    values = {
      outputs = {
        staging_workload = {
          schema              = "miakapp.staging-workload/1"
          project_id          = "miakapp-v4-staging"
          project_number      = "1072737219170"
          region              = "europe-west9"
          repository_commit   = "ba4fc9caed566fa39fc66371192fb1821b4232ff"
          source_sha256       = "3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e"
          artifact_repository = "projects/miakapp-v4-staging/locations/europe-west9/repositories/miakapp-control-plane"
          ingress             = "ALLOW_INTERNAL_ONLY"
          unauthenticated     = false
          minimum_instances   = 0
          maximum_instances   = 1
        }
      }
    }
  }

  override_resource {
    target = google_cloud_run_v2_service.relay["relay-a"]
    values = {
      uri = "https://miakapp-staging-relay-a-abcdefghij-od.a.run.app"
    }
  }

  override_resource {
    target = google_cloud_run_v2_service.relay["relay-b"]
    values = {
      uri = "https://miakapp-staging-relay-b-klmnopqrst-od.a.run.app"
    }
  }

  assert {
    condition = (
      length(google_cloud_run_v2_service.relay) == 2 &&
      length(google_cloud_run_v2_service_iam_member.public) == 0 &&
      terraform_data.deployment_guard["active"].input.profile_sha256 == local.profile.operation.converged_profile_sha256 &&
      { for item in google_cloud_run_v2_service.relay["relay-a"].template[0].containers[0].env : item.name => item.value }["MIAKAPP_RELAY_AUDIENCE"] == "wss://miakapp-staging-relay-a-abcdefghij-od.a.run.app/ws" &&
      { for item in google_cloud_run_v2_service.relay["relay-b"].template[0].containers[0].env : item.name => item.value }["MIAKAPP_RELAY_AUDIENCE"] == "wss://miakapp-staging-relay-b-klmnopqrst-od.a.run.app/ws"
    )
    error_message = "Private-ready services must use their distinct assigned audiences without public IAM."
  }
}

run "public_window_adds_only_the_two_invoker_members" {
  command = plan

  variables {
    deployment_phase = "public_window"
    relay_audiences = {
      relay-a = "wss://miakapp-staging-relay-a-abcdefghij-od.a.run.app/ws"
      relay-b = "wss://miakapp-staging-relay-b-klmnopqrst-od.a.run.app/ws"
    }
  }

  override_data {
    target = data.terraform_remote_state.workload[0]
    values = {
      outputs = {
        staging_workload = {
          schema              = "miakapp.staging-workload/1"
          project_id          = "miakapp-v4-staging"
          project_number      = "1072737219170"
          region              = "europe-west9"
          repository_commit   = "ba4fc9caed566fa39fc66371192fb1821b4232ff"
          source_sha256       = "3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e"
          artifact_repository = "projects/miakapp-v4-staging/locations/europe-west9/repositories/miakapp-control-plane"
          ingress             = "ALLOW_INTERNAL_ONLY"
          unauthenticated     = false
          minimum_instances   = 0
          maximum_instances   = 1
        }
      }
    }
  }

  override_resource {
    target = google_cloud_run_v2_service.relay["relay-a"]
    values = {
      uri = "https://miakapp-staging-relay-a-abcdefghij-od.a.run.app"
    }
  }

  override_resource {
    target = google_cloud_run_v2_service.relay["relay-b"]
    values = {
      uri = "https://miakapp-staging-relay-b-klmnopqrst-od.a.run.app"
    }
  }

  assert {
    condition = alltrue([
      for id, member in google_cloud_run_v2_service_iam_member.public :
      contains(["relay-a", "relay-b"], id) &&
      member.role == "roles/run.invoker" &&
      member.member == "allUsers" &&
      member.name == google_cloud_run_v2_service.relay[id].name
    ]) && length(google_cloud_run_v2_service_iam_member.public) == 2
    error_message = "The public window may add only one unauthenticated invoker member to each exact relay."
  }
}

run "rejects_mixed_or_foreign_ready_audiences" {
  command = plan

  variables {
    deployment_phase = "private_ready"
    relay_audiences = {
      relay-a = "wss://miakapp-staging-relay-b-klmnopqrst-od.a.run.app/ws"
      relay-b = "wss://foreign.example.test/ws"
    }
  }

  override_data {
    target = data.terraform_remote_state.workload[0]
    values = {
      outputs = {
        staging_workload = {
          schema              = "miakapp.staging-workload/1"
          project_id          = "miakapp-v4-staging"
          project_number      = "1072737219170"
          region              = "europe-west9"
          repository_commit   = "ba4fc9caed566fa39fc66371192fb1821b4232ff"
          source_sha256       = "3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e"
          artifact_repository = "projects/miakapp-v4-staging/locations/europe-west9/repositories/miakapp-control-plane"
          ingress             = "ALLOW_INTERNAL_ONLY"
          unauthenticated     = false
          minimum_instances   = 0
          maximum_instances   = 1
        }
      }
    }
  }

  expect_failures = [terraform_data.deployment_guard["active"]]
}

run "rejects_an_audience_not_assigned_to_its_service" {
  command   = apply
  state_key = "audience-mismatch"

  variables {
    deployment_phase = "private_ready"
    relay_audiences = {
      relay-a = "wss://miakapp-staging-relay-a-abcdefghij-od.a.run.app/ws"
      relay-b = "wss://miakapp-staging-relay-b-klmnopqrst-od.a.run.app/ws"
    }
  }

  override_data {
    target = data.terraform_remote_state.workload[0]
    values = {
      outputs = {
        staging_workload = {
          schema              = "miakapp.staging-workload/1"
          project_id          = "miakapp-v4-staging"
          project_number      = "1072737219170"
          region              = "europe-west9"
          repository_commit   = "ba4fc9caed566fa39fc66371192fb1821b4232ff"
          source_sha256       = "3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e"
          artifact_repository = "projects/miakapp-v4-staging/locations/europe-west9/repositories/miakapp-control-plane"
          ingress             = "ALLOW_INTERNAL_ONLY"
          unauthenticated     = false
          minimum_instances   = 0
          maximum_instances   = 1
        }
      }
    }
  }

  override_resource {
    target = google_cloud_run_v2_service.relay["relay-a"]
    values = {
      uri = "https://miakapp-staging-relay-a-zzzzzzzzzz-od.a.run.app"
    }
  }

  override_resource {
    target = google_cloud_run_v2_service.relay["relay-b"]
    values = {
      uri = "https://miakapp-staging-relay-b-klmnopqrst-od.a.run.app"
    }
  }

  expect_failures = [google_cloud_run_v2_service.relay["relay-a"]]
}

run "rejects_control_plane_baseline_drift" {
  command = plan

  override_data {
    target = data.terraform_remote_state.workload[0]
    values = {
      outputs = {
        staging_workload = {
          schema              = "miakapp.staging-workload/1"
          project_id          = "miakapp-v4-staging"
          project_number      = "1072737219170"
          region              = "europe-west9"
          repository_commit   = "ba4fc9caed566fa39fc66371192fb1821b4232ff"
          source_sha256       = "0000000000000000000000000000000000000000000000000000000000000000"
          artifact_repository = "projects/miakapp-v4-staging/locations/europe-west9/repositories/miakapp-control-plane"
          ingress             = "ALLOW_INTERNAL_ONLY"
          unauthenticated     = false
          minimum_instances   = 0
          maximum_instances   = 1
        }
      }
    }
  }

  expect_failures = [terraform_data.deployment_guard["active"]]
}

run "absent_has_no_managed_or_remote_resources" {
  command = plan

  variables {
    deployment_phase = "absent"
  }

  assert {
    condition = (
      length(data.terraform_remote_state.workload) == 0 &&
      length(terraform_data.deployment_guard) == 0 &&
      length(google_service_account.relay) == 0 &&
      length(google_cloud_run_v2_service.relay) == 0 &&
      length(google_cloud_run_v2_service_iam_member.public) == 0
    )
    error_message = "The absent phase must retain no relay state resources or cloud reads."
  }
}
