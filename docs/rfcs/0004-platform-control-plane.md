# RFC 0004 — Miakapp platform control plane

Status: Accepted

Date: 2026-08-31

## 1. Scope

This RFC defines the privileged Miakapp 3.5 control plane shared by the web
application, Firebase Functions, MiakAPI and RFC 0001 relays. It specifies:

- owner bootstrap and the persistent public home directory;
- generation, storage, use, listing and revocation of Home Keys;
- Home Key exchange for short-lived, resource-specific access tokens;
- the exact Miakapp JWT and JWKS profiles consumed by relays and platform APIs;
- the distinct Firebase ID-token profile used for human relay sessions;
- coarse Home Key scopes and their attenuation at token issuance;
- user-consented, home-scoped push grants;
- component upload and pointer-publication authorization;
- concurrency, rate, quota, audit, redaction and failure requirements; and
- the public conformance evidence required before an implementation may claim
  compatibility.

This RFC does not define RFC 0001 frames, coordinator application permissions,
the RFC 0002 component ABI, the MiakAPI lifecycle, Firebase login UX, an embedded
agent, coordinator-appointed administrators, billing, or a general OAuth
authorization server. Home Keys are first-party high-entropy API credentials;
they are not passwords, Firebase custom tokens or browser credentials.

The keywords **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT** and
**MAY** are normative.

## 2. Trust and security goals

| Party | Trust and authority |
|---|---|
| Firebase Auth | human identity root; issues Firebase ID tokens |
| Control plane | platform root; holds Home Key verifiers, signing authority, push credentials and publisher authority |
| Home owner | may create a home and manage its Home Keys and selected relay |
| Home Key holder | receives only the scopes recorded for that key |
| Coordinator | trusted application authority inside the home named by its token |
| Relay | platform-untrusted but trusted by a home for plaintext data and routing |
| Authenticated user | controls their own push destinations and grants |
| Home bundle | platform-untrusted; receives no control-plane credential |

The design has these required properties:

1. a relay never receives a Home Key, Firebase service credential, signing key,
   push credential or component-publication credential;
2. a token captured by a relay is useless at another relay and at every platform
   HTTP API;
3. deleting a Home Key prevents every new exchange immediately after the
   authoritative transaction commits;
4. access already issued from that key ends after a bounded lease;
5. a Home Key cannot exercise a scope absent from its registry record;
6. possession of a Home Key and knowledge of a Firebase UID is insufficient to
   send that user a push notification; and
7. outside the explicitly designated one-time secret outputs, no public record,
   response, error, audit event or log contains a Home Key, Home Key verifier,
   access token, Firebase token, push destination or signing private key.

This is not end-to-end encryption. The chosen relay still observes home traffic.

## 3. Versioned deployment profile

Every deployment publishes a bounded JSON document at
`/.well-known/miakapp-control-plane`:

```json
{
  "schema": "miakapp.control-plane-discovery/1",
  "issuer": "https://control.example.test",
  "jwks_uri": "https://control.example.test/.well-known/jwks.json",
  "exchange_endpoint": "https://control.example.test/v1/access-tokens:exchange",
  "push_audience": "https://control.example.test/v1/push",
  "components_audience": "https://control.example.test/v1/components"
}
```

All five URLs MUST be absolute HTTPS URLs without user information, query or
fragment. `issuer` has no trailing slash. The other values are exact identifiers,
not prefixes. The document has no unknown fields and is at most 4 KiB.

Resource servers pin this deployment configuration. They MUST NOT follow an
issuer, JWKS URL, resource URL, `jku`, `x5u` or other key location supplied by a
token. Production changes to an issuer or audience are migrations, not discovery
fallbacks.

## 4. Common representations and limits

### 4.1 Identifiers

| Value | Contract |
|---|---|
| home ID | 3..63 ASCII bytes, `[a-z][a-z0-9-]{1,61}[a-z0-9]` |
| Home Key ID | 16 random bytes, unpadded base64url (22 characters) |
| JWS, upload or grant ID | 16 random bytes, unpadded base64url (22 characters) |
| upload capability secret | 32 random bytes, unpadded base64url (43 characters) |
| Home Key label | 1..64 valid UTF-8 bytes, no control characters |
| coordinator name | RFC 0001 coordinator-name grammar |
| idempotency key | 16..128 valid UTF-8 bytes, no control characters |
| access token | compact JWS, at most 8,192 ASCII bytes |

IDs are compared byte-for-byte. They are not Unicode-normalized or case-folded.
Random values use a cryptographically secure generator.

### 4.2 JSON and HTTP

Control-plane requests and responses use UTF-8 JSON with
`Content-Type: application/json`. Unless a section sets a different limit:

- one request body is at most 16 KiB;
- one response body is at most 64 KiB, except the 96 KiB push-grant list in
  Section 12.4;
- nesting depth is at most 16;
- total JSON values are at most 2,048;
- one string is at most 4,096 UTF-8 bytes;
- one array or object has at most 256 entries;
- object keys are unique; and
- `__proto__`, `prototype` and `constructor` keys are rejected.

Objects are closed schemas. Unknown fields are errors. Numbers used for time,
generation or size are non-negative safe integers. Timestamps on HTTP surfaces
are UTC RFC 3339 strings; JWT times are integer NumericDate seconds. The single
named exception is access-exchange `expires_at_ms`, an exact safe-integer
millisecond conversion included for RFC 0003 compatibility.

Browser-callable endpoints allow only the deployment's exact configured HTTPS
origins, use no wildcard CORS origin, set `Access-Control-Allow-Credentials:
false`, and reject cookies as authentication. Secret-bearing and authenticated
responses use `Cache-Control: no-store`; discovery, JWKS and immutable public
artifacts are the only cacheable surfaces, with the explicit policies in their
sections. Redirects are never used for authenticated requests.

Secrets are carried only in `Authorization: Bearer ...`, the standard
`X-Firebase-AppCheck` header, the Section 12 one-time `Miakapp-Push-Proof`
header, or a response field explicitly designated as one-time secret output.
They never appear in a URL, query, path, cookie or redirect.

## 5. Owner bootstrap and home directory

### 5.1 Human authentication

Owner endpoints accept a Firebase ID token and verify it with the profile in
Section 11. A sensitive operation additionally requires `auth_time` no more than
ten minutes in the past. An implementation MAY require a stronger recent-login
or multi-factor policy, but may not weaken this bound.

The verifier returns `sub`, `auth_time` and `exp` as one authenticated principal.
Handlers derive the actor and freshness from that result; they never accept a UID,
authentication timestamp or boolean "recent" assertion from a request body.

The owner is the `uid` stored in the private `controlHomes/{homeId}` record. It
is not copied into the public `homes/{homeId}` directory document and is never
accepted from a request body. Platform-side membership does not exist. A bookmark
in `users/{uid}.homes` grants no authority. Firestore client rules deny every
read and write under `controlHomes`; only Functions/IAM access it.

### 5.2 Home creation

`POST /v1/homes` is the only production path that creates the authoritative home
record. Its body contains:

```json
{
  "home_id": "synthetic-home",
  "name": "Synthetic Home",
  "icon": "house",
  "relay_url": "wss://relay.example.test/ws"
}
```

`name` and `icon` are bounded presentation metadata. `relay_url` MUST be a
canonical `wss:` URL, have no user information, query or fragment, and have a
path ending in `/ws`. The control plane does not contact that URL. Selecting a
self-hosted relay is an explicit owner trust decision.

Creation is one Firestore transaction. It fails with `home_exists` if the ID is
already allocated and never changes an existing owner. A successful transaction
creates the public directory record and a private control-plane record, but no
Home Key. Key creation is a separate security-sensitive operation so a lost HTTP
response cannot leave an unknown bootstrap secret as the only route into a home.
Creation also consumes the per-owner and per-source admission budgets in Section
14 before either record is written.

Owner transfer and coordinator-appointed control-plane administrators are outside
version 1. Deleting a Firebase account does not silently transfer or delete a
home.

### 5.3 Relay selection

Only the owner may change a home's `relay_url`, using recent authentication. The
new value affects subsequent exchanges. Existing relay sockets retain their
current lease; their next reauthentication obtains a token for the selected URL,
causing the SDK to reconnect when the host changed. No access token is issued for
an obsolete selected relay.

### 5.4 Owner HTTP surface

Owner calls use `Authorization: Bearer <Firebase-ID-token>`. The verified `sub`
is the actor. Home creation and relay changes require recent authentication.

`POST /v1/homes` accepts exactly the Section 5.2 object and returns `201`:

```json
{
  "schema": "miakapp.home/1",
  "home": {
    "home_id": "synthetic-home",
    "name": "Synthetic Home",
    "icon": "house",
    "relay_url": "wss://relay.example.test/ws",
    "created_at": "2026-08-31T12:00:00Z",
    "updated_at": "2026-08-31T12:00:00Z"
  }
}
```

`PATCH /v1/homes/{homeId}` accepts a closed object containing at least one of
`name`, `icon` or `relay_url` and returns the same representation. The path ID is
authoritative. `home_id`, owner and timestamps cannot be supplied by the caller.
All writes go through the control plane; public Firestore rules never permit a
client to create or modify a directory home.

## 6. Home Keys

### 6.1 Format and entropy

A Home Key is exactly:

```text
mhk1_<22-character-key-id>_<43-character-secret>
```

The ID is 128 random bits and the secret is 256 random bits, both unpadded
base64url. The complete grammar is:

```text
^mhk1_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$
```

The control plane generates both values. It returns the complete key exactly
once and MUST NOT be able to recover it later. Clients treat it as opaque and
MUST NOT parse it except in conformance tests.

### 6.2 Registry record

The private registry lives at
`controlHomes/{homeId}/homeKeys/{keyId}` and stores, at minimum:

```text
key_id, home_id, verifier, verifier_key_version, label, scopes,
created_at, created_by, revoked_at_or_null, last_used_at_or_null
```

`verifier` is `HMAC-SHA-256(pepper[verifier_key_version], ASCII(homeKey))`.
The pepper is a 256-bit Secret Manager secret bound only to functions that verify
or create Home Keys. Comparison is constant-time. The registry stores neither
the raw key nor a reversible encryption of it. Pepper rotation retains old
versions until all corresponding keys have been replaced or revoked.

Uniform 256-bit key entropy is the primary offline-guessing defense. HMAC also
prevents a Firestore-only disclosure from becoming an offline verifier.

### 6.3 Coarse scopes

Version 1 defines exactly four Home Key scopes:

| Scope | Permits exchange for |
|---|---|
| `relay:coordinator` | an RFC 0001 coordinator session |
| `relay:cli` | an RFC 0001 CLI session |
| `push:send` | the home-scoped push API |
| `components:publish` | component upload/finalization/activation |

A key may hold any non-empty subset. Unknown scopes are rejected, not ignored.
Scopes are coarse trust boundaries. Namespace- or function-level coordinator
restrictions are deferred.

### 6.4 Management and revocation

Only the Firebase-authenticated owner with recent authentication may list, create
or revoke Home Keys. Listing returns metadata but never `verifier` or raw key.
Creation validates the complete requested scope set, commits the registry record,
then returns the one-time secret. The client MUST NOT automatically retry a key
creation whose response is lost. It lists keys, revokes the uncertain key and
creates another.

Revocation is idempotent and commits `revoked_at` transactionally. Every exchange
reads the authoritative record; no positive Home Key verification result is
cached across requests. A revoked key therefore cannot mint a new access token.
Existing access tokens remain valid only until their signed `exp`, at most five
minutes after issuance. Immediate invalidation of already-issued tokens would
require online relay introspection and is deliberately not claimed.

The registry retains at most 64 records per home. When creating a replacement at
that limit, the creation transaction removes the oldest revoked record before it
commits the new key; it never removes an active key to make room. Durable audit
events remain in the separately bounded audit store after registry compaction.

### 6.5 Home Key HTTP surface

All three routes require the authenticated owner and recent authentication:

| Method and path | Request | Success |
|---|---|---|
| `GET /v1/homes/{homeId}/home-keys` | no body | `200` bounded metadata list |
| `POST /v1/homes/{homeId}/home-keys` | `{ "label": string, "scopes": string[] }` | `201` metadata plus one-time `home_key` |
| `DELETE /v1/homes/{homeId}/home-keys/{keyId}` | no body | `204`, including an already revoked or absent syntactically valid ID |

The list and creation metadata shape is:

```json
{
  "key_id": "AAAAAAAAAAAAAAAAAAAAAA",
  "label": "Synthetic coordinator",
  "scopes": ["relay:coordinator"],
  "created_at": "2026-08-31T12:00:00Z",
  "revoked_at": null,
  "last_used_at": null
}
```

Creation wraps this as
`{ "schema":"miakapp.home-key-created/1", "key":<metadata>,
"home_key":"mhk1_..." }`. Listing uses
`{ "schema":"miakapp.home-key-list/1", "keys":[...] }`, ordered by
`created_at` then `key_id`, with at most 64 entries. Deletion's uniform `204`
avoids an owner-only existence oracle and makes revocation safely repeatable.

## 7. Access-token exchange

### 7.1 Request

`POST /v1/access-tokens:exchange` authenticates a Home Key as a bearer credential.
The body is one of these closed shapes:

```json
{
  "purpose": "relay",
  "role": "coordinator",
  "coordinator_name": "automation",
  "reason": "initial"
}
```

```json
{
  "purpose": "relay",
  "role": "cli",
  "reason": "initial"
}
```

```json
{ "purpose": "push" }
```

```json
{ "purpose": "components" }
```

Relay `reason` is `initial`, `reauth` or `reconnect` and is audit metadata only.
The exchange service derives home, key ID, granted scopes, resource audience and
relay URL from trusted registry records. A client cannot request an arbitrary
audience or a set of access-token scopes.

### 7.2 Scope attenuation

The requested profile maps to exactly one required Home Key scope and exactly one
access-token scope. If the key lacks it, exchange fails with `insufficient_scope`.
The issued token contains only that one scope even if the Home Key holds all four.

This attenuation is mandatory. In particular, a relay access token never contains
`push:send` or `components:publish`, because the platform-untrusted relay receives
that token during `HELLO` or `REAUTH`.

### 7.3 Response

Relay exchange succeeds with:

```json
{
  "schema": "miakapp.access-token/1",
  "access_token": "<compact JWS>",
  "token_type": "Bearer",
  "expires_at_ms": 1788211500000,
  "relay_url": "wss://relay.example.test/ws",
  "key": {
    "id": "AAAAAAAAAAAAAAAAAAAAAA",
    "label": "Synthetic coordinator"
  }
}
```

Push and component responses omit `relay_url`. `expires_at_ms` is the exact JWT
`exp` converted to milliseconds and is safe-integer representable. The official
MiakAPI provider maps the relay response to RFC 0003's three-field
`AccessToken`; it does not pass metadata into the SDK core.

Responses use `Cache-Control: no-store`, `Pragma: no-cache` and
`Referrer-Policy: no-referrer`. They never echo the Home Key.

### 7.4 Rate and concurrency behavior

Exchange performs one authoritative key read and one signing operation. Concurrent
requests do not extend the Home Key or mutate its scopes or revocation state;
bounded last-use metadata may update independently and grants no authority. Rate
limits apply independently to source IP, syntactically valid key ID and home.
Invalid credentials receive the same public error whether the ID is absent,
unknown, revoked or has a mismatched verifier.

Clients use one reconnect schedule. The exchange endpoint does not instruct the
SDK to start a second unbounded retry loop. `429` and retryable `503` responses may
include a bounded `Retry-After` value.

## 8. Miakapp access-token JWT profile

### 8.1 Signing algorithm and header

Miakapp access tokens are compact JWS tokens signed with Ed25519. The protected
header has exactly these members:

```json
{ "alg": "EdDSA", "kid": "<signing-key-version>", "typ": "at+jwt" }
```

The verification algorithm is pinned to `EdDSA`; it is never selected from an
untrusted allowlist. The JWK is `kty=OKP`, `crv=Ed25519`, `use=sig` and
`alg=EdDSA`. `kid` is an ASCII identifier of 1..128 bytes. Symmetric algorithms,
`none`, embedded keys and remote key headers are forbidden.

The production signing key is a Cloud KMS asymmetric signing key or an equivalent
non-exportable platform key. Test and emulator keys are deliberately separate and
cannot be loaded in production.

### 8.2 Claims

The common claims are:

```json
{
  "iss": "https://control.example.test",
  "sub": "synthetic-home",
  "aud": "wss://relay.example.test/ws",
  "exp": 1788211500,
  "iat": 1788211200,
  "jti": "BBBBBBBBBBBBBBBBBBBBBB",
  "client_id": "AAAAAAAAAAAAAAAAAAAAAA",
  "scope": "relay:coordinator",
  "miakapp_role": "coordinator",
  "miakapp_coordinator": "automation"
}
```

The claims object is closed. Common fields have these rules:

- `iss` exactly equals the pinned deployment issuer;
- `sub` is the Home Key's home ID;
- `aud` is one string exactly equal to the resource's configured audience;
- `iat` and `exp` are integer NumericDate values, `exp > iat`,
  `exp - iat <= 300` seconds, and `exp <= now + 300`;
- verification rejects `exp <= now` with no expiry grace;
- `iat` may be at most 30 seconds in the future;
- `client_id` is the authenticated Home Key ID;
- `jti` is a fresh cryptographically random JWS ID and both identifiers use the
  rules in Section 4;
- `scope` is exactly one known scope, never an array or space-delimited set; and
- the resource profile below is mutually exclusive with every other profile.

The 30-second `iat` tolerance handles clock skew but does not extend the lease:
an issuer using a future `iat` must shorten the remaining TTL so `exp` stays no
more than 300 seconds after the verifier's current time.
Relays and the control plane require synchronized clocks.

### 8.3 Resource profiles

| Profile | Audience | Required claims | Forbidden claims |
|---|---|---|---|
| coordinator relay | exact selected `relay_url` | `scope=relay:coordinator`, `miakapp_role=coordinator`, valid `miakapp_coordinator` | — |
| CLI relay | exact selected `relay_url` | `scope=relay:cli`, `miakapp_role=cli` | `miakapp_coordinator` |
| push | discovery `push_audience` | `scope=push:send` | `miakapp_role`, `miakapp_coordinator` |
| component publisher | discovery `components_audience` | `scope=components:publish` | `miakapp_role`, `miakapp_coordinator` |

The coordinator row has no additional forbidden profile claim; every required
claim remains mandatory. A resource server validates only its own row and rejects
a validly signed token for another row.

### 8.4 Relay identity binding

For coordinator tokens, the relay derives role, home ID, principal ID and
coordinator name from verified claims. The `HELLO` role and coordinator context
must exactly match. Principal ID equals `sub`.

For CLI tokens, role is CLI, home ID and principal ID equal `sub`, and the HELLO
CLI context is empty. A CLI token cannot authenticate a coordinator socket and a
coordinator token cannot authenticate a CLI socket.

`REAUTH` must validate the same issuer, audience, role, subject, key client and,
for a coordinator, name. It may change `jti`, issue/expiry times and signing key.
It cannot change the established principal.

## 9. JWKS publication and signing-key rotation

The configured `jwks_uri` returns an RFC 7517 JWK Set with at most 16 public keys
and a 64 KiB response limit. Keys have unique `kid` values and only the fields
needed for Ed25519 verification. The response uses HTTPS, no redirects,
`Content-Type: application/json`, an ETag and:

```text
Cache-Control: public, max-age=60, must-revalidate
```

Relay caches are single-flight and bounded. A known key may be used only while
the cached set is fresh. An unknown `kid` triggers at most one immediate refresh
per issuer per ten seconds; random `kid` values cannot cause one fetch each. If a
fresh key set cannot be obtained, new authentication fails as temporary. A relay
does not silently use an expired JWKS cache. Existing sockets remain valid only
until their current token lease requires reauthentication.

Routine rotation is:

1. create a new non-exportable signing-key version;
2. publish its public JWK for at least 60 seconds before first use;
3. begin signing with its `kid`;
4. stop signing with the prior key;
5. retain the prior public JWK for at least 330 seconds after its last issued
   token; and
6. remove and disable the prior version only after that interval.

At least one active key always exists. Rollback means selecting a still-published
non-compromised key, never republishing a removed private key.

Home Key revocation remains bounded by five minutes. A signing-private-key
compromise has a different worst case: a verifier may cache the compromised public
key for 60 seconds and then accept a forged token with a further five-minute
lease. The maximum claimed emergency residual is therefore six minutes, assuming
key removal and synchronized clocks. The platform MUST NOT claim instant signing
key revocation.

## 10. Relay authorization use of access-token scopes

The relay treats successful JWT verification as both authentication and coarse
role authorization:

- `relay:coordinator` permits only RFC 0001 coordinator frames;
- `relay:cli` permits only RFC 0001 CLI frames; and
- no other Miakapp access-token scope is accepted at the WebSocket endpoint.

The relay does not use push or publication scopes, does not introspect a Home Key
and makes no authenticated outbound request. Fine-grained state, event and call
authorization remains RFC 0001 coordinator-declared policy plus coordinator
business authorization.

## 11. Firebase user-token profile

User WebSocket sessions present Firebase ID tokens, not Miakapp access tokens.
The two token profiles use mutually exclusive issuers, algorithms, audiences and
claim validation.

The relay pins its Firebase project ID and the Google Secure Token certificate
endpoint. It verifies the official Firebase profile:

- header `alg` is exactly `RS256`, `kid` selects a cached Google certificate, and
  an RSA modulus is 2,048 through 4,096 bits with a signature length matching it;
- `aud` exactly equals the Firebase project ID;
- `iss` exactly equals `https://securetoken.google.com/<projectId>`;
- `sub` is a non-empty Firebase UID of at most 128 bytes;
- `exp` is strictly in the future;
- `iat` and `auth_time` are integer times not more than 30 seconds in the future;
- the complete RS256 signature verifies; and
- decoded input remains within the JSON and token limits in Section 4.

Google's certificate response is cached according to its `Cache-Control` maximum
age. Fetching is bounded, single-flight and pinned to the configured Google URL.
An unknown `kid` may cause one rate-limited refresh. A fetch failure after cache
expiry is temporary authentication failure.

The verifier returns user ID from `sub`, `auth_time` as `authenticated_at`, and
`exp` as one immutable identity result. The relay forwards `email` only when
`email_verified` is the boolean `true` and the email is valid UTF-8, contains no
control character and is at most 320 bytes. A caller-supplied UID or email is
ignored.

The Firebase token does not bind a home. The RFC 0001 user `HELLO` context selects
the home, where the user begins unenrolled unless a coordinator declaration grants
access. This permits the `miakapp.join` flow without a platform membership table.

Ordinary local verification does not query account disablement or Firebase token
revocation. The browser sends a fresh ID token through `REAUTH` before expiry;
failure closes the socket. The maximum disablement/revocation propagation bound
is therefore the Firebase ID-token lease, and must not be described as immediate.

## 12. Push destinations and grants

### 12.1 Destination ownership

An authenticated user owns private FCM delivery records under
`users/{uid}/pushDestinations/{destinationId}`. Firestore client rules deny every
read and write in this collection. Registration, listing and deletion go through
Functions so a path owned by a UID is never mistaken for proof that the same user
possesses a caller-supplied Firebase Installation ID (FID).

Registration is a two-phase proof-of-possession protocol. First,
`POST /v1/push-destinations:challenge` requires both a Firebase ID token and a
valid Firebase App Check token. Its closed body is
`{ "provider":"fcm", "fid":"<1..4096-byte Firebase Installation ID>" }`. Before contacting
FCM, the Function enforces the per-UID, per-App-Check-app and per-source budgets
in Section 14. App Check authenticates the calling app and Firebase authenticates
the user; neither is treated as proof that this installation owns the supplied
FID. The Function stores a five-minute challenge bound to the verified UID,
verified App Check app ID and a keyed FID fingerprint, sends a
random 256-bit challenge
secret in a data-only FCM message, and returns `202` with exactly
`schema="miakapp.push-challenge/1"`, a random `challenge_id` and `expires_at`.

The app that receives that message calls
`POST /v1/push-destinations:complete` with the same verified Firebase UID and App
Check app ID and `Miakapp-Push-Proof: <challengeId>.<secret>`. The Function
compares the proof in constant time, consumes it once, rechecks destination and
write quotas transactionally, chooses the random destination ID, and stores the
record. The UID, App Check app ID and FID fingerprint must all match the
challenge. An app logged in as another user cannot complete it. Expired,
replayed, wrong-user and wrong-app proofs fail uniformly as
`invalid_destination_proof`.

Version 1 destination records contain exactly
`schema="miakapp.push-destination/1"`, `provider="fcm"`, private `fid`, keyed
`fid_fingerprint`, verified App Check `verified_app_id`, and
`created_at`/`updated_at`
server timestamps. The completion response contains bounded metadata but never
the raw FID. A coordinator and relay never receive the destination. Challenge
records and uncompleted FIDs are short-lived and garbage-collected. Provider
registration refresh and stale-record cleanup follow the current FCM lifecycle
guidance. The FID remains delivery metadata, not authorization evidence; only
successful completion of the bound one-time challenge proves possession for this
registration. The challenge `expires_at` field has a Firestore TTL policy;
application-level bounded pruning remains mandatory because TTL deletion is not
an instantaneous admission-control mechanism.

`GET /v1/push-destinations` returns at most 16 metadata records and
`DELETE /v1/push-destinations/{destinationId}` returns uniform `204`; both require
the verified user and App Check. Deleting a destination immediately invalidates
every referencing grant because
send authorization requires a current destination read. Physical grant cleanup
may be asynchronous. Destination identifiers are random 16-byte IDs and do not
contain or encode the FID. Direct non-FCM Web Push is deferred.

The complete destination-management surface is:

| Method and path | Request | Success |
|---|---|---|
| `POST /v1/push-destinations:challenge` | Section 12.1 provider/FID object | `202`, challenge object |
| `POST /v1/push-destinations:complete` | `{}` plus `Miakapp-Push-Proof` | `201`, destination object |
| `GET /v1/push-destinations` | no body | `200`, destination list |
| `DELETE /v1/push-destinations/{destinationId}` | no body | uniform `204` |

The challenge response is exactly:

```json
{
  "schema": "miakapp.push-challenge/1",
  "challenge_id": "AAAAAAAAAAAAAAAAAAAAAA",
  "expires_at": "2026-08-31T12:05:00Z"
}
```

Public destination metadata is exactly `destination_id`, `provider`,
`created_at` and `updated_at`. Completion wraps it as
`{ "schema":"miakapp.push-destination-created/1", "destination":<metadata> }`.
Listing returns
`{ "schema":"miakapp.push-destination-list/1", "destinations":[...] }`,
ordered by `created_at` then `destination_id`, with no more than 16 entries.
These closed responses omit `fid`, `fid_fingerprint`, `verified_app_id` and every
other private destination field. Completion's empty object and proof
header are also closed: no destination ID or metadata is client-selected.

### 12.2 Explicit home-scoped grant

The Firebase-authenticated user creates a grant for the path-scoped home with:

```json
{
  "destination_id": "CCCCCCCCCCCCCCCCCCCCCC"
}
```

Creation is the user's explicit consent for that destination to receive push
messages attributed to that home. It returns a random grant ID, expiration and
home ID. The browser sends the grant ID to the coordinator over an authenticated
RFC 0001 call, whose principal lets the coordinator associate it with the user.

The platform intentionally does not consult a membership table. A user may grant
their own destination to any home ID, but a coordinator learns the grant only if
the user conveys it. This preserves consent without letting a Home Key nominate
an arbitrary Firebase UID.

A grant is bound to one `(home_id, uid, destination_id)`, expires no later than
180 days after creation, and is independently revocable by the user. At most one
grant for that tuple is active. Renewal atomically revokes the prior record,
creates a replacement with a new expiry and requires an authenticated user
action; implementations may make that action part of an explicit settings flow.

### 12.3 Sending

`POST /v1/push` accepts only a Miakapp push-profile token. Its body contains a
grant ID and a bounded semantic notification:

```json
{
  "grant_id": "DDDDDDDDDDDDDDDDDDDDDD",
  "title": "Synthetic alert",
  "body": "A synthetic sensor needs attention.",
  "tag": "sensor-alert"
}
```

`title` is 1..120 UTF-8 bytes, `body` is 1..1,024, and optional `tag` is 1..64;
all reject control characters. Arbitrary URLs, destination addresses, UIDs, raw
FCM options, HTML and unknown fields are forbidden. The platform constructs any
click destination from the verified home ID. Version 1's exact HTML-free text
grammar additionally rejects U+003C (`<`) and U+003E (`>`) in `title`, `body`
and `tag`; consumers render all three as text, never markup.

The Function requires all of:

- valid `push:send` token for the push audience;
- active grant whose `home_id` equals JWT `sub`;
- unexpired destination still owned by the grant's user; and
- rate and cost budget for key, home, grant and destination.

Success is `202` with exactly
`{ "schema":"miakapp.push-accepted/1", "request_id":"<22-char-id>" }`.
It means accepted by the platform push service, not displayed by the device.
Invalid, revoked, expired or cross-home grants reveal no destination or user
metadata.

### 12.4 Push-grant HTTP surface

Grant management uses the Firebase ID-token profile and derives the user from
verified `sub`:

| Method and path | Request | Success |
|---|---|---|
| `GET /v1/homes/{homeId}/push-grants` | no body | `200` current caller's bounded grants for the home |
| `POST /v1/homes/{homeId}/push-grants` | `{ "destination_id": "<22-char-id>" }` | `201` new grant metadata |
| `DELETE /v1/homes/{homeId}/push-grants/{grantId}` | no body | uniform `204` |

Grant metadata contains exactly `grant_id`, `home_id`, `destination_id`,
`created_at`, `expires_at` and `revoked_at`; it never contains the FID.
The creation response schema is `miakapp.push-grant/1`, the list schema is
`miakapp.push-grant-list/1`, and lists are ordered and capped at 256. Creating a
replacement is the version 1 renewal operation. None of these routes accepts a
Home Key or Miakapp access token.
The closed creation response is exactly
`{ "schema":"miakapp.push-grant/1", "grant":<metadata> }`; the closed list
response is exactly
`{ "schema":"miakapp.push-grant-list/1", "grants":[<metadata>,...] }`, ordered
by `created_at` then `grant_id`.
This list is the sole 96 KiB response-body exception to Section 4.2. The larger
bound accommodates all 256 closed metadata records, including 63-byte home IDs
and populated `revoked_at` timestamps; every other response remains capped at
64 KiB.
Deletion returns the same `204` for an owned active, already revoked, absent, or
different-user grant ID after authenticating the caller; only a matching
`(uid, homeId, grantId)` record is mutated. This prevents an existence oracle and
makes retry safe.

## 13. Component publication authorization

### 13.1 Authorization and invariants

The RFC 0002 publication sequence is authorized either by:

1. the home owner with recent Firebase authentication; or
2. a Miakapp component-publisher token whose `sub` equals the target home.

No relay token is accepted. The authorized publisher may:

- request one short-lived upload capability bound to the complete home, release,
  ABI, requirements, digest and size tuple;
- finalize only that immutable content-addressed object after delivery-path
  read-back verifies exact size and digest; and
- compare-and-set `components/{home}` from an expected generation to a strictly
  greater generation using the exact RFC 0002 pointer schema.

The upload capability expires within fifteen minutes, permits one object name and
cannot overwrite an existing digest. It contains no bucket-wide credential.
Finalization rejects module syntax, dynamic imports, source-map directives and
the other RFC 0002 publisher checks before activation, including its parse-time
100,000-token and 250,000-AST-member ceilings. An uploaded but unfinalized object
is an orphan eligible for garbage collection.

Activation is one transaction. A stale expected generation fails with
`generation_conflict`; last-write-wins is forbidden. A quarantined digest cannot
be activated even by an owner or valid publisher token. Rollback republishes a
previously verified digest at a new, greater generation; it does not upload or
finalize new bytes during the rollback transaction.

### 13.2 Publication HTTP surface

Publication endpoints accept either a recently authenticated home owner or a
`components:publish` token for the target home. The bounded protected JWT header
selects exactly one pinned verifier: `RS256` means the Firebase owner profile and
`EdDSA` means the Miakapp publisher profile. Any other algorithm is rejected, and
failure in one profile never falls back to the other.

Publication APIs never accept a Home Key directly. A Home Key holder must first
exchange it for the five-minute component profile, and a fresh token used later
must retain the same verified `client_id` to count as the original publisher.

The publisher first calls
`POST /v1/homes/{homeId}/component-uploads` with:

```json
{
  "release": "2026-08-31.1",
  "abi": "miakapp.component/1",
  "sha256": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
  "size": 4096,
  "requires": {
    "state_read": ["global.temperature"],
    "event_subscribe": [],
    "event_publish": [],
    "call": ["lighting.set"],
    "presentation": []
  }
}
```

The closed `requires` object and every field use RFC 0002's pointer rules. A
successful `201` returns schema `miakapp.component-upload/1`, a random
22-character `upload_id`, a non-secret HTTPS `upload_url` with no query or
fragment and ending in that ID, a
43-character random `upload_token`, and `expires_at`. The token is returned once,
stored only as a verifier, bound to the exact
`(home, digest, size, release, abi, requires)` tuple and expires within fifteen
minutes.

The client sends the exact Worker bytes once with `PUT <upload_url>`,
`Authorization: Bearer <upload_token>`,
`Content-Type: application/javascript; charset=utf-8` and an exact
`Content-Length`. The upload URL contains no credential. The upload endpoint
accepts no cookies, redirects, ranges, compression or multipart encoding, streams
with the 2 MiB ceiling and returns `204`. A capability cannot be reused. Upload
objects remain private staging data. After successful finalization, the service
copies or promotes the exact verified bytes to an immutable, content-addressed,
token-free public object whose CORS policy permits the trusted web host. The RFC
0002 pointer names only that final object and contains no query credential.

The original publisher then calls
`POST /v1/homes/{homeId}/component-uploads/{uploadId}:finalize` with an empty JSON
object. Finalization reads the delivered immutable object back, verifies the
bound size, digest and RFC 0002 syntax, and returns schema
`miakapp.component-release/1` with the stored release metadata. It never trusts
metadata repeated by the client.

The upload capability and finalization record bind the verified publisher
identity as well as `(home, digest, size, release, abi, requires)`. A different
Home Key for the same home cannot finalize the upload. A lost upload `PUT`
response is reconciled through upload metadata before another attempt; a lost
finalization response is reconciled by reading the release record. Neither
operation is blindly retried with a new capability.

The same publisher authorization protects both reconciliation reads. `GET
/v1/homes/{homeId}/component-uploads/{uploadId}` returns the closed schema
`miakapp.component-upload-status/1` with `upload_id`, `status`, `release`, `abi`,
`sha256`, `size`, `requires` and `expires_at`, but never the upload URL or token.
`status` is exactly `awaiting_upload`, `delivered` or `finalized`. This read
distinguishes whether a lost upload `PUT` took effect. `GET
/v1/homes/{homeId}/component-releases/{sha256}` returns the closed schema
`miakapp.component-release/1` with `release`, `abi`, `sha256`, `size`, `requires`
and `finalized_at`, or uniform `invalid_artifact` when no matching finalized
record exists. A publisher that lost the finalize response uses this second read
before deciding whether another action is necessary.

Finally `POST /v1/homes/{homeId}/component-releases:activate` accepts exactly:

```json
{
  "sha256": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
  "expected_generation": 0,
  "generation": 1
}
```

It derives every other pointer field from the finalized record and returns the
exact RFC 0002 pointer. Finalization and activation require publisher authority
again; possession of an upload capability alone grants neither operation.

## 14. Quotas, admission and cost bounds

Every production deployment declares finite limits for at least:

- exchange requests per IP, key and home;
- home creations per Firebase UID and source-network fingerprint;
- active Home Keys per home;
- active push challenges and destinations per Firebase UID and App Check app ID;
- active and retained push grants per user/home and push sends per grant/home;
- component upload bytes, attempts and activated releases per home;
- public request body, response body and concurrency; and
- audit writes and retained audit bytes.

The version 1 portability ceilings are 16 owned homes per Firebase UID, 64 active
Home Keys and 64 total Home Key registry records per home, four live push
challenges and 16 active push destinations per UID, 16 active push grants and 256
retained grant records per `(user, home)`, the RFC 0002 2 MiB artifact limit and
16 active JWKS keys. When renewal would exceed the retained-grant ceiling, the
same transaction removes the oldest revoked, expired or destination-invalidated
record before creating the replacement; an active grant is never removed to make
room. Deployments may configure lower limits and advertise retryable exhaustion,
but cannot accept an unbounded collection.

Counters used to admit homes, destinations and keys are reserved and committed in
the same transaction as the new record. The active-grant bound is structural:
there is at most one active grant per `(user, home, destination)` and at most 16
active destinations per user. Grant creation and retained-record compaction still
commit together. A Firestore rule based only on querying current collection size
is insufficient. Challenge issuance and home creation additionally use bounded
per-source rate buckets so fresh UIDs cannot turn FCM or persistent Firestore
writes into an unbounded cost oracle.

Rate limiting occurs before expensive signing, KMS, Storage or FCM work whenever
the required key is available. Invalid-key limits do not depend solely on a
database lookup controlled by the attacker. A deployment-level relay admission
policy separately bounds connections per IP, total homes and aggregate memory;
those limits are not access-token claims.

## 15. Audit, privacy and redaction

Security-sensitive control-plane operations append a bounded audit event. Events
include a generated event ID, server time, operation kind, outcome, home ID when
known, actor kind and a deployment-keyed, truncated fingerprint of a verified
actor, key or grant identifier. Raw grant IDs are capabilities and are never
stored in audit. Events may include a separately keyed truncated network
fingerprint for abuse correlation.

Audit and application logs MUST NOT include:

- Authorization headers or raw request bodies containing credentials;
- Home Keys, Home Key verifiers or pepper material;
- access, Firebase or upload-capability tokens;
- raw push challenge proofs or grant IDs;
- JWT signatures, push destinations or notification bodies;
- component bytes, home state, call arguments or user email; or
- raw IP addresses in long-lived audit storage.

Public errors contain a generated request ID for correlation. Detailed internal
causes remain in access-controlled diagnostics with the same secret redaction.
Audit retention is finite and documented; deletion policy and legal basis are a
deployment responsibility.

## 16. Stable HTTP failures

Errors use the closed shape:

```json
{
  "error": {
    "code": "invalid_home_key",
    "message": "Authentication failed",
    "retryable": false,
    "request_id": "EEEEEEEEEEEEEEEEEEEEEE"
  }
}
```

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `invalid_request` | malformed, oversized or unknown-field input |
| 401 | `invalid_firebase_token` | human authentication failed |
| 401 | `invalid_app_check_token` | application verification failed |
| 401 | `recent_authentication_required` | sensitive owner operation needs reauthentication |
| 401 | `invalid_home_key` | absent, unknown, revoked or mismatched key |
| 401 | `invalid_access_token` | signature or token profile failed |
| 401 | `invalid_destination_proof` | push challenge is absent, expired, replayed or identity-mismatched |
| 401 | `invalid_upload_capability` | upload capability is absent, expired, replayed or mismatched |
| 403 | `not_home_owner` | verified user does not own the home |
| 403 | `insufficient_scope` | Home Key lacks the required scope |
| 403 | `invalid_push_grant` | grant is unusable without exposing why |
| 403 | `publisher_mismatch` | a different verified publisher attempted finalization |
| 403 | `digest_quarantined` | release cannot be activated |
| 404 | `home_not_found` | target home does not exist |
| 409 | `home_exists` | home ID is allocated |
| 409 | `generation_conflict` | component CAS precondition failed |
| 413 | `limit_exceeded` | body, object or collection ceiling exceeded |
| 422 | `invalid_artifact` | upload is absent, unfinalized or fails read-back validation |
| 429 | `rate_limited` | bounded rate or cost budget exhausted |
| 503 | `temporarily_unavailable` | signing or required platform dependency unavailable |

Messages are stable, safe English text and never repeat attacker input. Unknown
internal failures map to `temporarily_unavailable` or a generic internal failure,
not to serialized exception text. Retryability never implies that a non-idempotent
key creation, push send or publication activation may be blindly retried.

## 17. Transactions, idempotency and uncertain outcomes

Firestore transactions protect owner bootstrap, key registry mutation, grant
mutation and component pointer activation. Callers may use an `Idempotency-Key`
only on operations whose endpoint explicitly stores a bounded result. An
implementation does not infer idempotency from HTTP method alone.

Home Key creation returns a one-time secret and is deliberately non-replayable.
Push delivery may already have reached FCM when a response is lost. Component
activation may already have committed. For each such operation, a transport loss
is `outcome_unknown`; the caller reconciles through the exact Section 13 metadata
reads, audit or the RFC 0002 active pointer instead of automatically repeating
the effect.

## 18. Emulator and conformance requirements

The public corpus under `control-plane-contract/` is synthetic. Fixture hosts use
`.test`, Firebase UIDs are fictional and every private key is marked test-only.
The corpus contains no production home, user, host, credential or push address.

Independent TypeScript and Go implementations consume the same signed token
vectors and MUST agree on valid and invalid profiles. The TypeScript behavioral
model additionally exercises control-plane state transitions. This public
contract harness MUST prove:

1. exact Home Key grammar and verifier calculation;
2. owner-only key creation and revocation plus recent-authentication denial
   derived from a signed Firebase `auth_time` older than ten minutes;
3. immediate exchange denial after revocation and expiry of prior access;
4. one-scope resource attenuation, successful push/component use of an exchanged
   token, and rejection of a direct Home Key, expired token or cross-resource
   substitution at those APIs;
5. exact issuer, audience, role and coordinator identity extraction;
6. algorithm confusion, `none`, unknown `kid`, bad signature, malformed base64url,
   duplicate JSON keys, unpaired Unicode surrogates, unsafe integers, overlong
   TTL, future issue time and expired token rejection;
7. signing-key overlap, at least 60 seconds of prepublication, first signing-key
   use, and at least 330 seconds of retiring-key retention through explicit
   clocked key-set transitions;
8. Firebase RS256 claim validation with 2,048- and 3,072-bit keys, authenticated
   time extraction and verified-email suppression;
9. challenge-proved FID destination registration bound to verified Firebase UID
   and App Check app ID, proof expiry/replay/wrong-principal denial, user-created
   grant, cross-home denial, causal grant expiry without an intervening
   invalidator, uniform revocation and destination deletion;
10. component-token and recent-owner publication authorization, one-use upload
    capability, complete `(home, release, ABI, requirements, digest, size,
    publisher)` binding, byte-derived delivery-path read-back, delayed
    reconciliation with fresh authority, generation CAS, quarantine and rollback
    to an already verified digest;
11. bounded JSON, files, audit projections and the exact 16-home, four-live-push-
    challenge, 16-destination, 64-active-and-retained-key, structurally bounded
    16-active-grant and 256-retained-grant boundaries, including causal active-
    grant reconstruction and successful replacements that transactionally
    compact both retained sets;
    and
12. privacy scanning plus human review of every public fixture.

The local Firebase vertical slice must use a `demo-*` project and Auth, Firestore,
Functions and Storage emulators. It MUST additionally test every Section 5, 6,
7, 12 and 13 HTTP schema, one-time-secret redaction, Firestore transactions and
rules, push challenge expiry/reuse, uniform revocation, upload capability
expiry/reuse, delivery-path
read-back, concurrent generation CAS, bounded rate/cost admission, retry and
uncertain-outcome behavior. Relay integration MUST prove exact `HELLO`/`REAUTH`
binding, JWKS cache expiry, single-flight unknown-`kid` refresh and refresh abuse
limits.

The Local Emulator Suite provides no App Check or FCM service emulator. Local
tests therefore use explicitly synthetic App Check verifier and FCM transport
seams. That evidence may prove the closed HTTP schemas, identity and FID binding,
one-time proof state machine, authorization, quotas and the exact outbound
transport request, but it is not App Check attestation or FCM service evidence.

Emulator success does not prove Cloud KMS, IAM, Secret Manager, real App Check
verification or enforcement, real FCM acceptance or delivery, ingress limits or
production Google certificate behavior. Those remain staging gates before
deployment.

## 19. Security claims and non-claims

After both contract and production acceptance tests pass, Miakapp may claim:

- relays verify coordinator/CLI access without holding a platform secret;
- relay-captured access cannot be replayed at another configured audience or a
  push/publication API;
- Home Key scope and revocation bound newly issued authority;
- push delivery requires an explicit user-created home grant; and
- component activation is home-bound, verified and generation-conditional.

Miakapp MUST NOT claim:

- immediate invalidation of an already-issued access or Firebase ID token;
- that a selected relay cannot read or alter home traffic;
- that separate Home Keys inside one home create mutually distrusting coordinator
  authority domains;
- guaranteed push display or exactly-once delivery;
- confidentiality of a finalized component artifact, which is intentionally
  public, immutable and must contain no credential, private home state or source
  map;
- that a signature or content digest makes generated code safe; or
- production readiness from fixture, emulator or library tests alone.

## 20. Deferred and rejected alternatives

### Relay introspects Home Keys

Rejected. It discloses the permanent credential to a platform-untrusted relay,
creates an authenticated hot-path call from the wrong IP and prevents secret-free
self-hosting.

### Long-lived signed Home Key

Rejected. A stateless non-expiring signed bearer is not revocable. Home Keys are
long-lived opaque credentials exchanged by their holder; relay access is a short
signed lease.

### One multi-audience token with every key scope

Rejected. A relay receiving that token could reuse it for push or publication.
Every token is attenuated to one resource profile and one scope.

### Bare `{homeKey, uid}` push request

Rejected. A Home Key proves control of a home, not user consent or ownership of a
push destination.

### Direct client writes for push destinations

Rejected. A Firestore path scoped to `request.auth.uid` proves who writes the
document, not possession of the FID inside it, and rules cannot provide the
transactional quotas and FCM challenge audit required here. Registration uses the
two-phase Function protocol in Section 12.

### Platform membership relation

Rejected for 3.5. The coordinator owns membership and permissions. User-owned
home bookmarks remain convenience data only.

### Direct client writes for component pointers

Rejected. Client-side rules cannot prove delivery-path read-back, digest
quarantine, generation CAS and scoped publisher authority as one operation.

### Online Firebase revocation check on every socket

Rejected from the default hot path. Local signature verification plus bounded
reauthentication removes a per-connection platform dependency. Deployments may
add a stronger profile but must name its availability and latency costs.

## 21. References

- [RFC 7515 — JSON Web Signature](https://www.rfc-editor.org/rfc/rfc7515)
- [RFC 7517 — JSON Web Key](https://www.rfc-editor.org/rfc/rfc7517)
- [RFC 7519 — JSON Web Token](https://www.rfc-editor.org/rfc/rfc7519)
- [RFC 8037 — CFRG elliptic-curve algorithms for JOSE](https://www.rfc-editor.org/rfc/rfc8037)
- [RFC 8725 — JSON Web Token Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725)
- [RFC 9068 — JWT profile for OAuth 2.0 access tokens](https://www.rfc-editor.org/rfc/rfc9068)
- [Firebase ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Firebase App Check for custom backends](https://firebase.google.com/docs/app-check/custom-resource-backend)
- [Firebase Cloud Messaging web receive](https://firebase.google.com/docs/cloud-messaging/web/receive-messages)
- [FCM registration management](https://firebase.google.com/docs/cloud-messaging/manage-tokens)
- [Firebase Local Emulator Suite](https://firebase.google.com/docs/emulator-suite)
- [Google Cloud KMS asymmetric signing](https://cloud.google.com/kms/docs/create-validate-signatures)
