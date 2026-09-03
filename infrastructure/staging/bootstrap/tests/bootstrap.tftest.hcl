mock_provider "google" {
  override_data {
    target = data.google_project.staging
    values = {
      project_id = "miakapp-v4-staging"
      number     = "1072737219170"
      name       = "Miakapp V4 Staging"
    }
  }

  override_data {
    target = data.google_billing_account.approved
    values = {
      id            = "AAAAAA-BBBBBB-CCCCCC"
      currency_code = "EUR"
      open          = true
    }
  }
}

mock_provider "google-beta" {
  override_resource {
    target = google_billing_project_info.staging
    values = {
      id              = "projects/miakapp-v4-staging"
      project         = "miakapp-v4-staging"
      billing_account = "AAAAAA-BBBBBB-CCCCCC"
      deletion_policy = "DELETE"
    }
  }
}

variables {
  billing_account_id = "AAAAAA-BBBBBB-CCCCCC"
}

run "rejects_an_unapproved_canonical_billing_account" {
  command = plan

  expect_failures = [google_billing_project_info.staging]
}

run "rejects_a_malformed_billing_account" {
  command = plan

  variables {
    billing_account_id = "billingAccounts/not-canonical"
  }

  expect_failures = [var.billing_account_id]
}
