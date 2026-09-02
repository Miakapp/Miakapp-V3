# Staging Terraform bootstrap proposal

Status: reviewable plan-only configuration; never applied

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
Consequently, this root has no active backend block. The guarded plan uses the
implicit local backend and writes no saved plan or state.

[`backend.gcs.tf.example`](backend.gcs.tf.example) is the exact reviewed backend
block for a later migration. A future authorized bootstrap must:

1. revalidate the external GitHub policy and current cloud inventory;
2. create and independently review an exact saved bootstrap plan;
3. apply that plan from protected temporary local state only after a new explicit
   authorization;
4. activate the backend template and run `terraform init -migrate-state` with
   the exact bucket and `terraform/bootstrap` prefix;
5. initialize the empty `terraform/foundation` state with protected operator
   credentials, then verify its exact generation before admitting CI planning;
6. verify the remote bootstrap object generation and reconcile every managed cloud
   resource; and
7. remove the protected local state copy only after both checks agree.

No apply or migration wrapper is committed in this phase. Local state is
sensitive and must never be committed, attached to a public issue, or discarded
before migration is proven.

## Guarded plan

The only supported command here is non-mutating and has not been run against
Google Cloud:

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

The state bucket uses uniform access, Public Access Prevention, Object
Versioning, and seven-day soft delete. Foundation state retains at least ten
newer generations before versions older than 30 days are pruned. Unique saved
plans are deleted live after two days and their archived version after one more
day; deleted data may still remain recoverable during soft delete.
