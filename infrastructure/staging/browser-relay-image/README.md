# Guarded staging relay image build

This package prepares and executes one verified regional Cloud Build for the
exact merged Miakapp-Server source required by the browser-relay acceptance
plan. It publishes one private Artifact Registry tag only after the image has
started with the complete bounded relay profile and returned the exact `/ping`
response. Deployment must use the resulting immutable digest, never the tag.

The source bundle is the deterministic `git archive` of only `.dockerignore`,
`Dockerfile`, `go.mod`, `go.sum`, `cmd/` and `internal/` at merge
`df10674e034f30eec80760f5ec94bc108cff026f`. The Dockerfile, archive, Git tree,
module files, two digest-pinned base images and digest-pinned Cloud Build Docker
builder are all independently checked before submission.

Cloud Build uses the existing `miakapp-control-build` identity. That account can
read the existing private source bucket, write only to the existing Artifact
Registry repository and emit Cloud Logging entries; this package creates no IAM
binding or credential. The request uses `E2_MEDIUM`, a 900-second timeout,
SHA-256 source provenance and `requestedVerifyOption=VERIFIED`. A successful
build is rejected unless Cloud Build reports the exact source generation,
builder digest, smoke step, image digest and verified-provenance settings.

## One-shot boundary

Planning performs only authenticated reads and writes a mode-0700 bundle outside
the repository. Applying requires an authorization bound to the metadata bytes
and clean execution commit, then atomically creates
`operations/browser-relay-image-build-v1.json` with generation precondition
zero. The claim permits one build request and no retry or deletion. An ambiguous
submission outcome requires a separately reviewed read-only recovery change;
the apply command never submits a second build.

The source archive remains as a content-addressed object so the reported build
provenance can be independently rechecked. No container-scanning API is enabled:
`containeranalysis.googleapis.com` may later be enabled separately to query the
stored provenance, while the verified build itself fails if provenance
generation fails.

This operation does not create a Cloud Run service, runtime identity, public IAM
member, request, fixture or browser runner. After the result is independently
validated and committed, a later change must bind its digest into the dormant
relay-services Terraform profile before any private bootstrap plan exists.

## Operator flow

From a clean checkout of the exact public `origin/main` commit:

```sh
MIAKAPP_STAGING_RELAY_IMAGE_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/browser-relay-image/plan.sh \
  /absolute/private/parent /absolute/path/to/Miakapp-Server

MIAKAPP_STAGING_RELAY_IMAGE_APPLY_AUTHORIZATION='<exact value from plan>' \
  ./infrastructure/staging/browser-relay-image/apply.sh \
  /absolute/private/relay-image-bundle
```

Both entrypoints reject Google, Git, proxy, Terraform, Firebase and unrelated
Miakapp environment overrides. Full command output and credentials remain out of
the repository; only bounded non-secret evidence is eligible for later commit.
