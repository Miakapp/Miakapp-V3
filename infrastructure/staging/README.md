# Miakapp 4 staging private workload boundary

Status: audience-bound source active and source-verified; Auth/App Check validated
on the preceding revision; bounded user-relay acceptance pending

This directory contains the closed description and observed state of
`miakapp-v4-staging`. The bounded foundation recovery has completed; its active
workflow and reviewed GitHub OIDC exchange are retired. The separate private
workload and both unscheduled private probes were applied and converged. One
bounded discovery request succeeded after two controlled failures. A later
single-execution probe validated real Firebase Auth and Admin custom-provider
App Check enforcement, deleted its synthetic user, and retired all temporary
capability. The current source-only revision has not received a request. This
evidence does not authorize public ingress, additional live requests, destroy,
or production changes.

## Current truth

Project `miakapp-v4-staging` (`1072737219170`) now has one active Gen 2 Function
backed by one Cloud Run service. It still has no App Engine application, public
ingress, unauthenticated invoker or minimum instance. All bounded requests in
the committed evidence targeted the preceding revision through unscheduled
private Workflows. The bootstrap is complete.
Protected foundation applies
on 2026-09-03 created all thirteen declared APIs, the deletion-protected Paris
Firestore database and three active TTL fields, one software Ed25519 signing
key, and five Secret Manager containers. The eight KMS, Secret Manager and
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
scaling or runtime document. Current merge commit
`022f10e2dc15f32a8a6679b38ce7f1a04582e450` produced source SHA-256
`6674c0353ec9c73fcfe0d3a63d17850f057a5f2a547a5855989e28f011249b1e`
and active revision `control-plane-00004-yis`. Current workload state generation
`1788557027934706` is 49,283 bytes at serial 14 with fifteen managed resources,
three data resources, one output and nothing tainted. The current canonical
[`workload/result.json`](workload/result.json) has SHA-256
`cfdb18b9dd6604cd92977cbd447dd0684f4b731ca84d2f7aa3f772cbd3bc3056`.
The latest source contains the audience-bound user-relay credential exchange;
its separate bounded acceptance probe has not run yet. The discovery and Auth/
App Check evidence below remains pinned to historical revision
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

Firebase Authentication is now initialized in its closed, non-deletable
configuration with every end-user provider disabled. The separately armed Auth
probe exchanged a signed custom token for a real Firebase ID token, proved the
fixed no-email synthetic UID, and sent three requests through internal ingress.
The missing-App-Check control returned `401 invalid_app_check_token`; the two
requests carrying a real Admin custom-provider App Check token both returned an
empty list with HTTP 200, proving the explicit reusable-token policy. The UID
was deleted and independently verified absent. The Workflow and both temporary
IAM bindings were then removed; the custom role remains dormant and unassigned.
The digest-pinned [`auth-probe/result.json`](auth-probe/result.json) and
[`auth-probe/retirement.json`](auth-probe/retirement.json) contain no execution
identifier, token material or raw diagnostic. Browser-provider attestation is
not claimed by this evidence.

The same independent `auth-probe` state root is now prepared for the bounded
audience-bound user-relay acceptance run. Its reviewed arm plan may create one
internal-only scale-to-zero verifier service, one unscheduled Workflow and four
hard-expiring IAM bindings, while retaining three disabled custom roles and a
keyless no-role verifier identity after retirement. It also enables and retains
the Cloud Asset API for supplemental project-wide IAM discovery; because that
inventory is eventually consistent, it is not used to authorize role
restoration. The Workflow
uses one fixed
no-email user and one private marker-guarded `controlHomes` document, performs
exactly seven Function requests (two metadata `GET`s and five exchange `POST`s),
verifies two Ed25519 credentials internally, then independently cleans the
private fixture and user and checks that the lowercase public `homes` path stayed
absent. This graph has not yet
been applied or invoked; [`auth-probe/README.md`](auth-probe/README.md) is the
authoritative lifecycle and cost boundary. Retirement removes the service and
Workflow, removes the temporary bindings, and disables all three roles; the Cloud Asset API, roles and verifier
identity remain as inert persistent infrastructure until a separately reviewed
teardown.

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
retirement evidence after exact fixture cleanup and convergence checks.

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
| [`auth-probe/`](auth-probe/) | Historical Auth/App Check evidence plus a guarded audience-bound user-relay Workflow and internal verifier | Historical probe retired; new bounded graph reviewed locally but not yet applied or invoked |
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
complete foundation state, the 49,283-byte workload state, the 13,596-byte probe
state, the 11,010-byte Firebase Auth state, the 16,821-byte Auth-probe state, and
recovery generations across all six Terraform prefixes. The live Firestore database is the project's
free-tier database; the five secret containers now each have one enabled
version. Secret Manager versions, the software KMS key version, Storage and
Artifact Registry bytes, build operations, and retained object versions remain
usage-metered. The deployed Function remains scale-to-zero, its deployment
inventory made no request, and no probe Workflow or verifier is currently
active. If armed, the user-relay verifier remains scale 0..1 and the Workflow is
unscheduled; both are retired immediately after one bounded execution.
Budget alerts at EUR 2, EUR 5, and EUR 10 are alarms rather than hard caps.

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

The gate validates bounded closed manifests, all reviewed inventories,
the retired recovery policy and historical blueprint, pinned actions and providers,
exact locks for macOS
ARM64 and Linux AMD64, all six Terraform roots with mock providers, script syntax,
private-plan handling, the exact recovery addresses, actions, planned values,
partial prior state, critical expression references and checks, the
complete simulated migration-only recovery state
machine, the simulated guarded foundation-state initializer, and hostile
environment inputs. It initializes Terraform with `-backend=false` and never
reads credentials or contacts staging.

The active validation workflow has only `contents: read`; it has no OIDC or
secret permission. With both recovery providers disabled, the reviewed GitHub
OIDC route cannot exchange credentials for the planner or deployer identity.
No persistent credential or repository secret is used.

## Next staging gate

Bootstrap, foundation, initial activation, private deployment, discovery, and
the synthetic Firebase Auth/App Check gate are complete. Firebase Authentication
is initialized under [`firebase-auth/`](firebase-auth/) with its exact closed
configuration and no end-user provider. The one-shot sequence under
[`auth-probe/`](auth-probe/) proved the real Firebase ID-token and Admin
custom-provider App Check path, the V1 reusable-token policy, and complete
synthetic-user cleanup. Its Workflow and temporary permissions are absent.

Browser App Check live-provider attestation remains a distinct blocker because
an Admin custom-provider token does not exercise browser attestation. Relay
token-refresh integration, trusted-source/edge admission, the managed-service
fault matrix, monitoring and billing-alert validation, secret and signing-key
rotation, migration rehearsal, and every broader `STAGE-*` observation remain
open blockers.
