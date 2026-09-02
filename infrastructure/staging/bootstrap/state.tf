resource "google_storage_bucket" "terraform_state" {
  project       = local.project_id
  name          = local.state_bucket_name
  location      = local.region
  storage_class = "STANDARD"

  force_destroy               = false
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  deletion_policy             = "PREVENT"

  versioning {
    enabled = true
  }

  soft_delete_policy {
    retention_duration_seconds = 604800
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      days_since_noncurrent_time = 30
      num_newer_versions         = 10
      with_state                 = "ARCHIVED"
    }
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      age            = 2
      matches_prefix = [local.plan_prefix]
      with_state     = "LIVE"
    }
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      days_since_noncurrent_time = 1
      matches_prefix             = [local.plan_prefix]
      with_state                 = "ARCHIVED"
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    google_billing_budget.staging,
    google_project_service.bootstrap["storage.googleapis.com"],
  ]
}

resource "google_storage_bucket" "components" {
  project       = local.project_id
  name          = local.component_bucket_name
  location      = local.region
  storage_class = "STANDARD"

  force_destroy               = false
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  deletion_policy             = "PREVENT"

  versioning {
    enabled = false
  }

  soft_delete_policy {
    retention_duration_seconds = 0
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      age            = 1
      matches_prefix = ["component-staging/"]
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    google_billing_budget.staging,
    google_project_service.bootstrap["storage.googleapis.com"],
  ]
}
