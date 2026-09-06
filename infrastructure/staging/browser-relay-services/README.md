# Digest-bound staging browser-relay services root

This directory defines the two ephemeral Cloud Run relay services required by
the live browser acceptance matrix. It remains deliberately non-operational: it
has no plan, apply, destroy, cloud inventory or authorization entrypoint. Importing or
validating its JavaScript modules makes no network request, and the committed
Terraform has never been applied.

The root now binds the merged Miakapp-Server source to the exact verified
Artifact Registry digest
`sha256:23a19a26e8a24f6434ab8bc557dfa3fa799e0262e3400170e3bf064101a890b1`.
The image is no longer an operator-controlled Terraform variable. The v1
profile without an image is retained as historical evidence, while the current
profile is tied to the byte-exact sanitized build result. Both revisions share
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
and Terraform teardown is IAM-first. A future digest-bound orchestrator must
still prove the transition plan, inventory the assigned URLs, render rollback,
bind a single-use claim and coordinate the control-plane edge before any phase
is applied. This source closes the image prerequisite but does not by itself
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
