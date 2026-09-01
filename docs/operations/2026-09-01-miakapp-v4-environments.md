# Miakapp 4 environment and cost boundary

Date: 2026-09-01

Status: accepted direction; no cloud project or resource is created by this
document

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
| Staging | `miakapp-v4-staging` | synthetic or explicitly anonymized | Real-service acceptance, load calibration and migration rehearsal |
| Production | `miakapp-v4` | migrated production data | Canary, then final Miakapp 4 service |
| Legacy production | `miakapp-3` | existing production data | Unchanged service and rollback oracle during migration |

The repository currently creates or deploys none of the two Miakapp 4 cloud
projects. The local package rejects execution outside the exact `demo-*`
namespace, and the root Firebase default remains the legacy project.

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

The merged local control-plane work adds **no Firebase usage and no cloud cost**.
It runs against local Auth, Firestore, Functions and Storage emulators and cannot
load as a production Function.

For a low-volume staging project, the intended initial posture is:

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

## Creation gate

Create `miakapp-v4-staging` only after the local fault matrix is green and a
reviewable staging manifest defines services, regions, IAM, secrets, quotas,
alerts and teardown. That planning-only manifest and its credential-free safety
gate now live under [`../../infrastructure/staging/`](../../infrastructure/staging/).
They explicitly keep project creation, billing, deployment, public ingress and CI
authentication disabled. Passing the manifest check is review evidence, not
authorization to perform a cloud action. Merely reserving an empty project ID is
harmless, but no repository workflow depends on the project existing yet.

Create or attach `miakapp-v4` only after the staging migration rehearsal produces:

1. a deterministic transformation report;
2. data, Auth and object reconciliation counts;
3. measured elapsed time and cloud cost;
4. a successful timed restore or rollback rehearsal;
5. a one-home canary plan with explicit abort criteria; and
6. evidence that no staging credential, FID, key or endpoint is present in the
   production configuration.

Until that gate passes, `miakapp-3` is intentionally untouched.
