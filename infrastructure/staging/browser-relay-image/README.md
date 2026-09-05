# Guarded staging relay image verification recovery

Status: Container Analysis prerequisite converged; one distinct v2 recovery
build reviewed but not executed; no relay service or public ingress created

This package prepares one new regional Cloud Build to recover verified
provenance for the exact merged Miakapp-Server source required by the
browser-relay acceptance plan. The build must start the image with the complete
bounded relay profile and return the exact `/ping` response. Deployment remains
forbidden until a successful result identifies an immutable digest.

## Consumed v1 attempt

The first guarded build and smoke steps succeeded, and Cloud Build pushed one
private Artifact Registry image. Cloud Build then marked that build `FAILURE`
because the Container Analysis metadata API was disabled, so the requested
verified provenance could not be emitted. The original claim permits no retry.

[`profile-v1.json`](profile-v1.json) and
[`result-v1.json`](result-v1.json) preserve the exact reviewed profile and
sanitized outcome. The pushed v1 digest is retained for audit but is explicitly
not authorized for deployment. No v1 mutation entrypoint remains.

## V2 recovery boundary

The recovery reuses source object generation `1788648564283151`, whose 53,098
bytes have SHA-256
`93fd720736453e3555be625bbb993194f48a5388821169c939674b04088f158e`.
Planning independently recreates the deterministic archive from merge
`df10674e034f30eec80760f5ec94bc108cff026f` and requires those exact bytes, but
applying is not allowed to upload or replace the existing object.

The v2 operation uses all three of the following identities distinct from v1:

- claim `operations/browser-relay-image-build-v2.json`;
- Cloud Build tag `miakapp-relay-image-v2`; and
- Artifact Registry tag ending in `-verified-v2`.

The atomic claim uses GCS generation precondition zero and permanently limits
the recovery to one build request with no retry or deletion. The build uses the
existing keyless `miakapp-control-build` identity, the digest-pinned Docker
builder, `E2_MEDIUM`, a 900-second timeout, SHA-256 source provenance and
`requestedVerifyOption=VERIFIED`. Polling uses the regional Cloud Build
operations endpoint. A successful response is rejected unless the exact source
generation and SHA-256, builder digest, smoke step, image digest, runtime config
and verified-provenance settings all match.

`containeranalysis.googleapis.com` is now enabled and owned by the converged
foundation Terraform state. `containerscanning.googleapis.com` remains
disabled: vulnerability scanning is neither authorized nor required. The API
prerequisite added no fixed-cost service.

This operation creates no Cloud Run service, runtime identity, IAM binding,
public principal, browser request or persistent credential. A later reviewed
change must bind the successful immutable digest into the dormant relay-services
Terraform profile before any private bootstrap plan can exist.

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
Miakapp environment overrides. Full output, the plan bundle and credentials
remain outside the repository; only bounded non-secret evidence may be
committed afterward.
