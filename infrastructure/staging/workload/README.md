# Private staging control-plane workload

Status: applied, recovered, converged, source-verified, and privately probed once

This is the third, workload-only Terraform state for `miakapp-v4-staging`. It
reads but never owns the reconciled bootstrap and foundation states. Its GCS
backend prefix is `terraform/workload`, so a Function deployment cannot alter
the 37-resource bootstrap or 33-resource foundation evidence.

The deployed graph contains exactly:

- one deterministic source ZIP in a dedicated private Paris bucket;
- one private Paris Docker repository and a build-only service account with
  repository writer, source-object viewer and log-writer access. A conditional
  project grant additionally permits reads only from Google's regional
  `gcf-v2-sources-*` object prefix used during the Function build;
- one Gen 2 `nodejs22` Function using the existing runtime identity, the exact
  committed non-secret runtime document, 256 MB, one CPU, concurrency 16,
  `minInstances=0`, `maxInstances=1`, a 30-second timeout and internal-only
  network ingress;
- one custom runtime role containing only `cloudmessaging.messages.create`;
  and
- one keyless synthetic probe account with `roles/run.invoker` on only the
  underlying Cloud Run service. The private operator receives only
  `iam.serviceAccounts.getOpenIdToken` on that probe account.

There is no `allUsers` or `allAuthenticatedUsers` binding, VPC connector, load
balancer, Cloud Armor policy, minimum instance, secret mount, service-account
key or live request. Internal-only ingress means the probe identity is defined
before testing but cannot be called directly from an internet workstation.
The probe uses a separately reviewed Google-hosted Workflow path; public
ingress remains forbidden.

## Consumed guarded plan and apply

The completed operation required a clean checkout at the exact `origin/main`
commit, the pinned toolchain, normal local User ADC and the reviewed Google
user. The raw user email existed only in a mode-0600 private variable file and
Terraform plan; the repository records only its SHA-256 fingerprint.

The initial private plan was created with:

```sh
MIAKAPP_STAGING_WORKLOAD_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/workload/plan.sh /private/tmp
```

At the reviewed source commit, the plan command built the source twice-tested
deterministic archive, used the real locking backend, accepted only the then
closed 14-create/zero-update/zero-delete graph, and printed an exact short-lived
authorization token. Terraform created its canonical empty workload state while
initializing the previously absent backend prefix; the plan command itself did
not apply a workload.

The exact saved binary plan was then applied with:

```sh
MIAKAPP_STAGING_WORKLOAD_APPLY_AUTHORIZATION='apply-private-workload:...' \
  ./infrastructure/staging/workload/apply.sh /private/tmp/miakapp-staging-workload-XXXXXX
```

The consumed bundle has been permanently deleted and these commands are not a
current replay instruction. Apply output and provider diagnostics remained
private. Completion required a fresh zero-change plan and independent Cloud
Functions, Cloud Run, IAM, Storage and Artifact Registry inventory. That
inventory read the immutable Google-managed source copy into memory, required
its SHA-256 to match the deterministic package, explicitly performed no
Function request, and produced the committed sanitized `result.json`.

No destroy entry point exists. Resources with meaningful identity or storage
carry `prevent_destroy`; generated source bytes remain reproducible from the
reviewed commit.

## Pinned source correction

The first Workflow execution reached the private Function with authenticated
internal ingress and returned a controlled `503 service_unavailable`. Runtime
initialization had rejected Secret Manager's documented canonical response
name: requests used the project ID while Google returned the same secret under
the exact numeric staging project. No secret payload, execution identifier or
trace identifier is committed.

The application correction accepts only the pinned pair
`miakapp-v4-staging` / `1072737219170`; adjacent project identifiers still fail
closed. `update-plan.sh` and `update-apply.sh` provide a single-purpose path to
deploy that correction. The validator accepts only the exact active baseline:
twelve no-ops, one deterministic source-object replacement, an in-place
Function update and an in-place deployment-guard update. It rejects any IAM,
network, scaling, identity or runtime-document change, any Function
replacement, and every different source baseline.

The update bundle remained private, expired after two hours, bound its
timing-safe authorization to the exact binary plan and exact `origin/main`
commit, and performed no request. Merge commit
`72bae493e496b7dbaae38bcba92dfcc6d604644d` produced exact plan SHA-256
`650a62e7308aa854fb8ac3ed88bdad987148364ac09860bdef734d9bcd56ecee`.
It converged to an empty plan and independent inventory verified active revision
`control-plane-00002-kux`, deterministic source SHA-256
`6cd045394b24a644d6b1ce9c431bcb73267fb894b7dc0b029d6c0be0488a9433`,
internal-only ingress, scale 0..1, zero public invokers and zero user-managed
keys. Workload state generation `1788486188603490` is 49,242 bytes at serial
10 with the same fifteen managed and three data resources and nothing tainted.
A separately authorized probe recovery may now run.

## Bounded first-build recovery

The first saved-plan apply reached Cloud Build but stopped before a Cloud Run
service or revision existed because the custom build identity could not read
Google's regional `gcf-v2-sources-*` copy. Successfully created prerequisites
remain tracked in the workload state. The plan validator therefore also has one
closed recovery profile: it accepts only the failed Gen 2 Function baseline,
the new conditional source-reader and private invoker creates, an in-place
Function update, and zero deletes. Any replacement, wider IAM scope, different
Function state or additional change is rejected.

Recovery configuration commit
`488da23cd7eb4c08baa9296724b87b7df34a1122` produced exact private plan SHA-256
`26437631f2d8ea61883762ae854024de5c1142db9182d46e083517af211a192b`.
Terraform created only the conditional source reader and private invoker,
updated the Function in place, and deleted nothing. Output reconciliation plan
SHA-256 `a31bda9269b138b270d58a6bb992ab7902d1fc73074c0f8f2543bdf0c8f09623`
then changed no resource, and a fresh full plan reported no changes.

The pre-correction workload state generation `1788481082158679` was 49,241 bytes at serial
8 with fifteen managed resources, three data resources, one output and no
tainted resource. Independent inventory observed active revision
`control-plane-00001-kod`, verified all three workload service accounts have
zero user-managed keys, and matched copied source SHA-256
`d2a9ffae2bd85106f782f9c75a10b6fb398682ead65dada2a1cf8ab5c65b7eb4`.
The canonical non-secret [`result.json`](result.json) has SHA-256
`2143c037de6cb2d8caf9acc9676fa5a54d9bf974793136596aac94de30c93590`.
No request was made. Raw plans, raw state, the operator email and private
diagnostics were not committed.
