# Staging browser App Check prerequisite

Status: API-only prerequisite applied and converged; authoritative key inventory
empty; plan and apply entrypoints permanently retired

This isolated Terraform root enabled the first reversible prerequisite for
browser App Check in `miakapp-v4-staging`. The exact saved plan created only:

- one state-only guard bound to the reviewed foundation and the single live
  Firebase Web app; and
- the `recaptchaenterprise.googleapis.com` service enablement.

It created no reCAPTCHA key and did not register an App Check provider. It owns
no Firebase Web app, Hosting release, relay, Function, IAM binding, secret,
public endpoint or resource managed by another Terraform root.

## Applied evidence

Execution commit `0e8d5dfc3b5b8dd42d84cb165ae2a4f676f7fcdb`
rendered plan
`f21835c20d9fe3dd4b2f47ac10f826a3c78b3b3e8a6e35aa4915c485c3058602`.
The plan contained exactly two creates, zero updates and zero deletes. Apply
converged to an empty follow-up plan.

The sanitized [result](result.json) records:

- the API enabled;
- zero keys in the now-readable authoritative reCAPTCHA inventory;
- zero keys in supplemental Cloud Asset Inventory;
- no App Check registration, enforcement record or debug token;
- no key, public endpoint, fixed-cost service or assessment created by the
  driver.

The private plan, metadata, mutation journal and diagnostics remain outside the
repository. No raw plan or raw state is committed.

The GCS backend prefix is `terraform/browser-app-check`. Its current state is
generation `1788591686695870`, 11,057 bytes, Terraform serial 3 and SHA-256
`4c2ac56a22e2ba11e6a4dd5c195910c1a0f1e749a009660294ea05bcd8c48aa7`.
It contains exactly two managed resources, two data resources, one output and
no tainted instance. Its lineage is unchanged from the 181-byte empty state
created as a backend-initialization side effect of the earlier non-applying
plan.

## Why this was deliberately two phases

While the reCAPTCHA Enterprise API was disabled, its direct key-list endpoint
was unavailable. An empty Cloud Asset response was useful historical,
eventually consistent corroboration, but not authoritative proof that no key
existed. Combining service enablement and key creation in one saved plan could
therefore have duplicated a hidden pre-existing key.

The applied phase stopped after API enablement and required the newly readable
direct list to be exactly empty. The project was created on 2026-09-02, its
full-lifetime Admin Activity inventory contained no earlier reCAPTCHA key or
service-enable event, and the post-apply direct inventory confirmed zero keys.

Both [plan](plan.mjs) and [apply](apply.mjs) retain the reviewed historical
contract and validators, but direct execution now fails before tool or cloud
access. The consumed saved plan must never be replayed.

## Non-deletable App Check boundary

This root does not declare
`google_firebase_app_check_recaptcha_enterprise_config`. Firebase exposes GET
and PATCH operations for that provider configuration but no delete operation;
removing its Terraform state would not unregister it. Provider registration is
therefore a later, explicitly non-deletable staging decision. Enforcement and
debug-token creation are separate later decisions as well.

API enablement has no fixed recurring service charge. The applied driver made
no assessment or browser request. Usage-based reCAPTCHA cost can begin only
once some client sends assessment traffic; no such client is configured by
this root.

References:

- [Firebase App Check with reCAPTCHA Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)
- [reCAPTCHA billing](https://cloud.google.com/recaptcha/docs/billing-information)
- [Firebase App Check REST provider configuration](https://firebase.google.com/docs/reference/appcheck/rest/v1/projects.apps.recaptchaEnterpriseConfig)

## Next gate

Create a separate implementation and fresh saved plan for one reversible
domain-restricted score key. That plan must start from the enabled API, the
exact current Terraform state and a newly observed authoritative empty key
inventory. App Check provider registration, browser SDK traffic and enforcement
remain excluded until later gates.
