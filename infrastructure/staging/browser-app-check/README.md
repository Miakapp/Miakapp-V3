# Staging browser App Check prerequisite

Status: API-only prerequisite applied and converged; authoritative key inventory
empty at the last committed observation; guarded single-key implementation
ready for a fresh saved plan but not yet applied

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

## Guarded reversible key operation

The active [key planner](key-plan.mjs) and [key apply driver](key-apply.mjs)
permit exactly one new `google_recaptcha_enterprise_key` from the applied state:

- Web `SCORE` integration;
- display name `Miakapp V4 staging browser App Check`;
- `allow_all_domains=false` and only `miakapp-v4-staging.web.app` in the
  allowed-domain list;
- AMP disabled, with no testing, WAF, Android, iOS or challenge configuration;
- the four exact staging labels, with the provider attribution label disabled;
- no App Check registration, enforcement, debug token, endpoint, browser
  request or assessment.

Google treats an allowed domain as also allowing its subdomains. The chosen
Firebase Hosting hostname is already the narrowest stable staging hostname, so
this does not authorize `miakapp.com`, another Hosting site or a custom domain.

The resource uses API deletion policy `DELETE` so a later reviewed teardown can
remove it, while Terraform `prevent_destroy=true` blocks accidental removal in
the active phase. Retirement therefore requires a distinct source change and
saved plan. The public site-key identifier will exist in private Terraform
state, but neither it nor its raw resource name is written to committed
evidence. reCAPTCHA also exposes a separately retrievable legacy secret for
some compatibility paths; these drivers never call that endpoint and never
emit that secret.

`key-plan.sh` requires the exact target confirmation
`miakapp-v4-staging:miakapp-v4-staging.web.app`, starts from the pinned
serial-3 state, an authoritative empty key inventory and the absence of the
private global attempt claim, and writes its
two-hour saved plan only to a mode-0700 directory outside the repository. Its
validator accepts one create, two managed no-ops, zero updates, zero deletes,
zero replacements and the output-only transition from API evidence to key
evidence. `key-apply.sh` then requires an authorization derived from the exact
plan bytes, baseline and merge commit.

Immediately before mutation, the apply driver obtains a fresh operator token
and revalidates the commit, saved plan, complete empty-key baseline, absent
global claim and exact remote state. It first writes an exclusive durable local
attempt marker. It then atomically creates the private object
`terraform/browser-app-check/operations/recaptcha-key-create-attempt.json` in
the versioned state bucket with the GCS `ifGenerationMatch=0` precondition.
That one-shot create is bound to the exact plan, baseline and merge commit; only
the process that successfully reads back its exact generation may invoke
Terraform. Independent bundles therefore cannot both pass the creation gate.
The claim contains hashes and operation metadata only, never a credential or
site key, and remains live as durable coordination evidence until a separate
reviewed retirement.

Once either marker exists, that bundle is permanently non-retryable regardless
of process outcome. An ambiguous failure must use a
separately reviewed inventory plus import-only or evidence-finalization
recovery; the driver preserves any Terraform fallback state and available raw
key inventory in the private bundle. It never automatically patches or deletes
a key or the global claim during recovery.

## Non-deletable App Check boundary

This root does not declare
`google_firebase_app_check_recaptcha_enterprise_config`. Firebase exposes GET
and PATCH operations for that provider configuration but no delete operation;
removing its Terraform state would not unregister it. Provider registration is
therefore a later, explicitly non-deletable staging decision. Enforcement and
debug-token creation are separate later decisions as well.

API enablement and the coordination object have no fixed recurring service
charge; the tiny private object consumes only metered Storage bytes. The
applied driver made no assessment or browser request. Usage-based reCAPTCHA
cost can begin only once some client sends assessment traffic; no such client
is configured by this root.

References:

- [Firebase App Check with reCAPTCHA Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)
- [reCAPTCHA billing](https://cloud.google.com/recaptcha/docs/billing-information)
- [Firebase App Check REST provider configuration](https://firebase.google.com/docs/reference/appcheck/rest/v1/projects.apps.recaptchaEnterpriseConfig)

## Next gate

Render, review and apply the fresh single-key saved plan, then commit only its
sanitized independently cross-linked evidence and permanently retire the
consumed key entrypoints. App Check provider registration remains a separate
non-deletable gate; browser SDK traffic and enforcement remain later gates.
