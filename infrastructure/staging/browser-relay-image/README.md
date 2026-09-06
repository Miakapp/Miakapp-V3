# Guarded staging relay image evidence

Status: v2 recovery succeeded with verified source provenance; immutable image
retained privately but not deployed; all one-shot entrypoints retired

This package preserves the reviewed contracts and sanitized results for the two
regional Cloud Builds used to produce the exact Miakapp-Server image required by
the browser-relay acceptance plan. The successful image remains private and no
relay service, IAM binding or public ingress has been created.

## Consumed v1 attempt

The first guarded build and smoke steps succeeded, and Cloud Build pushed one
private Artifact Registry image. Cloud Build then marked that build `FAILURE`
because the Container Analysis metadata API was disabled, so the requested
verified provenance could not be emitted. The original claim permits no retry.

[`profile-v1.json`](profile-v1.json) and
[`result-v1.json`](result-v1.json) preserve the exact reviewed profile and
sanitized outcome. The pushed v1 digest is retained for audit but is explicitly
not authorized for deployment. No v1 mutation entrypoint remains.

## Consumed v2 recovery

The recovery reused source object generation `1788648564283151`, whose 53,098
bytes have SHA-256
`93fd720736453e3555be625bbb993194f48a5388821169c939674b04088f158e`.
Planning independently recreated the deterministic archive from merge
`df10674e034f30eec80760f5ec94bc108cff026f` and proved those exact bytes before
applying. The executor neither uploaded nor replaced the existing object.

The v2 operation uses all three of the following identities distinct from v1:

- claim `operations/browser-relay-image-build-v2.json`;
- Cloud Build tag `miakapp-relay-image-v2`; and
- Artifact Registry tag ending in `-verified-v2`.

The atomic claim at generation `1788652620212083` used GCS generation
precondition zero and permanently limits the recovery to one build request with
no retry or deletion. Build `70e25c75-3c30-497a-982a-f7bebe71c4ee` used the
existing keyless `miakapp-control-build` identity, the digest-pinned Docker
builder, `E2_MEDIUM`, a 900-second timeout, SHA-256 source provenance and
`requestedVerifyOption=VERIFIED`. Both the build and hardened `/ping` smoke step
succeeded. The registry manifest and config were then read back and validated.

[`profile.json`](profile.json) preserves the exact pre-execution v2 contract.
[`result-v2.json`](result-v2.json) preserves its bounded non-secret result and
pins immutable digest
`sha256:23a19a26e8a24f6434ab8bc557dfa3fa799e0262e3400170e3bf064101a890b1`.
The committed result is byte-identical to the private executor receipt and its
validator closes over the exact source, claim, build, image, recovery and effect
fields.

`containeranalysis.googleapis.com` is now enabled and owned by the converged
foundation Terraform state. `containerscanning.googleapis.com` remains
disabled: vulnerability scanning is neither authorized nor required. The API
prerequisite added no fixed-cost service.

The operation created no Cloud Run service, runtime identity, IAM binding,
public principal, browser request or persistent credential. Deployment remains
unauthorized. A later reviewed change must bind the successful immutable digest
into the dormant relay-services Terraform profile before any private bootstrap
plan can exist.

## Permanent retirement

Both `plan.sh` and `apply.sh` now fail immediately with a permanent-retirement
message. The v1 and v2 claims and private images remain retained for audit, but
neither operation can be replayed or deleted through this package. Full command
output, the private plan bundle and credentials remain outside the repository.
