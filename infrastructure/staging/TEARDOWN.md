# Miakapp 4 staging teardown rehearsal

Status: non-executable rehearsal; neither Terraform root has been applied, the
cloud workflow is dormant, only the approved billing link is active in cloud,
and the reviewed local plan has not been authorized

This runbook applies to the existing `miakapp-v4-staging` project. It must never
be run against `miakapp-3`, `miakapp-v4`, or a `demo-*` project. A future
executable implementation must require the operator to type the full project ID
and must produce a plan before any destructive action.

At the 2026-09-02 bootstrap boundary, Firebase reserved the default Hosting site
namespace, created its project service identity and enabled its bootstrap APIs.
The owner linked the reviewed billing account on 2026-09-03; that operation
created no budget, App Engine application, Firebase app, database, bucket,
Function, Cloud Run service, KMS key ring or secret. Deleting the whole project
would permanently retire its globally unique ID; adding Firebase cannot
otherwise be fully undone. Retaining this empty undeployed project, with the
billing link removable during an authorized teardown, is therefore the default.

The repository now contains separate apply-capable bootstrap and foundation
roots, a private versioned GCS backend design, keyless plan/apply identities and
a dormant GitHub workflow blueprint. None exists in the cloud. The circular
bootstrap uses protected temporary local state first, then the reviewed GCS
migration template. One exact saved plan has been prepared and inspected in a
private local bundle outside the repository; it contains no state and has not
been applied. A digest-bound recovery-first apply/migration command is committed
but inactive and every authorization bit remains false. Local `.terraform/`
provider caches are disposable and are not cloud inventory.

If that wrapper ever reports failure, its printed private execution directory is
part of the recovery inventory. Do not delete it or rerun the original
empty-state plan. Determine whether a remote bootstrap generation exists,
reconcile it with the preserved local state, and produce a new reviewed recovery
plan before another mutation.

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
- Capture the bootstrap and foundation state generations, lock status, Object
  Versioning/soft-delete policy and bucket IAM once the backend exists. Never
  treat an absent local state file as an empty cloud environment.
- Close public ingress and stop test clients before removing stateful resources.

## Ordered teardown

1. Disable test traffic, scheduled work, triggers and public invocation. Disable
   the active deployment workflow, both GitHub environments and both WIF
   providers before revoking temporary human, CI and test-client access.
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
7. Remove runtime IAM, the conditional state/plan bucket grants and WIF
   impersonation grants. Delete the runtime, planner and deployer service
   accounts and WIF pool only after confirming no resource still depends on
   them.
8. Capture the final bootstrap/foundation state generations and independently
   reconcile the cloud inventory. Securely retain the minimum teardown evidence;
   never publish a state or saved plan.
9. In a separate reviewed manual step, remove every plan and state generation,
   account for the seven-day soft-delete window, and delete the state bucket.
   This self-removal cannot be proven only from the state it destroys.
10. Remove budget notifications and unlink billing only after the independent
    inventory and residual Storage window are accepted. Project deletion is a
    separate explicit owner decision because the ID becomes unavailable and
    recovery is time-limited.

## Completion evidence

The teardown is complete only when a second inventory, performed independently
of deployment state, records all of the following:

- no active Function, Cloud Run revision, Eventarc trigger or Artifact image;
- no Firestore database or TTL policy intended for this environment;
- no live component, plan or state object; every soft-deleted object and its
  remaining recovery/cost window is either expired or explicitly recorded;
- no enabled Secret Manager version;
- every KMS version disabled or scheduled for destruction, with the retained key
  ring documented;
- no staging IAM binding or service account with usable authority;
- no active App Check debug token, FID test registration or staging credential;
- the billing relationship and budgets in their intended final state; and
- the remote state backend, if it ever existed, was retired only after the
  independent cloud inventory agreed with the final state;
- a dated owner sign-off plus a follow-up check for delayed charges.

If any inventory source is unavailable, teardown remains incomplete. Do not infer
success from the absence of application traffic or from a single tool's state.

References:

- [Delete and restore Google Cloud projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
- [Cloud Storage soft delete](https://cloud.google.com/storage/docs/soft-delete)
- [Cloud KMS key lifecycle](https://cloud.google.com/kms/docs/destroy-restore)
- [Secret Manager best practices](https://cloud.google.com/secret-manager/docs/best-practices)
