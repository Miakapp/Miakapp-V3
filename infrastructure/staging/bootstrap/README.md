# Staging Terraform bootstrap proposal

Status: bootstrap apply complete; exact migration-only authorization pending

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

## Circular state migration recovery

The GCS bucket could not back the transaction that created it. The authorized
plan therefore applied against protected local state. Terraform completed all
27 remaining creations on 2026-09-03, leaving exactly 36 managed resources at
serial 39 with SHA-256
`c083e7a05f2ccf273abda98c0739584336d2cbaffd8ea836b65b0790f94833a2`.
The path, raw state, plan contents, billing identifier, and logs remain private.

The apply wrapper then stopped before migration because the local reducer
expected a `sensitive` member in the persisted non-sensitive output. Terraform
1.11.3 stores that output with exactly `type` and `value`. Read-only inventory
confirmed all bootstrap targets exist exactly once and the state bucket returns
only its root URL marker, with no state object.

[`apply-and-migrate.sh`](apply-and-migrate.sh) is permanently retired and cannot
invoke Terraform or Google Cloud. It must not be restored or used to rerun the
consumed plan. [`backend.gcs.tf.example`](backend.gcs.tf.example) remains the
reviewed migration target and is activated only inside a disposable private
working copy.

## Guarded migration-only recovery (awaiting authorization)

[`migrate-recovered-state.sh`](migrate-recovered-state.sh) is bound to the exact
complete-state digest, the reviewed private plan bundle, project
`miakapp-v4-staging`, remote object
`gs://miakapp-v4-staging-tfstate-1072737219170/terraform/bootstrap/default.tfstate`,
and the clean repository commit that executes it. It has no infrastructure
apply, import, destroy, state-push, or cloud-object copy path.

Only one operator may use the private bundle and complete state at a time. The
wrapper takes atomic sibling locks, rejects credential files and ambient Git,
Terraform, endpoint, or proxy overrides, and then verifies:

1. the exact saved plan, Terraform source, complete-state digest, serial,
   lineage, 36 managed addresses, and typed activation output;
2. the active project and approved billing-account fingerprint;
3. exactly one budget, both buckets, all three service accounts, the Workload
   Identity pool and both providers, plus all eight bootstrap APIs; and
4. an empty state bucket, accepting only `[]` or the exact bucket-root marker
   emitted by `gcloud storage ls --json`.

After a separate exact authorization, the command shape is:

```sh
MIAKAPP_STAGING_BOOTSTRAP_MIGRATION_AUTHORIZATION='migrate-bootstrap-state:miakapp-v4-staging:<64-hex-complete-state>:<40-hex-execution-commit>' \
  ./infrastructure/staging/bootstrap/migrate-recovered-state.sh \
  '/absolute/private/miakapp-staging-bootstrap-plan-...' \
  '/absolute/private/complete-bootstrap.tfstate'
```

Only after every preflight passes does Terraform run
`init -migrate-state -force-copy`. The wrapper reads the remote object back,
verifies its generation, and requires exact parsed-state equality. The
authoritative source state remains byte-for-byte unchanged after both success
and failure. A failure preserves the private execution directory and reports
only its path plus a bounded error; a success removes only the disposable copy.

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
with a client-side update, and no deletion. Its authorized apply produced a
nine-resource private state before the Budget API quota-project failure. Do not
retry either previous digest.

The recovery reducer accepts only the exact 36-address inventory with the
nine preserved addresses as `no-op`, the remaining 27 as `create`, and no
import, update or deletion. Both providers set `billing_project` to staging and
enable user-project quota attribution. The consumed final plan matched that
closed inventory and completed the bootstrap resources. Do not create or execute
another bootstrap plan while its complete state awaits migration. The commands
below remain as historical diagnostic tooling and cannot authorize mutation.

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
