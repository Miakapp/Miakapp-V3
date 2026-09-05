# Staging browser App Check prerequisite

Status: guarded API-only phase; canonical empty backend initialized, cloud apply
not yet executed

This isolated Terraform root prepares the first reversible prerequisite for
browser App Check in `miakapp-v4-staging`. Its saved plan may create exactly:

- one state-only guard bound to the reviewed foundation and the single live
  Firebase Web app; and
- the `recaptchaenterprise.googleapis.com` service enablement.

It creates no reCAPTCHA key and does not register an App Check provider. It
also owns no Firebase Web app, Hosting release, relay, Function, IAM binding,
secret, public endpoint or resource managed by another Terraform root.

The GCS backend prefix is `terraform/browser-app-check`. A non-applying,
resource-read-only plan had a backend-initialization side effect: it created the
canonical 181-byte empty Terraform 1.11.3 state at serial 1, generation
`1788588916588868`. That side effect was observed and pinned before this
guarded implementation; the state currently contains no managed resource, data
resource or output.

## Why this is deliberately two phases

When the reCAPTCHA Enterprise API is disabled, its direct key-list endpoint is
unavailable. An empty response from Cloud Asset Inventory is useful historical,
eventually consistent corroboration, but is not authoritative proof that no key
exists. Combining service enablement and key creation in one saved plan could
therefore duplicate a hidden pre-existing key.

This phase stops immediately after API enablement and requires the now-readable
authoritative key list to be exactly empty. Only a later pull request may render
a fresh plan for one domain-restricted score key. That future plan must begin
from the enabled API and a directly readable empty key list; it cannot reuse
this phase's baseline or authorization.

The project was created on 2026-09-02. A full-lifetime Admin Activity search
found no reCAPTCHA key or service-enable event, and current Cloud Asset
Inventory reports zero reCAPTCHA keys. These are strong supplemental checks,
while the direct post-enable list remains the decisive gate.

## Non-deletable App Check boundary

This root does not declare
`google_firebase_app_check_recaptcha_enterprise_config`. Firebase exposes GET
and PATCH operations for that provider configuration but no delete operation;
removing its Terraform state would not unregister it. Provider registration is
therefore a later, explicitly non-deletable staging decision. Enforcement and
debug-token creation are separate later decisions as well.

Enabling this API has no fixed recurring service charge. This driver performs
no assessment or browser request. If an unknown historical key existed,
enabling the API could nevertheless make traffic against that key possible;
the post-enable inventory is intentionally fail-closed and the documentation
does not claim that unrelated external traffic is impossible.

References:

- [Firebase App Check with reCAPTCHA Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)
- [reCAPTCHA billing](https://cloud.google.com/recaptcha/docs/billing-information)
- [Firebase App Check REST provider configuration](https://firebase.google.com/docs/reference/appcheck/rest/v1/projects.apps.recaptchaEnterpriseConfig)

## Render the API-only saved plan

Run from a clean checkout at the exact reviewed `origin/main` commit with
Terraform 1.11.3 and the reviewed Google user selected in `gcloud`:

```bash
private_parent="$(mktemp -d)"
MIAKAPP_STAGING_BROWSER_APP_CHECK_API_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/browser-app-check/plan.sh "$private_parent"
```

The driver rejects service-account impersonation, obtains a short-lived access
token for the exact hash-pinned user, verifies the token's actual principal,
and injects only that token into Terraform. REST inventory and Terraform
therefore act as the same principal without using persistent credentials.

Before planning, the driver requires:

- the exact active Firebase Web app and unregistered App Check response;
- no enforcement record or debug token;
- the reCAPTCHA API disabled and direct key existence explicitly unknown;
- an empty supplemental Cloud Asset key inventory; and
- the exact pinned empty backend generation.

It accepts only two creates: the guard and the API service. The binary plan,
its JSON rendering and canonical metadata are stored in a mode-`0700`
directory outside the repository and expire after two hours. The printed
authorization binds the plan, complete baseline and exact main commit:

```text
enable-browser-app-check-prerequisite-api:miakapp-v4-staging:<plan-sha256>:<baseline-sha256>:<main-commit>
```

## Apply the exact plan

```bash
MIAKAPP_STAGING_BROWSER_APP_CHECK_API_APPLY_AUTHORIZATION='<exact authorization>' \
  ./infrastructure/staging/browser-app-check/apply.sh '<private bundle>'
```

The apply driver re-renders the binary plan, then immediately before mutation
re-verifies the token principal, clean exact-main commit, unexpired metadata,
authorization, complete live baseline and pinned empty state. It writes an
exclusive `mutation-attempted.json` marker before invoking Terraform.

After apply it requires a zero-change Terraform plan, the API enabled, the
direct authoritative key list readable and empty, the supplemental Cloud Asset
list empty, and App Check registration, enforcement and debug tokens still
absent. Sanitized evidence records that this driver created no key, endpoint,
fixed-cost service or assessment.

Any failure after the marker is written makes the bundle permanently
non-retryable, even if Terraform reported an error. Preserve it, inspect the
remote state and authoritative key list, and use a separately reviewed recovery
path. If a hidden key appears after enablement, inspect and disable or delete
that exact key before proceeding.

## Next gate

After this API-only result is independently recorded, create a new pull request
for the reversible key phase. That phase must render a fresh saved plan from an
enabled API and an exact empty direct key inventory. App Check provider
registration, SDK traffic and enforcement remain excluded until still later
gates.
