resource "google_service_account" "relay" {
  for_each = local.enabled ? { runtime = true } : {}

  project      = local.profile.project_id
  account_id   = local.profile.runtime_identity.account_id
  display_name = "Miakapp V4 bounded staging relays"
  description  = "Keyless runtime identity with no project role for the ephemeral browser-relay acceptance services."

  depends_on = [terraform_data.deployment_guard]
}

resource "google_cloud_run_v2_service" "relay" {
  for_each = local.active_relays

  project              = local.profile.project_id
  location             = local.profile.region
  name                 = each.value.name
  description          = "Ephemeral ${each.key} for the bounded Miakapp V4 browser acceptance window."
  ingress              = local.profile.cloud_run.ingress
  deletion_protection  = local.profile.cloud_run.deletion_protection
  default_uri_disabled = false
  invoker_iam_disabled = false
  iap_enabled          = false
  launch_stage         = "GA"

  labels = merge(local.labels, {
    relay = each.key
  })

  template {
    execution_environment            = local.profile.cloud_run.execution_environment
    max_instance_request_concurrency = local.profile.cloud_run.concurrency
    service_account                  = google_service_account.relay["runtime"].email
    session_affinity                 = local.profile.cloud_run.session_affinity
    timeout                          = "${local.profile.cloud_run.request_timeout_seconds}s"

    labels = {
      relay = each.key
    }

    scaling {
      min_instance_count = local.profile.cloud_run.minimum_instances
      max_instance_count = local.profile.cloud_run.maximum_instances
    }

    containers {
      name  = "relay"
      image = local.relay_image

      ports {
        name           = "http1"
        container_port = local.profile.cloud_run.port
      }

      resources {
        limits = {
          cpu    = local.profile.cloud_run.cpu
          memory = local.profile.cloud_run.memory
        }
        cpu_idle          = local.profile.cloud_run.cpu_idle
        startup_cpu_boost = local.profile.cloud_run.startup_cpu_boost
      }

      startup_probe {
        initial_delay_seconds = 0
        timeout_seconds       = 2
        period_seconds        = 2
        failure_threshold     = 10

        http_get {
          path = "/ping"
          port = local.profile.cloud_run.port
        }
      }

      dynamic "env" {
        for_each = merge(local.common_environment, {
          MIAKAPP_RELAY_AUDIENCE = local.selected_audiences[each.key]
        })
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    postcondition {
      condition = (
        var.deployment_phase == "private_bootstrap" ||
        local.selected_audiences[each.key] == "${replace(self.uri, "https://", "wss://")}/ws"
      )
      error_message = "A ready relay audience must equal the exact URI assigned to that Cloud Run service."
    }
  }

  depends_on = [terraform_data.deployment_guard]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = local.public_relays

  project  = local.profile.project_id
  location = local.profile.region
  name     = google_cloud_run_v2_service.relay[each.key].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
