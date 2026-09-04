# Staging Firebase Auth and App Check probe

This Terraform root owns a bounded, private, single-execution probe for the existing Miakapp V4 staging control plane. It proves that the deployed service accepts a genuine Firebase ID token and a genuine App Check token for the pinned Firebase Web app while preserving the existing internal-only Cloud Run boundary.

The reviewed live execution succeeded on 2026-09-04. Its digest-pinned sanitized
result and retirement inventory are committed as `result.json` and
`retirement.json`; the Workflow, temporary IAM bindings and synthetic Firebase
user are absent. The default graph remains dormant.

The root uses the independent GCS backend prefix `terraform/auth-probe`. Its safe default is `armed = false`.

It consumes both the pinned private workload state and the exact closed Firebase
Authentication baseline from [`../firebase-auth/`](../firebase-auth/). Planning
fails before IAM or Workflow creation when that non-deletable initialization is
absent or its remote state is unexpected. The planner, apply driver, and
invocation driver also run an independent refresh-backed zero-change plan of the
Firebase Auth root immediately before their respective boundary, so stale state
cannot conceal live config drift. They also query all default-supported, OIDC,
and inbound-SAML provider collections through the Admin API and require all
three to be empty; no hard-coded Terraform output is treated as evidence of
external-provider absence.

## Security and cost boundary

The armed graph contains exactly:

- one unscheduled Workflow with `LOG_NONE`, basic execution history, no arguments and no retries;
- one temporary assignment of a four-permission custom role to the existing probe service account: three read/token Firebase permissions plus `serviceusage.services.use` for its own staging quota project;
- one temporary self-scoped `roles/iam.serviceAccountTokenCreator` binding;
- one permanent, unassigned custom-role definition after retirement.

It creates no key, secret, provider debug token, scheduler, public invoker, minimum instance or recurring compute. The Firebase Web API key is fetched at execution time and remains only in Workflow memory. The one execution creates a fixed no-email synthetic Firebase UID, performs three private read-only product requests, deletes that UID, and verifies its absence. The local driver independently verifies absence before and after execution and attempts deletion if execution fails.

On failure, the Workflow discards the original exception and can expose only
one source-pinned stage label. The Auth exchange maps documented Identity
Platform errors and HTTP statuses to fixed labels before clearing the caught
error. HTTP bodies, tokens and exception details remain absent from the result
and local error message.

The expected incremental cost is negligible: one short Workflow execution, Firebase token exchanges, IAM Credentials calls and a handful of Firestore reads. This is not a load test.

The custom-token exchange response is validated against its documented fields.
Because that response does not include a Firebase UID, a separate project-scoped
Admin lookup proves that the fixed no-email synthetic UID was created before the
probe proceeds.

## What the probe proves

The Workflow uses two authorization layers on each successful product request:

- `X-Serverless-Authorization` carries the Cloud Run OIDC token;
- `Authorization` carries the Firebase ID token;
- `X-Firebase-AppCheck` carries the App Check token.

It calls `GET /v1/push-destinations` in this exact order:

1. valid Firebase Auth without App Check must return `401 invalid_app_check_token`;
2. valid Firebase Auth and App Check must return an empty destination list with HTTP 200;
3. the same credentials must return the same HTTP 200 response again.

The third request documents the V1 policy: standard App Check tokens are reusable because runtime consumption is deliberately disabled. The existing one-time FID proof and admission transaction remain the operation replay boundary.

The App Check token is minted through Firebase's Admin custom-provider exchange. This validates project/app binding and the production backend verifier, but it does **not** validate browser attestation, reCAPTCHA Enterprise configuration, a wrong-app negative case or provider quota. The live browser-provider gate therefore remains separate.

## Guarded lifecycle

All commands require a clean checkout at the exact reviewed `origin/main` commit, the pinned operator identity, Terraform 1.11.3, the committed staging manifest and a private artifact directory outside the repository.

```bash
private_parent="$(mktemp -d)"
chmod 700 "$private_parent"

MIAKAPP_STAGING_AUTH_PROBE_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/auth-probe/plan.sh "$private_parent"
```

The planning command prints the private bundle path and the exact apply authorization derived from the binary plan digest and reviewed commit. Use that exact value:

When re-arming after the bounded diagnostic source update, the validator also
accepts one state-only `terraform_data` guard transition from the pinned prior
Workflow source hash to the current hash. It still rejects every Google
resource update.

```bash
MIAKAPP_STAGING_AUTH_PROBE_APPLY_AUTHORIZATION='arm-auth-app-check-probe:...' \
  ./infrastructure/staging/auth-probe/apply.sh '/private/bundle'
```

Apply prints the exact invocation authorization bound to the live Workflow revision and source hash:

```bash
MIAKAPP_STAGING_AUTH_PROBE_INVOKE_AUTHORIZATION='invoke-auth-app-check-probe:...' \
  ./infrastructure/staging/auth-probe/invoke.sh '/private/bundle'
```

Retirement is a separately rendered and validated targeted plan. It accepts the
exact subset of temporary resources found in Terraform state, so it also works
when arm or post-apply inventory stopped before `deployment.json` was written.
Terraform 1.11.3 marks this deliberately targeted plan as incomplete; the
validator requires that flag only for the normal targeted retirement profile
and still enumerates every allowed resource and action. The separate untargeted
recovery finalizer requires a complete, zero-cloud-delta plan. Normal retirement
never creates a missing resource during cleanup:

```bash
MIAKAPP_STAGING_AUTH_PROBE_RETIRE_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/auth-probe/retire-plan.sh '/private/bundle'

MIAKAPP_STAGING_AUTH_PROBE_RETIRE_AUTHORIZATION='retire-auth-app-check-probe:...' \
  ./infrastructure/staging/auth-probe/retire-apply.sh '/private/bundle'
```

Before rendering that plan, the driver compares the complete remote state
digest with an exact live inventory. A provider can occasionally create a
Workflow or IAM binding before failing to commit it to state. If such a
state-missing temporary is found, use the separate, digest-bound recovery:

```bash
MIAKAPP_STAGING_AUTH_PROBE_RETIRE_RECOVERY_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/auth-probe/retire-recovery-plan.sh '/private/bundle'

MIAKAPP_STAGING_AUTH_PROBE_RETIRE_RECOVERY_AUTHORIZATION='<exact authorization>' \
  ./infrastructure/staging/auth-probe/retire-recovery-apply.sh '/private/bundle'
```

Recovery removes only the uniquely named Workflow and exact probe-member IAM
bindings that exist live but not in state. For the inverse interrupted-delete
case, it removes only the exact allowlisted state address after proving that
the corresponding remote resource is already absent. If the exact permanent custom role
exists live but is missing or tainted in state, it imports or untaints only
that role by its full resource name. The operation is resumable after any
partial success. It completes retirement directly when no tracked temporary
remains; otherwise, render the normal saved retirement plan afterward.

Retirement deletes every present temporary Workflow or binding, independently
removes any remaining synthetic UID, verifies Terraform convergence and live
absence, and retains only the unassigned custom role and guard in state. Private
plans, tokens, raw diagnostics and unsanitized execution data must never be
committed. Only the closed, digest-pinned result and retirement summaries pass
the public evidence validator.
