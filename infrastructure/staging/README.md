# Miakapp 4 staging activation blueprint

Status: private keyless foundation plan strictly reviewed; apply unauthorized

This directory contains a closed, apply-capable description of the future
`miakapp-v4-staging` foundation. This revision authorizes only bounded manual
planning from protected `main`; it does not authorize foundation
apply, deployment, public ingress, or teardown.

## Current truth

Project `miakapp-v4-staging` (`1072737219170`) remains application-undeployed:
there is no Firebase app, App Engine application, Firestore database, Function,
Cloud Run service, KMS key ring, secret, or public ingress. The plan-only
workflow is installed on the default branch and completed its first successful
keyless run. The authorized bootstrap apply on 2026-09-03 did, however, complete
the infrastructure bootstrap itself:

- the approved billing link and exactly one EUR 10 alert budget;
- all eight bootstrap APIs;
- the private component and versioned Terraform-state buckets in Paris;
- the runtime, planner, and deployer service accounts;
- the Workload Identity pool and its two GitHub providers; and
- the reviewed project, bucket, and service-account IAM bindings.

Terraform reported `27 added, 0 changed, 0 destroyed` on top of the nine
resources recovered from the preceding partial run. Its complete Terraform
1.11.3 state contains exactly 36 managed addresses at serial 39. The committed
fingerprint is
`c083e7a05f2ccf273abda98c0739584336d2cbaffd8ea836b65b0790f94833a2`;
the path and raw contents remain private outside the repository.

The cloud apply succeeded, but the original wrapper stopped before backend
migration because its local validator expected a `sensitive` field that
Terraform 1.11.3 does not persist for this non-sensitive output. The guarded
recovery subsequently migrated the state to GCS. Terraform canonically raised
the serial to 40 and permuted the two `check_results` entries; a fresh read of
generation `1788439334043522` proved that every other parsed value is exactly
equal. The original serial-39 state remains protected as independent recovery
evidence outside the repository.

The consumed [`bootstrap/apply-and-migrate.sh`](bootstrap/apply-and-migrate.sh)
entry point is permanently retired. The replacement
[`bootstrap/migrate-recovered-state.sh`](bootstrap/migrate-recovered-state.sh)
contains no apply path and refuses to overwrite the existing state object. A
guarded live foundation plan has now been reviewed, but no foundation resource
or workload has been applied.

Workflow installation and manual keyless planning are authorized. A plan run
acquired its bounded Terraform lock and created one private, create-only
saved-plan object. The planner identity was exercised successfully; the deployer
remains unused. Foundation apply, workload deployment, public ingress and
destroy remain explicitly unauthorized. Passing the local gate is evidence,
never additional authorization.

## Repository layout

| Path | Purpose | Current execution boundary |
|---|---|---|
| [`bootstrap/`](bootstrap/) | Billing link, budget, both buckets, runtime/project IAM, Workload Identity Federation, and separate CI service accounts | Complete; remote state reconciled with protected local recovery evidence |
| [`terraform/`](terraform/) | APIs, Firestore, KMS, empty Secret Manager containers, and resource-scoped runtime IAM | Empty state reconciled; private saved plan strictly reviewed; no apply |
| [`automation/`](automation/) | GitHub policy record, hash-bound plan-only workflow, strict plan validator, dormant apply script, and operator inspection | Exact active plan-only copy installed under `.github/workflows` |
| [`test/`](test/) | Closed-schema, inventory, IAM, state, workflow, and hostile-input tests | Credential-free |
| [`TEARDOWN.md`](TEARDOWN.md) | Manual recovery and teardown rehearsal | Documentation only |

## Safety and cost posture

The proposed foundation fixes every regional resource to Paris, keeps the
Function at `minInstances=0` and `maxInstances=1`, and includes no load balancer,
Cloud Armor policy, VPC connector, Cloud NAT, Analytics property, or deployed
compute. The component bucket is private, has Public Access Prevention and no
CORS origin. No secret value or service-account key is represented.

The remote-state bucket uses uniform access, Public Access Prevention, Object
Versioning, and a seven-day soft-delete window. Foundation state will retain
recovery history. Live saved plans expire after
two days, their archived generation after one further day, and deleted bytes may
remain recoverable during the bucket soft-delete window. Plans and state may
contain private data and must never be committed or uploaded to public Actions
artifacts.

The planner and deployer identities now exist and are keyless and separate.
Both may read the private bucket. The planner may manage only `.tflock` objects and create
saved plans; it cannot create or replace state. The empty foundation state was
initialized and reconciled with protected operator credentials, satisfying the
state prerequisite for CI. Only the deployer may write foundation state;
neither may mutate the bootstrap
state prefix. Escalation-capable project IAM, service-account creation and bucket
creation remain human-bootstrap operations. The deployer has only service-scoped
foundation roles plus administration of the separate component bucket; it has no
project-wide Storage or IAM role capable of bypassing the state boundary. The
planner is usable only by the exact manual workflow on protected `main` and has
now completed one successful run. The deployer is not referenced by any active
workflow.

This repository change itself costs nothing. The successful plan-only workflow
added only API reads, a temporary lock that was released, and an 11,005-byte
private saved-plan object; it created no foundation resource. The state bucket
currently stores
one 60,909-byte bootstrap state and one current 181-byte empty foundation state,
plus tiny recoverable state and lock generations. It will later hold bounded
foundation state and short-lived plan objects. Storage
operations and retained versions are usage-metered. Budget alerts at EUR 2, EUR
5, and EUR 10 are alarms rather than hard caps. The software KMS key version is
the principal planned idle fixed cost; actual staging measurements must replace
estimates before production.

## Remote-state bootstrap boundary

The GCS bucket could not back the transaction that created it, so the authorized
apply used protected local state. The repository still keeps
[`bootstrap/backend.gcs.tf.example`](bootstrap/backend.gcs.tf.example) as a
template rather than activating it in the source tree.

The migration-only wrapper revalidated the private saved-plan bundle and exact
complete-state digest, serial, lineage, 36-address inventory, and activation
output. It then checked the project and billing fingerprint, the budget, APIs,
buckets, service accounts, Workload Identity pool and providers, and proved the
state bucket had no object. Only in a private working copy did it activate the
backend template and run `terraform init -migrate-state -force-copy`. It read
the remote object back and accepts only Terraform's observed canonical migration
transform: one serial increment and an exact permutation of `check_results`,
with strict equality everywhere else. Both success and failure leave the
authoritative source state unchanged; failures also retain the private execution
directory for diagnosis. The migration has completed and the existing object
makes this path fail closed on replay.

The ordinary foundation root already points at `terraform/foundation` and reads
the bootstrap output from `terraform/bootstrap`. A closed precondition checks
the exact project, region, both buckets, identity providers, all service
accounts, and numeric GitHub repository IDs before any foundation resource can
proceed.

## Guarded foundation-state initialization

[`terraform/initialize-state.sh`](terraform/initialize-state.sh) is the only
supported path for creating the initial foundation state. It operates in a
private directory outside the repository and copies only the reviewed backend,
provider lock, and CLI configuration. It first requires the exact reconciled
bootstrap generation and proves that the foundation object is either absent or
already the exact canonical empty state. Terraform 1.11.3 initializes an absent
GCS backend by creating its canonical serial-1 empty state during
`terraform init`; this is the only state-writing operation in the path.

The initializer never uses `terraform state push` or a direct cloud-object
write. It reads both Terraform's view and the exact current GCS generation back,
requires an exact canonical empty state at serial 1, and rejects every other
bucket object. Only after that reconciliation does the absent path create and
fingerprint a saved `-refresh-only` plan. It accepts only the two implicit locked
providers with no resource, output, variable, module, expression, provider
block, or action; the plan is never applied. It then rechecks that the reconciled
generation is still current. A valid preexisting empty state is reconciled
without planning or mutation, so recovery after an uncertain client result
cannot overwrite it.
Failure preserves private diagnostics; success removes them. The implementation
is bound to reviewed implementation commit
`626dc16637ba843f6d1543156aba99e7b551e705`. The first execution created
generation `1788443136082489`, then stopped before apply when its conservative
plan-shape check rejected Terraform's implicit provider metadata. After that
metadata was modeled exactly, clean execution commit
`ab6f26bd5dd076a79847f989615e7fddf93f2a07` reconciled the same canonical
empty generation without mutation. No initialization plan was ever applied.

Backend initialization and planning acquire and release Terraform's temporary
`.tflock` object.
The only durable new live object is the roughly 181-byte empty state; Object
Versioning and soft delete may temporarily retain tiny noncurrent state or lock
generations as recovery evidence.

## Guarded live foundation plan

The non-saving local wrapper was run from clean configuration commit
`363d017ebdc85af1285e38c5742365fd0a2a4395` with User ADC. Terraform 1.11.3
reported exactly `33 to add, 0 to change, 0 to destroy` plus two apply-time data
reads. The reviewed graph contains thirteen APIs, the bootstrap guard, one
regional Firestore database and three TTL fields, one software KMS key ring and
signing key, one key IAM member, five empty secret containers and their five IAM
members, and two component-bucket IAM members. It contains no workload, secret
version, public ingress, or billing resource.

The wrapper created no saved plan and ran no apply. A post-plan read proved that
foundation state generation `1788443136082489` and its SHA-256 remained
unchanged, and no `.tflock` object remained current.

The installed GitHub workflow then completed run `33772429693` from protected
configuration commit `acfcee42e202cdb4f08ada75ad81b1ad8a88951e`. Its private
11,005-byte plan has generation `1788449123427734` and SHA-256
`d90f4d2243a7754372c059f1fcd5297a23c317cbcdc9b9ff734c66575f347d3f`.
The complete binary was downloaded, digest-checked, rendered with the pinned
providers, and accepted by the `initial-foundation` closed policy: the same 33
creates and two reads, with no update or delete. The empty foundation state kept
the same generation and digest, and no live lock remained.

## Plan-only GitHub automation

[`automation/github-policy.json`](automation/github-policy.json) captures both
the observed GitHub settings and the settings required before activation. On
2026-09-03, `main` was protected with the credential-free staging gate bound to
GitHub Actions, the plan/apply environments were restricted to `main`, and
Actions were restricted to the reviewed SHA-pinned integrations with read-only
default permissions. The unrelated `miakapi` environment was left unchanged.
Repository OIDC customization remains at its default because the Google
provider, not GitHub's repository subject template, will enforce the immutable
numeric and workflow claims. The hash-bound plan-only copy is installed and has
successfully exercised those claims.

The plan-only workflow and its byte-identical blueprint require:

- protected `main` with the credential-free staging gate required;
- SHA-pinned selected actions and read-only default workflow permissions;
- the `miakapp-v4-staging-plan` environment, while the separately configured
  apply environment remains unused;
- OIDC conditions over immutable repository/owner IDs, `main`, the exact
  workflow reference, and the exact environment; and
- a hash-bound active file and blueprint before OIDC can be requested; and
- a separate policy transition before any apply workflow may be installed.

There is one known human administrator. The desired apply environment therefore
records that administrator as reviewer while allowing self-approval. This is an
explicit operator checkpoint, not independent four-eyes review. Administrator
bypass remains forbidden.

## Validate locally

Node.js 22 and Terraform 1.11.3 are required:

```sh
npm run test:staging-manifest
```

The gate validates bounded closed manifests, all three reviewed inventories,
the exact plan-only active workflow and blueprint, pinned actions and providers,
exact locks for macOS
ARM64 and Linux AMD64, both Terraform roots with mock providers, script syntax,
private-plan handling, the exact initial-foundation addresses, actions, planned
values, prior bootstrap output, critical expression references and checks, the
complete simulated migration-only recovery state
machine, the simulated guarded foundation-state initializer, and hostile
environment inputs. It initializes Terraform with `-backend=false` and never
reads credentials or contacts staging.

The active validation workflow has only `contents: read`; it has no OIDC or
secret permission. The manually dispatched plan workflow may request only the
planner OIDC identity. It has no apply job, and the dormant
apply script fails its separate policy check while foundation apply remains
unauthorized.

## Next staging gate

The GitHub branch, environment and Actions prerequisite are configured, the
foundation state boundary is reconciled, and the first private plan passed full
inspection. The next sequence is:

1. merge the strict plan admission policy through protected `main`;
2. dispatch a fresh private plan so the installed workflow itself exercises the
   new policy; and
3. separately review and activate the apply job only for that same
   `initial-foundation` policy.

The production Function entry point, exact FCM runtime permission, secret
version lifecycle, ingress design, monitoring, real-service fault matrix,
migration rehearsal, and every `STAGE-*` observation remain open blockers.
