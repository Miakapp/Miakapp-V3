output "staging_browser_app_check_key" {
  description = "Non-secret result of the isolated staging browser App Check key prerequisite."
  value = {
    schema                    = "miakapp.staging-browser-app-check-key/1"
    project_id                = local.project_id
    project_number            = local.project_number
    firebase_app_id           = data.google_firebase_web_app.staging.app_id
    firebase_app_display_name = data.google_firebase_web_app.staging.display_name
    recaptcha_api             = google_project_service.recaptcha_enterprise.service
    recaptcha_api_enabled     = true
    recaptcha_key_created     = true
    recaptcha_display_name    = google_recaptcha_enterprise_key.browser_app_check.display_name
    recaptcha_integration     = google_recaptcha_enterprise_key.browser_app_check.web_settings[0].integration_type
    recaptcha_allowed_domains = google_recaptcha_enterprise_key.browser_app_check.web_settings[0].allowed_domains
    recaptcha_allow_all       = google_recaptcha_enterprise_key.browser_app_check.web_settings[0].allow_all_domains
    recaptcha_allow_amp       = google_recaptcha_enterprise_key.browser_app_check.web_settings[0].allow_amp_traffic
    recaptcha_testing         = length(google_recaptcha_enterprise_key.browser_app_check.testing_options) > 0
    recaptcha_waf             = length(google_recaptcha_enterprise_key.browser_app_check.waf_settings) > 0
    app_check_registered      = false
    app_check_enforcement     = false
    debug_tokens              = 0
    public_endpoints_created  = 0
    fixed_cost_services       = 0
  }
}
