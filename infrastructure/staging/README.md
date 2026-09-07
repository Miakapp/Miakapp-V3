# Miakapp 4 staging private workload boundary

Status: private audience-bound user-relay acceptance succeeded and retired;
schema-2 two-key runtime deployed privately with version 1 current for the
browser-relay rehearsal and version 2 retained; live browser-relay plan rebased
but not executed; exact private relay-image v2 build verified and deployed to
two IAM-private, scale-to-zero relay services; their third one-shot transition
assigned both exact WSS audiences, converged at serial 4 and retired without
opening public invocation;
guarded rehearsal entry converged and its one-shot tooling
retired; real system-browser App Check provider token obtained and its
temporary Hosting route retired; browser App Check API-only prerequisite applied and
converged; one domain-restricted score key applied and independently converged;
exact non-deletable App Check provider registered with enforcement disabled;
second software signing-key version enabled and both versions published

This directory contains the closed description and observed state of
`miakapp-v4-staging`. The bounded foundation recovery has completed; its active
workflow and reviewed GitHub OIDC exchange are retired. The separate private
workload and its unscheduled private probes were applied and converged. One
bounded discovery request succeeded after two controlled failures. A later
single-execution probe exercised the current audience-bound user-relay exchange:
three negative controls and two successful, cryptographically verified
exchanges across a relay rotation. It removed both synthetic fixtures and all
temporary capability. This evidence does not authorize public ingress,
additional live requests, destroy, or production changes.

The separate [`browser-relay/`](browser-relay/) package now freezes the rebased
closed live topology, cost, signing-key and rollback matrix. It records twelve
pending cases and confirms all nine implementation preconditions are satisfied. The App Check
provider, standalone real-browser attestation, two-key runtime, guarded
rotation-entry and private-ready relay prerequisites are satisfied, while the
complete authenticated `LIVE-01` through `LIVE-12` matrix remains pending.
It contains no deployer or result and does not change the private cloud baseline
described below.

The guarded [`browser-relay-services/`](browser-relay-services/) root now owns
two healthy scale-to-zero Cloud Run services around the merged finite relay
admission profile. Its four phases solve the assigned-URL/audience bootstrap
without opening IAM early and model public IAM as the final dependency. The
verified v2 image digest is embedded in the profile and cannot be supplied as
an operator variable. The original bootstrap failed safely at Cloud Run's Gen2
memory floor; its distinct recovery created both private services at 512 MiB,
then the convergence gate caught a provider-only explicit-false normalization.
A third claimed transition removed only that non-round-tripping default,
assigned the two observed audiences and converged without creating, destroying,
opening IAM, sending a request or releasing Hosting. All three operations are
permanently claimed, retained as sanitized evidence and retired.

The guarded [`browser-relay-image/`](browser-relay-image/) package closed the
next pre-deployment boundary without creating a service. It pins the exact
merged Miakapp-Server Git tree and 53,098-byte archive, both digest-pinned base
images, the Cloud Build Docker builder, the existing private source bucket and
Artifact Registry repository, and one `E2_MEDIUM` build with verified SHA-256
source provenance. Its build-then-smoke sequence publishes only after `/ping`
returns `pong` from a read-only, non-root, capability-free container. The first
build exposed the missing Container Analysis prerequisite and is not
deployable. After that API converged, the distinct v2 recovery reused the exact
source generation and succeeded once. Its immutable digest is committed as
sanitized evidence and remains private in Artifact Registry. Both one-shot
entrypoints are permanently retired. The verified digest is now bound into both
private relay services; no public IAM binding or public invocation was created.

The [`signing-overlap/`](signing-overlap/) package records the converged next
prerequisite: one non-retried Cloud KMS version creation behind two atomic GCS
claims. Version 2 converged after the first and only direct REST request; both
one-shot entrypoints are permanently retired. The operation kept version 1,
the runtime document, Terraform state, IAM and private ingress unchanged. A
later guarded workload rollout prepublished both public keys with version 1
current, a second guarded rollout selected version 2 after 51 minutes and
44.897 seconds, and the browser-relay rehearsal entry reselected version 1
while retaining version 2. Version 2 stays published for the live forward
transition. The additional active software version is
bounded to USD 0.06/month at the currently documented Cloud KMS price.

The [`browser-app-check/`](browser-app-check/) root applied the reCAPTCHA
Enterprise API, exactly one domain-restricted score key and the exact
non-deletable provider registration. Direct and eventual Cloud Asset inventories
corroborate the key; direct App Check inventory corroborates the provider with a
one-hour TTL and default 0.5 minimum score. Enforcement and debug tokens remain
absent. A separate one-shot system-browser operation obtained one fresh provider
token and then removed its temporary Hosting route. Three atomic GCS claims
serialize the key,
registration operation and provider-attempt boundary across independently
copied bundles. The provider converged on the first exact saved-plan apply, so
recovery was not used. API, key, registration and unused recovery entrypoints
all fail before cloud access. Firebase exposes no provider-configuration delete
operation, so the registration is an intentional project-lifetime residual.

## Current truth

Project `miakapp-v4-staging` (`1072737219170`) now has one active Gen 2 Function
backed by its Cloud Run service plus two standalone private relay services. It
still has no App Engine application, unauthenticated invoker or minimum
instance. The latest bounded
requests targeted historical revision `control-plane-00004-yis` through one
unscheduled private Workflow. The current revision was source-verified without
making a request.
The bootstrap is complete.
Protected foundation applies
on 2026-09-03 created all thirteen declared APIs, the deletion-protected Paris
Firestore database and three active TTL fields, one software Ed25519 signing
key, and five Secret Manager containers. A later guarded operation added exact
software key version 2 outside Terraform while leaving version 1 and its sole
runtime publication unchanged. The eight KMS, Secret Manager and
component-bucket runtime IAM members are present with the exact declared
principals and roles.

The guarded initial activation completed from merge commit
`101e4231d452423bafa2ae1efd051e51faeff3c8`. It registered exactly one active
Firebase Web app and added exactly one enabled 32-byte version to each of the
five existing secret containers. Independent inventory found no workload or
public-ingress delta, and replaying the exact plan performed only read-back
reconciliation. The private derivation seed was deleted after success. The
committed non-secret result has SHA-256
`290c7cedb500d9f6844b49a45737ed920b3fe2e6ada6ed95b754a795768ccbdf`;
its production runtime document has SHA-256
`b794181400bf5ace6aaa9ffc4be00e4c4f6a59519284baa7f73bca3c042c4ff8`.

The original deterministic workload package from commit
`3f5a94dfcdfc0984487a558d966bbeaa769b18eb` has source SHA-256
`d2a9ffae2bd85106f782f9c75a10b6fb398682ead65dada2a1cf8ab5c65b7eb4`.
Its first 14-create plan stopped during the Function build because the custom
build identity could not read Google's regional source copy. Terraform preserved
a 13-resource partial state with the Function tainted and no private invoker.
Recovery configuration commit
`488da23cd7eb4c08baa9296724b87b7df34a1122` added only a conditional object-read
grant for that Google-managed bucket. The exact recovery plan created that grant
and the private probe invoker, updated the Function in place, and deleted
nothing. A separate output-only reconciliation plan changed no resource, and a
fresh full plan then reported no changes.

The first independent inventory from commit
`60bb8f48b885c4fdde2948309d95593657e9d039` observed Function revision
`control-plane-00001-kod` as `ACTIVE`, with internal-only ingress,
`minInstances=0`, `maxInstances=1`, no unauthenticated invoker and no
user-managed key on the runtime, build or probe account. It streamed Google's
immutable copied source
generation and matched the deterministic archive byte-for-byte. The non-secret
result committed at that historical boundary had SHA-256
`2143c037de6cb2d8caf9acc9676fa5a54d9bf974793136596aac94de30c93590`.
That workload state generation `1788481082158679` was 49,241 bytes at serial
8 with fifteen managed resources, three data resources, one output and no
tainted resource. Raw plan and state bytes remain private; the completed private
bundle was permanently deleted.

Three later, saved-plan source updates changed no IAM, ingress, network,
scaling or runtime document. The audience-bound exchange merge commit
`022f10e2dc15f32a8a6679b38ce7f1a04582e450` produced source SHA-256
`6674c0353ec9c73fcfe0d3a63d17850f057a5f2a547a5855989e28f011249b1e`
and revision `control-plane-00004-yis`. Its separate bounded acceptance probe
completed successfully against that exact revision.

A fourth source-only update deployed merge commit
`9f217da102b394734adba7ccef3f8f70d0317306` with deterministic source SHA-256
`d1844bbd007ae452d789011e8183038b9c1648b39c93b5122382c5f12a62ede8`.
Exact saved plan SHA-256
`ee98468a4ed92196109ac6f646030dca582068c6e2f2b5c1889e347322b1e3a6`
changed only the source object, Function and deployment guard, then converged
to active revision `control-plane-00005-biq`. At that boundary, the deployed
source accepted the bounded two-key runtime schema while the runtime document
remained on schema 1 with one published key.

A separate digest-bound plan then migrated only the Function environment and
deployment guard in place from schema 1 to schema 2. Exact plan SHA-256
`f9531f2ccde649b9f4b27d63b9c2228812d7deb5101515d1572d81851ad30560`
created and deleted nothing, preserved the deterministic source bytes and
converged to historical revision `control-plane-00006-wid`. At that boundary,
the runtime published exactly one key. Independent inventory made no request
and reconfirmed internal-only ingress, scale 0..1, zero public invokers and zero
user-managed keys.

The subsequent exact prepublication plan had SHA-256
`0ff816d86e0b391da341703744663d4d0efb2a5478c4e17fed2c7b23ca5e2e24`.
It updated only the Function and deployment guard in place, preserved source
SHA-256 `d1844bbd007ae452d789011e8183038b9c1648b39c93b5122382c5f12a62ede8`,
and converged to historical revision `control-plane-00007-deb` with versions 1
and 2 published and version 1 current. The authoritative Function update time is
`2026-09-05T11:59:31.953152089Z`. That workload state generation
`1788609578813791` was 49,898 bytes at serial 20 with fifteen managed resources,
three data resources, one output and nothing tainted; its SHA-256 was
`7233518baa49e38cbe846e148b498024c288e81222a8ed9f3cbf0cce4edab6dd`.

The exact activation plan had SHA-256
`252a404d50b891cdb49e379ff8f88b598effbee13f59b7065f44b754b84ac124`
and changed only `current_kid` in the runtime document plus the deployment
commit. It preserved both published keys, source, build, IAM, ingress and scale,
then converged without a request to historical revision `control-plane-00008-saz`.
Its authoritative update time is `2026-09-05T12:52:52.140270744Z`. Workload
state at that boundary was generation `1788612775466023`, 49,898 bytes at
serial 22 with
the same resource inventory and no taint; its SHA-256 is
`59fc885f69378118b972b76c5ae570890251215b5d232330c380d4d293ff6fd2`.
The canonical result at that boundary had SHA-256
`bab093e5f070039c3e8f482f83bb00927406ca9284c639ca62bc69c4ae997713`.

The subsequent guarded rehearsal-entry plan had SHA-256
`e0dec2a8b92545a0fdb89ac4f0e449bbac25f6332111dfd705921eaf6ceb5e29`
and reselected version 1 while retaining both published keys. It again changed
only the Function and deployment guard, preserved source, build, IAM, private
ingress and scale, and made no Function request. It converged to historical
revision `control-plane-00009-kur` at
`2026-09-05T19:04:13.514360614Z`. Workload state generation at that boundary
`1788635059003671` is 49,898 bytes at serial 24 with the same inventory and no
taint; its SHA-256 is
`07c0c7ef2d3130e440282a8923c15723deca39cf2d150c742bd7da4767d59283`.
The canonical result at that boundary had SHA-256
`5259f61aa65ceca3e45e162ea59045ee4947d9cec04e5a301261314f526b067c`.

The next exact source-only plan had SHA-256
`346dd483045090c31e6bf7da715bfb2d71a3c4672a85aa16aa92992058a71393`.
It deployed merge commit `ba4fc9caed566fa39fc66371192fb1821b4232ff`
and deterministic source SHA-256
`3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e`
to current private revision `control-plane-00010-vop`. The source adds one
bounded staging browser-relay edge profile, accepting only the exact direct
`run.app` issuer and Hosting `web.app` origin as an atomic pair. The active
runtime remains canonical, and independent inventory reconfirmed private
ingress, zero public invokers, scale 0..1 and no live request. Current workload
state generation `1788637742341649` is 49,898 bytes at serial 26 with the same
inventory and no taint; its SHA-256 is
`e948862e0638bca565bba5a46841162fa4757c6e477f63d859c8aa47a6b8aab7`.
The current canonical [`workload/result.json`](workload/result.json) has SHA-256
`7aa7f4ec4b5d5bcd2b272f472361975c84dbc974dfdf24f154290d20c95b7266`.
The discovery evidence below remains pinned to historical revision
`control-plane-00003-hum`.

The private probe deployment created only the Workflows API guard and one
unscheduled Workflow. Its third and final execution succeeded after two pinned
`503` failures, returning HTTP 200 with the exact staging discovery document in
956 ms. Serving that route proves all five secret values were loaded and the
KMS public key was validated before application routing. It performed no
Firestore, Storage or FCM mutation and did not validate Firebase Auth or App
Check. The canonical [`probe/result.json`](probe/result.json) has SHA-256
`ea3245756727eaf071f2edc6ef55ba1b730c5e3f61e38746fb7cbf36e8f4ef05`
and contains no execution UUID, trace context, stack or raw diagnostic.

Firebase Authentication remains initialized in its closed, non-deletable
configuration with every end-user provider disabled. The independent
`auth-probe` root now preserves the successful audience-bound acceptance run.
Workflows rejected generation 1's inline map expression and generation 2's
59-assignment initialization step during creation, so neither executed.
Generation 3 then completed exactly one execution against
`control-plane-00004-yis`: invalid Firebase Auth returned
`401 invalid_firebase_token`, missing App Check returned
`401 invalid_app_check_token`, and an absent private Home returned
`404 home_not_found`. Two subsequent exchanges returned distinct five-minute
Ed25519 credentials for relay A then relay B; the internal verifier validated
both signatures, claims and changed audiences.

The fixed no-email user and marker-guarded private `controlHomes` document were
deleted and independently verified absent, while the lowercase public `homes`
path remained absent. Retirement removed the Workflow, verifier and all four
temporary bindings. All nine role IDs across the three immutable generations
are disabled and unassigned. The Cloud Asset API, those inert roles, the keyless
no-role verifier identity and the exact state guard remain without recurring
compute. The digest-pinned [`auth-probe/result.json`](auth-probe/result.json) and
[`auth-probe/retirement.json`](auth-probe/retirement.json) contain no execution
identifier, token material or raw diagnostic. Browser-provider attestation is
not claimed; [`auth-probe/README.md`](auth-probe/README.md) is the authoritative
lifecycle and cost boundary.

The verifier's service policy contains exactly one conditioned binding for the
probe identity, but project inheritance also permits five authenticated staging
principals with `run.routes.invoke`: the Owner, two default Editor service
accounts, and the Cloud Functions and Cloud Run service agents. The live
inventory resolves role permissions, pins that inherited set, rejects extra
service-level bindings and makes no Workflow-only claim.

Interrupted retirement is state-and-live inventoried. A disabled Cloud Asset API
is restored alone before a mandatory fresh authorization. A soft-deleted probe
role is never restored automatically: eventual IAM-policy inventory cannot
authoritatively exclude a recent descendant binding, so recovery fails closed
for manual investigation. A tracked role whose recoverable definition cannot be
observed is never recreated under a generic Terraform create path. When all six
temporaries are absent live and in state, an explicit digest-bound finalization
can disable the remaining exact roles or, if already disabled, regenerate the
retirement evidence after exact fixture cleanup and convergence checks. Its
output-only finalizer accepts both the preceding dormant generation and the
current armed output left by a successful targeted retirement; all managed
resources must remain no-ops.

The earlier authorized bootstrap apply completed:

- the approved billing link and exactly one EUR 10 alert budget;
- all eight bootstrap APIs;
- the private component and versioned Terraform-state buckets in Paris;
- the runtime, planner, and deployer service accounts;
- the retained Workload Identity pool and its two now-disabled GitHub
  providers; and
- the reviewed project, bucket, and service-account IAM bindings.

Terraform reported `27 added, 0 changed, 0 destroyed` on top of the nine
resources recovered from the preceding partial run. Its complete Terraform
1.11.3 state contains exactly 36 managed addresses at serial 39. The committed
fingerprint is
`c083e7a05f2ccf273abda98c0739584336d2cbaffd8ea836b65b0790f94833a2`;
the path and raw contents remain private outside the repository.

The cloud apply succeeded, but the original wrapper stopped before backend
migration because its local validator expected a `sensitive` field that
Terraform 1.11.3 does not persist for this non-sensitive output. The guarded
recovery subsequently migrated the state to GCS. Terraform canonically raised
the serial to 40 and permuted the two `check_results` entries; a fresh read of
generation `1788439334043522` proved that every other parsed value is exactly
equal. The original serial-39 state remains protected as independent recovery
evidence outside the repository.

The planner's already-live Service Usage Consumer member was then adopted with
a configuration-driven Terraform import. The plan contained exactly one import
and no add, change, or destroy. Project IAM retained etag `BwZalzR1TWY=` and the
same canonical policy digest, and no `SetIamPolicy` audit entry appeared. The
resulting bootstrap state generation `1788457646215552` at serial 41 had 37
managed resources and remains the historical planner-role adoption record.

PR #30 configuration commit
`ee457535a64355cd8133410d9c8c43f039608928` then disabled exactly the plan and
apply Workload Identity providers. Its exact private 25,925-byte plan had
SHA-256
`8f570dfe5450b704112d484f058fc6dfcd39069a92c8bb483c5029027183e888`
and contained 35 no-ops plus two updates, each limited to `disabled: false` to
`true`. Apply reported `0 added, 2 changed, 0 destroyed`; a follow-up full plan
reported no changes. Current bootstrap state generation `1788460174191027` is
61,864 bytes at serial 42 with 37 managed resources, two data resources and one
output. Its SHA-256 is
`288d947d35f5d5a278aaff210ea878a9dab817f594b4c3161ed117bb2e30e26d`.
The pool remains enabled and retained.

The consumed [`bootstrap/apply-and-migrate.sh`](bootstrap/apply-and-migrate.sh)
entry point is permanently retired. The replacement
[`bootstrap/migrate-recovered-state.sh`](bootstrap/migrate-recovered-state.sh)
contains no apply path and refuses to overwrite the existing state object. A
guarded live foundation plan was reviewed before any foundation resource or
workload had been applied.

Run `33776569977` later applied that plan through the separate deployer identity
after normal environment approval. Terraform recorded 25 managed foundation
resources before the command failed; the private detailed log was intentionally
discarded, so no exact failure cause is claimed. State generation
`1788452068422403` is healthy at serial 4, all TTL operations completed
successfully, and no lock remains. A fresh private plan reports exactly eight
creates and 25 no-ops.

The first protected recovery refresh exposed that the planner lacked
`serviceusage.services.use`, because quota attribution had not been exercised
while the initial plan deferred its cloud reads. The narrow Service Usage
Consumer binding is now live and declared in the bootstrap source; its bootstrap
state reconciliation is complete. A subsequent fresh plan also showed that
Firestore's retention-window timestamp advances alongside its opaque etag. The
recovery validator accepts only a valid nondecreasing timestamp and otherwise
keeps the drift schema closed.

Protected run `33784785967` passed that validator, applied the exact eight IAM
members, and wrote complete state generation `1788456706865449` at serial 6.
The workflow's final step failed because it attempted its follow-up provider
reads with the deliberately narrower deployer identity. An independent User-ADC
plan then reported all 33 managed resources as no-ops and zero changes. Before
activation, cloud inventory confirmed the eight exact IAM members, five secret
containers with no versions, three active TTL fields, enabled software Ed25519
key version 1, no workload, and no live lock. The consumed plan generation is
deleted and remains only within the private bucket's soft-delete window. The
active recovery workflow has been removed and its plan/apply entrypoints now
fail immediately. GitHub workflow `349440747` was observed in state
`disabled_manually` before source removal.

## Repository layout

| Path | Purpose | Current execution boundary |
|---|---|---|
| [`bootstrap/`](bootstrap/) | Billing link, budget, both buckets, runtime/project IAM, Workload Identity Federation, and separate CI service accounts | Complete; both recovery providers disabled, 37-resource serial-42 state reconciled, zero plan verified |
| [`terraform/`](terraform/) | APIs, Firestore, KMS, Secret Manager containers, and resource-scoped runtime IAM | Complete; 33-resource state independently converged; versions are managed outside Terraform |
| [`activation/`](activation/) | One Firebase Web app, five initial secret versions, and the closed non-secret runtime document | Applied once and idempotently revalidated; result evidence committed without secret payloads |
| [`workload/`](workload/) | Deterministic production package, private Gen 2 Function, dedicated build/probe identities, and one-permission FCM role | Applied and converged; current internal-only revision independently source-verified |
| [`probe/`](probe/) | Isolated Workflows API and one fixed, unscheduled, keyless internal discovery probe | Applied and consumed; exactly two failures followed by one validated HTTP 200 discovery response |
| [`firebase-auth/`](firebase-auth/) | Closed Firebase Authentication initialization with no end-user sign-in provider | Non-deletable resource initialized, state-adopted, reconciled, and independently validated |
| [`auth-probe/`](auth-probe/) | Guarded audience-bound user-relay Workflow, internal verifier and sanitized evidence | Generation 3 succeeded once and retired; both fixtures and every temporary capability are absent; all nine one-shot roles are disabled |
| [`browser-app-check/`](browser-app-check/) | Guarded reCAPTCHA Enterprise API, score key and App Check provider prerequisites | API, one globally serialized domain-restricted score key and exact non-deletable provider applied and converged; all consumed/recovery entrypoints retired; enforcement remains disabled |
| [`browser-attestation/`](browser-attestation/) | One-shot real system-browser App Check provider observation | Fresh provider token obtained through the default macOS browser; all six claims retained, temporary Hosting disabled/deleted, route verified 404, and every execution/recovery entrypoint retired |
| [`signing-overlap/`](signing-overlap/) | Monotone second KMS version creation and 60/330-second overlap rollout contract | Version 2 enabled after one direct request; two atomic claims retained and one-shot entrypoints retired; runtime, Terraform, IAM, ingress and requests unchanged |
| [`browser-relay/`](browser-relay/) | Closed live browser, two-relay, signing-key and rollback acceptance plan | Rebases the current private `00010`/two-key/version-1-entry/App Check/two-relay baseline; not deployed, every `LIVE-*` case pending, and no cloud mutation granted |
| [`browser-relay-edge/`](browser-relay-edge/) | Dormant reversible control-plane edge state machine | Pins the atomic staging issuer/origin profile and public-last/private-first transition ordering; exposes no CLI and grants no cloud mutation |
| [`browser-relay-runner/`](browser-relay-runner/) | Dormant operator-local three-engine runner | Real offline CI smoke launches Chromium, Firefox and WebKit sequentially; private input stays in memory, output is closed, and no live run or cloud mutation is authorized |
| [`browser-relay-page/`](browser-relay-page/) | Dormant Firebase/MiakAPI scenario host and deterministic artifact | Revision 3 implements serialized lifecycle and typed outcomes; pinned browsers prove native terminal fencing and separately explicit cleanup before sequential replacement using offline fakes, not native async Firebase cleanup or persisted BFCache restoration; no live authority is granted |
| [`browser-relay-fixture/`](browser-relay-fixture/) | Dormant single synthetic-Home lifecycle controller | Proves initial absence before creation, configures the fixed MiakAPI coordinator, emits one in-memory custom token per browser, supports one relay rotation and requires coordinator-first cleanup plus verified final absence; the controller itself has no transport or live authority |
| [`browser-relay-fixture-cloud/`](browser-relay-fixture-cloud/) | Dormant injected Google/Firebase fixture adapter | Implements bounded keyless JWT signing, fixed control-plane mutations, complete inventory and preconditioned atomic cleanup for the controller; no CLI, ambient credentials, IAM change or live authority is present |
| [`browser-relay-fixture-miakapi/`](browser-relay-fixture-miakapi/) | Dormant pinned MiakAPI Node factory binding | Reproducibly vendors the exact coordinator commit, injects the Home Key exchange transport and permits one provider and coordinator construction without starting a session; no CLI or live authority is present |
| [`browser-relay-aggregator/`](browser-relay-aggregator/) | Dormant independent-source engine-result aggregator | Assigns all 40 assertions and eight counters to exact source owners, accepts 18 single-use closed receipts in canonical order and emits only the existing runner schema; it is not wired or executed and grants no live authority |
| [`browser-relay-independent-observers/`](browser-relay-independent-observers/) | Dormant non-page source observers and closed runner-result reducer | Validates 43 exact facts, 15 private receipts, source ledgers, revision/signing lineage and common-clock LIVE-09/10/11 windows; all dependency contracts are digest-pinned, while authenticated live acquisition remains absent |
| [`browser-relay-playwright-bridge/`](browser-relay-playwright-bridge/) | Dormant page-to-receipt Playwright bridge | Lazily drives the phased host and real receipt producer for Firefox/WebKit; Chromium is blocked before page or private-input acquisition because pinned Playwright cannot prove native BFCache restoration; no engine result, cloud receipt or live authority is produced |
| [`browser-relay-page-receipt/`](browser-relay-page-receipt/) | Dormant browser-owned source receipt producer | Revision 2 reduces 18 exact Chromium page facts or three secondary-browser facts, cross-checks cumulative host lifecycle evidence, typed call outcomes and terminal cleanup, is bound to the bridge and now combines offline with every independent source |
| [`browser-relay-scenario-fixture/`](browser-relay-scenario-fixture/) | Dormant four-input scenario fixture controller | Composes the immutable fixture with a second exact synthetic Firebase identity, grants both identities state access through one coordinator and requires coordinator-first verified cleanup across both ownership domains; the bridge is present while the complete Chromium scenario remains blocked |
| [`browser-relay-scenario-fixture-cloud/`](browser-relay-scenario-fixture-cloud/) | Dormant injected replacement-identity Google/Firebase adapter | Supplies only the exact second synthetic UID through bounded keyless signing, token-bound identity verification and independently observed cleanup; closes the cloud implementation gap without wiring the scenario or granting live, IAM, Hosting or public-ingress authority |
| [`browser-relay-monitoring/`](browser-relay-monitoring/) | Closed allow-listed monitoring preflight and evaluator | One post-merge read-only observation verified all six metric surfaces, the existing EUR 10 budget and the private edge/relay boundary; no mutation or acceptance execution occurred |
| [`browser-relay-rollback/`](browser-relay-rollback/) | Closed-target rollback preflight | Post-merge observation verified all ten private-target facts and a four-resource Terraform no-change plan; its sanitized result records zero mutation, public-ingress change and acceptance execution |
| [`browser-relay-orchestrator/`](browser-relay-orchestrator/) | Dormant single-use edge orchestrator | Post-merge read-only preflight proved the claim absent and the rollback target private and converged; no claim, mutation, public edge or live acceptance has run |
| [`browser-relay-operation/`](browser-relay-operation/) | Dormant full live-operation and preflight envelope | Composes the claimed edge, public-last relay transition, one matrix and two-level cleanup; its exact post-merge read-only preflight succeeded privately, while no cloud adapter, live authority or execution is present |
| [`browser-relay-services/`](browser-relay-services/) | Guarded two-relay Cloud Run Terraform state machine | Two private-ready 512-MiB scale-0..1 services use their exact assigned WSS audiences and a keyless role-free identity; all three claims remain durable and every one-shot entrypoint is retired |
| [`browser-relay-image/`](browser-relay-image/) | Guarded one-shot private relay image build | Distinct v2 recovery succeeded once with exact source provenance and hardened smoke validation; immutable image is deployed only to the two IAM-private relays; all build entrypoints retired |
| [`automation/`](automation/) | GitHub policy record, historical recovery blueprint, strict plan validator, and operator inspection | One-shot workflow disabled and removed; plan/apply entrypoints inert |
| [`test/`](test/) | Closed-schema, inventory, IAM, state, workflow, and hostile-input tests | Credential-free |
| [`TEARDOWN.md`](TEARDOWN.md) | Manual recovery and teardown rehearsal | Documentation only |

## Safety and cost posture

The foundation fixes every regional resource to Paris. The workload contract
keeps the Function at `minInstances=0` and `maxInstances=1` with internal-only
ingress and includes no load
balancer, Cloud Armor policy, VPC connector, Cloud NAT, Analytics property, or
always-on compute. The component bucket is private, has Public Access Prevention
and no CORS origin. No secret payload, private derivation seed or
service-account key is represented in Git, logs or Terraform state.

The remote-state bucket uses uniform access, Public Access Prevention, Object
Versioning, and a seven-day soft-delete window. Foundation state retains
recovery history. Live saved plans expire after
two days, their archived generation after one further day, and deleted bytes may
remain recoverable during the bucket soft-delete window. Plans and state may
contain private data and must never be committed or uploaded to public Actions
artifacts.

The planner and deployer identities and their IAM grants remain keyless and
separate. A successfully impersonated identity may read the private bucket. The
planner may consume project quota for provider reads, manage only `.tflock`
objects, and create saved plans; it cannot create or replace state. The empty foundation state was
initialized and reconciled with protected operator credentials, satisfying the
state prerequisite for CI. Only the deployer may write foundation state;
neither may mutate the bootstrap
state prefix. Escalation-capable project IAM, service-account creation and bucket
creation remain human-bootstrap operations. The deployer has only service-scoped
foundation roles plus administration of the separate component bucket; it has no
project-wide Storage or IAM role capable of bypassing the state boundary. The
planner and deployer were exercised only through the exact historical workflow.
That workflow is no longer installed, both cloud-plan and apply activation
flags are false, and both recovery provider resources are disabled. This closes
the reviewed GitHub OIDC exchange route while retaining the enabled pool. It
does not prove that another administrator cannot impersonate either service
account; that access remains part of the security and teardown inventory. The
manual operator plan remains read-only and requires User ADC plus an exact
staging confirmation.

Repository validation itself costs nothing. Planning adds only bounded API
reads, temporary locks, and short-lived private saved-plan objects. The state
bucket currently stores the 61,864-byte bootstrap state, the 53,619-byte
complete foundation state, the 49,563-byte workload state, the 13,596-byte probe
state, the 11,010-byte Firebase Auth state, the 35,312-byte Auth-probe state, and
recovery generations across the six earlier Terraform prefixes. The seventh
prefix, `terraform/browser-app-check`, now stores its 15,925-byte serial-5
state at generation `1788603682439071`; it contains the state guard, reCAPTCHA
API service, one score key and its exact provider registration plus two data
resources and one output. The eighth prefix,
`terraform/browser-relay-services`, stores its 37,399-byte serial-4 state at
generation `1788664157688934`; it contains two private-ready relay services, one
role-free service account, the guard and no public IAM resource. The live
Firestore database is the project's
free-tier database; the five secret containers now each have one enabled
version. Secret Manager versions, the software KMS key version, Storage and
Artifact Registry bytes, build operations, and retained object versions remain
usage-metered. The deployed Function remains scale-to-zero, its deployment
inventory made no request, and no probe Workflow or verifier is currently
active. If armed, the user-relay verifier remains scale 0..1 and the Workflow is
unscheduled; both are retired immediately after one bounded execution.
Budget alerts at EUR 2, EUR 5, and EUR 10 are alarms rather than hard caps.
The consumed key and registration applies added three tiny private coordination
objects under that seventh prefix before their irreversible boundaries. They add
no fixed-cost service and prevent copied private bundles from repeating either
mutation while the claims remain live.

## Remote-state bootstrap boundary

The GCS bucket could not back the transaction that created it, so the authorized
apply used protected local state. The repository still keeps
[`bootstrap/backend.gcs.tf.example`](bootstrap/backend.gcs.tf.example) as a
template rather than activating it in the source tree.

The migration-only wrapper revalidated the private saved-plan bundle and exact
complete-state digest, serial, lineage, 36-address inventory, and activation
output. It then checked the project and billing fingerprint, the budget, APIs,
buckets, service accounts, Workload Identity pool and providers, and proved the
state bucket had no object. Only in a private working copy did it activate the
backend template and run `terraform init -migrate-state -force-copy`. It read
the remote object back and accepts only Terraform's observed canonical migration
transform: one serial increment and an exact permutation of `check_results`,
with strict equality everywhere else. Both success and failure leave the
authoritative source state unchanged; failures also retain the private execution
directory for diagnosis. The migration has completed and the existing object
makes this path fail closed on replay. The later import-only adoption preserved
that initial migration evidence while advancing generation `1788457646215552`
to serial 41 with the planner quota member as its sole additional managed
resource. The WIF-provider retirement then advanced current state to serial 42
without changing the 37-resource inventory.

The ordinary foundation root already points at `terraform/foundation` and reads
the bootstrap output from `terraform/bootstrap`. A closed precondition checks
the exact project, region, both buckets, identity providers, all service
accounts, and numeric GitHub repository IDs before any foundation resource can
proceed.

## Guarded foundation-state initialization

[`terraform/initialize-state.sh`](terraform/initialize-state.sh) is the only
supported path for creating the initial foundation state. It operates in a
private directory outside the repository and copies only the reviewed backend,
provider lock, and CLI configuration. It first requires the exact reconciled
bootstrap generation and proves that the foundation object is either absent or
already the exact canonical empty state. Terraform 1.11.3 initializes an absent
GCS backend by creating its canonical serial-1 empty state during
`terraform init`; this is the only state-writing operation in the path.

The initializer never uses `terraform state push` or a direct cloud-object
write. It reads both Terraform's view and the exact current GCS generation back,
requires an exact canonical empty state at serial 1, and rejects every other
bucket object. Only after that reconciliation does the absent path create and
fingerprint a saved `-refresh-only` plan. It accepts only the two implicit locked
providers with no resource, output, variable, module, expression, provider
block, or action; the plan is never applied. It then rechecks that the reconciled
generation is still current. A valid preexisting empty state is reconciled
without planning or mutation, so recovery after an uncertain client result
cannot overwrite it.
Failure preserves private diagnostics; success removes them. The implementation
is bound to reviewed implementation commit
`626dc16637ba843f6d1543156aba99e7b551e705`. The first execution created
generation `1788443136082489`, then stopped before apply when its conservative
plan-shape check rejected Terraform's implicit provider metadata. After that
metadata was modeled exactly, clean execution commit
`ab6f26bd5dd076a79847f989615e7fddf93f2a07` reconciled the same canonical
empty generation without mutation. No initialization plan was ever applied.

Backend initialization and planning acquire and release Terraform's temporary
`.tflock` object.
The only durable new live object is the roughly 181-byte empty state; Object
Versioning and soft delete may temporarily retain tiny noncurrent state or lock
generations as recovery evidence.

## Guarded live foundation plan

The non-saving local wrapper was run from clean configuration commit
`363d017ebdc85af1285e38c5742365fd0a2a4395` with User ADC. Terraform 1.11.3
reported exactly `33 to add, 0 to change, 0 to destroy` plus two apply-time data
reads. The reviewed graph contains thirteen APIs, the bootstrap guard, one
regional Firestore database and three TTL fields, one software KMS key ring and
signing key, one key IAM member, five empty secret containers and their five IAM
members, and two component-bucket IAM members. It contains no workload, secret
version, public ingress, or billing resource.

The wrapper created no saved plan and ran no apply. A post-plan read proved that
foundation state generation `1788443136082489` and its SHA-256 remained
unchanged, and no `.tflock` object remained current.

The now-retired GitHub workflow historically completed run `33774848684` from
protected configuration commit `66869a3564788ba725049cc91326b17eb239ddaf`.
Its private 11,000-byte plan has generation `1788450586606804` and SHA-256
`5def42ea3f598a5f2c59d9456814646c1b526526c6b96acf20a0db7626bc36da`.
The complete binary was downloaded, digest-checked, rendered with the pinned
providers, and accepted by the `initial-foundation` closed policy: the same 33
creates and two reads, with no update or delete. The empty foundation state kept
the same generation and digest, and no live lock remained.

Protected run `33776569977` then validated and attempted the same 33-create plan.
The apply stopped after Terraform had persisted 25 managed resources. Its exact
private plan and resulting state fingerprints are recorded in the manifest;
the discarded apply log prevents attributing a precise cause. Independent cloud
and state reads found the three expected IAM groups absent and no unexpected
workload or public resource. A subsequent private 18,893-byte saved plan,
SHA-256 `b22920a8fd933ecc05298c9fd8f2565ed01cd5b33b96bf08b223360f3390b54a`,
contains exactly eight creates, 25 no-ops and seven refresh-only provider
normalizations. It passed the closed `partial-foundation-recovery` validator and
was removed after review.

The final recovery used private plan generation `1788456590438484` with SHA-256
`d68d4d6748e03691cb1d103a0ab593413110349ba4b39b0ea4efb9be381f1a1f`.
Terraform completed all eight creates. Current state contains 33 managed
resources, three data resources and one output, and the independent no-change
plan proves configuration convergence. The failed overall Actions conclusion
records only the underprivileged follow-up plan, not an incomplete apply.

## Retired partial-recovery GitHub automation and federation

[`automation/github-policy.json`](automation/github-policy.json) captures both
the observed GitHub settings and the settings required before activation. On
2026-09-03, `main` was protected with the credential-free staging gate bound to
GitHub Actions, the plan/apply environments were restricted to `main`, and
Actions were restricted to the reviewed SHA-pinned integrations with read-only
default permissions. The unrelated `miakapi` environment was left unchanged.
Repository OIDC customization remains at its default because the Google
provider, not GitHub's repository subject template, enforces the immutable
numeric and workflow claims. The hash-bound recovery copy ran only from
protected `main`. Workflow `349440747` was set to `disabled_manually`, and its
active source has now been removed from `.github/workflows/`.

The retained historical blueprint required:

- protected `main` with the credential-free staging gate required;
- SHA-pinned selected actions and read-only default workflow permissions;
- separate `miakapp-v4-staging-plan` and `miakapp-v4-staging-apply`
  environments, with explicit approval on the latter;
- OIDC conditions over immutable repository/owner IDs, `main`, the exact
  workflow reference, and the exact environment; and
- a hash-bound active file and blueprint before OIDC could be requested;
- the exact private object and SHA-256 emitted by the same workflow attempt;
- the closed `partial-foundation-recovery` validator immediately before apply;
- a private, non-saving post-apply plan intended to report zero changes.

There is one known human administrator. The desired apply environment therefore
records that administrator as reviewer while allowing self-approval. This is an
explicit operator checkpoint, not independent four-eyes review. Administrator
bypass remains forbidden. The policy record now sets workflow installation,
cloud planning and foundation apply authorization to false. Both historical
entrypoint scripts exit before credential, Terraform or cloud access. Reusing
the blueprint requires a new reviewed activation change.

The plan/apply WIF providers are also disabled. Only their `disabled` attribute
changed; the pool, service accounts and IAM bindings were deliberately retained.
Consequently the reviewed GitHub exchange cannot mint either CI identity, but
the evidence does not rule out impersonation by another administrator.

## Validate locally

Node.js 22 and Terraform 1.11.3 are required:

```sh
npm run test:staging-manifest
```

The gate first resolves `manifest.json` as a canonical index over exactly four
fixed fragments under `manifest/`: core intent, Terraform history, platform
evidence and browser-relay evidence. The index is limited to 16 KiB, each
fragment to 96 KiB and the complete bundle to 192 KiB. Every file must be a
regular non-symlink, non-executable file using exact two-space JSON plus one
terminal newline; the loader binds the fixed path, mount, byte length, SHA-256,
fragment schema, owned fields and aggregate size, and requires the index and
core fragment to agree on the semantic schema and revision before assembling
the unchanged manifest. The gate then validates that bounded closed
manifest, all reviewed inventories,
the retired recovery policy and historical blueprint, pinned actions and providers,
exact locks for macOS
ARM64 and Linux AMD64, all eight Terraform roots with mock providers, script syntax,
private-plan handling, the exact recovery addresses, actions, planned values,
partial prior state, critical expression references and checks, the
complete simulated migration-only recovery state
machine, the simulated guarded foundation-state initializer, and hostile
environment inputs. It initializes Terraform with `-backend=false` and never
reads credentials or contacts staging.

The validator assumes a trusted, quiescent checkout. A process allowed to
rewrite the checkout concurrently could also replace the validator itself, so
concurrent local writers are outside this validation boundary. Within that
boundary, descriptor identity, directory inventory and path containment are
checked before and after every bounded non-blocking file read.

The active validation workflow has only `contents: read`; it has no OIDC or
secret permission. With both recovery providers disabled, the reviewed GitHub
OIDC route cannot exchange credentials for the planner or deployer identity.
No persistent credential or repository secret is used.

## Next staging gate

Bootstrap, foundation, initial activation, private deployment, discovery, and
the private user-relay acceptance gate are complete. Firebase Authentication is
initialized under [`firebase-auth/`](firebase-auth/) with its exact closed
configuration and no end-user provider. The one-shot sequence under
[`auth-probe/`](auth-probe/) proved real Firebase ID-token and Admin
custom-provider App Check enforcement, private Home routing and rotation, and
both audience-bound token signatures. Its Workflow, verifier, fixtures and
temporary permissions are absent.

The standalone browser App Check live-provider prerequisite is now closed. The
default macOS browser obtained a fresh provider token through the exact staging
Hosting origin; its token bytes never left the page, and the temporary route was
disabled, deleted and independently observed as HTTP 404. Relay token-refresh
integration, trusted-source/edge admission, the managed-service
fault matrix, monitoring and billing-alert validation, secret and signing-key
rotation, migration rehearsal, and every broader `STAGE-*` observation remain
open blockers.

The digest-pinned [`browser-relay/plan.json`](browser-relay/plan.json) is now
rebased from an independent read-only observation completed at
`2026-09-06T04:08:50.844Z`. It verified private
`control-plane-00010-vop`, zero Firebase Auth users, zero application fixture
collections, a disabled Hosting route, two published signing keys with version
1 current, the completed browser App Check attestation and two private-ready
generation-2 relays. Their exact WSS audiences, verified image digest, 512-MiB
memory, role-free keyless identity, scale 0..1 and zero public IAM bindings match
the immutable private-ready result hash. The bounded staging edge profile is
present in source while the active runtime remains canonical. The plan selects
the remaining shape: the existing Hosting `web.app` origin, temporary direct
provider endpoints, a local unscheduled three-engine runner, one execution and
a maximum twenty-minute public window. It assumes no free tier and stops at a
EUR 1 projected increment, inside the separately authorized EUR 5 monthly
boundary. App Engine, an external load balancer, Cloud Armor, VPC and DNS
changes are absent. Revision 8 is retained byte-for-byte for the historical
relay-image build dependency.

No live case may start yet. The production runtime now publishes both signing
keys with version 1 current and version 2 retained. The guarded
`signing-overlap/` operation created version 2 exactly once, and separate
workload plans prepublished both keys, activated version 2 and then converged
the reversible browser-relay rehearsal entry back to version 1 without changing
source, IAM, ingress or scale. Its one-shot entrypoints are retired and the
browser-relay precondition is satisfied. The live matrix can activate version 2 on the
same socket, wait the full 330-second retirement bound, and disable rather than
destroy version 1; no third KMS version is required.
The browser App Check API, its single
domain-restricted score key and the exact non-deletable provider registration
are applied, independently converged and retired as one-shot entrypoints.
Version 2 activation is complete. The browser-attestation package
used one ephemeral `127.0.0.1` callback because Conductor's Browser tab is a
localhost preview; that operation and all recovery paths are now permanently
retired. The full browser-relay matrix must acquire fresh credentials and cannot
reuse the consumed token or callback.
Plan revision 15 consumes the merged runner and page profiles plus the closed
monitoring, rollback, orchestrator and complete-operation preflight results. It
archives revision 14 byte-for-byte and records all nine prerequisites as
satisfied without promoting either offline browser smoke or any read-only
preflight to live matrix evidence.
The dormant [`browser-relay-edge/`](browser-relay-edge/) library now covers the
edge transition state machine and its emergency ingress closure. The adjacent
[`browser-relay-orchestrator/`](browser-relay-orchestrator/) library now binds
it to one retained generation-zero claim, the exact closed prerequisites, one
callback and a mandatory canonical-private postflight. Neither package exposes
an operator entrypoint or grants live authority. A post-merge read-only
preflight from exact commit
`6995856fc5cfd64a06176c83e9d24bc93558e05b` proved the retained claim absent,
the canonical-private control plane and both private-ready relays unchanged,
and a four-resource Terraform no-change plan. Revision 13 pins its sanitized
result and marks `EDGE-01` satisfied without creating a claim or opening the
edge.
The dormant [`browser-relay-rollback/`](browser-relay-rollback/) library now
pins that edge machine, the exact private-ready baseline and all six ordered
rollback steps. Its read-only observer can verify ten closed-target conditions,
including an independently rendered zero-change relay Terraform plan. The
post-merge preflight observed all ten conditions and the four-resource
Terraform no-change plan from exact commit
`0fd0d05ee31f84d42cf69cc6f5cead9cbcad79be`. Its sanitized result records no
mutation or live acceptance, and revision 12 pins it to close `ROLLBACK-01`.
The separate relay-image operation is fully reviewed, permanently consumed and
bound by immutable digest into both private relay services. Their exact Cloud
Run URLs and WSS audiences have been independently observed after the
zero-create, zero-delete private-ready transition. Its result and serial-4 state
are pinned, its claim is durable and its entrypoints are retired. Public
invocation, browser traffic and the edge transition remain separate later
gates.
The dormant [`browser-relay-runner/`](browser-relay-runner/) package pins plan
revision 9, Playwright 1.62.1 and the merged MiakAPI browser client. Current
plan revision 15 pins the merged runner profile and the page host's independent
three-engine revision-2 CI profile, retained byte-exact as
`browser-relay-page/profile-v2.json`. Current page revision 3 pins plan 15
without changing that historical CI claim. The package has no
CLI, publisher, credential loader or cloud adapter. Its dedicated CI gate
intercepts the exact staging URL locally and proves three real ephemeral browser
engines produce only the reviewed closed aggregate. It records zero live runs
and grants no authority to publish Hosting or expose either private service.
The adjacent [`browser-relay-page/`](browser-relay-page/) package now supplies
the missing browser host foundation without claiming a matrix result. Firebase
Auth is memory-only, App Check uses the real reCAPTCHA Enterprise provider,
MiakAPI is vendored from the exact unpublished v4 commit and source credentials
are checked for absence from WebSocket bytes without retaining frames. Its
deterministic builder emits one HTML and one JavaScript file with no source map.
The page exposes a phased observation API rather than the runner's final
40-assertion API, so an independent fixture/operator adapter must still combine
browser facts with cloud-side evidence. Revision 3 implements serialized native
page lifecycle and typed call outcomes locally. Its separate bounded lifecycle
observation retains no raw event or credential and leaves the original safe
observation schema unchanged. The selected 720-second runner bound allocates
600 seconds to Chromium and 60 to each secondary engine, leaving 180 seconds
for callback cleanup and 300 for edge rollback within the unchanged ceilings.
Nothing in this package publishes Hosting, opens ingress or grants live browser
execution.
Its separate keyless CI job does load the dormant artifact with Chromium,
Firefox and WebKit while blocking every non-artifact request; this is offline
implementation evidence, not a live acceptance execution. A separately
allowlisted loopback harness first proves explicit terminal cleanup before
sequential identity replacement using offline Firebase/MiakAPI fakes. It then
proves trusted non-persisted native pagehide synchronous terminal fencing and
zero active sockets, with IndexedDB blocked while stopping or restored after
stopped, not completion of asynchronous
Firebase cleanup. Playwright 1.62.1 explicitly does not support
BFCache testing, so native persisted restoration remains unproven with state
`blocked_by_pinned_playwright`. The simulated trusted persisted unit test is
not native BFCache proof and cannot close the full scenario gate.
The adjacent [`browser-relay-fixture/`](browser-relay-fixture/) package now
implements the fixed application fixture lifecycle behind an exact injected
boundary. It refuses both creation and deletion unless all fixture domains were
first proved empty, so an existing namespace can never be mistaken for
disposable test data. After that proof, partial or ambiguous creation remains
recoverable. The controller confines the Firebase identity token and Home Key
to memory, configures the exact `acceptance.temperature` state, user ACL and
idempotent `acceptance.set` function, and issues fresh custom tokens only in the
reviewed Chromium/Firefox/WebKit order. Cleanup stops the coordinator before
data removal and must observe every fixed domain absent. The package has no
cloud transport, ambient credential lookup, CLI, retry loop or live authority;
no staging mutation was made.
The adjacent
[`browser-relay-fixture-cloud/`](browser-relay-fixture-cloud/) package now
implements that exact injected boundary against the reviewed staging Google,
Firebase and control-plane APIs. Construction remains inert and requires an
explicit ephemeral OAuth session, HTTP transport, clock and the two pinned
MiakAPI factories. It permits four keyless IAM JWT signatures, one identity,
one Home, one Home Key and one relay rotation only after observing the entire
fixed namespace absent. Cleanup requires zero coordinator sessions, validates
the complete ownership and key registries, atomically deletes their five
possible Firestore documents with `updateTime` preconditions, deletes the fixed
Firebase UID last and independently observes final absence. Unknown mutation
outcomes are observed without retry. The adapter has no command, ambient
credential discovery, binding mutation, publication path or live authority;
all its current evidence is offline and staging remains unchanged.
The adjacent
[`browser-relay-fixture-miakapi/`](browser-relay-fixture-miakapi/) package now
closes the remaining SDK-factory placeholder. Its 160,762-byte ESM bundle is
reproducibly built from the same exact MiakAPI commit as the browser page and
pins the source archive, package, lock file, Node entry point, generated bundle
and license. The wrapper allows one Home Key provider and one coordinator only,
requires the provider identity to match, and explicitly passes the injected
HTTP function into MiakAPI so the library's global fetch fallback is
unreachable. Constructing either factory makes no HTTP or WebSocket request and
does not start a coordinator. No credential, cloud mutation or live evidence
was added.
The adjacent [`browser-relay-aggregator/`](browser-relay-aggregator/) package
now closes the independent evidence-reduction boundary. Chromium must supply
eight source-specific receipts; Firefox and WebKit supply five each. All 40
runner assertions have one non-overlapping owner, and each counter or public
identifier is accepted only from its named browser, App Check, Hosting,
control-plane, relay, coordinator, KMS or Firestore source. The single-use
state machine rejects missing, repeated or out-of-order receipts, permanently
fails after invalid evidence and emits only the already reviewed engine result
schema. It has no observer adapters, credentials, CLI, cloud mutation or live
authority, so its current evidence remains entirely offline.
The adjacent
[`browser-relay-independent-observers/`](browser-relay-independent-observers/)
package now implements every remaining source-receipt producer. Seven
Chromium observers and four observers in each secondary engine accept 43 exact
ordered facts across App Check, Hosting, the control plane, relays, the
synthetic coordinator, KMS and Firestore. They accept no assertion maps and
retain no raw cloud response, document, log entry, private identifier or
credential. Together with the page producer, their 15 receipts exercise all
18 aggregator inputs and all 40 assertions offline. This package is still a
source-only library: it has no transport adapter, cloud request, browser
automation, mutation or live authority.
Only their closed runner-result producer is public; the 15 independent receipts
never escape before aggregation with the three page receipts. It checks
control-plane/KMS ledger parity, cross-browser revision lineage, digest-pinned
dependency contracts and browser start/receipt-close offsets on one structural
operation clock. Live wiring remains
blocked until one adapter binds every source to a non-replayable common
operation capability and authenticated monotonic epoch. It must also replace the current
whole-engine sequential runner with case-level interleaving so Firefox and
WebKit run after Chromium closes LIVE-09 but before version 1 retirement, as
the canonical plan requires. The former manifest-capacity blocker is closed:
the same revision-91 semantic object is now assembled from a small index and
four independently bounded, digest-pinned canonical fragments. Each fragment
must remain below its 96-KiB ceiling and the complete bundle below its 192-KiB
aggregate ceiling without sacrificing line-oriented review.
The adjacent
[`browser-relay-page-receipt/`](browser-relay-page-receipt/) package implements
the first exact source producer. It accepts no assertion map: Chromium must
provide 18 ordered, cumulative facts from the pinned page boundary, including
two scheduled renewal intervals, one-maximum-socket relay handoff, stable
failed/uncertain outcomes, persisted `pagehide`/`pageshow`, sign-out and a new
identity generation only after the old page stopped. Firefox and WebKit each
provide an exact start/stop triple. Revision 2 also carries the bounded host
lifecycle projection with every fact, uses its typed call outcomes and verifies
terminal sign-out/disposal without depending on a fenced asynchronous SDK
callback. The producer emits only the aggregator's `browser_page` receipt and
discards every fact on close or failure. The adjacent
[`browser-relay-playwright-bridge/`](browser-relay-playwright-bridge/) now owns
the page-to-receipt transport for Firefox and WebKit, including lazy private
input acquisition and page cleanup before receipt closure. Chromium returns a
distinct blocked result before page or private-input acquisition because pinned
Playwright 1.62.1 explicitly cannot test BFCache restoration; that result is
not an engine result and cannot satisfy the persisted lifecycle facts. Current
page revision 3 supplies the required 600-second Chromium budget and local
lifecycle/outcome APIs, but the complete Chromium scenario and all independent
live source adapters remain absent. These offline capabilities are not
acceptance evidence. The adjacent
[`browser-relay-scenario-fixture/`](browser-relay-scenario-fixture/) composes the
immutable three-input fixture with a second exact synthetic Firebase identity.
It provides the fourth Chromium input, extends the one coordinator's state
access to both identities, forbids calls from the replacement identity and
requires coordinator-first cleanup of both ownership domains. The original
fixture's three-input/one-identity limits remain explicit, while current
dependency pins and timing metadata follow page revision 3. The separate
[`browser-relay-scenario-fixture-cloud/`](browser-relay-scenario-fixture-cloud/)
now implements the replacement Google/Firebase transport behind an explicitly
injected ephemeral session and HTTP implementation. It bounds the lifecycle to
two distinct keyless signatures, binds the exchanged token to the exact
replacement identity through one account lookup, and requires independently
observed absence after cleanup without retrying uncertain mutations. This
closes only the second-identity cloud implementation gap: the complete Chromium
page scenario, a BFCache-capable automation path, independent live source
adapters and aggregator wiring remain open. All mutation, IAM, Hosting,
public-ingress and execution authority remains closed.
The adjacent [`browser-relay-operation/`](browser-relay-operation/) package now
closes the remaining ordering gap without executing it. The claimed edge owns
the control-plane transition. Inside that single window the operation creates
only synthetic fixtures, verifies the temporary runner, samples the existing
monitoring contract and makes both relays public only immediately before the
matrix. Its first unconditional cleanup removes the runner, stops sessions and
restores private relays. After the edge orchestrator has restored the canonical
private control plane, its second cleanup removes fixtures and temporary
bindings and requires the complete rollback target. The package has no CLI,
cloud adapter or authorization source, records zero live runs, and plan
revision 15 remains entirely pending. Its separate preflight source reduced
exactly one fresh read-only orchestrator observation from merged commit
`ae21e4922d3f70fffe9218cd975f180faca486f0` to a closed private and unclaimed
baseline. It made no mutation, public-ingress change or acceptance execution;
revision 14 pins its sanitized result while revision 13 remains byte-exact.
Revision 15 preserves revision 14 byte-for-byte and adds only the merged page
profile and offline CI proof to the pin chain.
The dormant
[`browser-relay-monitoring/`](browser-relay-monitoring/) package separately
pins the six permitted header-only Cloud Monitoring queries, the existing EUR
10 staging budget and every plan ceiling. Its read-only adapter first requires
the exact canonical-private control plane and two private-ready relays, and its
evaluator emits only stable stop-and-rollback reasons. It has no CLI, scheduler
or resource writer. One read-only preflight from the merged implementation
confirmed all six descriptors and queries, the EUR 10 budget shape and the
exact private boundary. Its closed result records zero cloud mutations, public
ingress changes and acceptance executions. Plan revision 11 pins that result
and closes `MONITORING-01`.
