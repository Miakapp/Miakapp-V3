resource "google_project_iam_member" "planner" {
  for_each = local.planner_project_roles

  project = local.project_id
  role    = each.value
  member  = google_service_account.planner.member
}

resource "google_project_iam_member" "deployer" {
  for_each = local.deployer_project_roles

  project = local.project_id
  role    = each.value
  member  = google_service_account.deployer.member
}

resource "google_project_iam_member" "runtime" {
  for_each = local.runtime_project_roles

  project = local.project_id
  role    = each.value
  member  = google_service_account.control_plane.member

  dynamic "condition" {
    for_each = each.value == "roles/datastore.user" ? [true] : []

    content {
      title       = "Default Firestore database only"
      description = "Restrict the runtime data plane to the staging default database."
      expression  = "resource.name == \"projects/${local.project_id}/databases/(default)\""
    }
  }
}

resource "google_storage_bucket_iam_member" "terraform_state_reader" {
  for_each = {
    deployer = google_service_account.deployer.member
    planner  = google_service_account.planner.member
  }

  bucket = google_storage_bucket.terraform_state.name
  role   = "roles/storage.objectViewer"
  member = each.value
}

resource "google_storage_bucket_iam_member" "terraform_foundation_deployer" {
  bucket = google_storage_bucket.terraform_state.name
  role   = "roles/storage.objectAdmin"
  member = google_service_account.deployer.member

  condition {
    title       = "Foundation state and locks"
    description = "Allow the protected deployer to persist only foundation state and locks."
    expression  = "resource.name.startsWith('projects/_/buckets/${local.state_bucket_name}/objects/${local.foundation_prefix}/')"
  }
}

resource "google_storage_bucket_iam_member" "terraform_foundation_lock_writer" {
  bucket = google_storage_bucket.terraform_state.name
  role   = "roles/storage.objectAdmin"
  member = google_service_account.planner.member

  condition {
    title       = "Foundation locks only"
    description = "Allow the planner to acquire and release only Terraform lock objects."
    expression  = "resource.name.startsWith('projects/_/buckets/${local.state_bucket_name}/objects/${local.foundation_prefix}/') && resource.name.endsWith('.tflock')"
  }
}

resource "google_storage_bucket_iam_member" "terraform_plan_creator" {
  bucket = google_storage_bucket.terraform_state.name
  role   = "roles/storage.objectCreator"
  member = google_service_account.planner.member

  condition {
    title       = "Create private saved plans only"
    description = "Allow the planner to create, but not replace or delete, saved plan objects."
    expression  = "resource.name.startsWith('projects/_/buckets/${local.state_bucket_name}/objects/${local.plan_prefix}')"
  }
}

resource "google_storage_bucket_iam_member" "component_deployer" {
  bucket = google_storage_bucket.components.name
  role   = "roles/storage.admin"
  member = google_service_account.deployer.member
}
