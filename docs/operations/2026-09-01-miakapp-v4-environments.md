# Miakapp 4 environment and cost boundary

Date: 2026-09-01

Status: accepted direction; staging bootstrap and foundation complete, exact
keyless recovery workflow and WIF exchange retired on 2026-09-03, private
audience-bound workload source active and converged with internal-only ingress
and no request, one exact discovery response validated on its preceding
revision, and one real Firebase Auth plus Admin custom-provider App Check probe
succeeded there and retired on 2026-09-04

## Decision

The agent-centred rebuild is Miakapp 4. It is a breaking product and data-model
change, not an in-place feature release of Miakapp 3.

Miakapp 3 remains the legacy production and rollback target until a Miakapp 4
canary has passed its sustained acceptance window. Development, staging and
production do not share a Firebase project. Firebase recommends separate projects
for separate environments because applications inside one project share backend
resources and configuration.

The preferred project IDs, subject to global availability when they are created,
are:

| Environment | Project ID | Data | Purpose |
|---|---|---|---|
| Local | `demo-miakapp-v4` | synthetic only | Hermetic Emulator Suite and CI |
| Staging | `miakapp-v4-staging` | synthetic only | Existing billing-linked project with an Auth/App Check-validated, scale-to-zero private Function for real-service acceptance and migration rehearsal |
| Production | `miakapp-v4` | migrated production data | Canary, then final Miakapp 4 service |
| Legacy production | `miakapp-3` | existing production data | Unchanged service and rollback oracle during migration |

The `miakapp-v4-staging` Firebase project was created manually on 2026-09-02;
`miakapp-v4` does not exist. Paris (`europe-west9`) is the reviewed immutable
regional location, and the owner selected an existing EUR billing account whose
identifier is represented publicly only by a SHA-256 fingerprint. The account
was linked on 2026-09-03. The exact private foundation recovery ran through
protected staging automation, then its active workflow and apply authorization
were retired. Both recovery WIF providers are disabled, while their pool is
retained. The local package rejects execution outside the exact
`demo-*` namespace, and the root Firebase default remains the legacy project.

References:

- [Firebase environments](https://firebase.google.com/docs/projects/dev-workflows/overview-environments)
- [Firebase project best practices](https://firebase.google.com/docs/projects/dev-workflows/general-best-practices)
- [Firebase demo projects and Emulator Suite isolation](https://firebase.google.com/docs/emulator-suite/install_and_configure#project_id_configuration)

## Deployment invariants

1. Local and pull-request checks use only `demo-miakapp-v4`. An unavailable
   emulator must fail closed instead of falling through to a live service.
2. Staging and production have separate Firebase app registrations, API keys,
   service accounts, IAM, secrets, signing keys, App Check registrations,
   Storage buckets, Firestore databases, rules and indexes.
3. Automation names the destination project explicitly. It must not deploy using
   a mutable `default` alias.
4. No staging command may accept `miakapp-3` or `miakapp-v4` as its destination.
   No production command may accept `miakapp-3` before the approved cutover.
5. Staging starts with synthetic data. A production-derived rehearsal dataset
   requires a documented minimization/anonymization review.
6. A public endpoint is not opened until source attribution, ingress restriction,
   bounded admission and alerts have passed the staging gate.
7. Staging begins with scale-to-zero and the smallest useful `maxInstances`.
   Minimum instances and broader scaling require measured latency or load evidence.
8. Budget alerts are alarms, not hard caps. Service quotas, application admission,
   instance ceilings and a rehearsed shutdown procedure remain necessary.

Firebase documents that a `demo-*` project has no live resources, while use of a
real project ID can reach any product that is not being emulated. Firebase also
warns that a staging application must not use production project credentials.

- [Multiple Firebase projects](https://firebase.google.com/docs/projects/multiprojects)
- [Environment-specific Firebase API keys](https://firebase.google.com/docs/projects/api-keys)
- [Avoiding surprise bills](https://firebase.google.com/docs/projects/billing/avoid-surprise-bills)

## Cost posture

Local control-plane tests and credential-free validation add no Firebase usage.
A live plan adds bounded API reads, a temporary lock, and a small private object.
The staging project now has the approved billing link, alert budget, bootstrap
resources, thirteen foundation APIs, a deletion-protected Firestore database
with active TTL fields, one software KMS signing-key version, one Firebase Web
app and five Secret Manager containers with one enabled version each. One Gen 2
Function and its backing Cloud Run service are active with internal-only
ingress, no unauthenticated invoker and no minimum instance. The unscheduled
private Workflow made two controlled failing requests and one successful exact
discovery request, all without retry or application mutation. No App Engine
application or public ingress exists. Firebase also reserved a Hosting site
namespace, but no application was deployed to it.

For a low-volume staging project, the intended initial posture is:

- Paris regional resources; Paris and Belgium use Cloud Run Tier 1 pricing,
  while Zurich uses the more expensive Tier 2;
- no minimum Function instances;
- `maxInstances: 1` until concurrency and cost tests justify more;
- the Firestore free database only, with bounded fixed-slot admission and audit;
- no recurring managed export and no retained test data beyond its stated TTL;
- software Cloud KMS keys and the minimum Secret Manager versions required by the
  deployed profile;
- billing alerts at low operator-selected thresholds, including early warning at
  approximately EUR 2, EUR 5 and EUR 10; and
- no silently enabled fixed-price edge product. The ingress design and its full
  load-balancer/edge-policy baseline must be priced and accepted explicitly.

The Function deployment, four bounded source updates and one runtime-only
migration incurred build, source and Artifact Registry storage; the current
workload state is 49,563 bytes. The historical discovery Workflow made exactly
three bounded requests and has a 13,596-byte state. The Function remains
scale-to-zero with no recurring minimum-instance charge. The original discovery
Workflow remains deployed but unscheduled; the temporary Auth/App Check and
user-relay probe Workflows are retired. No Workflow has idle compute.

The private Terraform bucket stores small state objects and short-lived saved
plans. Object Versioning and
seven-day soft delete deliberately retain recovery bytes longer than the
two-day live-plan window, so the cost is
usage-metered rather than literally zero after activation. The planner/deployer,
Workload Identity Federation, and GitHub OIDC exchanges have no always-on
compute instance. These bootstrap resources now exist. The recovery workflow is
absent, GitHub workflow `349440747` was observed as `deleted` after its source
was removed from `main`, both activation modes fail closed, and both provider
resources are disabled. The reviewed
GitHub OIDC route therefore cannot request either cloud identity. The service
accounts and IAM grants remain, and this evidence does not disprove
impersonation by another administrator.

At personal-home traffic, the usage-metered services are expected to remain near
their free tiers or cost cents, but that is an estimate rather than a guarantee.
Cloud Firestore provides one free database per project with daily read/write/delete
quotas; Functions scale-to-zero usage also has a free allowance. TTL deletion,
managed exports, internet egress, abuse and fixed-price networking can still
produce charges. Cloud Armor or a load balancer can dominate an otherwise tiny
monthly bill, so it is a staging decision rather than an implicit dependency.

Before production, staging records actual operations per request, stored bytes,
egress, build minutes, signing operations and worst-case admitted traffic. The
measured result replaces every planning estimate.

- [Firestore pricing and free quota](https://firebase.google.com/docs/firestore/pricing)
- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Cloud KMS pricing](https://cloud.google.com/kms/pricing)
- [Secret Manager pricing](https://cloud.google.com/secret-manager/pricing)
- [Cloud Armor pricing](https://cloud.google.com/armor/pricing)
- [Cloud Run regional price tiers](https://cloud.google.com/run/pricing#regional-price-tiers)

## Migration is a transformation

The move is manageable at the current scale, but it is not a blind Firestore copy.
Miakapp 4 removes platform-owned relations, groups, pages, invitations and
coordinator secrets. The migration therefore exports a versioned legacy snapshot,
transforms only the retained concepts, validates the result against the new closed
schemas, and imports into an empty staging destination first.

The rehearsal covers all of these independent boundaries:

- **Firestore:** deploy indexes first; stop both client and Admin writes for the
  final consistent export; validate counts, identifiers and domain invariants;
- **Authentication:** preserve UIDs, provider links, custom claims and password
  hash parameters where supported; require reauthentication after project
  cutover because legacy ID tokens belong to the old project;
- **FCM:** registrations are project-bound, so every client must register its FID
  in Miakapp 4 rather than copying a legacy destination;
- **Storage:** copy only retained objects and verify bytes, content type, cache
  metadata and digest markers; recreate IAM, CORS, lifecycle and retention policy;
- **platform configuration:** recreate OAuth providers, authorized domains,
  email templates, App Check, KMS, Secret Manager, IAM and monitoring; and
- **routing:** rehearse custom-domain and application configuration cutover while
  keeping `miakapp-3` available as the rollback target.

Managed Firestore export/import requires billing on both projects, charges one
read per exported document and one write per imported document, does not trigger
Functions, and may leave a partial destination after cancellation. Authentication
and FCM consequently need their own rehearsal rather than being inferred from a
successful Firestore import.

- [Move Firestore data between projects](https://firebase.google.com/docs/firestore/manage-data/move-data)
- [Firestore export/import behavior and billing](https://firebase.google.com/docs/firestore/manage-data/export-import)
- [Import Firebase Authentication users](https://firebase.google.com/docs/auth/admin/import-users)
- [FCM project credential matching](https://firebase.google.com/docs/cloud-messaging/error-codes)

## Staging activation gate

The local fault matrix and reviewable staging manifest preceded the one-shot
creation of `miakapp-v4-staging`. The 2026-09-02 bootstrap claimed the permanent
project ID and enabled Firebase without selecting an immutable resource
location. A separately authorized operation linked the approved billing account
on 2026-09-03. Its sanitized inventory now lives under
[`../../infrastructure/staging/`](../../infrastructure/staging/).

The location and billing-account selection are reviewed inputs. Separate
apply-capable Terraform roots now describe (1) the circular bootstrap for
billing, budget, both buckets, runtime/project IAM and keyless plan/apply
identities and (2) the regional foundation for APIs, Firestore, KMS, empty
secret containers and resource-scoped IAM. Keeping project IAM,
service-account creation and bucket creation in the human bootstrap prevents
the apply identity from escalating into the bootstrap state. Credential-free
checks use mock providers.

The bootstrap root intentionally starts with the implicit local backend because
its GCS bucket cannot back the transaction that creates it. A reviewed inactive
backend template defines the immediate migration target. The foundation already
uses the private GCS backend and refuses to proceed unless the remote bootstrap
output matches every exact project, region, identity and repository value.

A GitHub policy record and retained hash-bound blueprint document separate numeric-claim WIF
providers and service accounts, protected plan/apply environments, SHA-pinned
selected actions, and private create-only saved-plan storage. On 2026-09-03, the
repository's actual `main`/environment/Actions settings were configured and
independently re-observed against that policy. The existing `miakapi`
environment and default repository OIDC subject were left unchanged. The
one-shot workflow evolved through protected merges from plan-only inspection to
the initial apply and exact partial recovery. Each active revision verified its
file, blueprint and SHA-256 before requesting either short-lived OIDC identity.
After convergence, the active file was removed and all three activation flags
were set to false. GitHub workflow `349440747` was independently observed in
state `disabled_manually` before source removal.

The first private saved plan was superseded after Cloud Billing rejected a
redundant billing-association write before Terraform recorded resources. The
next plan, from commit `6340bffbddcc4797067ef48170fc5c3524345bf2` with SHA-256
`6fb0b0c15fa04338a40ab59de790c3a4a85f96b418377c4a70570a8dabd5d457`,
used an import and was separately authorized. It recorded the billing link and
all eight bootstrap APIs before budget creation failed because User ADC lacked a
quota project. Terraform preserved a private local state at serial 11 with nine
managed resources; no state bucket existed, so migration could not start.
Independent inventory found the target budget, buckets, service accounts and
Workload Identity pool absent. The digest is superseded and must not be retried.

The Terraform `google` and `google-beta` provider configurations now attribute
API quota to `miakapp-v4-staging`. The final plan was created from commit
`e9f410c58c8cbbf8f5f7a17170c9e8ed55a10501`, fully
reviewed, and bound by SHA-256
`12927b270f2bfa78c8f8c8c7e7071ce9cfec18d5e848165c04b585260bd5f7da`.
Its authorized execution completed all 27 creations on top of the nine recovered
no-op resources. Terraform preserved an exact 36-resource state at serial 39
with SHA-256
`c083e7a05f2ccf273abda98c0739584336d2cbaffd8ea836b65b0790f94833a2`.
The original wrapper then rejected Terraform's real output representation before
backend migration. A migration-only wrapper later created and reconciled remote
bootstrap state generation `1788439334043522` at serial 40 without applying
infrastructure. The protected serial-39 source remains independent recovery
evidence. A guarded initializer bound to reviewed commit
`626dc16637ba843f6d1543156aba99e7b551e705` models the initialization behavior
that produced foundation state generation `1788443136082489` at serial 1 during
`terraform init`. Its original plan-shape guard then
rejected Terraform's deterministic implicit provider metadata before any apply.
Independent reads have verified that the state is canonical and empty and that
the inspection-only plan contains no resource action. Clean execution commit
`ab6f26bd5dd076a79847f989615e7fddf93f2a07` then reconciled the same generation
without planning or mutation. A subsequent non-saving live plan from commit
`363d017ebdc85af1285e38c5742365fd0a2a4395` was fully reviewed: `33 to add, 0
to change, 0 to destroy`, with no workload, public ingress, secret version, or
state change. Protected run `33776569977` subsequently validated and attempted that exact
33-create plan after normal environment approval. Terraform persisted 25
managed resources before the command failed. Because the private detailed log
was discarded as designed, no precise failure cause is claimed. Independent
reads verified all APIs, Firestore and its three active TTL fields, the KMS key
and enabled initial version, and five secret containers with zero versions. The
one KMS, five secret and two component-bucket runtime IAM bindings were absent.

Partial foundation state generation `1788452068422403` was healthy at serial 4
with 25 managed and two data resources. A fresh private plan from the unchanged
Terraform configuration reports exactly eight creates, 25 no-ops, no update or
delete, and seven bounded refresh-only provider normalizations. It passed the
closed `partial-foundation-recovery` profile and was removed after review.

Protected run `33784785967` subsequently applied an independently reviewed plan
with the exact eight IAM creates. Terraform wrote current foundation generation
`1788456706865449` at serial 6 with 33 managed resources. The overall workflow
failed only when its final convergence plan used the intentionally narrower
deployer identity; a separate User-ADC plan then reported all 33 resources as
no-ops and zero changes. At that pre-activation boundary, live inventory
confirmed the exact eight IAM members, three active TTL fields, five secret
containers with no versions, enabled software Ed25519 key version 1, no
workload and no lock. The consumed private plan generation was deleted under
the bucket's soft-delete policy.

The already-live planner Service Usage Consumer member was also adopted into
bootstrap state through a one-import/no-change Terraform plan. Project IAM etag
and canonical policy digest remained unchanged, no `SetIamPolicy` audit entry
appeared, and a fresh full plan reported no changes. That historical bootstrap
generation `1788457646215552` at serial 41 had 37 managed resources and is
retained as the planner-role adoption record.

PR #30 configuration commit
`ee457535a64355cd8133410d9c8c43f039608928` then produced an exact private
25,925-byte WIF-retirement plan with SHA-256
`8f570dfe5450b704112d484f058fc6dfcd39069a92c8bb483c5029027183e888`.
Its only changes among 35 no-ops were the plan/apply provider `disabled`
attributes moving from `false` to `true`. Apply reported `0 added, 2 changed, 0
destroyed`; the pool stayed enabled and retained, and the follow-up plan
reported no changes. Current bootstrap state generation `1788460174191027` is
61,864 bytes at serial 42 with 37 managed resources, two data resources and one
output. Its SHA-256 is
`288d947d35f5d5a278aaff210ea878a9dab817f594b4c3161ed117bb2e30e26d`.
Project and service-account IAM normalized hashes were unchanged: the recovery
service accounts and roles remain, so other administrator impersonation is not
disproved even though the reviewed GitHub exchange is closed.

Guarded activation from merge commit
`101e4231d452423bafa2ae1efd051e51faeff3c8` subsequently registered exactly one
Firebase Web app and one enabled initial version in each of the five secret
containers. Its exact plan replay reconciled without another write; independent
inventory found no workload or ingress, and the private seed was deleted. The
committed non-secret result and runtime document are digest-pinned in
[`../../infrastructure/staging/activation/`](../../infrastructure/staging/activation/).

The private workload packages only the production module graph and deploys a
scale-to-zero, internal-only Function plus a one-permission FCM role. Its first
build stopped because the custom build identity lacked access to Google's copied
source object. A bounded recovery added an object-prefix-conditioned reader,
created the private probe invoker, updated the Function in place and deleted
nothing. An output-only reconciliation and a fresh full plan both changed no
resource. After two bounded source corrections, independent inventory verified
revision `control-plane-00003-hum`, its exact copied source bytes, private IAM,
all three workload identities with zero user-managed keys, and no
deployment-time request.

The separate unscheduled private probe against that revision then recorded two bounded `503` failures
followed by one no-retry HTTP 200 response from the exact discovery route.
Serving that route proves the production initialization path loaded all five
secret values and validated the KMS public key without an application mutation.
Its sanitized result is digest-pinned under
[`../../infrastructure/staging/probe/`](../../infrastructure/staging/probe/)
without execution or trace identifiers.

The project-level Firebase Authentication configuration is now initialized as a
non-deletable closed baseline with no end-user sign-in provider. The provider's
non-atomic create was recovered by exact state adoption and reconciled to zero
change; independent live inspection found no default-supported, OIDC or
inbound-SAML provider.

The independent Auth/App Check root then armed one bounded, unscheduled Workflow
with temporary least-privilege IAM. Its sole successful execution created one
fixed no-email synthetic user through a custom token, proved that missing App
Check returns `401 invalid_app_check_token`, and received HTTP 200 twice with a
real Admin custom-provider App Check token. This validates the explicit V1
reusable-token policy without claiming browser attestation. The user was deleted
and independently verified absent, and the Workflow and both temporary IAM
bindings were retired. Digest-pinned public summaries contain no execution ID,
token, header, trace or raw diagnostic. The separate browser-provider
attestation gate remains open.

After those historical probes, a third source-only update deployed the
audience-bound user-relay credential exchange as revision
`control-plane-00004-yis`. Its saved plan changed only the deterministic source
object, Function and deployment guard. It converged to zero changes, and
independent inventory verified the copied bytes, internal-only ingress, scale
0..1, zero public invokers and zero user-managed keys without making a request.
The separate bounded user-relay probe subsequently executed once against that
exact revision. It proved invalid-Firebase, missing-App-Check and missing-Home
failures, verified two signed credentials across an authoritative relay
rotation, removed both synthetic fixtures, and retired its Workflow, verifier
and temporary bindings. Its sanitized evidence is digest-pinned under
[`../../infrastructure/staging/auth-probe/`](../../infrastructure/staging/auth-probe/).

A fourth guarded source-only update deployed merge commit
`9f217da102b394734adba7ccef3f8f70d0317306` as revision
`control-plane-00005-biq`. The deployed source added closed schema-2 support for
one selected KMS signer and at most two KMS-validated published keys while the
live runtime remained on schema 1. Its saved plan changed only the deterministic
source object, Function and deployment guard.

A separate plan with SHA-256
`f9531f2ccde649b9f4b27d63b9c2228812d7deb5101515d1572d81851ad30560`
then migrated that same single-key document to schema 2 on revision
`control-plane-00006-wid`. It performed exactly two in-place updates, no source
replacement and no IAM, ingress or scale change. Independent inventory made no
request and reconfirmed the copied bytes, internal-only ingress, scale 0..1,
zero public invokers and zero user-managed keys. A subsequent exact plan
prepublished versions 1 and 2 with version 1 current on revision
`control-plane-00007-deb`. It again changed only the Function and deployment
guard in place, preserved the source, and made no request. The current sanitized
deployment result is digest-pinned under
[`../../infrastructure/staging/workload/`](../../infrastructure/staging/workload/).

A later exact two-update plan changed only `current_kid` and the deployment
guard, selected version 2 while retaining version 1, and converged to
`control-plane-00008-saz` at that then-current boundary. It preserved
the source, build, IAM,
internal-only ingress and scale 0..1 and made no Function request. Retiring
version 1 remains a separately guarded operation after the complete lease
bound.

A subsequent exact two-update rehearsal-entry plan reselected version 1 while
retaining version 2 and converged to current revision
`control-plane-00009-kur`. It preserved the same source, build, IAM,
internal-only ingress and scale 0..1 and made no Function request. Its consumed
one-shot tooling is retired.

A later one-shot system-browser operation closed the standalone Web App Check
provider prerequisite. The default macOS browser obtained one fresh
reCAPTCHA Enterprise-backed token from the exact staging Hosting origin. Token
bytes and claims never left the page; Hosting was disabled and deleted after an
8,749 ms public window, and the runner now returns HTTP 404. Enforcement remains
disabled and all execution plus recovery entrypoints are retired.

The browser-relay plan was then rebased by an independent read-only observation
at `2026-09-05T19:04:24.200Z`. It reconfirmed private
`control-plane-00009-kur`, zero unauthenticated invokers, zero relay services,
zero Firebase Auth users, zero application fixture collections, two enabled and
published signing versions with version 1 current for the rehearsal, the registered provider and
completed browser attestation, and a disabled Hosting runner returning HTTP
404. The remaining Firestore documents are confined to the three expected
bounded admission/audit collections. This observation granted no deployment or
public-ingress authority.

The pinned local relay-authentication path now includes signing-key overlap,
key-changing `REAUTH`, concurrent cache refresh, expiry, unknown-`kid` abuse,
JWKS outage and bounded recovery. A separate pinned local gate now exercises the
public browser client in real Chromium through snapshot, patch, call/result and
completed post-lease reauthentication on one WebSocket. The complete
audience-bound local gate additionally carries Auth-emulator and signed synthetic
App Check sources through the real exchange, verifies the exact user token at the
relay, and performs a no-overlap authoritative handoff across two relays. The
complete disconnect matrix, live KMS and Firebase behavior, staging quotas and
alerts, managed retiring-key removal and teardown evidence remain blockers.
Public ingress remains absent.

The user-relay probe retirement driver also closes both zero-temporary crash
windows. If all six temporaries are already absent live and in Terraform state,
a separate short-lived authorization binds explicit finalization to the exact
inventory, operator and reviewed commit. Recovery then disables any remaining
GA roles or, for an already retired graph, skips apply and regenerates sanitized
retirement evidence after fixture and convergence checks. The normal validator
admits a zero-delete plan only as a race fallback and only with one to three exact
role-disable updates; it never accepts an all-no-op delta.

Passing the manifest check is evidence, not additional authorization.

Create or attach `miakapp-v4` only after the staging migration rehearsal produces:

1. a deterministic transformation report;
2. data, Auth and object reconciliation counts;
3. measured elapsed time and cloud cost;
4. a successful timed restore or rollback rehearsal;
5. a one-home canary plan with explicit abort criteria; and
6. evidence that no staging credential, FID, key or endpoint is present in the
   production configuration.

Until that gate passes, `miakapp-3` is intentionally untouched.
