# Miakapp 4 staging teardown rehearsal

Status: non-executable planning checklist; there are currently no staging cloud
resources to remove

This runbook applies only after `miakapp-v4-staging` is explicitly created. It
must never be run against `miakapp-3`, `miakapp-v4`, or a `demo-*` project. A
future executable implementation must require the operator to type the full
project ID and must produce a plan before any destructive action.

Infrastructure state or a successful destroy command is not sufficient evidence
that spend has stopped. Managed Functions can leave Cloud Run revisions,
Artifact Registry images and Eventarc resources; Storage can retain soft-deleted
objects; Secret Manager and KMS versions can remain billable; Cloud KMS key rings
cannot be deleted; and billing can report late usage.

## Preconditions

- Record the incident, experiment or planned shutdown that authorizes teardown.
- Confirm the exact target is `miakapp-v4-staging` in the active credential,
  command arguments, generated plan and operator prompt.
- Export only the synthetic evidence required for the staging report. Do not
  retain credentials, FIDs, App Check debug tokens or secret values.
- Capture a before-inventory of enabled APIs, IAM bindings, service accounts,
  Functions and Cloud Run revisions, Eventarc triggers, Firestore databases,
  buckets and objects, Artifact Registry images, secrets, KMS versions, budgets
  and billing exports.
- Close public ingress and stop test clients before removing stateful resources.

## Ordered teardown

1. Disable test traffic, scheduled work, triggers and public invocation. Revoke
   temporary human, CI and test-client access.
2. Remove the Function and inspect Cloud Run, Eventarc and Artifact Registry for
   resources that outlive the deployment abstraction.
3. Inventory the component bucket by live generations and soft-deleted objects.
   Delete only after required synthetic reconciliation evidence is captured.
4. Disable Firestore deletion protection only in the reviewed teardown change,
   then remove the staging database, TTL policies and indexes.
5. Disable or destroy Secret Manager versions after their consumers are gone.
   Remove secret-level IAM independently.
6. Disable KMS key versions, stop any rotation schedule and schedule version
   destruction according to the reviewed recovery window. Record the
   non-deletable key ring as a permanent residual resource.
7. Remove runtime and deployer IAM bindings, then delete dedicated service
   accounts only after confirming that no resource still depends on them.
8. Remove budget notifications and unlink billing only after the independent
   resource inventory is empty. Project deletion is a separate, explicit owner
   decision because the project ID becomes unavailable and recovery is
   time-limited.

## Completion evidence

The teardown is complete only when a second inventory, performed independently
of deployment state, records all of the following:

- no active Function, Cloud Run revision, Eventarc trigger or Artifact image;
- no Firestore database or TTL policy intended for this environment;
- no live or soft-deleted Storage object and no retention policy blocking
  deletion;
- no enabled Secret Manager version;
- every KMS version disabled or scheduled for destruction, with the retained key
  ring documented;
- no staging IAM binding or service account with usable authority;
- no active App Check debug token, FID test registration or staging credential;
- the billing relationship and budgets in their intended final state; and
- a dated owner sign-off plus a follow-up check for delayed charges.

If any inventory source is unavailable, teardown remains incomplete. Do not infer
success from the absence of application traffic or from a single tool's state.

References:

- [Delete and restore Google Cloud projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
- [Cloud Storage soft delete](https://cloud.google.com/storage/docs/soft-delete)
- [Cloud KMS key lifecycle](https://cloud.google.com/kms/docs/destroy-restore)
- [Secret Manager best practices](https://cloud.google.com/secret-manager/docs/best-practices)
