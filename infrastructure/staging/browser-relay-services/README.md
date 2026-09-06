# Digest-bound staging browser-relay services root

This directory defines the two ephemeral Cloud Run relay services required by
the live browser acceptance matrix. The first bounded bootstrap was attempted
once and is permanently consumed. Cloud Run rejected both service creations
because Gen2 requires at least 512 MiB, while the v3 profile requested 256 MiB.
The Terraform guard and keyless, role-free runtime identity were created before
that provider error; no relay, public IAM member, live request, Hosting release
or persistent credential was created. `bootstrap-failure-v1.json` records only
sanitized, independently inventoried facts from that partial outcome.

A distinct single-use memory recovery was subsequently executed. It created
both private scale-to-zero services at 512 MiB and updated the guard in place;
the existing identity was an exact no-op. The post-apply convergence plan then
caught one provider-only mismatch: Google provider 8.1.0 does not round-trip an
explicit `binary_authorization.use_default = false` block when the Cloud Run API
omits its default-disabled value. Cloud Run reports both services healthy and
their IAM policies remain private, but their protocol audiences are not yet
private-ready. The recovery is permanently consumed and recorded in
`memory-recovery-failure-v1.json` rather than being retried.

The current single-use private-ready entrypoint removes that non-round-tripping
block and assigns each already-observed service URL as its exact WSS audience.
Omitting the block preserves Cloud Run's disabled default; it does not enable
Binary Authorization or ignore arbitrary drift. The reviewed saved plan may
contain only two in-place audience updates and one guard update, with zero
creates, zero deletes, zero public IAM members and zero workload requests.

The root now binds the merged Miakapp-Server source to the exact verified
Artifact Registry digest
`sha256:23a19a26e8a24f6434ab8bc557dfa3fa799e0262e3400170e3bf064101a890b1`.
The image is no longer an operator-controlled Terraform variable. The v1
profile without an image, v2 digest-bound dormant profile, consumed v3
bootstrap profile and consumed v4 memory-recovery profile are retained as
historical evidence. The current v5 profile pins both durable claims, both
failure records, both assigned service URLs and the exact recovered serial-3
backend state. All revisions share
one keyless service account with no project role, secret, database access or VPC
connector. Each service scales from zero to one 1-vCPU/512-MiB instance,
accepts at most eight concurrent requests and has a 900-second request timeout
for WebSockets.

## Lifecycle

Cloud Run assigns a service URL only after first creation, while the relay
requires that exact `wss://.../ws` URL as its token audience at process startup.
The root therefore exposes exactly four declarative phases:

1. `absent`: no guard, identity, service or public IAM member;
2. `private_bootstrap`: two IAM-protected services use distinct invalid
   bootstrap audiences solely so Cloud Run can assign their URLs;
3. `private_ready`: both services use their independently observed exact WSS
   audiences and remain IAM-protected; and
4. `public_window`: only the two exact services additionally receive
   `allUsers` `roles/run.invoker` members.

The IAM resources depend on the services, so forward creation is public-last
and Terraform teardown is IAM-first. The original bootstrap and memory-recovery
claims remain durable and are never deleted or reused. Their entrypoints reject
before environment validation or cloud access. The private-ready driver verifies
both claims by exact generation, size and content digest, inventories the exact
recovered state, validates an exact zero-create/three-update saved plan and binds
it to a two-hour metadata document. Immediately before Terraform apply, it
atomically creates a third generation-pinned claim. Any ambiguous outcome after
that claim is non-retryable. It then requires an empty convergence plan and
independently inventories Cloud Run, service-account keys, project roles,
service IAM, Terraform state and all three claims without calling either
workload endpoint. A separately reviewed operation must still coordinate the
control-plane edge and prove rollback before any public window. Private-ready
does not by itself satisfy `RELAY-01` or authorize public invocation.

## Admission and privacy boundary

The Cloud Run request concurrency and one-instance ceiling agree with the
relay's process-wide eight-connection limit. Each process also allows at most
eight active connections and 32 attempts per minute for one immediate TCP peer,
64 tracked peers, 16 live or grace-retained Homes, 256 KiB queued per connection
and 4 MiB queued across the process.

The Go relay deliberately ignores `X-Forwarded-For` and other caller-controlled
headers. On Cloud Run its immediate peer can represent a shared Google proxy,
so the per-peer bound is intentionally as coarse as the global bound. The global
Cloud Run and process ceilings remain the safety boundary; this profile does not
claim end-user IP fairness.

The public window exposes `/ping` and `/ws` at the network layer. `/ws` still
requires the exact Hosting Origin, the `miakapp` subprotocol and a short-lived
Miakapp token bound to the exact relay URL, Home, user and role. The relay sees
plaintext Home traffic and therefore remains a trusted operator choice; this
profile is not end-to-end encryption.

## Local validation

These commands are credential-free and perform no cloud mutation:

```sh
node infrastructure/staging/browser-relay-services/guard.mjs \
  infrastructure/staging/browser-relay-services
node infrastructure/staging/browser-relay-services/contract.mjs \
  infrastructure/staging/browser-relay-services/profile.json
terraform -chdir=infrastructure/staging/browser-relay-services init \
  -backend=false -input=false -lockfile=readonly
terraform -chdir=infrastructure/staging/browser-relay-services validate
terraform -chdir=infrastructure/staging/browser-relay-services test
```

They are included in `npm run test:staging-manifest`.

## Private-ready operator flow

The original bootstrap and memory-recovery plan/apply paths reject every
invocation because their global claims were consumed. The private-ready planner
and apply driver run only from a clean commit that is byte-for-byte equal to
`origin/main`. The private bundle must live outside the repository and is never
committed:

```sh
MIAKAPP_STAGING_RELAY_SERVICES_READY_PLAN_CONFIRMATION=miakapp-v4-staging \
  infrastructure/staging/browser-relay-services/ready-plan.sh /private/tmp

MIAKAPP_STAGING_RELAY_SERVICES_READY_APPLY_AUTHORIZATION='<exact planner output>' \
  infrastructure/staging/browser-relay-services/ready-apply.sh '<exact private bundle>'
```

The apply command is single-use. Do not retry a bundle after
`private-ready-mutation-attempted.json` exists and never delete any global claim
to make a retry possible. Preserve the bundle and reconcile from fresh live
evidence.
