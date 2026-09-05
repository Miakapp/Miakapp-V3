# Staging audience-bound user-relay probe

This Terraform root owns one bounded, private, single-execution acceptance probe
for the audience-bound user-relay exchange deployed on Miakapp V4 staging. It
uses the independent GCS backend prefix `terraform/auth-probe`; its safe default
is `armed = false`.

The committed `result.json` and `retirement.json` currently preserve the
preceding Firebase Auth/App Check probe against historical revision
`control-plane-00003-hum`. Two user-relay arm generations were fully retired
without an execution after Workflows rejected their source at creation time:
generation 1 used an invalid inline map expression, and generation 2 exceeded
the 50-assignment per-step limit. Their six role IDs remain disabled and
unassigned. The source now splits initialization into two bounded steps and was
accepted by the real Google Workflows compiler in a compile-only deployment
that had zero executions and was immediately deleted. A reviewed generation-3
role set and later expiry are now prepared for the next arm. The
historical evidence remains valid until a successful generation runs, retires,
and replaces it with a digest-pinned sanitized result.

The root consumes the exact private workload state and closed Firebase
Authentication baseline from [`../firebase-auth/`](../firebase-auth/). Planning,
applying, and invoking independently require the Firebase Auth root to converge
to zero changes and query every supported external-provider collection. A stale
Terraform output cannot conceal live authentication drift.

## Security and cost boundary

The configured persistent graph contains:

- six retained custom roles across generations 1 and 2, fixed at `DISABLED`,
  plus three generation-3 least-privilege roles for Firebase token operations,
  self-scoped JWT/OIDC signing, and default-database fixture CRUD; generation 3
  is also dormant and disabled unless the one-shot root is explicitly armed;
- the Cloud Asset API used as supplemental project-wide discovery for verifier
  grants and custom-role bindings, without treating its eventually consistent
  results as an undelete authorization;
- one dormant, unassigned, keyless verifier identity; and
- one state guard pinned to the exact workload, Firebase Auth baseline, Workflow
  source, verifier source, image digest, verifier URI, and capability expiry.

Arming creates exactly six temporary resources:

- one unscheduled Workflow with `LOG_NONE`, basic execution history, no argument,
  no retry, and at most one execution;
- one internal-only Cloud Run verifier using the already-reviewed image digest,
  a separate no-role identity, scale 0..1, concurrency 1, and no user-configured
  environment variable or secret;
- four IAM bindings granting only Firebase token operations, default-database
  fixture CRUD, self-signing, and one exact service-level verifier invocation
  binding to the existing probe identity.

The verifier is not claimed to be Workflow-only. Project-level inheritance
currently gives `run.routes.invoke` to five authenticated principals: one Owner,
the two default Editor service accounts, and the Cloud Functions and Cloud Run
service agents. The deployment inventory resolves every project role's
permissions, requires exactly that closed inherited set, and rejects every extra
service-level binding. Internal-only ingress, IAM enforcement and the absence of
public principals remain mandatory.

Every generation-3 temporary IAM binding independently expires at
`2026-09-06T18:00:00Z`. Retirement is still mandatory immediately after the
single execution; expiry is a backstop, not the cleanup mechanism. No resource
has public ingress or a public principal. No service-account key, secret,
scheduler, minimum instance, VPC, NAT, load balancer, or recurring compute is
created. The reused probe identity is checked for zero user-managed keys
immediately before Terraform applies any temporary privilege and again in the
post-apply deployment inventory.

The expected incremental cost is negligible: one short scale-to-zero verifier
revision, one short Workflow execution, two token exchanges, IAM Credentials
calls, bounded all-resource IAM policy searches, bounded Firestore fixture
operations, seven private Function requests (two metadata `GET`s and five
exchange `POST`s), and one internal verifier request. This is not a load or
stress test.

## What the probe proves

The Workflow uses three independent authentication layers:

- `X-Serverless-Authorization` carries the Cloud Run identity token to the
  internal Function;
- `Authorization` carries a genuine Firebase ID token for a fixed no-email
  synthetic user;
- `X-Firebase-AppCheck` carries a genuine Admin custom-provider App Check token.

It performs five `POST /v1/user-relay-tokens:exchange` requests in this order:

1. an invalid Firebase token must return `401 invalid_firebase_token`;
2. valid Firebase Auth without App Check must return
   `401 invalid_app_check_token`;
3. valid Firebase Auth and App Check with no private Home must return
   `404 home_not_found`;
4. a fixed private `controlHomes` fixture pointing to relay A must return a
   five-minute Ed25519 credential for relay A;
5. after a compare-and-set rotation to relay B, the same request must return a
   distinct credential for relay B.

The Workflow fetches the discovery document and JWKS through private ingress and
requires the exact issuer, endpoint, key type, key ID, algorithm, and Ed25519
public key. It then sends both credentials once to the internal verifier. The
verifier checks both signatures, exact claims, five-minute lifetime, ordered
audiences, and distinct token IDs, then returns only four sanitized facts.

The fixed private Home deliberately has an owner different from the authenticated
user. Success therefore proves the current exchange contract does not enforce
Home ownership; it does not claim that this is the final authorization policy.
The fixed lowercase public `homes` path is checked before and after execution;
no public document is created.

The Workflow deletes the private Home with an update-time precondition,
self-deletes the synthetic Firebase user with that user's own ID token, attempts
both cleanup domains independently, and verifies both plus the public Home are
absent. The local driver independently checks all three fixed paths before and
after execution and performs marker-checked cleanup after failure. Tokens, Web
API keys, exception bodies,
execution IDs, trace IDs, and raw diagnostics never enter public evidence.

This probe does not validate browser attestation, reCAPTCHA Enterprise, live
relay sockets, source admission, key rotation, a relay rollback, or production.
Those acceptance gates remain separate.

## Guarded lifecycle

All commands require a clean checkout at the exact reviewed `origin/main`
commit, the pinned operator identity, Terraform 1.11.3, the committed staging
manifest, and a private artifact directory outside the repository.

Cloud Asset must already be enabled and imported into this root before an arm
plan is accepted. If it is absent, the recovery planner emits only the
separately authorized `cloud_asset_api_prerequisite` action; after applying that
prerequisite, create a fresh arm plan. This makes project-wide IAM discovery
available before any temporary role is granted.

```bash
private_parent="/private/path/created-with-mktemp"
chmod 700 "$private_parent"

MIAKAPP_STAGING_AUTH_PROBE_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/auth-probe/plan.sh "$private_parent"
```

The planner accepts only the exact nine creates, one state-only guard update, and zero
deletes. It prints the authorization derived from the binary plan digest and
reviewed commit:

```bash
MIAKAPP_STAGING_AUTH_PROBE_APPLY_AUTHORIZATION='arm-user-relay-probe:...' \
  ./infrastructure/staging/auth-probe/apply.sh '/private/bundle'
```

Apply must converge and independently inventory the exact Workflow, verifier,
three enabled generation-3 roles, six disabled roles across generations 1 and 2, keyless
identity, four conditioned bindings, zero executions, zero
public principals, the five explicitly acknowledged project-level verifier
invokers, no direct verifier grant plus a zero-result supplemental project-wide
snapshot, and zero recurring compute. It then prints an invocation
authorization bound to the live Workflow revision and both source hashes:

```bash
MIAKAPP_STAGING_AUTH_PROBE_INVOKE_AUTHORIZATION='invoke-user-relay-probe:...' \
  ./infrastructure/staging/auth-probe/invoke.sh '/private/bundle'
```

Retirement is a separately rendered, targeted capability-closing plan. It
accepts the exact subset of six temporary resources still represented in state,
and ensures all three generation-3 custom roles are disabled (zero to three
transitions) while generations 1 and 2 remain disabled.
With a stable inventory, this normal path contains at least one temporary
delete; an exact zero-temporary graph is routed to separately authorized
finalization. The plan validator still permits a zero-delete fallback only with
at least one exact role-disable transition, closing a race in which the last
temporary disappears after inventory and before planning. An all-no-op state is
handled by authorized evidence recovery instead. This allows cleanup after a
partial arm while never creating a missing temporary resource:

```bash
MIAKAPP_STAGING_AUTH_PROBE_RETIRE_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/auth-probe/retire-plan.sh '/private/bundle'

MIAKAPP_STAGING_AUTH_PROBE_RETIRE_AUTHORIZATION='retire-user-relay-probe:...' \
  ./infrastructure/staging/auth-probe/retire-apply.sh '/private/bundle'
```

Each role generation is intentionally one-shot. The arm preflight rejects a
previously disabled generation-3 role and verifies that generations 1 and 2 remain
disabled and unassigned. Another acceptance run requires new reviewed role IDs
and a new capability expiry instead of reactivating retained bindings.

Before planning retirement, the driver compares the complete remote state with
live inventory and routes every absent, stale, or tainted state-only guard
through recovery. If a provider created or deleted a temporary without recording
the same state transition, use the separate digest-bound recovery:

```bash
MIAKAPP_STAGING_AUTH_PROBE_RETIRE_RECOVERY_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/auth-probe/retire-recovery-plan.sh '/private/bundle'

MIAKAPP_STAGING_AUTH_PROBE_RETIRE_RECOVERY_AUTHORIZATION='<exact authorization>' \
  ./infrastructure/staging/auth-probe/retire-recovery-apply.sh '/private/bundle'
```

Recovery has two closed phases. If Cloud Asset is disabled, the first
authorization can only enable that API and import its one Terraform address; it
then stops and requires a fresh complete inventory and authorization. The normal
phase can remove only the uniquely named Workflow, verifier service, and four
exact conditioned bindings, forget only allowlisted temporary state, or
import/untaint an exact persistent resource. A missing non-role persistent
resource can be recreated only through a targeted saved plan whose exact value
and create-only delta pass the committed validator. Missing, stale and tainted
generations of the state-only guard have their own create, update or untaint
actions in the digest-bound authorization. If all six temporary resources are
absent both live and in state while every persistent resource and the guard are
exact, the inventory binds an explicit finalization flag into the same digest,
TTL, operator, and commit authorization. Apply then disables any remaining GA
roles. If every role is already disabled but a failed apply left only the
non-secret Terraform output stale, a separate validator accepts exactly that
one output update while requiring every managed resource to remain a no-op.
Apply then cleans the exact fixtures, rechecks convergence, and regenerates
retirement evidence. This closes both a partial-arm interruption before the first
temporary create and a process interruption after Terraform retirement.

A soft-deleted custom role is never undeleted automatically. Cloud Asset IAM
policy search is eventually consistent, so an empty result cannot safely prove
that restoring a role would not reactivate a recent descendant binding. The
driver fails closed for manual investigation. A tracked role that is absent is
also never generically recreated until its role ID is verifiably reusable.
Recovery never broadens a role or invokes the product route.

Successful retirement removes the Workflow, verifier service, every temporary
binding, and any exact synthetic fixture. It retains only the Cloud Asset API,
nine disabled custom roles across three immutable generations, the keyless no-role
verifier identity, and the guard. Private plans, state, credentials, raw
diagnostics, and unsanitized execution data must never be committed.
