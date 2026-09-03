# Miakapp 4 staging foundation

Status: foundation complete; recovery workflow and WIF exchange retired

This directory contains the closed description and observed state of the
`miakapp-v4-staging` foundation. The bounded recovery has completed; its active
workflow, apply authorization and reviewed GitHub OIDC exchange are retired.
This revision does not authorize workload deployment, public ingress, destroy,
or production changes.

## Current truth

Project `miakapp-v4-staging` (`1072737219170`) remains application-undeployed:
there is no Firebase app, App Engine application, Function, Cloud Run service,
secret version, or public ingress. The bootstrap is complete. Protected
foundation applies on 2026-09-03 created all thirteen declared APIs, the
deletion-protected Paris Firestore database and three active TTL fields, one
software Ed25519 signing key, and five empty Secret Manager containers. The
eight KMS, Secret Manager and component-bucket runtime IAM members are present
with the exact declared principals and roles.

The earlier authorized bootstrap apply completed:

- the approved billing link and exactly one EUR 10 alert budget;
- all eight bootstrap APIs;
- the private component and versioned Terraform-state buckets in Paris;
- the runtime, planner, and deployer service accounts;
- the retained Workload Identity pool and its two now-disabled GitHub
  providers; and
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

The planner's already-live Service Usage Consumer member was then adopted with
a configuration-driven Terraform import. The plan contained exactly one import
and no add, change, or destroy. Project IAM retained etag `BwZalzR1TWY=` and the
same canonical policy digest, and no `SetIamPolicy` audit entry appeared. The
resulting bootstrap state generation `1788457646215552` at serial 41 had 37
managed resources and remains the historical planner-role adoption record.

PR #30 configuration commit
`ee457535a64355cd8133410d9c8c43f039608928` then disabled exactly the plan and
apply Workload Identity providers. Its exact private 25,925-byte plan had
SHA-256
`8f570dfe5450b704112d484f058fc6dfcd39069a92c8bb483c5029027183e888`
and contained 35 no-ops plus two updates, each limited to `disabled: false` to
`true`. Apply reported `0 added, 2 changed, 0 destroyed`; a follow-up full plan
reported no changes. Current bootstrap state generation `1788460174191027` is
61,864 bytes at serial 42 with 37 managed resources, two data resources and one
output. Its SHA-256 is
`288d947d35f5d5a278aaff210ea878a9dab817f594b4c3161ed117bb2e30e26d`.
The pool remains enabled and retained.

The consumed [`bootstrap/apply-and-migrate.sh`](bootstrap/apply-and-migrate.sh)
entry point is permanently retired. The replacement
[`bootstrap/migrate-recovered-state.sh`](bootstrap/migrate-recovered-state.sh)
contains no apply path and refuses to overwrite the existing state object. A
guarded live foundation plan was reviewed before any foundation resource or
workload had been applied.

Run `33776569977` later applied that plan through the separate deployer identity
after normal environment approval. Terraform recorded 25 managed foundation
resources before the command failed; the private detailed log was intentionally
discarded, so no exact failure cause is claimed. State generation
`1788452068422403` is healthy at serial 4, all TTL operations completed
successfully, and no lock remains. A fresh private plan reports exactly eight
creates and 25 no-ops.

The first protected recovery refresh exposed that the planner lacked
`serviceusage.services.use`, because quota attribution had not been exercised
while the initial plan deferred its cloud reads. The narrow Service Usage
Consumer binding is now live and declared in the bootstrap source; its bootstrap
state reconciliation is complete. A subsequent fresh plan also showed that
Firestore's retention-window timestamp advances alongside its opaque etag. The
recovery validator accepts only a valid nondecreasing timestamp and otherwise
keeps the drift schema closed.

Protected run `33784785967` passed that validator, applied the exact eight IAM
members, and wrote complete state generation `1788456706865449` at serial 6.
The workflow's final step failed because it attempted its follow-up provider
reads with the deliberately narrower deployer identity. An independent User-ADC
plan then reported all 33 managed resources as no-ops and zero changes. Cloud
inventory confirmed the eight exact IAM members, five secret containers with no
versions, three active TTL fields, enabled software Ed25519 key version 1, no
workload, and no live lock. The consumed plan generation is deleted and remains
only within the private bucket's soft-delete window. The active recovery workflow
has been removed and its plan/apply entrypoints now fail immediately. GitHub
workflow `349440747` was observed in state `disabled_manually` before source
removal.

## Repository layout

| Path | Purpose | Current execution boundary |
|---|---|---|
| [`bootstrap/`](bootstrap/) | Billing link, budget, both buckets, runtime/project IAM, Workload Identity Federation, and separate CI service accounts | Complete; both recovery providers disabled, 37-resource serial-42 state reconciled, zero plan verified |
| [`terraform/`](terraform/) | APIs, Firestore, KMS, empty Secret Manager containers, and resource-scoped runtime IAM | Complete; 33-resource state independently converged |
| [`automation/`](automation/) | GitHub policy record, historical recovery blueprint, strict plan validator, and operator inspection | One-shot workflow disabled and removed; plan/apply entrypoints inert |
| [`test/`](test/) | Closed-schema, inventory, IAM, state, workflow, and hostile-input tests | Credential-free |
| [`TEARDOWN.md`](TEARDOWN.md) | Manual recovery and teardown rehearsal | Documentation only |

## Safety and cost posture

The foundation fixes every regional resource to Paris, keeps the
Function at `minInstances=0` and `maxInstances=1`, and includes no load balancer,
Cloud Armor policy, VPC connector, Cloud NAT, Analytics property, or deployed
compute. The component bucket is private, has Public Access Prevention and no
CORS origin. No secret value or service-account key is represented.

The remote-state bucket uses uniform access, Public Access Prevention, Object
Versioning, and a seven-day soft-delete window. Foundation state retains
recovery history. Live saved plans expire after
two days, their archived generation after one further day, and deleted bytes may
remain recoverable during the bucket soft-delete window. Plans and state may
contain private data and must never be committed or uploaded to public Actions
artifacts.

The planner and deployer identities and their IAM grants remain keyless and
separate. A successfully impersonated identity may read the private bucket. The
planner may consume project quota for provider reads, manage only `.tflock`
objects, and create saved plans; it cannot create or replace state. The empty foundation state was
initialized and reconciled with protected operator credentials, satisfying the
state prerequisite for CI. Only the deployer may write foundation state;
neither may mutate the bootstrap
state prefix. Escalation-capable project IAM, service-account creation and bucket
creation remain human-bootstrap operations. The deployer has only service-scoped
foundation roles plus administration of the separate component bucket; it has no
project-wide Storage or IAM role capable of bypassing the state boundary. The
planner and deployer were exercised only through the exact historical workflow.
That workflow is no longer installed, both cloud-plan and apply activation
flags are false, and both recovery provider resources are disabled. This closes
the reviewed GitHub OIDC exchange route while retaining the enabled pool. It
does not prove that another administrator cannot impersonate either service
account; that access remains part of the security and teardown inventory. The
manual operator plan remains read-only and requires User ADC plus an exact
staging confirmation.

Repository validation itself costs nothing. Planning adds only bounded API
reads, temporary locks, and short-lived private saved-plan objects. The state
bucket currently stores the 61,864-byte bootstrap state, the 53,619-byte complete
foundation state, and recovery generations. The live Firestore database is the
project's free-tier database; five secret containers have zero versions. The
software KMS key version is the principal idle fixed cost. Storage operations
and retained versions remain usage-metered, and budget alerts at EUR 2, EUR 5,
and EUR 10 are alarms rather than hard caps.

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
makes this path fail closed on replay. The later import-only adoption preserved
that initial migration evidence while advancing generation `1788457646215552`
to serial 41 with the planner quota member as its sole additional managed
resource. The WIF-provider retirement then advanced current state to serial 42
without changing the 37-resource inventory.

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

The now-retired GitHub workflow historically completed run `33774848684` from
protected configuration commit `66869a3564788ba725049cc91326b17eb239ddaf`.
Its private 11,000-byte plan has generation `1788450586606804` and SHA-256
`5def42ea3f598a5f2c59d9456814646c1b526526c6b96acf20a0db7626bc36da`.
The complete binary was downloaded, digest-checked, rendered with the pinned
providers, and accepted by the `initial-foundation` closed policy: the same 33
creates and two reads, with no update or delete. The empty foundation state kept
the same generation and digest, and no live lock remained.

Protected run `33776569977` then validated and attempted the same 33-create plan.
The apply stopped after Terraform had persisted 25 managed resources. Its exact
private plan and resulting state fingerprints are recorded in the manifest;
the discarded apply log prevents attributing a precise cause. Independent cloud
and state reads found the three expected IAM groups absent and no unexpected
workload or public resource. A subsequent private 18,893-byte saved plan,
SHA-256 `b22920a8fd933ecc05298c9fd8f2565ed01cd5b33b96bf08b223360f3390b54a`,
contains exactly eight creates, 25 no-ops and seven refresh-only provider
normalizations. It passed the closed `partial-foundation-recovery` validator and
was removed after review.

The final recovery used private plan generation `1788456590438484` with SHA-256
`d68d4d6748e03691cb1d103a0ab593413110349ba4b39b0ea4efb9be381f1a1f`.
Terraform completed all eight creates. Current state contains 33 managed
resources, three data resources and one output, and the independent no-change
plan proves configuration convergence. The failed overall Actions conclusion
records only the underprivileged follow-up plan, not an incomplete apply.

## Retired partial-recovery GitHub automation and federation

[`automation/github-policy.json`](automation/github-policy.json) captures both
the observed GitHub settings and the settings required before activation. On
2026-09-03, `main` was protected with the credential-free staging gate bound to
GitHub Actions, the plan/apply environments were restricted to `main`, and
Actions were restricted to the reviewed SHA-pinned integrations with read-only
default permissions. The unrelated `miakapi` environment was left unchanged.
Repository OIDC customization remains at its default because the Google
provider, not GitHub's repository subject template, enforces the immutable
numeric and workflow claims. The hash-bound recovery copy ran only from
protected `main`. Workflow `349440747` was set to `disabled_manually`, and its
active source has now been removed from `.github/workflows/`.

The retained historical blueprint required:

- protected `main` with the credential-free staging gate required;
- SHA-pinned selected actions and read-only default workflow permissions;
- separate `miakapp-v4-staging-plan` and `miakapp-v4-staging-apply`
  environments, with explicit approval on the latter;
- OIDC conditions over immutable repository/owner IDs, `main`, the exact
  workflow reference, and the exact environment; and
- a hash-bound active file and blueprint before OIDC could be requested;
- the exact private object and SHA-256 emitted by the same workflow attempt;
- the closed `partial-foundation-recovery` validator immediately before apply;
- a private, non-saving post-apply plan intended to report zero changes.

There is one known human administrator. The desired apply environment therefore
records that administrator as reviewer while allowing self-approval. This is an
explicit operator checkpoint, not independent four-eyes review. Administrator
bypass remains forbidden. The policy record now sets workflow installation,
cloud planning and foundation apply authorization to false. Both historical
entrypoint scripts exit before credential, Terraform or cloud access. Reusing
the blueprint requires a new reviewed activation change.

The plan/apply WIF providers are also disabled. Only their `disabled` attribute
changed; the pool, service accounts and IAM bindings were deliberately retained.
Consequently the reviewed GitHub exchange cannot mint either CI identity, but
the evidence does not rule out impersonation by another administrator.

## Validate locally

Node.js 22 and Terraform 1.11.3 are required:

```sh
npm run test:staging-manifest
```

The gate validates bounded closed manifests, all reviewed inventories,
the retired recovery policy and historical blueprint, pinned actions and providers,
exact locks for macOS
ARM64 and Linux AMD64, both Terraform roots with mock providers, script syntax,
private-plan handling, the exact recovery addresses, actions, planned values,
partial prior state, critical expression references and checks, the
complete simulated migration-only recovery state
machine, the simulated guarded foundation-state initializer, and hostile
environment inputs. It initializes Terraform with `-backend=false` and never
reads credentials or contacts staging.

The active validation workflow has only `contents: read`; it has no OIDC or
secret permission. With both recovery providers disabled, the reviewed GitHub
OIDC route cannot exchange credentials for the planner or deployer identity.
No persistent credential or repository secret is used.

## Next staging gate

The bootstrap and foundation are complete, both current states are reconciled,
the recovery workflow is retired, and staging still contains no deployed
workload. Local code now provides the strict non-secret runtime loader, a pure
four-phase configuration-reference transition validator, single-flight
initialization and an undiscovered private Function entrypoint carrying
`omit: true`. It does not yet create, enable, disable or destroy live Secret
Manager versions, nor enforce those transitions during deployment. The next
sequence is to provision the exact staging configuration and initial secret
versions, authorize live Function activation behind a reviewed private
admission path, and then run bounded synthetic staging validation before
considering public ingress.

Live production-Function activation, exact FCM runtime permission, secret-version
provisioning and rotation evidence, ingress design, monitoring, real-service
fault matrix, migration rehearsal, and every `STAGE-*` observation remain open
blockers.
