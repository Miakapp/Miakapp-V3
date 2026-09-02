data "google_project" "staging" {
  project_id = local.project_id
}

data "google_billing_account" "approved" {
  billing_account = var.billing_account_id
  open            = true
  lookup_projects = false
}

resource "google_billing_project_info" "staging" {
  provider = google-beta

  project         = local.project_id
  billing_account = var.billing_account_id
  deletion_policy = "PREVENT"

  lifecycle {
    prevent_destroy = true

    precondition {
      condition = (
        data.google_project.staging.project_id == local.project_id &&
        tostring(data.google_project.staging.number) == local.project_number &&
        data.google_project.staging.name == local.project_display_name
      )
      error_message = "The authenticated project is not the approved Miakapp V4 staging project."
    }

    precondition {
      condition = (
        sha256(var.billing_account_id) == local.approved_billing_account_sha256 &&
        data.google_billing_account.approved.currency_code == "EUR"
      )
      error_message = "The supplied billing account is not the approved open EUR account."
    }
  }
}

resource "google_project_service" "bootstrap" {
  for_each = local.bootstrap_service_apis

  project                    = local.project_id
  service                    = each.value
  disable_on_destroy         = false
  disable_dependent_services = false
  deletion_policy            = "PREVENT"

  depends_on = [google_billing_project_info.staging]
}

resource "google_billing_budget" "staging" {
  billing_account = data.google_billing_account.approved.id
  display_name    = "Miakapp V4 staging monthly"
  deletion_policy = "PREVENT"

  budget_filter {
    projects               = ["projects/${local.project_number}"]
    calendar_period        = "MONTH"
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = "EUR"
      units         = "10"
    }
  }

  threshold_rules {
    threshold_percent = 0.2
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 1
    spend_basis       = "CURRENT_SPEND"
  }

  all_updates_rule {
    monitoring_notification_channels = []
    enable_project_level_recipients  = true
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.bootstrap["billingbudgets.googleapis.com"]]
}
