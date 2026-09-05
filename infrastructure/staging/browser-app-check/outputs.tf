output "staging_browser_app_check_api" {
  description = "Non-secret result of the isolated staging reCAPTCHA Enterprise API prerequisite."
  value = {
    schema                    = "miakapp.staging-browser-app-check-api/1"
    project_id                = local.project_id
    project_number            = local.project_number
    firebase_app_id           = data.google_firebase_web_app.staging.app_id
    firebase_app_display_name = data.google_firebase_web_app.staging.display_name
    recaptcha_api             = google_project_service.recaptcha_enterprise.service
    recaptcha_api_enabled     = true
    recaptcha_keys_created    = 0
    app_check_registered      = false
    app_check_enforcement     = false
    debug_tokens              = 0
    public_endpoints_created  = 0
    fixed_cost_services       = 0
  }
}
