# Staging Terraform foundation

Status: foundation complete; recovery workflow and WIF exchange retired

This root describes the ordinary protected foundation for the existing,
billing-linked but undeployed `miakapp-v4-staging` project. Billing management,
budgets, both Storage buckets,
the runtime service account and its project IAM, remote-state storage, Workload
Identity Federation, and CI identities belong to
[`../bootstrap/`](../bootstrap/), not this root.

The foundation contains:

- the exact APIs required by the eventual staging control plane;
- the Standard default Firestore database with deletion protection and three
  TTL fields;
- the existing private Paris component bucket and runtime service account,
  both verified through the bootstrap state;
- one software Ed25519 KMS signing key without automatic rotation;
- five Secret Manager containers, never payload-version resources; and
- additive resource IAM members for create/read-only component objects, the
  signing key and the declared secrets.

This Terraform root contains no Function, Cloud Run service, public ingress,
Firebase app, relay, App Engine application, load balancer, VPC connector, NAT,
Cloud Armor policy, secret value, service-account key, or billing resource. The
guarded non-Terraform activation boundary has since registered one Firebase Web
app and added one enabled version to each container; it did not change this
foundation state.

## Bootstrap-state guard

The root uses the private GCS backend
`gs://miakapp-v4-staging-tfstate-1072737219170` at
`terraform/foundation`. It reads the bootstrap root's non-secret activation
output from `terraform/bootstrap`.

Before any foundation resource can proceed, a closed precondition compares the
remote output with the exact project ID and number, Paris region, state bucket
and prefixes, plan/apply providers, all three service accounts, component
bucket, and numeric GitHub repository IDs. Missing, local, stale, or foreign
bootstrap state fails closed. The bootstrap state is present remotely at serial
42 with 37 managed resources. Its original serial-40 migration was reconciled
against the protected serial-39 source state; generation `1788457646215552` at
serial 41 records adoption of the already-live planner quota member without an
IAM write. The serial-42 state records only disabling both recovery WIF
providers. Terraform's
GCS backend initially created empty foundation state at serial 1. Protected run
`33776569977` later persisted 25 managed resources. Recovery run `33784785967`
completed the remaining eight IAM members. Current generation
`1788456706865449` is healthy at serial 6 with all 33 managed resources; the
bootstrap guard, APIs, Firestore, TTL fields, KMS key material, five empty secret
containers and their exact resource IAM are present.

## Credential-free validation

From the repository root:

```sh
npm run test:staging-manifest
```

The gate pins Terraform 1.11.3 and Google providers 8.1.0, verifies lock hashes
for macOS ARM64 and Linux AMD64, initializes with `-backend=false`, validates the
HCL, and exercises the bootstrap guard through mock providers. It reads no
Google credential and calls no Google Cloud API. Terraform may contact the
provider registry to download or verify the pinned provider binaries.

## Historical guarded initial state

[`initialize-state.sh`](initialize-state.sh) created only the initial empty
foundation state. The section below is retained as historical audit evidence,
not as an active procedure. Do not run this command: the current non-empty,
complete foundation state makes the script fail closed. The historical path
required User ADC, a clean checkout, a private operator-owned directory outside
the repository, the exact reconciled bootstrap generation, and an authorization
bound to the clean execution commit. The implementation was bound to reviewed
commit `626dc16637ba843f6d1543156aba99e7b551e705`.

The historical authorized command shape was:

```sh
MIAKAPP_STAGING_FOUNDATION_STATE_AUTHORIZATION='initialize-foundation-state:miakapp-v4-staging:1788439334043522:<40-hex-execution-commit>' \
  ./initialize-state.sh '/absolute/private/execution-parent'
```

The script copies only `versions.tf`, `.terraform.lock.hcl`, and
`terraform-cli.tfrc` into its private root. On an absent GCS backend, Terraform
1.11.3 creates the canonical empty state during `terraform init`; that backend
initialization is the script's only state-writing operation. The script
immediately reconciles Terraform's view with the exact current GCS generation.
It then saves and fingerprints a post-initialization `-refresh-only` plan and
accepts only the exact two implicit locked providers with no resource, output,
module, variable, expression, provider block, or action. The plan is never
applied.

The script does not call `terraform state push`, write a cloud object directly,
or permit an existing state to be overwritten. A valid preexisting state is
reconciled without planning or mutation. Backend initialization and planning
create and release temporary `.tflock` objects; only the tiny empty state remains
live afterward, while bucket recovery policies may briefly retain noncurrent
bytes. A first authorized run created generation `1788443136082489` before its
conservative plan-shape check rejected Terraform's implicit provider metadata.
The state and preserved plan were independently verified. After the checker was
updated to model only that exact provider metadata, clean execution commit
`ab6f26bd5dd076a79847f989615e7fddf93f2a07` reconciled the existing generation
without planning, applying, or otherwise mutating it.

## Guarded local plan

After initialization and independent verification of the empty foundation
state, an operator may run the non-saving local plan wrapper with User ADC:

```sh
MIAKAPP_STAGING_PLAN_CONFIRMATION='miakapp-v4-staging' ./plan.sh
```

The wrapper rejects credential files, explicit tokens, impersonation, custom
endpoints, and all Terraform or Google environment overrides. It uses the real
GCS backend with locking. It was run from clean configuration commit
`363d017ebdc85af1285e38c5742365fd0a2a4395` and reported exactly `33 to add, 0
to change, 0 to destroy`. The full output was reviewed: it contains only the
declared foundation graph, two apply-time data reads, no workload, no public
ingress, and no secret version. No saved plan was created and no apply ran.
Post-plan checks found the exact same state generation and digest and no current
lock object.

The historical manual keyless workflow in [`../automation/`](../automation/)
was the authorized recovery path. Its plan job created a private, create-only
saved plan and emits only bounded action/address metadata. Run `33774848684`
successfully created and fully inspected such a plan from protected commit
`66869a3564788ba725049cc91326b17eb239ddaf`. The exact binary passed the closed
`initial-foundation` validator with 33 creates, two reads, and no update or
delete. A following protected revision admitted that binary boundary into a
separate environment-protected apply job with an intended zero-change
convergence check.

That protected apply recorded 25 managed resources before its command failed.
The detailed runner log was discarded by design, so the repository does not
claim an exact cause. Independent state and cloud reads found only the expected
KMS signer, five secret accessor and two component-bucket IAM members missing.
A fresh private plan contains those exact eight creates and 25 no-ops. Seven
`resource_drift` entries are limited to a changing Firestore etag and provider
normalization of empty KMS/Secret Manager maps; none is a configuration update.
The `partial-foundation-recovery` validator closes over the complete resource,
prior-state, planned-value, drift, output, check and relevant-attribute shapes.
Run `33784785967` applied that exact eight-create plan. Its overall conclusion
was failure only because the final convergence plan used the deliberately
narrower deployer identity, which lacks planner reads. A separate User-ADC plan
reported all 33 resources as no-ops and zero changes. The consumed private plan
generation was deleted, the active workflow was removed, and the retained
`plan.sh` and `apply.sh` compatibility entrypoints fail immediately.

The remaining recovery exchange was retired from PR #30 configuration commit
`ee457535a64355cd8133410d9c8c43f039608928`. Its exact private 25,925-byte plan,
SHA-256
`8f570dfe5450b704112d484f058fc6dfcd39069a92c8bb483c5029027183e888`,
contained 35 no-ops and two updates: only the plan/apply provider `disabled`
attributes changed from `false` to `true`. Apply reported `0 added, 2 changed, 0
destroyed`, and the follow-up plan reported zero changes. Bootstrap state
generation `1788460174191027` is 61,864 bytes at serial 42 with 37 managed
resources, two data resources and one output; its SHA-256 is
`288d947d35f5d5a278aaff210ea878a9dab817f594b4c3161ed117bb2e30e26d`.
The pool remains enabled and retained.

## Explicit boundaries

Terraform source is inherently apply-capable. Repository guards and supported
wrappers do not prevent a privileged operator from bypassing them, so direct
Terraform mutation remains unauthorized. The one-shot CI plan/apply workflow is
retired and absent, both provider resources are disabled, and the reviewed
GitHub OIDC exchange route is closed. The service accounts and IAM roles remain;
this evidence does not disprove impersonation by another administrator. The
manual operator plan remains read-only, requires User ADC and exact staging
confirmation, and uses the locking backend. Workload deployment, public ingress,
direct apply, and destroy remain unauthorized.
