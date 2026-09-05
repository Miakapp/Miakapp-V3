# Staging browser App Check prerequisite

Status: domain-restricted score key and its exact non-deletable App Check
provider registration applied and converged; authoritative and Cloud Asset
inventories contain exactly one key; enforcement and browser traffic absent;
all consumed mutation and recovery entrypoints permanently retired

This isolated Terraform root applied the reCAPTCHA API, score-key and provider
prerequisites for browser App Check in `miakapp-v4-staging` as separate guarded
operations. The first, API-only saved plan created only:

- one state-only guard bound to the reviewed foundation and the single live
  Firebase Web app; and
- the `recaptchaenterprise.googleapis.com` service enablement.

That first operation created no reCAPTCHA key and did not register an App Check
provider. The root still owns no Firebase Web app, Hosting release, relay,
Function, IAM binding, secret, public endpoint or resource managed by another
Terraform root.

## Historical API-only phase

Execution commit `0e8d5dfc3b5b8dd42d84cb165ae2a4f676f7fcdb`
rendered plan
`f21835c20d9fe3dd4b2f47ac10f826a3c78b3b3e8a6e35aa4915c485c3058602`.
The plan contained exactly two creates, zero updates and zero deletes. Apply
converged to an empty follow-up plan.

The sanitized result committed by that execution recorded:

- the API enabled;
- zero keys in the now-readable authoritative reCAPTCHA inventory;
- zero keys in supplemental Cloud Asset Inventory;
- no App Check registration, enforcement record or debug token;
- no key, public endpoint, fixed-cost service or assessment created by the
  driver.

The private plan, metadata, mutation journal and diagnostics remain outside the
repository. No raw plan or raw state is committed.

The GCS backend prefix is `terraform/browser-app-check`. Its pre-key baseline
was generation `1788591686695870`, 11,057 bytes, Terraform serial 3 and SHA-256
`4c2ac56a22e2ba11e6a4dd5c195910c1a0f1e749a009660294ea05bcd8c48aa7`.
It contained exactly two managed resources, two data resources, one output and
no tainted instance. Its lineage is unchanged from the 181-byte empty state
created as a backend-initialization side effect of the earlier non-applying
plan. The historical serial-4 key state is documented under the applied key
operation below. The current serial-5 provider state is pinned by the current
[sanitized result](result.json).

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

## Applied reversible key operation

The consumed [key planner](key-plan.mjs) and [key apply driver](key-apply.mjs)
created exactly one new `google_recaptcha_enterprise_key` from the API-only
state:

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

The consumed `key-plan.sh` required the exact target confirmation
`miakapp-v4-staging:miakapp-v4-staging.web.app`, started from the pinned
serial-3 state, an authoritative empty key inventory and the absence of the
private global attempt claim, and wrote its two-hour saved plan only to a
mode-0700 directory outside the repository. Its validator accepted one create,
two managed no-ops, zero updates, zero deletes, zero replacements and the
output-only transition from API evidence to key evidence. `key-apply.sh` then
required an authorization derived from the exact plan bytes, baseline and merge
commit.

Immediately before mutation, the apply driver obtained a fresh operator token
and revalidated the commit, saved plan, complete empty-key baseline, absent
global claim and exact remote state. It first wrote an exclusive durable local
attempt marker. It then atomically created the private object
`terraform/browser-app-check/operations/recaptcha-key-create-attempt.json` in
the versioned state bucket with the GCS `ifGenerationMatch=0` precondition.
That one-shot create is bound to the exact plan, baseline and merge commit; only
the process that successfully reads back its exact generation may invoke
Terraform. Independent bundles therefore cannot both pass the creation gate.
The claim contains hashes and operation metadata only, never a credential or
site key, and remains live at generation `1788596614949831` as durable
coordination evidence until a separate reviewed retirement.

Both key entrypoints now fail before tool or cloud access and the consumed
private bundle remains permanently non-retryable. Any future recovery must use a
separately reviewed inventory plus import-only or evidence-finalization
recovery; the driver preserves any Terraform fallback state and available raw
key inventory in the private bundle. It never automatically patches or deletes
a key or the global claim during recovery.

The exact applied plan SHA-256 is
`dd45c80ed38dbe5e681713442ddaa02e1dc78d2a3ce6f9365b7bbc04f96e248b`.
The independently revalidated state is generation `1788596623837355`, serial
4, 14,139 bytes and SHA-256
`954c7c6ea4187ee59764cca2d4fb0cf359cc8a580dc1f12d96cad46ae2741f9f`.
It has three managed resources, two data resources, one output and no tainted
instance. Direct and eventual Cloud Asset inventories now both corroborate one
key; the raw key name and public site-key identifier remain absent from Git.

## Applied non-deletable App Check registration

This root now declares exactly one
`google_firebase_app_check_recaptcha_enterprise_config`, bound to the existing
score key and the one reviewed Firebase Web app. Registration converged on
2026-09-05 while enforcement remained disabled. Firebase exposes GET and PATCH
operations for this provider configuration but no delete operation. The Google
provider implements Terraform creation as a PATCH and deletion only by
forgetting the Terraform state ID; it cannot unregister the provider.
`prevent_destroy=true` protects the declared resource, and every saved-plan
validator rejects update, delete, replacement or omission. No teardown driver
exists for it.

The consumed [registration planner](registration-plan.mjs) accepted only one
Terraform create action for this provider, with the existing API, key and guard
as exact no-ops. It pinned:

- Firebase app `1:1072737219170:web:5053ca93bf25d7373cd73b`;
- the hash of the exact existing site-key identifier, without committing its
  raw value;
- token TTL `3600s` and the independently observed default minimum valid score
  `0.5`;
- the exact serial-4 key state and both direct and Cloud Asset key inventories;
- zero enforcement records, debug tokens, browser requests, assessments, IAM
  changes, public endpoints and fixed-cost services.

`registration-plan.sh` required the explicit target
`miakapp-v4-staging:1:1072737219170:web:5053ca93bf25d7373cd73b:nondeletable`
and wrote its two-hour plan only to a private mode-0700 directory outside the
repository. Planning was sandwiched between two identical direct-cloud and state
observations. `registration-apply.sh` derived its authorization from the exact
plan, baseline and merge commit. Immediately before apply it repeated that whole
baseline with a fresh operator token, wrote and fsynced a non-retryable local
bundle marker, then atomically created and read back the distinct private GCS
object
`terraform/browser-app-check/operations/app-check-registration-attempt.json`
using `ifGenerationMatch=0`. One more exact inventory and state read still found
the provider-attempt object absent. The driver then constructed the complete
Terraform invocation, atomically created and read back
`terraform/browser-app-check/operations/app-check-provider-attempt.json`, and
invoked Terraform with no intervening local write or fallible validation. This
second permanent claim is the global irreversible boundary: even independently
copied bundles cannot both issue the provider PATCH. A crash after the first
claim but before the second remains recoverable; once the second exists, an
absent provider is deliberately ambiguous and fails closed.

Both registration claims bind the project, app/config identity, site-key and
resource-name hashes, TTL, score, exact prerequisite state generation, plan,
baseline, commit and operator. The first also binds the saved-plan expiry; the
second binds the exact first-claim generation and digest. They contain no
credential or raw site key, are never automatically deleted, and prohibit
retry. The final observation matched the exact registered provider, unchanged
key, `3600s` TTL, `0.5` score, zero enforcement/debug records, healthy
four-resource Terraform state and both live registration claims.

An ambiguous PATCH outcome could never replay the original plan. The separate
[recovery inventory](registration-recovery-plan.mjs) and
[claim-bound recovery](registration-recovery-apply.mjs) require the consumed
registration claim plus exact live provider, prerequisite-claim, provider-claim
and state snapshots. If and only if the provider had remained unregistered, the
state had still been the pinned serial-4 prerequisite, and the global
provider-attempt claim had been absent, recovery could atomically acquire that
second claim and immediately perform the first invocation of the original saved
plan. Once the second claim exists, an unregistered provider fails closed as an
ambiguous attempt.

For an independently exact registered provider, the unused recovery path would
have permitted only import of an absent address, state-only removal and reimport
of the exact tainted partial address, or output reconciliation. A reconciliation
saved plan had to contain a provider no-op and zero cloud mutations. Each attempt
would create a fresh one-shot private child bundle without overwriting or deleting
earlier metadata, markers or diagnostics. A missing or foreign provider/state
combination failed closed. The provider converged on the first apply, so no
recovery action ran. Both registration entrypoints and both unused recovery
entrypoints now fail before environment, bundle, tool or cloud access. Future
drift handling requires a newly reviewed gate.

Execution commit `67c6947231c2b4a515e74a3b7a27ea972f1dcd15`
rendered exact plan SHA-256
`9af7eaf470ce1a65f3737823135604a31ea6cbbd2575bd1afcc17d00033dfee7`
from baseline SHA-256
`4545f379199b8b41d6dbabd24fb073f63ae6863cbbf88cdc4c65bd6658e445ef`.
Apply reported success without recovery. The registration claim is generation
`1788603676767807`; the provider-attempt claim is generation
`1788603679291215`. Current state generation `1788603682439071` is serial 5,
15,925 bytes and SHA-256
`e05629171f5efd2bfe68657a5fd1567de0b5e0769948ef751ff0a3aba26f41dc`.
It contains four managed resources, two data resources, one output and no
tainted instance. The committed result contains only sanitized, cross-linked
receipts; raw site-key, provider response, plan, state and operator credentials
remain outside Git.

Provider registration alone does not enable enforcement and the drivers never
initialize a browser SDK. The site key is a browser-visible identifier, while
the separately retrievable legacy secret and operator credentials are not; no
driver requests that secret or adds Firebase App Check IAM.

API enablement, the key, provider registration and all three coordination objects
have no fixed recurring service charge; the tiny private objects consume only
metered Storage bytes.
The applied driver made no assessment or browser request. Usage-based reCAPTCHA
cost can begin only once some client sends assessment traffic; no such client
is configured by this root.

References:

- [Firebase App Check with reCAPTCHA Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)
- [reCAPTCHA billing](https://cloud.google.com/recaptcha/docs/billing-information)
- [Firebase App Check REST provider configuration](https://firebase.google.com/docs/reference/appcheck/rest/v1/projects.apps.recaptchaEnterpriseConfig)

## Next gate

Exercise real browser SDK attestation against this exact provider without
enabling enforcement, then validate token exchange, refresh and negative
controls through the separately reviewed browser-relay acceptance gate. Public
ingress, assessments and enforcement remain distinct bounded mutations and must
not be inferred from provider registration alone.
