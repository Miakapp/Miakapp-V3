# Staging Firebase Authentication baseline

This root manages the deliberately closed Firebase Authentication baseline for
`miakapp-v4-staging`. It is a prerequisite for the bounded synthetic Auth and
App Check probe in `../auth-probe`.

## Irreversible boundary

Creating `google_identity_platform_config.firebase_auth` initializes Firebase
Authentication (Identity Platform) for the project. Google does not provide an
operation that reverses that initialization. The resource and its state guard
therefore use `prevent_destroy`, and this root intentionally has no retirement
driver.

The reviewed baseline enables no end-user sign-in method: anonymous, email,
phone, MFA, multi-tenancy, duplicate-email mode, request logging, and external
identity providers all remain disabled. User creation and deletion through
Firebase custom-token and authenticated administrative APIs remain available so
the bounded probe can create and remove its fixed no-email synthetic identity.

The closed configuration was initialized, adopted into its dedicated remote
state after the provider's non-atomic create, and reconciled to zero change on
2026-09-04. Independent live inspection found no default-supported, OIDC or
inbound-SAML provider. The subsequent bounded Auth/App Check probe validated one
custom-token user lifecycle and removed that synthetic identity. The sanitized
closed-baseline summary is committed as digest-pinned `result.json`; its
validator rejects any extra field or changed policy value.

No API key, OAuth token, user token, private key, or service-account key may be
written to Git or emitted by these drivers. The Google provider does persist its
computed `client.api_key` as a sensitive attribute in the private,
access-controlled GCS state bucket; the sanitized output deliberately excludes
it.

## Render the saved plan

Run only from a clean checkout at the exact reviewed `origin/main` commit, with
Terraform 1.11.3 and the reviewed Google operator selected:

```bash
private_parent="$(mktemp -d)"
MIAKAPP_STAGING_FIREBASE_AUTH_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/firebase-auth/plan.sh "$private_parent"
```

The driver validates the complete staging manifest, initializes the dedicated
`terraform/firebase-auth` backend, rejects any delta except the exact
create-only closed configuration, and prints a digest-bound authorization:

```text
initialize-nondeletable-firebase-auth:miakapp-v4-staging:<plan-sha256>:<main-commit>
```

The bundle is mode `0700`, lives outside the repository, expires after two
hours, and contains the binary plan, its reviewed JSON rendering, and canonical
metadata.

## Apply the exact plan

Applying requires the exact authorization printed by the planner:

```bash
MIAKAPP_STAGING_FIREBASE_AUTH_APPLY_AUTHORIZATION='<exact authorization>' \
  ./infrastructure/staging/firebase-auth/apply.sh '<private bundle>'
```

The apply driver rechecks every digest and the exact `origin/main` commit,
applies only the saved binary plan, requires an empty convergence plan, and
writes a sanitized private result. Because initialization cannot be undone,
there is no wildcard, broad, or standing substitute for the exact authorization
string.

## Recover an interrupted provider create

The Google provider initializes the service and then patches the requested
configuration. Those two API calls are not atomic. If initialization succeeds
but the patch or Terraform state write fails, do not rerun the create-only
plan. Render a state-recovery operation instead:

```bash
private_parent="$(mktemp -d)"
MIAKAPP_STAGING_FIREBASE_AUTH_RECOVERY_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/firebase-auth/recovery-plan.sh "$private_parent"
```

This read-only inventory requires the exact live configuration to exist. It
accepts only an absent, tainted, or exact already-managed state address and
binds the action to the state lineage, serial, complete state digest, live
configuration digest, and exact `origin/main` commit. The already-managed case
provides a resumable, plan-only entry after an interrupted adoption. Apply the
printed state-recovery authorization:

```bash
MIAKAPP_STAGING_FIREBASE_AUTH_STATE_RECOVERY_AUTHORIZATION='<exact authorization>' \
  ./infrastructure/staging/firebase-auth/recovery-adopt.sh '<private bundle>'
```

The adoption driver can only import or untaint
`google_identity_platform_config.firebase_auth` with the exact ID
`projects/miakapp-v4-staging/config`. Google canonicalizes the computed resource
name to `projects/1072737219170/config`; state and live validation require that
exact import-ID/name distinction. The driver then renders a second saved plan
whose validator categorically rejects creating, replacing, or deleting Firebase Auth.
Apply that digest-bound reconciliation plan with:

```bash
MIAKAPP_STAGING_FIREBASE_AUTH_RECONCILIATION_AUTHORIZATION='<exact authorization>' \
  ./infrastructure/staging/firebase-auth/recovery-apply.sh '<private bundle>'
```

The final driver requires an empty convergence plan, validates the closed live
configuration, checks all three external identity-provider collections, and
writes only sanitized evidence. API keys and imported state remain confined to
the access-controlled remote state and the mode-`0700` private bundle.
