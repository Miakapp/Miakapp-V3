# Miakapp 4 staging activation blueprint

Status: guarded bootstrap plan observed; the Firebase project is still unbilled,
empty, and undeployed

This directory contains a closed, apply-capable description of the future
`miakapp-v4-staging` foundation. It does not authorize or perform cloud
mutation. No active repository workflow authenticates to Google Cloud.

## Current truth

The one-shot Firebase bootstrap on 2026-09-02 reserved project
`miakapp-v4-staging` (`1072737219170`) and its default Hosting site name. The
dated inventory in [`manifest.json`](manifest.json) records:

- no billing link;
- no registered Firebase app, App Engine application, Firestore database,
  Storage bucket, Function, Cloud Run service, KMS key ring, or secret;
- no staging runtime, planner, or deployer identity; and
- no live Terraform state or saved plan.

On 2026-09-02, the guarded bootstrap command ran against configuration commit
`f363d4ee3cc6639edfa59fefe92cb1ffca682fd1` and proposed 36 additions, no
changes, and no destroys. The closed observation in the manifest records the
resource-category totals and the unchanged billing, API, IAM, bucket, service
account, Workload Identity, and local state boundaries. The command saved no
plan and performed no apply.

Firebase-enabled APIs and its managed Admin SDK service account exist, but they
are not evidence of a deployed or billable workload. Paris (`europe-west9`) and
the SHA-256 fingerprint of an existing EUR billing account are reviewed inputs;
the raw billing account identifier is not committed.

All authorization bits in the manifest remain false. Passing the local gate is
review evidence, never authorization to link billing, create resources, install
a cloud workflow, open ingress, apply, or destroy.

## Repository layout

| Path | Purpose | Current execution boundary |
|---|---|---|
| [`bootstrap/`](bootstrap/) | Billing, budget, both buckets, runtime/project IAM, Workload Identity Federation, and separate CI service accounts | Guarded 36/0/0 plan observed with local User ADC; never applied |
| [`terraform/`](terraform/) | APIs, Firestore, KMS, empty Secret Manager containers, and resource-scoped runtime IAM | Mock-tested offline; live plan blocked until bootstrap state exists |
| [`automation/`](automation/) | GitHub policy record, dormant plan/apply workflow, private-plan scripts, and operator inspection | Outside `.github/workflows`; cannot run |
| [`test/`](test/) | Closed-schema, inventory, IAM, state, workflow, and hostile-input tests | Credential-free |
| [`TEARDOWN.md`](TEARDOWN.md) | Manual recovery and teardown rehearsal | Documentation only |

## Safety and cost posture

The proposed foundation fixes every regional resource to Paris, keeps the
Function at `minInstances=0` and `maxInstances=1`, and includes no load balancer,
Cloud Armor policy, VPC connector, Cloud NAT, Analytics property, or deployed
compute. The component bucket is private, has Public Access Prevention and no
CORS origin. No secret value or service-account key is represented.

If separately authorized and applied, the remote-state bucket would use uniform
access, Public Access Prevention, Object Versioning, and a seven-day soft-delete
window. Foundation state retains recovery history. Live saved plans expire after
two days, their archived generation after one further day, and deleted bytes may
remain recoverable during the bucket soft-delete window. Plans and state may
contain private data and must never be committed or uploaded to public Actions
artifacts.

The planner and deployer configurations are keyless and separate. Both may read
the private bucket. The planner may manage only `.tflock` objects and create
saved plans; it cannot create or replace state. The empty foundation state must
be initialized and verified with protected operator credentials before CI is
admitted. Only the deployer may write foundation state; neither may mutate the bootstrap
state prefix. Escalation-capable project IAM, service-account creation and bucket
creation remain human-bootstrap operations. The deployer has only service-scoped
foundation roles plus administration of the separate component bucket; it has no
project-wide Storage or IAM role capable of bypassing the state boundary. None
of these identities exists today.

This repository change itself costs nothing. If activated, the empty state
bucket should store only small state and short-lived plan objects, but Storage
operations and retained versions are usage-metered. Budget alerts at EUR 2, EUR
5, and EUR 10 are alarms rather than hard caps. The software KMS key version is
the principal planned idle fixed cost; actual staging measurements must replace
estimates before production.

## Remote-state bootstrap boundary

The GCS bucket cannot be the backend of the transaction that creates it. The
bootstrap root therefore has no active backend block and its guarded plan uses
the implicit local backend. [`bootstrap/backend.gcs.tf.example`](bootstrap/backend.gcs.tf.example)
is the exact migration target, not an active Terraform file.

A future explicitly authorized bootstrap must save and review an exact plan,
apply it from protected temporary local state, activate the backend template,
migrate that exact state to `terraform/bootstrap`, and independently reconcile
the remote generation before deleting any local copy. There is deliberately no
apply or migration wrapper in this revision.

The ordinary foundation root already points at `terraform/foundation` and reads
the bootstrap output from `terraform/bootstrap`. A closed precondition checks
the exact project, region, both buckets, identity providers, all service
accounts, and numeric GitHub repository IDs before any foundation resource can
proceed.

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
private-plan handling, and hostile environment inputs. It initializes Terraform
with `-backend=false` and never reads credentials or contacts staging.

The active validation workflow has only `contents: read`; it has no OIDC or
secret permission. The dormant workflow deliberately fails its first policy job
because workflow installation and cloud bootstrap remain unauthorized.

## Next authorization gate

The GitHub branch, environment and Actions prerequisite and the non-saved
bootstrap diagnostic plan were completed and re-observed on 2026-09-02 without
installing a cloud workflow or changing Google Cloud. Before any additional
cloud action, a separate reviewed pass must:

1. revalidate the external policy and cloud inventory, then receive new operator
   authorization to link billing and create, review, and apply an exact saved
   bootstrap plan;
2. migrate and reconcile bootstrap state before any foundation plan;
3. install the cloud workflow only after its WIF providers and service accounts
   exist; and
4. review a live foundation plan before granting apply approval.

The production Function entry point, exact FCM runtime permission, secret
version lifecycle, ingress design, monitoring, real-service fault matrix,
migration rehearsal, and every `STAGE-*` observation remain open blockers.
