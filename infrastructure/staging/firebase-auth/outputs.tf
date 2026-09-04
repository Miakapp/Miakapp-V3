output "staging_firebase_auth" {
  description = "Non-secret Firebase Auth baseline consumed by bounded staging probes."
  value = {
    schema                    = "miakapp.staging-firebase-auth/1"
    project_id                = local.project_id
    project_number            = local.project_number
    config_name               = google_identity_platform_config.firebase_auth.name
    anonymous_sign_in         = google_identity_platform_config.firebase_auth.sign_in[0].anonymous[0].enabled
    email_sign_in             = google_identity_platform_config.firebase_auth.sign_in[0].email[0].enabled
    phone_sign_in             = google_identity_platform_config.firebase_auth.sign_in[0].phone_number[0].enabled
    duplicate_emails          = google_identity_platform_config.firebase_auth.sign_in[0].allow_duplicate_emails
    user_signup_disabled      = google_identity_platform_config.firebase_auth.client[0].permissions[0].disabled_user_signup
    user_deletion_disabled    = google_identity_platform_config.firebase_auth.client[0].permissions[0].disabled_user_deletion
    anonymous_user_autodelete = google_identity_platform_config.firebase_auth.autodelete_anonymous_users
    multi_tenant              = google_identity_platform_config.firebase_auth.multi_tenant[0].allow_tenants
    mfa                       = google_identity_platform_config.firebase_auth.mfa[0].state
    request_logging           = google_identity_platform_config.firebase_auth.monitoring[0].request_logging[0].enabled
  }
}
