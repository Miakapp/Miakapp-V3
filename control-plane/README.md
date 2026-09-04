# Miakapp control-plane emulator slice

This package is the first deployed-shape implementation slice of
[RFC 0004](../docs/rfcs/0004-platform-control-plane.md). Its active Firebase
codebase runs only against the Local Emulator Suite and the exact
`demo-miakapp-v4` project. A separate deterministic production package now
selects the staging adapter as its entrypoint. That endpoint remains absent from
the emulator package main, so the Local Emulator Suite cannot discover it.

The slice implements:

- the closed deployment-discovery document and Ed25519 JWKS;
- Firebase-owner authentication derived from verified `sub`, `iat`,
  `auth_time`, and `exp` claims;
- transactional public/private home creation and owner-only relay updates;
- one-time Home Key creation, version-selected HMAC-only storage, bounded
  metadata listing, retained-record compaction, and uniform revocation; and
- scope-attenuated, audience-bound, five-minute access-token exchange.

The push vertical slice adds closed Firebase Installation ID (FID)
challenge/completion schemas, strict synthetic App Check and push-access-token
verification, a synthetic recording FCM transport, keyed FID fingerprints, the
one-time proof-of-possession state machine, bounded destination/grant registries,
user-owned home-scoped consent, and semantic notification sending.

The component-publication vertical slice adds algorithm-selected owner or
`components:publish` authorization, verifier-only one-use upload capabilities,
private Storage staging, server-side byte read-back and bounded JavaScript
inspection, immutable content-addressed publication, publisher-bound release
finalization, reconciliation reads, transactional pointer activation,
quarantine, and rollback to an already verified digest.

The admission slice adds exact Firestore fixed-window budgets before costly
signing, Storage and synthetic push effects. It uses a fixed-slot counter table,
a fixed-slot redacted audit ring, domain-separated HMAC fingerprints, stable
`429 rate_limited` responses with bounded `Retry-After`, and TTL policies as
cleanup defense in depth. Firestore client Rules deny all counter, ring-state and
audit access.

The implementation deliberately lives under `control-plane/` with dedicated
Firebase configuration and rules. It does not modify or deploy the legacy root
Firebase project, `.firebaserc`, Firestore rules, or web application.

## Run

Requirements:

- Bun 1.2.23;
- Node.js 22.12 or newer within major 22;
- Java 21; and
- Bash.

From the repository root:

```sh
npm run test:control-plane-emulator
```

Or directly:

```sh
./control-plane/check.sh
```

On Apple Silicon with Homebrew, the check automatically discovers the keg-only
`openjdk@21` installation. Other systems can provide Java 21 through `PATH` or
`JAVA_HOME`.

Firebase Functions accepts only a major Node version in `package.json`, so the
deployment manifest retains `"node": "22"`. The executable preflight enforces
the narrower Node 22.12+ test-runner requirement before installing packages.

The runner installs the pinned lockfile, type-checks, runs unit tests, builds the
Function, starts Auth, Firestore, Functions, and Storage emulators, and executes
the integration and Rules corpus. Unit tests remain on the pinned Bun runtime;
Firestore integration tests run through Vitest on Node 22.12+ because
[firebase-tools#8226](https://github.com/firebase/firebase-tools/issues/8226)
tracks random Bun `node:http2` failures against the emulator, including on
GitHub Actions. Firestore Emulator 1.19.4 is pinned while
[firebase-tools#10518](https://github.com/firebase/firebase-tools/issues/10518)
tracks intermittent transaction-lock failures observed in later releases. The
runner downloads the JAR into the ignored `.firebase/emulators` cache and
verifies its exact byte size and SHA-256 digest before executing it. Every
admission scenario and each remaining stateful test file run behind a fresh
emulator process boundary. Concurrency remains inside scenarios that assert its
exact boundary, while emulator-only transaction locks cannot contaminate later
evidence. Randomized fixtures reserve non-colliding fixed-table admission slots
before exercising an asserted success path; they never retry a production
mutation after its intentional fail-closed `429`. Tests also clear documents
collection by collection instead of using
the emulator-wide reset endpoint, so a failed scenario cannot turn later
cleanup into a cascade of HTTP 409 responses. Every Firebase invocation uses
the fixed `demo-*` project; attempts to load the Function outside that emulator
runtime fail closed.

## Evidence and boundary

The integration corpus proves the owner-to-access-token path through local Auth,
Functions, and Firestore. It also drives component bytes through the Storage
Emulator, reads the exact final pointer URL through a marker-gated Functions
route, and proves through a separate client Rules context that the backing
Storage object remains private. The corpus covers strict/duplicate-key
JSON rejection, recent-login claims, atomic home creation including a concurrent
allocation race, exact 16-home and 64-key ceilings, owner isolation,
one-time-secret redaction, retained-key compaction under concurrent replacement,
versioned-pepper lookup, independent verification of all four attenuated token
profiles, uniform/repeated revocation, post-revocation exchange denial,
transaction-linearized signing during revoke and relay-change races, malformed
registry state, CORS, cookie rejection, and deny-by-default client Rules.

For component publication, the corpus proves owner and attenuated-token
authorization without verifier fallback, direct-Home-Key and cross-resource
rejection, complete metadata and publisher binding, secret redaction, upload
expiry and replay denial, delivery-path digest/size/syntax validation,
reconciliation from a committed Storage object, denial of the exact pointer URL
until an artifact marker commits atomically with finalization, refreshed
authority with the same `client_id`, immutable private backing bytes and a
cacheable token-free artifact response, concurrent generation CAS,
quarantine, rollback, authenticated pointer reads, and private staging/metadata
Rules.

The exchange transaction is the issuance linearization point. It performs the
single authoritative read, reserves a fixed `jti` and `iat` against the current
key, scopes and relay, records bounded last-use metadata, and commits. The
service then performs exactly one signature over that reserved grant. A
conflicting revocation or relay change therefore wins before the reservation or
follows an already-issued bounded lease; HTTP response arrival order does not
redefine that transaction order.

For bounded admission, the corpus proves exact atomic global and resource
saturation under concurrency, multi-unit byte charging, independent subjects,
fixed-window reset, one coalesced audit saturation marker, finite physical slot
counts, and request-ID correlation from a public 429 to its private redacted
event. Early 429 responses retain the allowed-origin CORS contract. The HTTP
exchange regression also proves that a rejected key budget leaves the previous
issuance reservation unchanged, so no additional signature can be reached. The
component delivery and push-send call graphs reserve their verified resource
budgets before their first Storage or transport effect.

The exact local profile is documented in RFC 0004 §14.1 and configured in
[`src/config.ts`](src/config.ts). Long-lived audit records contain only keyed,
truncated actor/resource and separately keyed network fingerprints; tests scan
the denied exchange event for the raw Home Key and key ID. The local source
dimension uses only the direct TCP peer exposed by the Functions emulator and
does not trust forwarded headers. Syntactically valid but unverified credentials
remain anonymous actors, and retryable dependency failures are recorded as
`outcome_unknown` rather than a definitive denial.

Synthetic fixture signing keys and the Home Key pepper are test-only material
from [`control-plane-contract/`](../control-plane-contract/). They are rejected
unless the Function is running in the exact demo emulator project. No production
credential or private home data belongs in this package.

The Local Emulator Suite provides no App Check or FCM service emulator. The
push-destination Emulator tests therefore use only the fixture's test App Check
key and an explicit recording transport; they can prove token-profile rejection,
closed schemas, verified UID/app/FID binding, challenge expiry and one-time
completion, authorization, and the exact synthetic transport request and record.
Separate unit tests now prove the exact FID-targeted FCM HTTP v1 request built by
the production transport and its one-attempt, redacted failure boundary.
The transport deliberately does not use the Firebase Admin Messaging retry loop:
an uncertain provider result is never duplicated automatically. These tests do
not prove real App Check attestation, FCM acceptance, or device delivery. Real
service acceptance remains a staging gate.

Expired challenge records carry a Firestore TTL policy and are also pruned on
subsequent issuance. The Emulator does not execute production TTL deletion, so
the tests prove the configured policy and application pruning separately.

The Storage Emulator proves object creation, read-back and client Rules.
Structural adapter tests prove create-only generation-precondition wiring and
fail-closed conflict reconciliation because the Emulator does not enforce those
production generation preconditions. Neither layer proves production bucket IAM,
CORS configuration, retention policy, lifecycle cleanup or service-account
isolation. Firebase Auth Emulator owner tokens use its local unsigned profile, so
the algorithm selector accepts `alg: none` only inside the exact demo-emulator
boundary; production Firebase RS256 verification remains a staging gate. The
Functions Framework may reject compressed or oversized requests before
application code runs, so the 2 MiB application check is not evidence of a
production streaming ingress limit.

An isolated production-security boundary lives in
[`src/production-config.ts`](src/production-config.ts),
[`src/cloud-security.ts`](src/cloud-security.ts), and
[`src/google-cloud-clients.ts`](src/google-cloud-clients.ts). It accepts only the
explicit staging or production project, the reviewed Paris `europe-west9`
region, numeric Secret Manager versions and one full Ed25519 KMS key-version
name. Initialization reads each declared 32-byte
secret once, checks the returned resource name and CRC32C, then binds the KMS
public key to the configured JWKS key. The staging and production project IDs
are also bound respectively to `https://control.staging.miakapp.com` and
`https://control.miakapp.com`; they cannot mint tokens carrying the other
environment's issuer. Each token uses one `AsymmetricSign` request over the exact
JWS signing input with automatic client retries disabled; the response name,
request-integrity acknowledgement, signature CRC32C and signature itself are
verified against an independent immutable copy before release. Production client
construction fails before creating either SDK client when
`GOOGLE_SDK_NODE_LOGGING` is nonempty, because that debug mode can serialize
Secret Manager payloads and complete KMS signing material.

The complete isolated production composition now lives in
[`src/production-runtime-config.ts`](src/production-runtime-config.ts) and
[`src/production-runtime.ts`](src/production-runtime.ts). Its closed runtime
document binds the exact staging or production project, issuer, origins, App
Check app, dedicated component bucket and dedicated runtime service-account
email. It rejects every emulator variable, Google SDK debug logging, credential
file override, metadata-host override, HTTP/HTTPS/gRPC proxy override,
quota-project override and Google Cloud universe override. Every Google client
is constructed with a metadata-only credential pinned to that service account
and an exact `googleapis.com` endpoint, rather than invoking the ambient ADC
search path. Firestore uses its direct pinned constructor with that same
explicit Google Auth instance, exact default database and exact service path;
Firebase Admin's structural credential remains limited to the Firebase services
that support it. The composition injects Firebase Auth, standard
Firebase Admin App Check
verification, Firestore, FCM FID messaging, production Storage, the five pinned
secret keyrings and the KMS signer into the existing application. App Check
token consumption is deliberately disabled in version 1: the one-time FID proof
and transactional admission controls provide the request-level replay boundary
without the extra limited-use-token round trip and provider quota. This policy
still requires real attestation and wrong-app tests in `STAGE-03`.

[`src/production-runtime-loader.ts`](src/production-runtime-loader.ts) reads one
required `MIAKAPP_RUNTIME_CONFIG_JSON` value, rejects inputs over 16 KiB, uses
the duplicate-key-safe JSON parser, validates the closed runtime schema, and
requires the expected deployment environment. The document may contain only
public configuration, a public JWK and pinned numeric resource names; raw secret
bytes and private JWK fields are rejected.

[`src/staging-runtime-document.ts`](src/staging-runtime-document.ts) is the
staging-only initial document builder used by the guarded activation boundary.
It accepts only the real staging Firebase app ID, the canonical public half of
the Paris KMS key, and one numeric version per declared secret. Its output must
pass the production parser and classify all five keyrings as one `initialize`
transition. The corresponding CLI exchanges this non-secret JSON only through
stdin/stdout; it neither reads credentials nor calls a cloud service.

[`src/production-secret-lifecycle.ts`](src/production-secret-lifecycle.ts)
defines a pure offline validator for four-phase configuration-reference
transitions. An initialization snapshot contains one current pinned reference
per purpose; a prepare snapshot adds one later pinned reference without
switching; activate changes the current pointer within that same two-reference
set; and a retire snapshot removes only the non-current reference. Outside
initialization, at most one of the five secret purposes may change per
transition. Replacements, mutable versions, phase skipping and combined
rotation are rejected. This validator does not create, enable, disable or
destroy Secret Manager versions, and it is not yet wired into deployment
enforcement.

[`src/production-function-runtime.ts`](src/production-function-runtime.ts)
single-flights initialization for each instance. Concurrent requests therefore
perform one configuration load, one pass over the configured pinned secret
versions and one KMS public-key read. An initialization failure is latched and
every later request receives the same redacted, non-cacheable `503` without
another cloud attempt.

[`src/production-entrypoint.ts`](src/production-entrypoint.ts) is a reviewable,
staging-bound Gen 2 adapter. It registers `onInit()`, pins Paris, zero minimum
and one maximum instance, concurrency 16, a 30-second timeout, the dedicated
runtime service account and a private invoker. It deliberately selects no
ingress mode, mounts no Function secret, and is enabled only for the separate
production package.

None of the production modules is imported or re-exported by
[`src/index.ts`](src/index.ts), which remains the demo-emulator entry point and
the sole Function discovered through the package main selected by
`firebase.json`. The deployment manifest under [`deployment/`](deployment/)
selects `lib/production-entrypoint.js` instead, and the reproducible packager
copies only its statically reachable module graph. Importing the adapter
constructs no client, reads no configuration or secret,
and makes no ADC, network or cloud-resource call. Unit tests use injected
clients. The
concrete Google adapter is exercised with injected transports to prove that the
generated clients receive fresh extensible call options while preserving the
bounded timeout and `retry: null`; no real client method runs in that test. The
private fixture JWK remains confined to the emulator-specific configuration
subtype. The deployed staging workload separately pins internal-only ingress,
scale zero-to-one, the committed runtime document, dedicated runtime/build/probe
identities and a one-permission FCM role. Independent inventory verified its
active revision and exact copied source without making a request, so it does not
count as a `STAGE-01` acceptance result.

Passing this slice does **not** close RFC 0004's complete emulator or production
gate. Push registration and sending have only synthetic local service evidence;
component publication and read-back have local Emulator evidence only. Bounded
audit/rate/cost admission now has local transactional evidence. The deterministic
application/dependency failures, transaction replays, ambiguous Storage state,
CAS races and audit outcomes are consolidated in [`FAULT-MATRIX.md`](FAULT-MATRIX.md).
Trusted production source attribution, Cloud Armor plus ingress restriction,
alerting, load/cost calibration, TTL/index deployment, live network faults, live
JWKS rotation, live Cloud KMS and Secret Manager behavior, IAM, bucket CORS/lifecycle policy, real
App Check, real FCM, production Firebase certificates and staging rollback remain
subsequent staging work. Admin SDK access
bypasses Firestore and Storage Rules, so the Rules tests exercise separate client
contexts explicitly. Public discovery, JWKS and artifact reads are bounded only
by local Function instance/concurrency settings in this slice; production edge
admission must cover them before any publicly reachable deployment.

The reviewable [`../infrastructure/staging/`](../infrastructure/staging/) intent
freezes the existing project's target, locations, resource and IAM inventory,
cost posture, unresolved production adapters and teardown evidence. Its CI gate
has no credentials and authorizes no cloud mutation or live request.
