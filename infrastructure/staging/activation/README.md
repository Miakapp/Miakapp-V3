# Initial staging activation material

This directory contains the guarded one-shot boundary for the first non-secret
Miakapp V4 staging runtime document. It is intentionally narrower than a
deployment: the reviewed delta is exactly one Firebase Web app and one enabled
32-byte version in each of the five existing Secret Manager containers.

The operation does **not** create an App Engine application, Cloud Function,
Cloud Run service, ingress policy, minimum instance, DNS record, App Check
provider or FCM role. The production entrypoint remains omitted after this
operation.

## Live result

The guarded operation completed from merge commit
`101e4231d452423bafa2ae1efd051e51faeff3c8` at
`2026-09-03T22:04:21.219Z`. It created Firebase Web app
`1:1072737219170:web:5053ca93bf25d7373cd73b` and enabled version `1` in each
of the five existing secret containers. The exact plan was then replayed and
reconciled without another write. Independent inventory confirmed zero App
Engine applications, Functions, Cloud Run services, public ingress or minimum
instances. The private derivation seed was deleted after successful read-back.

Only the bounded non-secret [`result.json`](result.json) and
[`runtime-config.json`](runtime-config.json) are committed. Their exact SHA-256
digests are respectively
`290c7cedb500d9f6844b49a45737ed920b3fe2e6ada6ed95b754a795768ccbdf` and
`b794181400bf5ace6aaa9ffc4be00e4c4f6a59519284baa7f73bca3c042c4ff8`.
[`evidence.mjs`](evidence.mjs) closes their schemas, canonical encodings and
cross-document references. No plan, seed or secret payload is present in the
repository.

## Safety model

- Every command names `miakapp-v4-staging` explicitly and the executor accepts
  only the exact `origin/main` commit recorded by a two-hour plan.
- A SHA-256-bound authorization string separates read-only planning from the
  five non-idempotent Secret Manager writes and Firebase app registration.
- Credential files, impersonation, endpoint/proxy overrides, alternate gcloud
  configuration roots and unknown `MIAKAPP_*` controls are rejected. Existing
  local User ADC and Firebase CLI authentication are used without creating a
  persistent credential.
- The private plan directory must be owned by the current user, mode `0700`,
  and outside the repository. Its files are mode `0400` or `0600`.
- One random 32-byte private seed derives five domain-separated 32-byte values.
  Secret bytes travel only through child-process stdin. They never enter a
  command argument, Terraform state, Git, JSON, stdout or an environment
  variable.
- Before every non-idempotent call, the executor writes a plan-bound attempt
  marker to the private directory. After any ambiguous write, it lists the
  inventory and reads the sole secret candidate back. It resumes only when the
  attempted resource is visible and its bytes match the retained private seed;
  an absent attempted resource stops the run instead of risking a duplicate.
- A successful execution deletes the seed after the runtime document and
  completion record are durable. A failed execution retains it in the private
  directory so the same plan can be reconciled safely.

The runtime document contains only public identifiers: the Firebase app ID,
the KMS public JWK, numeric Secret Manager resource names, origins and bounded
RPC settings. Its builder runs the same production parser and classifies the
five keyrings as the initial lifecycle transition.

## Review and execute

First create a private parent outside the checkout, owned by the current user
and inaccessible to group or other users. Then, from the exact clean
`origin/main` commit:

```sh
MIAKAPP_STAGING_ACTIVATION_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/activation/plan.sh /absolute/private/parent
```

The planner performs read-only inventory, writes `plan.json` below a fresh
private directory, and prints its exact authorization value. Execute that same
file before its two-hour expiry:

```sh
MIAKAPP_STAGING_ACTIVATION_AUTHORIZATION='materialize-staging-activation:miakapp-v4-staging:<plan-sha256>:<commit>' \
  ./infrastructure/staging/activation/apply.sh /absolute/private/parent/miakapp-staging-activation-plan-XXXXXX/plan.json
```

Success produces private `runtime-config.json` and `result.json` files and
reports zero deployed workloads. Do not hand-edit either file. The exact
validated non-secret copies from the completed operation are now committed and
digest-pinned above; the private directory and any failed diagnostic log stay
outside Git. A fresh plan intentionally rejects this non-empty activation
baseline, while replaying the completed plan remains a read-only reconciliation
path.

If execution stops after any mutation, rerun the exact command with the exact
same plan directory. Do not generate a new plan or remove `activation.seed`
until the executor either reconciles successfully or an independent inspection
establishes that no write occurred.
