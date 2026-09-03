# Miakapp 4 staging teardown rehearsal

Status: non-executable rehearsal; bootstrap resources and both reconciled remote
states exist, protected local recovery evidence remains private, and the exact
initial-foundation apply is authorized but has not yet run

This runbook applies to the existing `miakapp-v4-staging` project. It must never
be run against `miakapp-3`, `miakapp-v4`, or a `demo-*` project. A future
executable implementation must require the operator to type the full project ID
and must produce a plan before any destructive action.

At the 2026-09-02 bootstrap boundary, Firebase reserved the default Hosting site
namespace, created its project service identity and enabled its bootstrap APIs.
The owner linked the reviewed billing account on 2026-09-03. The later bootstrap
apply created the reviewed budget, two private buckets, three service accounts,
Workload Identity pool and providers, and their IAM bindings. It created no App
Engine application, Firebase app, database, Function, Cloud Run service, KMS key
ring or secret. Deleting the whole project would permanently retire its globally
unique ID; adding Firebase cannot
otherwise be fully undone. Retaining this empty undeployed project, with the
billing link removable during an authorized teardown, is therefore the default.

The repository contains separate bootstrap and foundation roots, a private
versioned GCS backend, keyless plan/apply identities and a hash-bound protected
GitHub workflow. Terraform completed the final
27-create/nine-no-op plan, but
the wrapper rejected the complete state before migration because its output
shape assumption differed from Terraform 1.11.3. The exact 36-resource state at
serial 39 is preserved outside the repository with fingerprint
`c083e7a05f2ccf273abda98c0739584336d2cbaffd8ea836b65b0790f94833a2`.
The guarded migration created bootstrap state generation `1788439334043522` at
serial 40. A fresh private read reconciled it with the protected serial-39 source:
the serial increased once, the two `check_results` entries were permuted, and
every other value remained exactly equal. Terraform's foundation backend
created and guarded execution commit
`ab6f26bd5dd076a79847f989615e7fddf93f2a07` reconciled canonical empty state
generation `1788443136082489` at serial 1 without mutation. Object Versioning also
retains the noncurrent 181-byte empty state that Terraform created during
bootstrap backend initialization. Local `.terraform/` provider caches are
disposable and are not cloud inventory.

If the migration-only wrapper reports failure, its printed private execution
directory is part of the recovery inventory. Do not delete it or rerun the
consumed saved plan. Determine whether a remote bootstrap generation exists and
reconcile it with the preserved complete local state before another mutation.

The foundation-state initializer follows the same fail-closed recovery rule. If
it reports failure, retain its private diagnostic directory and inspect the
current foundation generation before another mutation. Re-running the guarded
path may only reconcile an exact empty state; it never replaces one.

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
   every active plan or deployment workflow, both GitHub environments and both
   WIF
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
