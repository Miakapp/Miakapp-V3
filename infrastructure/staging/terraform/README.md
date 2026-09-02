# Staging Terraform foundation proposal

Status: apply-capable configuration; mock-tested offline; blocked on bootstrap

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
bootstrap state fails closed. The buckets and state do not exist yet.

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

## Guarded local plan

After an authorized bootstrap and verified state migration, an operator may run
the non-saving local plan wrapper with User ADC:

```sh
MIAKAPP_STAGING_PLAN_CONFIRMATION='miakapp-v4-staging' ./plan.sh
```

The wrapper rejects credential files, explicit tokens, impersonation, custom
endpoints, and all Terraform or Google environment overrides. It uses the real
GCS backend with locking. It has not been run and cannot currently succeed
because the bucket and bootstrap state are absent.

The dormant keyless workflow in [`../automation/`](../automation/) is the
intended activation path after bootstrap. It creates a private, create-only
saved plan, emits only bounded action/address metadata, and allows the protected
apply job to consume only the exact same-run object and SHA-256 digest. The
workflow is not installed or authorized.

## Explicit non-authorization

Terraform source is inherently apply-capable. Repository guards and supported
wrappers do not prevent a privileged operator from bypassing them, so direct
Terraform mutation remains unauthorized. No active CI workflow has cloud
credentials, the WIF resources do not exist, no live plan has been reviewed,
and every manifest authorization bit remains false.
