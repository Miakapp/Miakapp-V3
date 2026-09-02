resource "google_project_service" "required" {
  for_each = local.required_service_apis

  project                    = local.project_id
  service                    = each.value
  disable_on_destroy         = false
  disable_dependent_services = false
  deletion_policy            = "PREVENT"

  depends_on = [terraform_data.bootstrap_guard]
}
