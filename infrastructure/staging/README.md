# Miakapp 4 staging activation blueprint

Status: recovery plan reviewed; exact apply-and-migrate authorization pending

This directory contains a closed, apply-capable description of the future
`miakapp-v4-staging` foundation. It does not authorize or perform cloud
mutation. No active repository workflow authenticates to Google Cloud.

## Current truth

The one-shot Firebase bootstrap on 2026-09-02 reserved project
`miakapp-v4-staging` (`1072737219170`) and its default Hosting site name. The
dated inventory in [`manifest.json`](manifest.json) records:

- the approved EUR billing link is active and recorded in the preserved local
  Terraform state; no target budget or billing export exists;
- no registered Firebase app, App Engine application, Firestore database,
  Storage bucket, Function, Cloud Run service, KMS key ring, or secret;
- no staging runtime, planner, or deployer identity; and
- no remote Terraform state exists. The only authoritative bootstrap state is a
  mode-0600 private local recovery file outside the repository.

On 2026-09-03, after the separately authorized billing link, the guarded
bootstrap command ran against configuration commit
`9b3905bb62718b57456b0658386b424ed635e82f` and proposed 36 additions, no
changes, and no destroys. The closed observation in the manifest records the
resource-category totals, the approved link, and the unchanged API, IAM, bucket,
service-account, Workload Identity, and local-state boundaries. The command
saved no plan and performed no apply. Because no Terraform state exists, the
provider still represents the already-active billing association as an addition;
the command did not create or change that link.

Later on 2026-09-03, the guarded saved-plan path produced and fully inspected a
create-only plan from commit
`c192f97959833f53a19d4e6dc50b26292c88b3b5`. Its SHA-256 is
`0918d21c4677ce0958be9ccc43057d8d76a33857fdfbea066120ba953e30b5c1`, and
its exact result is the same 36 additions, no changes, and no destroys. The
private bundle path, planned values, and raw billing-account identifier are not
committed. Planning and inspection created no state, performed no apply, and
left the target budget, buckets, service accounts, and Workload Identity pool
absent. The owner then authorized that exact digest. Its first Terraform action
attempted to rewrite the already-correct billing association and hit the Cloud
Billing association-change quota. Terraform stopped with zero managed resources;
independent inventory confirmed that every proposed cloud target remained absent.
That plan is superseded and must not be retried.

The import recovery plan was created and fully inspected from commit
`6340bffbddcc4797067ef48170fc5c3524345bf2`; its SHA-256 is
`6fb0b0c15fa04338a40ab59de790c3a4a85f96b418377c4a70570a8dabd5d457`,
with exactly 35 creations, one import with a client-side update, and no deletion.
The owner authorized that exact plan at execution commit
`c3028c74d582c4f405f93e15ae0cf60898181728`. Terraform imported the billing
link and recorded all eight bootstrap APIs before budget creation failed: User
Application Default Credentials had no quota project for the Budget API. The
failed run preserved a valid Terraform 1.11.3 state at serial 11 with exactly
nine managed resources. Its SHA-256 is
`07fc7412e35efaff288e2efd30f786c2871d9fa836fb813a178d247ccb1efe5a`;
the file path and contents remain private and are not committed.

Fresh read-only inventory confirmed that the approved billing link and all eight
bootstrap APIs are active, while the target budget, both target buckets, three
service accounts, and Workload Identity pool remain absent. The failed plan is
superseded and must not be retried. Both Google providers now charge API quota
to the staging project, and every planning/execution path is bound to the exact
preserved state. The replacement plan was created from commit
`e9f410c58c8cbbf8f5f7a17170c9e8ed55a10501`; its SHA-256 is
`12927b270f2bfa78c8f8c8c7e7071ce9cfec18d5e848165c04b585260bd5f7da`.
The complete plan was inspected and contains exactly 27 creations and nine
no-op resources, with no import, update, or deletion. A second read-only
inventory confirmed the same boundary. Neither apply nor state migration is
authorized.

Firebase-enabled APIs and its managed Admin SDK service account exist, but they
are not evidence of a deployed or metered workload. Paris (`europe-west9`) and
the SHA-256 fingerprint of the linked EUR billing account are reviewed inputs;
the raw billing account identifier is not committed.

All authorization bits for additional cloud actions in the manifest remain
false. Passing the local gate is review evidence, never authorization to create
resources, install a cloud workflow, open ingress, apply, or destroy.

## Repository layout

| Path | Purpose | Current execution boundary |
|---|---|---|
| [`bootstrap/`](bootstrap/) | Imported billing link, budget, both buckets, runtime/project IAM, Workload Identity Federation, and separate CI service accounts | Recovery plan reviewed against the private nine-resource state; exact authorization pending |
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

The bootstrap root contains guarded commands that can save an exact plan to
a mode-0700 directory outside the repository, inspect it locally, and—only after
a separate exact authorization—apply and migrate it. The execution wrapper
requires the Budget API preflight to succeed through the staging quota project,
proves the eight state-recorded APIs are still enabled, and requires exactly one
target budget after a complete apply. It keeps all transient state outside the repository,
activates the backend template only in a private working copy, and deletes local
state only after the remote generation and full state contents reconcile. The
wrapper also verifies the exact recovery-state digest, lineage, serial and nine
baseline addresses before planning or applying; a produced state must retain
that lineage and inventory before migration. The reviewed recovery-plan digest
is bound in the wrapper, but no execution can pass without a separate exact
authorization tied to the clean repository commit that runs it.

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
private-plan handling, the complete simulated apply/migration/recovery state
machine, and hostile environment inputs. It initializes Terraform with
`-backend=false` and never reads credentials or contacts staging.

The active validation workflow has only `contents: read`; it has no OIDC or
secret permission. The dormant workflow deliberately fails its first policy job
because workflow installation and cloud bootstrap remain unauthorized.

## Next authorization gate

The GitHub branch, environment and Actions prerequisite are configured. Before
any additional cloud action, the recovery sequence must:

1. receive explicit operator authorization for the reviewed recovery plan and
   exact clean execution commit;
2. revalidate its state, digest, policy, and inventory before applying it;
3. migrate and reconcile bootstrap state before any foundation plan;
4. install the cloud workflow only after its WIF providers and service accounts
   exist; and
5. review a live foundation plan before granting apply approval.

The production Function entry point, exact FCM runtime permission, secret
version lifecycle, ingress design, monitoring, real-service fault matrix,
migration rehearsal, and every `STAGE-*` observation remain open blockers.
