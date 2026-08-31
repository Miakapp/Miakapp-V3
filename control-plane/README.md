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
Functions, and Firestore. Storage participates only in a separate
deny-by-default client Rules assertion. The corpus covers strict/duplicate-key
JSON rejection, recent-login claims, atomic home creation including a concurrent
allocation race, exact 16-home and 64-key ceilings, owner isolation,
one-time-secret redaction, retained-key compaction under concurrent replacement,
versioned-pepper lookup, independent verification of all four attenuated token
profiles, uniform/repeated revocation, post-revocation exchange denial,
transaction-linearized signing during revoke and relay-change races, malformed
registry state, CORS, cookie rejection, and deny-by-default client Rules.

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

Passing this slice does **not** close RFC 0004's complete emulator or production
gate. Push destinations/grants, App Check, component publication and read-back,
audit/rate/cost admission, live JWKS rotation, Cloud KMS, Secret Manager, IAM,
FCM delivery, production Firebase certificates, indexes, ingress limits, and
staging rollback remain subsequent work. Admin SDK access also bypasses
Firestore Rules, so the Rules tests exercise separate client contexts explicitly.
