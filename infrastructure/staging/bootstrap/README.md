# Staging Terraform bootstrap proposal

Status: recovery plan reviewed; exact apply-and-migrate authorization pending

This root owns the one-time resources required before the ordinary staging
foundation can use remote state and keyless GitHub automation:

- import of the exact approved billing association and one project-filtered EUR 10 budget
  with current-spend alerts at EUR 2, EUR 5, and EUR 10;
- the exact bootstrap APIs;
- one private, versioned Paris GCS bucket for state and short-lived saved plans;
- the private Paris component bucket and dedicated runtime service account;
- separate planner and deployer service accounts without keys;
- one Workload Identity Pool and separate plan/apply GitHub OIDC providers; and
- additive project, bucket, and service-account IAM bindings.

The OIDC providers require numeric repository ID `354682190`, numeric owner ID
`83046838`, `refs/heads/main`, the exact workflow reference, and the matching
GitHub environment. The planner receives project reads; the deployer receives
only service-scoped roles needed to mutate the reviewed foundation. The
escalation-capable project IAM, service-account creation and bucket creation
stay in this human-operated bootstrap root.

Both CI identities can read the state bucket. The planner may manage only
`.tflock` objects and create objects under `plans/`; it cannot create or replace
foundation state. Only the deployer may write foundation state, and neither
identity can write `terraform/bootstrap/`. The deployer has
bucket administration only on the component bucket. It has no project IAM,
service-account administration or project-wide Storage role with which to
escape that boundary.

## Circular state migration

The GCS bucket does not exist and cannot back the operation that creates it.
Consequently, this root has no active backend block. The diagnostic guarded plan
uses the implicit local backend and reads the exact private recovery state without
modifying it. The separate saved-plan wrapper stores only the plan binary and a
closed summary beside that state, never inside the repository.

[`backend.gcs.tf.example`](backend.gcs.tf.example) is the exact reviewed backend
block for a later migration. Two earlier saved plans are superseded. The first
stopped before recording resources. The second recorded a private partial state
but stopped before creating the state bucket, so no remote migration was
possible. The committed [`apply-and-migrate.sh`](apply-and-migrate.sh) wrapper
must:

1. revalidate the exact recovery-state digest, lineage, serial and nine managed
   addresses, the saved-plan digest, external GitHub policy, and cloud inventory;
2. copy that recovery state into a protected temporary directory and apply the
   exact plan only after a new explicit authorization;
3. activate the backend template and run `terraform init -migrate-state` with
   the exact bucket and `terraform/bootstrap` prefix, but only if the apply has
   created the state bucket;
4. initialize the empty `terraform/foundation` state with protected operator
   credentials, then verify its exact generation before admitting CI planning;
5. verify the remote bootstrap object generation and reconcile every managed
   resource against the recovery lineage; and
6. remove the protected local state copy only after both checks agree.

On the second authorized attempt, Terraform imported the approved billing link
and recorded all eight bootstrap APIs, then failed while creating the budget.
User Application Default Credentials lacked a quota project for that API. The
protected Terraform 1.11.3 state is serial 11 and contains exactly those nine
managed resources. Its SHA-256 is
`07fc7412e35efaff288e2efd30f786c2871d9fa836fb813a178d247ccb1efe5a`.
The state path, contents and logs remain private. Independent inventory confirmed
that the target budget, buckets, service accounts and Workload Identity pool are
absent. Local state is sensitive and must never be committed or attached to a
public issue.

## Guarded recovery apply and migration (awaiting authorization)

The execution command is intentionally single-use and is bound to the reviewed
recovery plan, the exact repository commit that executes it, the
preserved state digest, project `miakapp-v4-staging`, and remote object
`gs://miakapp-v4-staging-tfstate-1072737219170/terraform/bootstrap/default.tfstate`.
The plan was created from configuration commit
`e9f410c58c8cbbf8f5f7a17170c9e8ed55a10501` on 2026-09-03. Its SHA-256 is
`12927b270f2bfa78c8f8c8c7e7071ce9cfec18d5e848165c04b585260bd5f7da`.
The complete rendering was manually reviewed: exactly 27 resources are created,
the billing link and eight API resources are no-op, and there is no import,
update, or deletion. Fresh read-only inventory found every creation target and
the remote state absent. No apply or state migration is authorized.

Only one operator may use an authoritative private bundle and recovery file at a
time. The wrapper takes atomic sibling locks for both before reading cloud
inventory or invoking Terraform. A surviving lock after an abrupt process or
host failure must be investigated, not deleted reflexively or worked around with
a copied bundle. After the owner separately authorizes this exact
apply-and-migrate operation, the shape of the command is:

```sh
MIAKAPP_STAGING_BOOTSTRAP_EXECUTION_AUTHORIZATION='apply-and-migrate:miakapp-v4-staging:<64-hex-reviewed-plan>:<40-hex-reviewed-execution-commit>' \
  ./infrastructure/staging/bootstrap/apply-and-migrate.sh \
  '/absolute/private/miakapp-staging-bootstrap-plan-...' \
  '/absolute/private/bootstrap.tfstate'
```

Before mutation, the wrapper requires the authorization's repository commit to
equal the clean checkout's current commit. It then revalidates the plan, its
exact Terraform source, the active project and billing fingerprint, and the
absence of the target budget, buckets, service accounts, and Workload Identity
pool. The Budget API lookup must succeed through the staging quota project; it
can no longer be deferred. The wrapper also proves that all eight state-recorded
bootstrap APIs remain enabled. After a complete apply and state reconciliation,
it retries the budget lookup and requires exactly one target budget. It rejects
credential files, endpoint, proxy, Git, and Terraform overrides. The plan is
applied once with state and logs confined beside the private bundle. The backend
template is activated only in a separate private working copy; Terraform then
migrates with locking and reads the state back. The helper requires structurally
identical parsed state contents, the expected lineage/header, the exact 36
managed addresses, and the sole typed non-secret activation output before the
local copy is removed.

If apply is partial and the state bucket exists, the wrapper attempts to migrate
and reconcile only a state that retains every recovery baseline address and
contains no address outside the reviewed plan. If the bucket does not yet exist,
it preserves the validated descendant state locally and stops. Any apply,
migration, read-back, inventory, reconciliation, or budget-postcondition failure
leaves the private execution directory intact and prints only its location plus
a bounded error.
Terraform also runs from that private directory, so a higher-priority
`errored.tfstate` produced after a persistence failure cannot land in the
repository and is used for recovery instead of any older normal state.
Do not rerun a saved plan after a partial apply; preserve the directory and
create a recovery plan from the authoritative local or migrated state.

## Guarded diagnostic plan

The basic non-saved diagnostic command is:

```sh
MIAKAPP_STAGING_BILLING_ACCOUNT_ID='XXXXXX-XXXXXX-XXXXXX' \
MIAKAPP_STAGING_BOOTSTRAP_CONFIRMATION='miakapp-v4-staging' \
./plan.sh '/absolute/private/bootstrap.tfstate'
```

It accepts only local User Application Default Credentials, checks the approved
billing-account SHA-256 fingerprint, rejects all ambient Terraform and Google
environment overrides, verifies the exact private recovery state, initializes
providers without a remote backend, and does not save a plan. It verifies that
Terraform did not modify the state file. Direct `terraform apply` remains
technically possible but is explicitly unauthorized.

On 2026-09-03, after the separately authorized billing link, the command was run
against configuration commit
`9b3905bb62718b57456b0658386b424ed635e82f`. It proposed 36 additions, no changes,
and no destroys: two billing/budget resources, eight service APIs, two
buckets, three service accounts, three Workload Identity pool/provider
resources, and 18 IAM bindings. No saved plan, Terraform state, or apply was
created. Post-plan checks found billing still linked to the approved account,
enabled services, project IAM, and bucket inventory unchanged, and all proposed
service accounts, buckets, and the Workload Identity pool still absent. This
diagnostic result is not an exact saved plan and cannot be applied later. With no
Terraform state, the provider represents the already-active billing association
as an addition; the diagnostic did not create or change that link.

The state bucket uses uniform access, Public Access Prevention, Object
Versioning, and seven-day soft delete. Foundation state retains at least ten
newer generations before versions older than 30 days are pruned. Unique saved
plans are deleted live after two days and their archived version after one more
day; deleted data may still remain recoverable during soft delete.

## Superseded plans and state-bound recovery

This path produced the now-superseded plan from clean commit
`c192f97959833f53a19d4e6dc50b26292c88b3b5` on 2026-09-03. Its SHA-256 is
`0918d21c4677ce0958be9ccc43057d8d76a33857fdfbea066120ba953e30b5c1`; the
verified and manually reviewed result was exactly 36 additions, no changes, and
no destroys. Its authorized apply stopped at the redundant billing-link write
before creating any resource. Do not retry that digest.

[`imports.tf`](imports.tf) declares the preexisting billing link as an idempotent
Terraform import. The replacement plan was created from clean
commit `6340bffbddcc4797067ef48170fc5c3524345bf2` on 2026-09-03. Its SHA-256 is
`6fb0b0c15fa04338a40ab59de790c3a4a85f96b418377c4a70570a8dabd5d457`;
the verified and manually reviewed result is exactly 35 creations, one import
with a client-side update, and no deletion. Its authorized apply produced the
nine-resource private state described above before the Budget API quota-project
failure. Do not retry either previous digest.

The recovery reducer accepts only the exact 36-address inventory with the
nine preserved addresses as `no-op`, the remaining 27 as `create`, and no
import, update or deletion. Both providers set `billing_project` to staging and
enable user-project quota attribution. The reviewed plan above matches that
closed inventory. The following command can reproduce a private state-bound
plan, but does not authorize its application and will produce a different binary
digest.

To reproduce or refresh the plan, first create a persistent operator-owned directory
outside the Git repository and remove every group/other permission from it. Then
run:

```sh
private_parent='/absolute/private/miakapp-bootstrap-plans'
mkdir -p "$private_parent"
chmod 700 "$private_parent"

MIAKAPP_STAGING_BILLING_ACCOUNT_ID='XXXXXX-XXXXXX-XXXXXX' \
MIAKAPP_STAGING_BOOTSTRAP_CONFIRMATION='miakapp-v4-staging' \
./save-plan.sh "$private_parent" '/absolute/private/bootstrap.tfstate'
```

The wrapper rejects a dirty checkout, Git/Terraform/Google overrides, credential
files, a foreign billing-account fingerprint, local state in the source tree,
an altered recovery state, and any plan other than the exact reviewed 27 creates
plus nine no-op resources. It uses a fresh bundle-local Terraform data directory so stale backend metadata
cannot be reused, removes that directory after planning, and leaves a unique
mode-0700 bundle containing only:

- `bootstrap.tfplan`, the sensitive mode-0600 Terraform binary; and
- `metadata.json`, a closed mode-0600 summary with the source commit, plan
  SHA-256, exact resource addresses, and explicit false apply/migration
  authorization bits.

Planned values and the raw billing-account identifier never enter the metadata.
Terraform JSON is streamed into the bounded reducer and is not persisted. The
private diagnostic log is deleted on success, and every known partial artifact
is deleted on failure. The bundle must not be moved, renamed, committed,
uploaded to a public artifact service, or copied into an issue or pull request.

Inspect it only from the same clean commit:

```sh
MIAKAPP_STAGING_BOOTSTRAP_INSPECTION_CONFIRMATION='miakapp-v4-staging' \
./inspect-plan.sh \
  '/absolute/private/miakapp-bootstrap-plans/miakapp-staging-bootstrap-plan-XXXXXX' \
  '/absolute/private/bootstrap.tfstate'
```

Inspection verifies the private file modes and exact two-file inventory, source
commit, SHA-256 digest, and a newly derived binary-plan summary before rendering
the full plan. The final rendering is sensitive and must remain in the local
operator terminal. Neither command can apply, import, destroy, migrate state, or
authorize a later mutation.
