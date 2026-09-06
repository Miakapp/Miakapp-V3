# Digest-bound staging browser-relay services root

This directory defines the two ephemeral Cloud Run relay services required by
the live browser acceptance matrix. A bounded, single-use operator entrypoint is
prepared for the first private bootstrap. It may create only the two private
scale-to-zero services, one keyless identity with no project role and one
Terraform guard. It cannot add a public invoker, send a request to either relay,
release Hosting, create a persistent credential or destroy a resource.
Importing or validating its JavaScript modules makes no network request. The
entrypoint has not yet been executed at this revision.

The root now binds the merged Miakapp-Server source to the exact verified
Artifact Registry digest
`sha256:23a19a26e8a24f6434ab8bc557dfa3fa799e0262e3400170e3bf064101a890b1`.
The image is no longer an operator-controlled Terraform variable. The v1
profile without an image and v2 digest-bound dormant profile are retained as
historical evidence, while the current profile additionally pins the initial
empty backend state and operation boundary. All revisions share
one keyless service account with no project role, secret, database access or VPC
connector. Each service scales from zero to one 1-vCPU/256-MiB instance,
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
and Terraform teardown is IAM-first. The bootstrap driver inventories the live
baseline, validates an exact four-create saved plan, binds it to a two-hour
metadata document and requires an exact digest-based authorization. Immediately
before Terraform apply, it atomically creates a durable generation-pinned claim
in the state bucket. Any ambiguous outcome after that claim is non-retryable.
It then requires an empty convergence plan and independently inventories Cloud
Run, service-account keys, project roles, service IAM, Terraform state and the
claim without calling either workload endpoint. Later, separately reviewed
phases must still replace both bootstrap audiences, coordinate the control-plane
edge and prove rollback before any public window. This phase does not by itself
satisfy `RELAY-01` or authorize public ingress.

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

## Private bootstrap operator flow

The planner and apply driver intentionally run only from a clean commit that is
byte-for-byte equal to `origin/main`. The private bundle must live outside the
repository and is never committed:

```sh
MIAKAPP_STAGING_RELAY_SERVICES_BOOTSTRAP_PLAN_CONFIRMATION=miakapp-v4-staging \
  infrastructure/staging/browser-relay-services/plan.sh /private/tmp

MIAKAPP_STAGING_RELAY_SERVICES_BOOTSTRAP_APPLY_AUTHORIZATION='<exact planner output>' \
  infrastructure/staging/browser-relay-services/apply.sh '<exact private bundle>'
```

The apply command is single-use. Do not retry a bundle after
`mutation-attempted.json` exists and never delete its global claim to make a
retry possible. Preserve the bundle and reconcile from fresh live evidence.
