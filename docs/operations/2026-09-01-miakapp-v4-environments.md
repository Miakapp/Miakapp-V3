# Miakapp 4 environment and cost boundary

Date: 2026-09-01

Status: accepted direction; staging bootstrap resources and reconciled remote
state created on 2026-09-03; project remains application-undeployed

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
| Staging | `miakapp-v4-staging` | synthetic only | Existing billing-linked, undeployed project for real-service acceptance, load calibration and migration rehearsal |
| Production | `miakapp-v4` | migrated production data | Canary, then final Miakapp 4 service |
| Legacy production | `miakapp-3` | existing production data | Unchanged service and rollback oracle during migration |

The `miakapp-v4-staging` Firebase project was created manually on 2026-09-02;
`miakapp-v4` does not exist. Paris (`europe-west9`) is the reviewed immutable
regional location, and the owner selected an existing EUR billing account whose
identifier is represented publicly only by a SHA-256 fingerprint. The account
was linked on 2026-09-03. The repository workflow still creates or deploys
neither environment. The local package rejects execution outside the exact
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

The merged local control-plane work, Terraform source, dormant cloud workflow
blueprint, and active credential-free validation add **no Firebase usage and no
cloud cost**. The billing association enables future metered services but does
not itself create one.
It runs against local Auth, Firestore, Functions and Storage emulators and cannot
load as a production Function. The staging project currently has the approved
billing link, alert budget, all eight Terraform bootstrap APIs, two private
buckets, three bootstrap service accounts, and Workload Identity Federation. No
registered Firebase app, App Engine application, database, Function, Cloud Run
service, or deployed workload exists. Firebase also reserved a Hosting site
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

The private Terraform bucket will store small state objects and short-lived
saved plans after the pending migration. Object Versioning and seven-day soft delete deliberately retain
recovery bytes longer than the two-day live-plan window, so the cost is
usage-metered rather than literally zero after activation. The planner/deployer,
Workload Identity Federation, and GitHub OIDC exchanges have no always-on
compute instance. These bootstrap resources now exist, but no active workflow
uses them.

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

A GitHub policy record and dormant workflow blueprint define separate numeric-
claim WIF providers and service accounts, protected plan/apply environments,
SHA-pinned selected actions, a private create-only saved plan and same-run digest
verification. On 2026-09-02, the repository's actual
`main`/environment/Actions settings were configured and independently
re-observed against that policy. The existing `miakapi` environment and default
repository OIDC subject were left unchanged. The workflow remains outside
`.github/workflows`, and its policy job rejects the current cloud-inactive
record. The WIF identities, buckets, and reconciled remote bootstrap state now
exist, but no foundation state object or active workflow exists.

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

The providers now attribute API quota to `miakapp-v4-staging`. The final plan
was created from commit `e9f410c58c8cbbf8f5f7a17170c9e8ed55a10501`, fully
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
`052f6c92d76f93ec222ffd03e4d34ba7a927495b` now describes the next mutation:
create and verify only an empty serial-1 foundation state with protected
credentials. Only after its separate exact authorization may the
operator authorize and install the workflow and review a foundation plan. The
production Function entry point,
exact FCM permission, quotas, alerts and teardown evidence remain blockers.
Deployment, public ingress and active CI authentication remain disabled. Passing
the manifest check is evidence, not authorization.

Create or attach `miakapp-v4` only after the staging migration rehearsal produces:

1. a deterministic transformation report;
2. data, Auth and object reconciliation counts;
3. measured elapsed time and cloud cost;
4. a successful timed restore or rollback rehearsal;
5. a one-home canary plan with explicit abort criteria; and
6. evidence that no staging credential, FID, key or endpoint is present in the
   production configuration.

Until that gate passes, `miakapp-3` is intentionally untouched.
