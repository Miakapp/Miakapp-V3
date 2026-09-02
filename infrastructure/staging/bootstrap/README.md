# Staging Terraform bootstrap proposal

Status: approved billing link active; exact private plan reviewed (36 add,
0 change, 0 destroy); never applied

This root owns the one-time resources required before the ordinary staging
foundation can use remote state and keyless GitHub automation:

- the exact approved billing association and one project-filtered EUR 10 budget
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
uses the implicit local backend and writes no saved plan or state. The separate
saved-plan wrapper confines its prospective local state to the private plan
bundle; a successful plan is rejected if Terraform creates that state before an
apply.

[`backend.gcs.tf.example`](backend.gcs.tf.example) is the exact reviewed backend
block for a later migration. Saved-plan creation and review are complete. A
future authorized bootstrap must:

1. revalidate the exact saved-plan digest, external GitHub policy, and current
   cloud inventory;
2. apply that plan from protected temporary local state only after a new explicit
   authorization;
3. activate the backend template and run `terraform init -migrate-state` with
   the exact bucket and `terraform/bootstrap` prefix;
4. initialize the empty `terraform/foundation` state with protected operator
   credentials, then verify its exact generation before admitting CI planning;
5. verify the remote bootstrap object generation and reconcile every managed cloud
   resource; and
6. remove the protected local state copy only after both checks agree.

Saved-plan preparation and inspection were completed on 2026-09-03. No apply or
migration wrapper is committed in this phase. Local state is sensitive and must
never be committed, attached to a public issue, or discarded before migration is
proven.

## Guarded diagnostic plan

The basic non-saved diagnostic command is:

```sh
MIAKAPP_STAGING_BILLING_ACCOUNT_ID='XXXXXX-XXXXXX-XXXXXX' \
MIAKAPP_STAGING_BOOTSTRAP_CONFIRMATION='miakapp-v4-staging' \
./plan.sh
```

It accepts only local User Application Default Credentials, checks the approved
billing-account SHA-256 fingerprint, rejects all ambient Terraform and Google
environment overrides, initializes providers without a remote backend, and does
not save a plan. Direct `terraform apply` remains technically possible but is
explicitly unauthorized.

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

## Exact saved-plan preparation

This path produced the authoritative plan from clean commit
`c192f97959833f53a19d4e6dc50b26292c88b3b5` on 2026-09-03. Its SHA-256 is
`0918d21c4677ce0958be9ccc43057d8d76a33857fdfbea066120ba953e30b5c1`; the
verified and manually reviewed result is exactly 36 additions, no changes, and
no destroys. It created no state and performed no apply or migration. Only that
digest is authoritative; any other local bundle is superseded and must not be
applied.

To produce a replacement, first create a persistent operator-owned directory
outside the Git repository and remove every group/other permission from it. Then
run:

```sh
private_parent='/absolute/private/miakapp-bootstrap-plans'
mkdir -p "$private_parent"
chmod 700 "$private_parent"

MIAKAPP_STAGING_BILLING_ACCOUNT_ID='XXXXXX-XXXXXX-XXXXXX' \
MIAKAPP_STAGING_BOOTSTRAP_CONFIRMATION='miakapp-v4-staging' \
./save-plan.sh "$private_parent"
```

The wrapper rejects a dirty checkout, Git/Terraform/Google overrides, credential
files, a foreign billing-account fingerprint, local state in the source tree,
and any plan other than the exact reviewed 36 create-only resource instances. It
uses a fresh bundle-local Terraform data directory so stale backend metadata
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
./inspect-plan.sh '/absolute/private/miakapp-bootstrap-plans/miakapp-staging-bootstrap-plan-XXXXXX'
```

Inspection verifies the private file modes and exact two-file inventory, source
commit, SHA-256 digest, and a newly derived binary-plan summary before rendering
the full plan. The final rendering is sensitive and must remain in the local
operator terminal. Neither command can apply, import, destroy, migrate state, or
authorize a later mutation.
