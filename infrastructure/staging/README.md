# Miakapp 4 staging activation blueprint

Status: bootstrap complete; remote state migrated and reconciled; foundation initialization pending

This directory contains a closed, apply-capable description of the future
`miakapp-v4-staging` foundation. It does not authorize or perform cloud
mutation. No active repository workflow authenticates to Google Cloud.

## Current truth

Project `miakapp-v4-staging` (`1072737219170`) remains application-undeployed:
there is no Firebase app, App Engine application, Firestore database, Function,
Cloud Run service, KMS key ring, secret, public ingress, or active cloud
workflow. The authorized bootstrap apply on 2026-09-03 did, however, complete
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
contains no apply path and refuses to overwrite the existing state object. No
foundation resource or workload has been planned yet.

All current authorization bits for additional cloud actions remain false.
Passing the local gate is evidence, never authorization to initialize state,
install a workflow, deploy a workload, open ingress, apply, or destroy.

## Repository layout

| Path | Purpose | Current execution boundary |
|---|---|---|
| [`bootstrap/`](bootstrap/) | Billing link, budget, both buckets, runtime/project IAM, Workload Identity Federation, and separate CI service accounts | Complete; remote state reconciled with protected local recovery evidence |
| [`terraform/`](terraform/) | APIs, Firestore, KMS, empty Secret Manager containers, and resource-scoped runtime IAM | Mock-tested offline; live plan blocked until empty foundation state is initialized and verified |
| [`automation/`](automation/) | GitHub policy record, dormant plan/apply workflow, private-plan scripts, and operator inspection | Outside `.github/workflows`; cannot run |
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

The planner and deployer identities now exist and are keyless and separate. Both may read
the private bucket. The planner may manage only `.tflock` objects and create
saved plans; it cannot create or replace state. The empty foundation state must
be initialized and verified with protected operator credentials before CI is
admitted. Only the deployer may write foundation state; neither may mutate the bootstrap
state prefix. Escalation-capable project IAM, service-account creation and bucket
creation remain human-bootstrap operations. The deployer has only service-scoped
foundation roles plus administration of the separate component bucket; it has no
project-wide Storage or IAM role capable of bypassing the state boundary. They
are not used by any active workflow.

This repository change itself costs nothing. The state bucket currently stores
one 60,909-byte bootstrap state plus Terraform's recoverable 181-byte initial
empty generation, and will later hold bounded foundation state and short-lived
plan objects. Storage
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
bootstrap generation and proves that the foundation object is absent. It then
creates a saved `-refresh-only` plan, rejects any plan containing a resource,
output, variable, module, provider configuration, or action, and applies only
that verified empty plan through Terraform's locking GCS backend.

The initializer never uses `terraform state push` or a direct cloud-object
write. It reads both Terraform's view and the exact current GCS generation back,
requires an exact canonical empty state at serial 1, and rejects every other
bucket object. A valid preexisting empty state is reconciled without planning or
mutation, so recovery after an uncertain client result cannot overwrite it.
Failure preserves private diagnostics; success removes them. The implementation
is bound to reviewed implementation commit
`052f6c92d76f93ec222ffd03e4d34ba7a927495b` and remains disabled until a
separate exact authorization names the clean execution commit.

The plan and apply acquire and release Terraform's temporary `.tflock` object.
The only durable new live object is the roughly 181-byte empty state; Object
Versioning and soft delete may temporarily retain tiny noncurrent state or lock
generations as recovery evidence.

## Dormant GitHub automation

[`automation/github-policy.json`](automation/github-policy.json) captures both
the observed GitHub settings and the settings required before activation. On
2026-09-02, `main` was protected with the credential-free staging gate bound to
GitHub Actions, the plan/apply environments were restricted to `main`, and
Actions were restricted to the reviewed SHA-pinned integrations with read-only
default permissions. The unrelated `miakapi` environment was left unchanged.
Repository OIDC customization remains at its default because the future Google
provider, not GitHub's repository subject template, will enforce the immutable
numeric and workflow claims. The cloud workflow is still not installed.

The dormant blueprint requires:

- protected `main` with the credential-free staging gate required;
- SHA-pinned selected actions and read-only default workflow permissions;
- separate `miakapp-v4-staging-plan` and `miakapp-v4-staging-apply`
  environments;
- OIDC conditions over immutable repository/owner IDs, `main`, the exact
  workflow reference, and the exact environment; and
- explicit approval in the apply environment before the same-run,
  digest-verified private plan is applied.

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
the absent active workflow, pinned actions and providers, exact locks for macOS
ARM64 and Linux AMD64, both Terraform roots with mock providers, script syntax,
private-plan handling, the complete simulated migration-only recovery state
machine, the simulated guarded foundation-state initializer, and hostile
environment inputs. It initializes Terraform with `-backend=false` and never
reads credentials or contacts staging.

The active validation workflow has only `contents: read`; it has no OIDC or
secret permission. The dormant workflow deliberately fails its first policy job
because workflow installation and foundation deployment remain unauthorized.

## Next authorization gate

The GitHub branch, environment and Actions prerequisite are configured. Before
any additional cloud action, the recovery sequence must:

1. authorize, initialize, and verify the empty foundation state before admitting CI;
2. install the cloud workflow only after the state boundary is proven; and
3. review a live foundation plan before granting apply approval.

The production Function entry point, exact FCM runtime permission, secret
version lifecycle, ingress design, monitoring, real-service fault matrix,
migration rehearsal, and every `STAGE-*` observation remain open blockers.
