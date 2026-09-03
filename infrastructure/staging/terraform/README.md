# Staging Terraform foundation proposal

Status: apply-capable configuration; live foundation plan reviewed; no apply

This root describes the ordinary protected foundation for the existing,
billing-linked but undeployed `miakapp-v4-staging` project. Billing management,
budgets, both Storage buckets,
the runtime service account and its project IAM, remote-state storage, Workload
Identity Federation, and CI identities belong to
[`../bootstrap/`](../bootstrap/), not this root.

The foundation proposes:

- the exact APIs required by the eventual staging control plane;
- the Standard default Firestore database with deletion protection and three
  TTL fields;
- the existing private Paris component bucket and runtime service account,
  both verified through the bootstrap state;
- one software Ed25519 KMS signing key without automatic rotation;
- five empty Secret Manager containers, never payload versions; and
- additive resource IAM members for create/read-only component objects, the
  signing key and the declared secrets.

There is no Function, Cloud Run service, public ingress, Firebase app, relay,
App Engine application, load balancer, VPC connector, NAT, Cloud Armor policy,
secret value, service-account key, or billing resource.

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
40 and was reconciled against the protected serial-39 source state. Terraform's
GCS backend created the empty foundation state at serial 1. Exact reads through
Terraform and GCS reconciled current generation `1788443136082489` as the same
canonical empty state.

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

## Guarded initial state

[`initialize-state.sh`](initialize-state.sh) creates only the initial empty
foundation state. It requires User ADC, a clean checkout, a private
operator-owned directory outside the repository, the exact reconciled bootstrap
generation, and an authorization bound to the clean execution commit. The
implementation is bound to reviewed commit
`626dc16637ba843f6d1543156aba99e7b551e705` and remains fail-closed until a
separate exact authorization names the clean execution commit.

The authorized command shape is:

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

The manual keyless workflow in [`../automation/`](../automation/) is the
authorized planning path after bootstrap. Its exact active copy creates a
private, create-only saved plan and emits only bounded action/address metadata.
It becomes dispatchable after protected merge to `main`. It contains no apply
job; the separate apply script and deployer identity remain dormant.

## Explicit non-authorization

Terraform source is inherently apply-capable. Repository guards and supported
wrappers do not prevent a privileged operator from bypassing them, so direct
Terraform mutation remains unauthorized. The plan workflow may use short-lived
keyless planner credentials after protected merge, but it cannot write
foundation state or request the deployer identity. No private saved foundation
plan exists yet, no active apply workflow exists, and the apply and destroy
authorization bits remain false.
