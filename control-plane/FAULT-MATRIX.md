# Control-plane fault matrix

Status: local deterministic gate

This matrix consolidates the failure evidence required by RFC 0004 Sections 17
and 18. A green local suite proves application classification, transaction
linearization, bounded effects and reconciliation against synthetic dependencies
and the Firebase Emulator Suite. It does not turn Emulator behavior into evidence
for production IAM, networking or managed-service retry semantics.

## Required observations

Every injected application or dependency failure must establish all applicable
properties below:

1. the request terminates with a closed, correlated response;
2. a definitive caller or policy rejection is audited as `denied`;
3. an unknown dependency or commit-boundary failure is audited as
   `outcome_unknown` with `temporarily_unavailable`;
4. a non-idempotent effect is invoked at most once by one request;
5. no secret, FID, raw artifact, token, exception text or private dependency
   response reaches the public body or audit record;
6. a response loss or ambiguous commit is reconciled through authoritative state,
   never by blindly repeating the effect; and
7. every loop, wait and retry remains bounded by the test timeout and configured
   platform limits.

## Local deterministic matrix

| ID | Boundary and injected fault | Required result | Executable evidence |
|---|---|---|---|
| `LOCAL-01` | Admission storage is unavailable before a ticket exists | Correlated `503`; no domain or external effect starts | `test/unit/api-fault-matrix.test.ts` — admission-open case |
| `LOCAL-02` | A Firestore-backed domain mutation throws after admission | Correlated `503`; ticket finishes `outcome_unknown`; one invocation only | `test/unit/api-fault-matrix.test.ts` — home/key/exchange cases |
| `LOCAL-03` | A domain method returns a definitive `ApiError` | Stable public error; ticket finishes `denied`, never `outcome_unknown` | `test/unit/api-fault-matrix.test.ts` — definitive-denial case; `test/unit/admission.test.ts` |
| `LOCAL-04` | Push challenge state is created but transport fails | Correlated `503`; no challenge secret/FID leak; send invoked once | `test/unit/api-fault-matrix.test.ts` — challenge transport case |
| `LOCAL-05` | Push is authorized but the transport result is unknown | Correlated `503`; `outcome_unknown`; no automatic resend | `test/unit/api-fault-matrix.test.ts` — semantic push case |
| `LOCAL-06` | Component upload delivery, finalization or activation dependency fails | Correlated `503`; `outcome_unknown`; one store boundary invocation | `test/unit/api-fault-matrix.test.ts` — component cases |
| `LOCAL-07` | Audit completion fails after a successful response was committed | The success response is not rewritten or double-sent; pending bounded audit is allowed | `test/unit/api-fault-matrix.test.ts` — post-response audit case |
| `LOCAL-08` | Firestore replays an access-token reservation transaction callback | One stable `jti`, one reservation and exactly one signing operation | `test/emulator/vertical-slice.test.ts` — “signs exactly once when reservation transaction work is replayed” |
| `LOCAL-09` | Revocation or relay mutation races an access-token reservation | The reservation linearizes before or after the mutation; no obsolete post-commit mint | `test/emulator/vertical-slice.test.ts` — “linearizes one token reservation before concurrent revoke and relay changes” |
| `LOCAL-10` | A Home Key create commit is observed again after an ambiguous transaction result | The exact attempt is returned without creating a second live secret | `test/emulator/vertical-slice.test.ts` — “uses the persisted pepper version and recognizes an exact ambiguous-commit retry” |
| `LOCAL-11` | Create-only object publication sees a prior write | Identical bytes and metadata reconcile; any conflict fails closed | `test/unit/component-storage.test.ts` — ambiguous and immutable-write cases |
| `LOCAL-12` | Storage succeeds while Firestore publication state is absent or stale | Artifact stays private; retry reads authoritative bytes and repairs state | `test/emulator/component-vertical-slice.test.ts` — “derives finalization from Storage read-back and reconciles uncertain outcomes” |
| `LOCAL-13` | Two component activations race the same generation | Exactly one CAS wins; quarantine and rollback preserve an already verified digest | `test/emulator/component-vertical-slice.test.ts` — “activates by CAS, blocks quarantine, rolls back, and enforces client Rules” |
| `LOCAL-14` | Admission budget is exhausted before Home Key reservation/signing | Correlated `429`; no extra reservation/signature; one bounded audit outcome | `test/emulator/admission-vertical-slice.test.ts` — “returns a correlated 429 before another Home Key reservation or signing effect” |
| `LOCAL-15` | Pinned Secret Manager or Cloud KMS adapter receives a dependency failure, malformed response, mismatched version, invalid checksum, mutable signing input or wrong signing key; generated-client debug logging is enabled | Generic failure; no secret disclosure or invalid token; exact environment issuer; one call per pinned secret and at most one signing RPC with automatic retries disabled; SDK clients are not constructed under sensitive logging | `test/unit/cloud-security.test.ts`, `test/unit/google-cloud-clients.test.ts`, and `test/unit/production-config.test.ts` — production cloud security boundaries |
| `LOCAL-16` | Inactive production runtime receives a cross-environment config, emulator/credential/endpoint/quota/proxy override, foreign Firebase app, wrong App Check app, Firebase JWKS outage, failed FCM send or mismatched Storage bucket | Fail before SDK construction where possible; exact project/issuer/origin/bucket/service-account binding; explicit Firestore Google Auth without ambient ADC; definitive identity rejection remains `401` while provider-key outage is correlated `503`; one raw FCM HTTP v1 attempt with no SDK retry; create-only Storage/read-back; no import-time cloud effect | `test/unit/production-runtime-config.test.ts`, `test/unit/production-runtime.test.ts`, `test/unit/api-fault-matrix.test.ts`, `test/unit/auth.test.ts`, `test/unit/app-check.test.ts`, `test/unit/push.test.ts`, `test/unit/component-storage.test.ts`, and `test/unit/access-token.test.ts` — offline production composition boundaries |

The unit API cases execute the real Express router, parsers, token profiles and
response encoder. Only the external dependency at the named boundary is replaced
with a deterministic recorder/fault. The Emulator cases use promise gates or
explicit state mutation, never timing sleeps, for causal race evidence.

## Staging-only matrix

The following rows cannot be closed by local fakes or the Emulator Suite. They
remain mandatory acceptance tests in the isolated `miakapp-v4-staging` project.

| ID | Real boundary | Required staging evidence |
|---|---|---|
| `STAGE-01` | Cloud KMS and Secret Manager | Key-version publication, one signing operation, access denial, timeout, rotation overlap and recovery |
| `STAGE-02` | Firebase Auth and Google JWKS | RS256 certificates, cache expiry, single-flight unknown-`kid` refresh, failed refresh and abuse limit |
| `STAGE-03` | App Check | Real attestation enforcement, wrong app/project, replay policy and provider quota behavior |
| `STAGE-04` | FCM | FID registration, accepted send, invalid/stale destination, quota/5xx and unknown send outcome without automatic duplication |
| `STAGE-05` | Firestore | Deployed indexes and TTL, production transaction contention, permission failure and ambiguous connection loss |
| `STAGE-06` | Cloud Storage | IAM, CORS, generation preconditions, read-back metadata, partial upload, lifecycle and retention policy |
| `STAGE-07` | Functions and network | Deadline, process termination, cold start, connection reset before/after response, slow upload/download and instance saturation |
| `STAGE-08` | Public ingress | Trusted source attribution, edge denial, bounded discovery/JWKS/artifact reads and measured worst-case admitted cost |
| `STAGE-09` | Migration and rollback | Partial import, suppressed triggers, reconciliation counts, timed restore, custom-domain reversal and one-home canary abort |

Firebase documents that the Emulator Suite does not reproduce full Functions
containers or retries, Firestore production limits/indexes, Storage IAM/CORS and
all Google Cloud Storage APIs. It also provides no App Check or FCM emulator.
These rows therefore require real staging rather than a more elaborate local
mock.

`LOCAL-15` proves the application request shape, generated-client adapter shape
and fail-closed response validation with injected clients. It does not prove managed-service IAM,
latency, transport retries, audit logs, key lifecycle or Secret Manager
consistency, and therefore does not close `STAGE-01`.

`LOCAL-16` proves only closed configuration and dependency wiring with injected
SDK clients, plus construction of the real pinned Firestore client without a
network call. The production factories use explicit metadata-only identities
and reject standard proxy environment overrides, but the tests perform no
metadata, App Check, FCM, Storage, KMS or Secret Manager network call and
therefore close none of `STAGE-01`, `STAGE-03`, `STAGE-04` or `STAGE-06`.

- [Functions Emulator differences](https://firebase.google.com/docs/emulator-suite/connect_functions#how_the_cloud_functions_emulator_differs_from_production)
- [Firestore Emulator differences](https://firebase.google.com/docs/emulator-suite/connect_firestore#how_the_cloud_firestore_emulator_differs_from_production)
- [Storage Emulator differences](https://firebase.google.com/docs/emulator-suite/connect_storage#how_the_cloud_storage_for_firebase_emulator_differs_from_production)
- [Local Emulator Suite supported products](https://firebase.google.com/docs/emulator-suite#which_firebase_features_and_platforms_are_supported)

## Gate

Run:

```sh
./control-plane/check.sh
```

The local gate is closed only when every `LOCAL-*` row is represented by a causal
test and the complete check is green. No `STAGE-*` row may be relabelled local or
complete merely because a fake returned the expected error. The reviewable
[`../infrastructure/staging/manifest.json`](../infrastructure/staging/manifest.json)
binds all nine staging rows to the existing isolated, billing-linked project in
Paris. Its separate bootstrap and foundation Terraform roots are applied and
reconciled in private remote state; the one-shot keyless recovery workflow has
been removed and both WIF providers are disabled. The guarded activation
materialized exactly one Firebase Web app and five enabled initial secret
versions, then reconciled the same plan without another write. Its committed
evidence contains no secret payload. The separately managed workload is now an
active scale-to-zero Function with internal-only ingress, exact copied-source
verification and no live request. Active credential-free CI uses mock providers
and fails closed if a change claims credentials, public ingress, an unpinned
Function deployment or fixed-cost edge services. Deployment and inventory alone
close no `STAGE-*` row: neither the manifest, historical cloud evidence nor a
mock-provider check satisfies any staging row by itself.
