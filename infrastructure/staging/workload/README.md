# Private staging control-plane workload

Status: bounded signing-key overlap bridge applied, converged and source-verified;
the preceding audience-bound revision was accepted by one retired bounded probe

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
balancer, Cloud Armor policy, minimum instance, secret mount or service-account
key. Workload deployment and inventory make no Function request. The later
bounded probe used a separately reviewed Google-hosted Workflow path;
internal-only ingress and the absence of public invokers remain unchanged.

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
internal ingress and returned a controlled `503 service_unavailable`. A
separate read-only boundary reproduction found that Secret Manager's documented
canonical response name used the exact numeric staging project while requests
used its project ID, and that the runtime rejected that valid representation.
The original execution had no classified startup log, so it did not by itself
identify the failing initialization boundary. No secret payload, execution
identifier or trace identifier is committed.

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
A separately authorized recovery ran exactly once against this revision. It
made one Workflow execution with no retry and received the same controlled
`503 service_unavailable`; the recovery wrapper then stopped. At that historical
boundary, staging had exactly two failed private executions and no success.

## Runtime initialization diagnostic correction

Cloud Run documents `PORT`, `K_SERVICE`, `K_REVISION` and `K_CONFIGURATION` as
its built-in container variables, but does not guarantee either
`GCLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT`. The production runtime boundary had
required one of those optional project aliases and rejected the standard
`googleapis.com` universe-domain marker. Both assumptions can fail before any
Google client is constructed.

The diagnostic source update accepts an absent project alias, still rejects
every present alias that differs from `miakapp-v4-staging`, and accepts only an
unset or exact `googleapis.com` universe domain. It also classifies startup
failures into a small fixed stage allow-list. The Function logs only the fixed
event name and stage; it discards the original exception, message, stack and
cause.

The update-plan validator permitted only the deterministic source
object replacement, in-place Function update, deployment-guard update and
twelve no-ops from that exact baseline. It continues to reject IAM, network,
scaling, identity, runtime-document and Function replacement changes. Applying
the update made no Function request.

Merge commit `60322c69c92b8ccf5f3d1bc87ba264a00e5dca05` produced exact
plan SHA-256
`b66c16e1f7cd540b4708306e17f7e92fe69172ce06b3e2ee1f90fb284636ea07`
and source SHA-256
`86f4818dfcb4021e5578638d6fb1e9b7da31ea245528cbdc8573dabecdfca358`.
The saved plan applied and converged to active revision
`control-plane-00003-hum` with internal-only ingress, scale 0..1, zero public
invokers and zero user-managed keys. Workload state generation
`1788488610045265` is 49,242 bytes at serial 12 with fifteen managed and three
data resources, nothing tainted, and SHA-256
`3adbde5e684736080d47b239031a2bb469787641ccf0f87c409d2b3a3b180145`.

The canonical non-secret result at that historical boundary had SHA-256
`dfe8900cd90fe53cbb85ac656ddce42c26fef64c9bbed462688c0e0755363e15`.
That inventory was scoped to deployment, so `live_request_performed` was false.

## Audience-bound user-relay credential source

After the local cross-repository gate passed, merge commit
`022f10e2dc15f32a8a6679b38ce7f1a04582e450` produced deterministic source
SHA-256 `6674c0353ec9c73fcfe0d3a63d17850f057a5f2a547a5855989e28f011249b1e`.
Its exact saved plan had SHA-256
`eeb7bf638d7b46212994513eb2decc8405991e6907b6838caa04f6eba07cffa3`
and contained only one source-object replacement plus in-place Function and
deployment-guard updates. IAM, ingress, identities, runtime configuration and
scale did not change.

The plan applied once and converged to active revision
`control-plane-00004-yis`. Independent inventory verified internal-only
ingress, scale 0..1, zero public invokers, zero user-managed keys and the copied
source bytes without making a Function request. Workload state generation
`1788557027934706` is 49,283 bytes at serial 14 with fifteen managed and three
data resources, one output, nothing tainted, and SHA-256
`4f2977ce6e8c736cbdf31d58ba1da81f4291ace4c9d5d0d7d21a727c063cfc6e`.

The canonical non-secret [`result.json`](result.json) at that deployment
boundary had SHA-256
`cfdb18b9dd6604cd92977cbd447dd0684f4b731ca84d2f7aa3f772cbd3bc3056`.
That deployment artifact correctly records no request during source inventory.
The separate bounded user-relay probe later made five requests to this exact
revision, validated three negative controls and two signed relay exchanges, and
retired. Its current digest-pinned evidence lives under
[`../auth-probe/`](../auth-probe/). The older discovery artifact below remains
evidence for revision `control-plane-00003-hum`, not a claim about this revision.

## Bounded signing-key overlap runtime bridge

Merge commit `9f217da102b394734adba7ccef3f8f70d0317306` produced deterministic
source SHA-256
`d1844bbd007ae452d789011e8183038b9c1648b39c93b5122382c5f12a62ede8`.
Its exact saved plan had SHA-256
`ee98468a4ed92196109ac6f646030dca582068c6e2f2b5c1889e347322b1e3a6`
and again contained only one source-object replacement plus in-place Function
and deployment-guard updates. IAM, ingress, identities, runtime configuration
and scale did not change.

The plan applied once and converged to active revision
`control-plane-00005-biq`. Independent inventory verified internal-only
ingress, scale 0..1, zero public invokers, zero user-managed keys and copied
source generation `1788581208774706` without making a Function request. The
deployed source preserves schema-1 and single-key behavior while accepting a
closed schema 2 that selects exactly one KMS signer and publishes at most two
KMS-validated public keys. The live runtime document intentionally remains on
schema 1 with one key; migrating it is a separate guarded operation.

Current workload state generation `1788581270106628` is 49,242 bytes at serial
16 with fifteen managed and three data resources, one output, nothing tainted,
and SHA-256
`d765cceffc696905f045a34805f9c6f1a6c45e9ba3f2224754a90a157c89b428`.
The current canonical non-secret [`result.json`](result.json) has SHA-256
`dc3324d3b812e1dafc6a6678c7427ac715ea1d2a81de527750aa958c7c71a440`.
The updater's next before-state is pinned to this deployed commit/source tuple.

## Guarded single-key schema migration

[`runtime-config.json`](runtime-config.json) is the exact proposed schema-2
document. It is a pure transformation of the historical
[`../activation/runtime-config.json`](../activation/runtime-config.json): the
effective KMS key version, public JWK, issuer, origins, Firebase app, secret
versions, timeouts and component bucket remain byte-for-byte equivalent after
parsing. It contains exactly one published signing key and therefore does not
yet claim key overlap.

The dedicated wrappers refuse every delta except an in-place Function update
and an in-place deployment-guard update. The source object, copied source,
build configuration, IAM, ingress, identities and scale must remain unchanged.
The source updater fails closed while this migration is pending.

After merging the reviewed implementation, render a fresh private plan only
from exact `origin/main`:

```sh
MIAKAPP_STAGING_WORKLOAD_RUNTIME_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/workload/runtime-plan.sh /private/tmp
```

Review its closed summary and use only the exact short-lived
`migrate-private-runtime:...` authorization printed by that plan:

```sh
MIAKAPP_STAGING_WORKLOAD_RUNTIME_APPLY_AUTHORIZATION='migrate-private-runtime:...' \
  ./infrastructure/staging/workload/runtime-apply.sh \
  /private/tmp/miakapp-staging-workload-XXXXXX
```

Apply performs no request. Completion requires a zero-change follow-up plan and
independent inventory of the same source bytes, schema-2 runtime digest,
internal-only ingress, scale 0..1 and zero public invokers. Until that sanitized
result replaces the current deployment evidence, the schema-1 document remains
the live truth.

## Successful private discovery

After the diagnostic deployment, the single-purpose recovery path made exactly
one third Workflow execution with no retry. Revision `control-plane-00003-hum`
returned HTTP 200 and the exact staging discovery document in 956 ms. Serving
that route proves the production initialization path loaded all five declared
secret values and validated the KMS public key. It did not exercise Firebase
Auth, App Check, FCM, Firestore or Storage mutation.

The sanitized probe artifact is separately digest-pinned under
[`../probe/`](../probe/). It retains no execution UUID, trace context, stack,
raw header set or diagnostic payload. Both invocation wrappers now fail closed
against the three-execution history, so this evidence cannot be replayed into a
fourth request.

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
The historical non-secret result at that boundary had SHA-256
`2143c037de6cb2d8caf9acc9676fa5a54d9bf974793136596aac94de30c93590`.
No request was made. Raw plans, raw state, the operator email and private
diagnostics were not committed.
