# Private staging control-plane workload

Status: two-key schema-2 runtime deployed, converged and source-verified with
version 1 current for the browser-relay rehearsal and version 2 retained; all
one-time activation and rehearsal-entry points are retired; the historical
audience-bound revision was accepted by one retired bounded probe

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
KMS-validated public keys. At this historical boundary, the live runtime
document intentionally remained on schema 1 with one key.

Workload state generation `1788581270106628` was 49,242 bytes at serial
16 with fifteen managed and three data resources, one output, nothing tainted,
and SHA-256
`d765cceffc696905f045a34805f9c6f1a6c45e9ba3f2224754a90a157c89b428`.
The canonical non-secret result at that boundary had SHA-256
`dc3324d3b812e1dafc6a6678c7427ac715ea1d2a81de527750aa958c7c71a440`.

## Completed single-key schema migration

The deployed schema-2 document is a pure transformation of the historical
[`../activation/runtime-config.json`](../activation/runtime-config.json): the
effective KMS key version, public JWK, issuer, origins, Firebase app, secret
versions, timeouts and component bucket remain byte-for-byte equivalent after
parsing. It contains exactly one published signing key and therefore does not
yet claim key overlap. Its exact digest is
`20be750358ffbc2136bab26bca6338b430ea6480ae9874f3fe5e7132c5e0db10`.

The exact plan from deployment commit
`e42cdd70f812580a6070f0e850daa04dbe0cee42` had SHA-256
`f9531f2ccde649b9f4b27d63b9c2228812d7deb5101515d1572d81851ad30560`.
It updated only the Function and deployment guard in place: zero creates, zero
deletes, no source-object replacement and no IAM, ingress, identity or scale
change. Apply converged to revision `control-plane-00006-wid`; independent
inventory matched deterministic source SHA-256
`d1844bbd007ae452d789011e8183038b9c1648b39c93b5122382c5f12a62ede8`
in copied generation `1788584317247647` and made no Function request.

At that historical boundary, workload state generation `1788584368457557` was
49,563 bytes at serial 18 with fifteen managed and three data resources, one
output, nothing tainted, and SHA-256
`746dcf402b9c6735175af9b46d9dda5f53f1788217f2b342c617838b6e2a8242`.
The canonical non-secret result at that boundary had SHA-256
`8abb27b692b6003566f510d3c03e8fa1c47926b51f263ea4dc7011838629a24c`.
The one-time schema migration wrappers are retired.

## Completed signing-key prepublication

[`runtime-config-version-1-current.json`](runtime-config-version-1-current.json)
preserves the exact historical prepublication document. It keeps
`staging-access-token-v1` as `current_kid` and appends only the public JWK for
enabled KMS version 2. Its SHA-256 is
`c018708786fc23a15f7701093b5148c0e415a2df8045af8e170e4308c2deae37`.

Merge commit `2bdd1a9e224234318d2ffd77c61b609331ccd044` produced an exact
saved plan with SHA-256
`0ff816d86e0b391da341703744663d4d0efb2a5478c4e17fed2c7b23ca5e2e24`.
Its metadata and JSON rendering had SHA-256
`278a6aadfa0866c1e6ec8668731167c9156c413e14cccaceb535f6955bb683d0`
and
`9c8e83767293848fd1bdd398e428fb0c22f18bf3a00e228f3f89be560d3ab233`.
The validator accepted only two in-place updates: the Function and deployment
guard. It required the deterministic source archive and historical source
metadata to remain unchanged, checked all thirteen other managed resources as
no-ops, and rejected every IAM, ingress, identity, scale, source, import,
generated-configuration or live-request delta.

Apply converged to active revision `control-plane-00007-deb`, whose
authoritative update time is `2026-09-05T11:59:31.953152089Z`. Independent
inventory matched the unchanged source SHA-256 in copied generation
`1788609527738009`, internal-only ingress, scale 0..1, zero public invokers and
zero user-managed keys without making a Function request. That workload
state generation `1788609578813791` was 49,898 bytes at serial 20 with fifteen
managed and three data resources, one output, nothing tainted, and SHA-256
`7233518baa49e38cbe846e148b498024c288e81222a8ed9f3cbf0cce4edab6dd`.
The canonical non-secret result at that boundary had SHA-256
`27253e9715fb901f78ce3dfd5ffd7ff0981b9dee818bde507b9170d35ffed185`.

The one-time prepublication wrappers are retired. At this historical boundary,
version 1 remained current and the regular source updater was blocked pending a
separately reviewed activation.

## Completed signing-key activation

[`runtime-config.json`](runtime-config.json) records the exact historical
two-key activation document. It changes only `current_kid` from the
prepublished document to
`staging-access-token-v2`, retains both public versions and has SHA-256
`40e2f83fbe8e3d27b7e53c4a666f424519fc6972ef19a7598ab9e093be0c70f7`.

Merge commit `6a9db97deb59b6c8e919d451c922ddb246eb54b2` produced an exact
saved plan with SHA-256
`252a404d50b891cdb49e379ff8f88b598effbee13f59b7065f44b754b84ac124`.
Its metadata and JSON rendering had SHA-256
`4bab6d00b2d82d0f232dcfbbf14120957f53da43725f552adfa51cc3a556a6c9`
and
`fd385f4216af57d810f128ccca4e44176149d2985083d21eecc8aa62d2d3608e`.
The plan was created 51 minutes and 44.897 seconds after the authoritative
prepublication update. Its independent validator accepted only in-place
Function and deployment-guard updates, with the source object, build, IAM,
ingress, identities and scale unchanged and no live request.

Apply converged to active revision `control-plane-00008-saz`, whose
authoritative update time is `2026-09-05T12:52:52.140270744Z`. Independent
inventory matched the unchanged source SHA-256 in copied generation
`1788612724252705`, internal-only ingress, scale 0..1, zero public invokers and
zero user-managed keys without making a Function request. Workload state
generation `1788612775466023` is 49,898 bytes at serial 22 with fifteen managed
and three data resources, one output, nothing tainted, and SHA-256
`59fc885f69378118b972b76c5ae570890251215b5d232330c380d4d293ff6fd2`.
The canonical non-secret result at that historical boundary had SHA-256
`bab093e5f070039c3e8f482f83bb00927406ca9284c639ca62bc69c4ae997713`.

The one-time activation wrappers are retired and the regular source updater is
restored against this exact deployment. Version 1 remains published throughout
the overlap window; any later retirement is a separate guarded transition and
must not occur before 330 seconds have elapsed from the activation update time.

## Completed browser-relay rotation entry

The browser-relay acceptance matrix needs a forward version-1-to-version-2
transition on an already open WebSocket. A one-shot, reversible
configuration-only entry selected the historical two-key
[`runtime-config-version-1-current.json`](runtime-config-version-1-current.json).
Both public JWKs and both enabled KMS versions remain present; no third key is
created.

Merge commit `eaa7bb46ed06206fcd0c0dec100a069c54b259cf` produced exact saved
plan SHA-256
`e0dec2a8b92545a0fdb89ac4f0e449bbac25f6332111dfd705921eaf6ceb5e29`.
Its metadata and JSON rendering had SHA-256
`a63c66c6787ea4b619fedf7237fef265389f167a7492089eedcc23e7cb8a8619`
and
`857d3b2cfbc779d9a67413a2367f23eb86db6ab9261d62b9a34eafea66c13254`.
The validator accepted only in-place Function and deployment-guard updates and
required all thirteen other managed resources to remain no-ops. Source, build,
IAM, private ingress, identities and scale were unchanged; no Function request
was made.

Apply converged to historical revision `control-plane-00009-kur`, whose
authoritative update time is `2026-09-05T19:04:13.514360614Z`. Independent
inventory matched unchanged source SHA-256
`d1844bbd007ae452d789011e8183038b9c1648b39c93b5122382c5f12a62ede8`
in copied generation `1788635007869418`, internal-only ingress, scale 0..1,
zero public invokers and zero user-managed keys. Both KMS versions remain
enabled and both public keys remain published, with version 1 current. Workload
state generation `1788635059003671` is 49,898 bytes at serial 24 with fifteen
managed and three data resources, one output, nothing tainted, and SHA-256
`07c0c7ef2d3130e440282a8923c15723deca39cf2d150c742bd7da4767d59283`.
The canonical non-secret result at that boundary had SHA-256
`5259f61aa65ceca3e45e162ea59045ee4947d9cec04e5a301261314f526b067c`.

The one-shot entry wrappers and selector are retired. The default Terraform
graph now directly describes this version-1-current state, and the regular
source updater is restored against the exact deployed revision. Re-entering the
historical transition requires new reviewed tooling; it cannot replay these
consumed plan bytes.

## Bounded staging browser-relay edge-profile source

Merge commit `ba4fc9caed566fa39fc66371192fb1821b4232ff` added one staging-only
network profile. It accepts only the direct control-plane `run.app` issuer and
the staging Hosting `web.app` origin as an atomic pair; mixed pairs, arbitrary
provider domains and production usage fail closed. The active runtime document
remains canonical, so deploying this capability did not change an issuer,
origin, IAM binding or ingress setting.

Exact saved plan SHA-256
`346dd483045090c31e6bf7da715bfb2d71a3c4672a85aa16aa92992058a71393`
had metadata and JSON SHA-256
`79960deb8bf50b8d3895685db88bfb50b5450cf92cc5026115f3301f7b013f7f`
and
`ac3fd004bd27ef0dc1564a3244d5a3fea598df4feffd0f9f325c66fc029a5271`.
It deployed deterministic source SHA-256
`3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e`
to current private revision `control-plane-00010-vop`, updated at
`2026-09-05T19:48:55.366699112Z`, with copied source generation
`1788637681094791`. Independent inventory at
`2026-09-05T19:49:07.829Z` reconfirmed internal-only ingress, scale 0..1,
zero public invokers and no live request. Runtime SHA-256
`c018708786fc23a15f7701093b5148c0e415a2df8045af8e170e4308c2deae37`
still publishes both enabled keys with version 1 current.

Workload state generation `1788637742341649` is 49,898 bytes at serial 26
with fifteen managed and three data resources, one output, nothing tainted,
and SHA-256
`e948862e0638bca565bba5a46841162fa4757c6e477f63d859c8aa47a6b8aab7`.
The current canonical non-secret [`result.json`](result.json) has SHA-256
`7aa7f4ec4b5d5bcd2b272f472361975c84dbc974dfdf24f154290d20c95b7266`.
The private bundle retains the raw plan and state only until this sanitized
evidence is merged, after which it is recoverably trashed.

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
