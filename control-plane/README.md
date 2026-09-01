# Miakapp control-plane emulator slice

This package is the first deployed-shape implementation slice of
[RFC 0004](../docs/rfcs/0004-platform-control-plane.md). It runs only against
the Firebase Local Emulator Suite and the exact `demo-miakapp-v35` project. It
cannot be loaded as a production Function.

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

The implementation deliberately lives under `control-plane/` with dedicated
Firebase configuration and rules. It does not modify or deploy the legacy root
Firebase project, `.firebaserc`, Firestore rules, or web application.

## Run

Requirements:

- Bun 1.2.23;
- Node.js 22;
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

The runner installs the pinned lockfile, type-checks, runs unit tests, builds the
Function, starts Auth, Firestore, Functions, and Storage emulators, and executes
the integration and Rules corpus. Every Firebase invocation uses the fixed
`demo-*` project; attempts to load the Function outside that emulator runtime
fail closed.

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

Synthetic fixture signing keys and the Home Key pepper are test-only material
from [`control-plane-contract/`](../control-plane-contract/). They are rejected
unless the Function is running in the exact demo emulator project. No production
credential or private home data belongs in this package.

The Local Emulator Suite provides no App Check or FCM service emulator. The
push-destination tests therefore use only the fixture's test App Check key and an
explicit recording transport; they can prove token-profile rejection, closed
schemas, verified UID/app/FID binding, challenge expiry and one-time completion,
authorization, and the exact synthetic transport request and record. They do not
construct a Firebase Admin `FidMessage` or prove real App Check attestation, FCM
acceptance, or device delivery. Real service construction and acceptance remain
staging gates.

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

Passing this slice does **not** close RFC 0004's complete emulator or production
gate. Push registration and sending have only synthetic local service evidence;
component publication and read-back have local Emulator evidence only. Bounded
audit/rate/cost admission, the remaining fault-injection matrix, live JWKS
rotation, Cloud KMS, Secret Manager, IAM, bucket CORS/lifecycle policy, real App
Check, real FCM, production Firebase certificates, production index/TTL
deployment, ingress limits, and staging rollback remain subsequent work. Admin
SDK access also bypasses Firestore and Storage Rules, so the Rules tests exercise
separate client contexts explicitly.
