# Consumed staging relay image build v1

Status: one build submitted; build and smoke steps succeeded; verified
provenance failed; image not authorized for deployment; v1 entrypoints retired

This package records the first guarded regional Cloud Build for the exact
merged Miakapp-Server source required by the browser-relay acceptance plan. The
build and bounded `/ping` smoke test succeeded, and Cloud Build pushed one
private Artifact Registry image. Cloud Build then marked the build `FAILURE`
because the Container Analysis metadata API was disabled, so it could not emit
the requested verified provenance. The pushed digest is retained for audit but
is explicitly not authorized for deployment.

The source bundle is the deterministic `git archive` of only `.dockerignore`,
`Dockerfile`, `go.mod`, `go.sum`, `cmd/` and `internal/` at merge
`df10674e034f30eec80760f5ec94bc108cff026f`. The Dockerfile, archive, Git tree,
module files, two digest-pinned base images and digest-pinned Cloud Build Docker
builder were independently checked before submission.

Cloud Build used the existing `miakapp-control-build` identity. That account can
read the existing private source bucket, write only to the existing Artifact
Registry repository and emit Cloud Logging entries; this operation created no
IAM binding or credential. The request used `E2_MEDIUM`, a 900-second timeout,
SHA-256 source provenance and `requestedVerifyOption=VERIFIED`. The failed
attempt still resolved the exact immutable source generation and reported its
SHA-256 and MD5 hashes. The committed
[`result-v1.json`](result-v1.json) pins the sanitized claim, build, source and
private image observations without storing credentials or log contents.

## Consumed one-shot boundary

Planning performed only authenticated reads and wrote a mode-0700 bundle
outside the repository. Applying required an authorization bound to the
metadata bytes and clean execution commit, then atomically created
`operations/browser-relay-image-build-v1.json` with generation precondition
zero. The claim permitted one build request and no retry or deletion. Exactly
one matching build exists.

Both v1 entrypoints now fail before operator, source or cloud access, and the
original claim and source object remain durable. A future v2 build must use a
different claim, build tag and image tag. The source archive remains as a
content-addressed object so the recovery build can reuse and independently
recheck the same bytes.

The prerequisite fix adds `containeranalysis.googleapis.com`, which stores
build metadata. `containerscanning.googleapis.com` remains disabled:
vulnerability scanning is not authorized or required for this recovery.

The operation created no Cloud Run service, runtime identity, public IAM
member, request, fixture or browser runner. A separately reviewed v2 operation
must complete verified provenance before an immutable digest can be bound into
the dormant relay-services Terraform profile.

## Retired operator flow

The historical commands below are retained only to identify the consumed
boundary. They now fail immediately and must not be run or replayed:

```sh
MIAKAPP_STAGING_RELAY_IMAGE_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/browser-relay-image/plan.sh \
  /absolute/private/parent /absolute/path/to/Miakapp-Server

MIAKAPP_STAGING_RELAY_IMAGE_APPLY_AUTHORIZATION='<exact value from plan>' \
  ./infrastructure/staging/browser-relay-image/apply.sh \
  /absolute/private/relay-image-bundle
```

Full command output, the private bundle and credentials remain outside the
repository. Only the bounded non-secret result is committed.
