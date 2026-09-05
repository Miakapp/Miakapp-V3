# Miakapp 4 staging teardown rehearsal

Status: non-executable rehearsal; bootstrap, complete foundation, activation,
the private workload and a consumed unscheduled probe exist, protected recovery
evidence remains private, and one-shot recovery automation is retired

This runbook applies to the existing `miakapp-v4-staging` project. It must never
be run against `miakapp-3`, `miakapp-v4`, or a `demo-*` project. A future
executable implementation must require the operator to type the full project ID
and must produce a plan before any destructive action.

At the 2026-09-02 bootstrap boundary, Firebase reserved the default Hosting site
namespace, created its project service identity and enabled its bootstrap APIs.
The owner linked the reviewed billing account on 2026-09-03. The later bootstrap
apply created the reviewed budget, two private buckets, three service accounts,
Workload Identity pool and providers, and their IAM bindings. A later protected
foundation apply created the declared APIs, Firestore database and TTL fields,
KMS key ring and signing-key version, and five empty Secret Manager containers.
At that historical boundary it had no App Engine application, Firebase app,
Function, Cloud Run service, secret version or public ingress.

The guarded initial activation later registered exactly one active Firebase Web
app and added one enabled 32-byte version to each of the five secret containers.
Its committed non-secret result and runtime document have respective SHA-256
digests `290c7cedb500d9f6844b49a45737ed920b3fe2e6ada6ed95b754a795768ccbdf`
and `b794181400bf5ace6aaa9ffc4be00e4c4f6a59519284baa7f73bca3c042c4ff8`.
Independent inventory at that activation boundary found no App Engine
application, Function, Cloud Run service, public ingress or minimum instance.
The private derivation seed was deleted after success.

The later workload apply preserved a 13-resource partial state after its first
Function build failed on access to Google's copied source; the Function was
tainted and the private invoker absent. A bounded recovery added only the
conditional source reader and private probe invoker, then updated the Function
in place. Two bounded source corrections later produced revision
`control-plane-00003-hum`. Against that revision, one unscheduled Workflow made
exactly three no-retry requests: two
controlled failures followed by one HTTP 200 discovery response. Its successful
route performed no application mutation; both invocation entry points now fail
closed. A third source-only update then deployed the audience-bound user-relay
exchange as revision `control-plane-00004-yis` without making a request. The
bounded probe later succeeded against that exact revision and retired. A fourth
source-only update deployed the signing-key overlap bridge as revision
`control-plane-00005-biq`. A separate two-update plan then migrated the
single-key runtime document to schema 2 as current revision
`control-plane-00006-wid`. Independent inventory matched the unchanged source
bytes and reconfirmed internal-only ingress, no unauthenticated invoker, no
minimum instance and zero user-managed keys across the runtime/build/probe
identities. The current schema 2 still publishes exactly one key and does not
claim live overlap.
Deleting the whole project would permanently retire its globally unique
ID; adding Firebase cannot otherwise be fully undone. Retaining this private
scale-to-zero project, with the billing link removable during an authorized
teardown, is therefore the default.

The repository contains separate bootstrap, foundation, workload, discovery-probe,
Firebase Auth and Auth-probe roots plus an applied browser App Check API-only
root, a private versioned GCS backend, keyless plan/apply identities
and a retained historical workflow blueprint. Terraform completed the final
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
generation `1788443136082489` at serial 1 without mutation. The already-live
planner quota member was later imported without changing project IAM;
generation `1788457646215552` at serial 41 with 37 managed resources preserves
that adoption history. PR #30 configuration commit
`ee457535a64355cd8133410d9c8c43f039608928` then changed only the two recovery
provider `disabled` attributes from `false` to `true`. Its exact private
25,925-byte plan had SHA-256
`8f570dfe5450b704112d484f058fc6dfcd39069a92c8bb483c5029027183e888`
and contained 35 no-ops and two updates. Apply reported `0 added, 2 changed, 0
destroyed`; a follow-up plan reported no changes. Current bootstrap generation
`1788460174191027` is 61,864 bytes at serial 42 with 37 managed resources, two
data resources and one output, and SHA-256
`288d947d35f5d5a278aaff210ea878a9dab817f594b4c3161ed117bb2e30e26d`.
Protected run `33776569977` replaced empty foundation state with partial
generation `1788452068422403` at serial 4 containing 25 managed resources.
Recovery run `33784785967` then created the exact remaining eight IAM members;
current foundation generation `1788456706865449` is serial 6 with 33 managed
resources and independently plans to zero changes. GitHub workflow `349440747`
was observed as `deleted` after its active source was removed, and both recovery
WIF providers are disabled while the pool remains enabled and retained. Object
Versioning retains recovery generations. Local `.terraform/`
provider caches are disposable and are not cloud inventory.

Current workload state generation `1788584368457557` is 49,563 bytes at serial
18 with fifteen managed resources, three data resources, one output and no
tainted resource. Its SHA-256 is
`746dcf402b9c6735175af9b46d9dda5f53f1788217f2b342c617838b6e2a8242`.
Probe state generation `1788484287000119` is 13,596 bytes at serial 3 with
three managed resources, one data resource, one output and nothing tainted. Its
SHA-256 is
`af7241b8d72085e0b30b7ca1a093726b2462b83160bd7566f6847d94aeb1cbf5`.
Firebase Auth state generation `1788517368759987` is 11,010 bytes. Auth-probe
state generation `1788574226264316` is 35,312 bytes at serial 27, with twelve
managed resources, two data resources, one output and no tainted instance. Its
SHA-256 is
`88afa245c7943a44b23e32a452793c2825cf8e2bfb11ba55f95e299680b15cb2`.
Browser-App-Check state generation `1788591686695870` is 11,057 bytes at
serial 3, with two managed resources, two data resources, one output and no
tainted instance. Its SHA-256 is
`4c2ac56a22e2ba11e6a4dd5c195910c1a0f1e749a009660294ea05bcd8c48aa7`.
It records only the state guard and enabled reCAPTCHA Enterprise API; direct
post-apply inventory found zero keys.
Raw state remains private; these metadata do not establish current convergence
by themselves.
Raw plan and state bytes were never committed.

The `auth-probe` root retains three retired user-relay role generations. The
first two never executed; generation 3 completed exactly one successful bounded
execution and was retired. All nine role IDs are disabled and unassigned, and
the Workflow, internal verifier service and four conditioned probe bindings are
absent. Preserve every role generation disabled and the keyless verifier
identity until Terraform state and independent inventory agree; none creates
idle compute by itself.

The guarded Auth-probe recovery enables a missing Cloud Asset API as a separate
prerequisite and requires a new authorization afterward. It never automatically
undeletes a soft-deleted custom role because eventually consistent IAM-policy
search cannot exclude a recent descendant binding. Investigate that case
manually, and never replace a tracked missing role with a generic create while
its role ID may still be reserved.

The planner/deployer service accounts and IAM roles remain. Closing the reviewed
GitHub OIDC route does not disprove impersonation by another administrator, so
teardown must still inventory and revoke every such authority explicitly.

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
  Firebase app registrations, Hosting sites, releases, channels and deployed
  content, App Check provider configurations, enforcement records, debug tokens
  and reCAPTCHA Enterprise keys, Functions and Cloud Run revisions, Eventarc
  triggers, Workflows, executions and schedules, Firestore databases, buckets
  and objects, Artifact Registry images, secrets, KMS versions, budgets and
  billing exports.
- Capture the bootstrap, foundation, workload, discovery-probe, Firebase Auth,
  Auth-probe and browser-App-Check state generations that actually exist, plus
  lock status, Object Versioning/soft-delete policy and bucket IAM once the
  corresponding backend exists. Never
  treat an absent local state file as an empty cloud environment.
- Close public ingress and stop test clients before removing stateful resources.

## Ordered teardown

1. Verify the retired GitHub recovery workflow remains absent and both recovery
   WIF providers remain disabled. Then disable test traffic, scheduled work,
   triggers, public invocation, every other active plan or deployment workflow,
   both GitHub environments and any other federation route before revoking
   temporary human, CI and test-client access. Confirm no probe execution is in
   flight, remove deletion protection from the unscheduled private Workflow in
   the reviewed teardown change, delete it, and then decide explicitly whether
   the now-inert Workflows API remains enabled.
2. Remove the Function and inspect Cloud Run, Eventarc and Artifact Registry for
   resources that outlive the deployment abstraction.
3. Disable App Check enforcement first, revoke and delete debug tokens, stop all
   provider-backed clients, and delete reCAPTCHA Enterprise keys only after
   their evidence is retired. Firebase exposes no delete operation for a
   registered reCAPTCHA Enterprise App Check provider configuration; record it
   as a permanent project residual instead of claiming Terraform state removal
   deleted it. After the direct key inventory is empty, disable
   `recaptchaenterprise.googleapis.com` or explicitly accept it as an inert
   residual service. Inventory and retire Hosting channels, releases and
   deployed content before deleting Firebase app registrations.
4. Inventory the component bucket by live generations and soft-deleted objects.
   Delete only after required synthetic reconciliation evidence is captured.
5. Disable Firestore deletion protection only in the reviewed teardown change,
   then remove the staging database, TTL policies and indexes.
6. Disable or destroy Secret Manager versions after their consumers are gone.
   Remove secret-level IAM independently.
7. Disable KMS key versions, stop any rotation schedule and schedule version
   destruction according to the reviewed recovery window. Record the
   non-deletable key ring as a permanent residual resource.
8. Remove runtime IAM, including the planner Service Usage Consumer member, the
   conditional state/plan bucket grants and WIF impersonation grants. Delete the
   runtime, build, probe, Auth-probe verifier, planner and deployer service
   accounts and WIF pool only after confirming no resource still depends on them.
   Remove every retained custom Auth-probe role only after its bindings are
   absent; explicitly decide whether the now-inert Cloud Asset API remains enabled.
9. Capture the final bootstrap/foundation/workload/discovery-probe/Firebase-Auth/
   Auth-probe/browser-App-Check state generations that exist and independently
   reconcile the cloud inventory.
   Securely retain the minimum teardown evidence; never publish a state or saved
   plan.
10. In a separate reviewed manual step, remove every plan and state generation,
   account for the seven-day soft-delete window, and delete the state bucket.
   This self-removal cannot be proven only from the state it destroys.
11. Remove budget notifications and unlink billing only after the independent
    inventory and residual Storage window are accepted. Project deletion is a
    separate explicit owner decision because the ID becomes unavailable and
    recovery is time-limited.

## Completion evidence

The teardown is complete only when a second inventory, performed independently
of deployment state, records all of the following:

- no active Function, Cloud Run revision, Eventarc trigger or Artifact image;
- no private-probe Workflow, in-flight execution or Scheduler trigger, with the
  Workflows API disabled or explicitly accepted as an inert residual service;
- the Cloud Asset API disabled or explicitly accepted as an inert residual
  service after its verifier-identity policy inventory is no longer needed;
- no Firebase app registration, Hosting channel/release/content, App Check
  enforcement record, debug token or reCAPTCHA key; any non-deletable App Check
  provider configuration is explicitly recorded as a permanent residual, and
  the reCAPTCHA Enterprise API is disabled or accepted as an inert residual;
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
