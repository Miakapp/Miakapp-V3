# Miakapp 4 — Design

Date: 2026-08-29
Status: architecture approved; wire, component-runtime, coordinator-SDK,
platform-control-plane and trusted-browser contracts accepted; operational
migration remains open
Scope: the Miakapp ecosystem. This document is the shared contract between the
web app, `miakapp-server` (rewritten in Go), MiakAPI and the Firebase Functions.
Each repository derives its own implementation plan from it.

The web app's own rebuild is not covered here and needs its own design pass. The
exact wire format is RFC 0001, the component capability boundary is RFC 0002 and
the MiakAPI coordinator surface plus temporary migration-adapter boundary are RFC
0003. RFC 0004 defines the platform control plane and RFC 0005 defines the trusted
browser relay client. The operational migration procedure remains an explicit
gate. A repository may proceed only through the gates required by its current
vertical slice (§ 19).

---

## 1. Context

Miakapp relays a home's state in real time between a **coordinator** (a program
running at the user's home, behind NAT) and **users** (browsers).
`miakapp-server` is the mandatory hop, because the coordinator has no public
address.

Moving to Miakapp 4 changes what the server *is*: it stops being a relay that carries
business logic and becomes a **generic data bridge**. All application logic —
users, permissions, invitations — moves down into the coordinator, which is
written by an AI agent.

### Why a rewrite

Auditing the v3 server surfaced structural defects, not isolated bugs:

| Finding | Detail |
|---|---|
| The "optimised" codec is larger than JSON | Measured: 56 B vs 49 B. `miakode` produces a string, which `Buffer.from()` re-encodes as UTF-8; every character ≥ 0x80 becomes two bytes. |
| The codec does not compute the minimum it thinks it does | `m > c` compares a `number` to a `string`, always `false`. The "minimum" is the first character's code. The round-trip holds by luck. |
| The rate limiter limits nothing | `wsServer.js` writes `.l` and reads `.last` (`undefined`) → `NaN`, so the condition is never true. `.i` stays at 0. |
| Guaranteed memory leak | `Home.destroy()` is never called: a home seen once keeps its Firestore listeners open until restart. |
| Artificial latency floor | Every `COMMIT` resends the full state to every user, re-filtered and re-encoded per socket. No diffing. |
| Useless application-level heartbeat | A round trip every 5 s, when RFC 6455 provides control frames the browser answers inside the network stack. |
| Security | Hard-coded origin allowlist, `firebase-admin@9` (2021), no tests. |

### Deployment shape

Miakapp is not yet deployed at a scale that constrains the migration: there is
no fleet of third-party installations to protect, and the whole dataset fits
comfortably in a single JSON export.

That is what makes a **final platform cutover** viable without a permanent
compatibility layer (see § 16). It does not remove the need for beta, shadow,
canary and rollback validation. A project with third-party operators would have
to decide differently.

---

## 2. What goes away

- `miakode` — replaced by MessagePack plus a path dictionary.
- The application-level `PING`/`PONG` heartbeat — replaced by WebSocket control frames.
- Platform-side groups, permissions, pages and invitations.
- The `relations` Firestore collection and its ~120 lines of rules.
- The Coordinator Secret — replaced by Home Keys.
- The Firestore read in the user authentication path.
- Persistent Firebase service credentials inside the server.
- `.devcontainer/`, `.vscode/`, and every mention of abandoned tooling.

---

## 3. Target architecture

```mermaid
flowchart LR
    C[Coordinator<br/>MiakAPI · Bun/TypeScript]
    F[Firebase Function<br/>Home Keys · push · JWKS]
    R[miakapp-server<br/>Go · no persistent platform secrets]
    B[Browser host<br/>trusted React shell]
    S[Firestore + Storage<br/>directory · pointers · bundles]
    U[Sandboxed home UI<br/>home-authored React bundle]

    C -->|1 · HTTPS Home Key exchange| F
    C -->|2 · WSS short-lived token| R
    B -->|3 · HTTPS ID + App Check exchange| F
    F -->|4 · relay URL + short lease| B
    B -->|5 · WSS short-lived token| R
    B -->|6 · pointer and immutable release| S
    C -->|7 · HTTPS push request| F
    B <-->|versioned capability bridge| U
```

1. The coordinator exchanges its Home Key for its server address and a short-lived token.
2. It connects to the server with that token.
3. The browser host sends its Firebase ID and App Check tokens only to the
   control-plane HTTPS exchange.
4. The control plane returns one relay URL and audience-bound five-minute token.
5. The user connects to that relay with only the Miakapp token.
6. The browser host reads the component pointer from Firestore, verifies the
   release, and loads it in a sandboxed, non-credential-bearing context.
7. The coordinator requests a push through the Function.

**The server holds no persistent platform or home secret.** It verifies
signatures with public keys and makes no authenticated outbound calls. The
current user path gives it only a relay-specific Miakapp lease; Firebase source
credentials remain on HTTPS. Every profile still exposes plaintext home data, so
the selected relay is trusted by the home for confidentiality and correct
routing (§ 4). Audience binding removes the cross-relay bearer risk, not
plaintext visibility.

---

## 4. Trust model

| Party | Trust | Consequence |
|---|---|---|
| Firebase Auth | identity root | provides `uid` and `email_verified` |
| Firebase Function | platform root | sole holder of platform signing, push and Home Key material |
| Coordinator | trusted within its own home | application permission authority; deployed agent output is reviewed as ordinary privileged code |
| miakapp-server | target: **platform-untrusted, home-data-trusted** | anyone may host one after user credentials are audience-bound; it sees plaintext home state |
| Browser host | trusted platform client | holds Firebase identity and enforces the component capability boundary |
| Home UI bundle | untrusted by the platform | executes in a sandbox without ambient Firebase credentials or host-origin authority |

Two properties follow from the server being **platform-untrusted**:

- The Function never talks to it. The coordinator is the caller (§ 5.2).
- The short-lived token carries an `aud` claim naming the destination server;
  otherwise a malicious server could replay a captured token against the
  official server to impersonate the coordinator.

The original Firebase-direct user profile did not satisfy the second property:
its audience was the Firebase project, so the selected relay received a reusable
user bearer. It is now a historical synthetic-only fixture profile. RFC 0005's
current path issues a short-lived credential bound to the exact relay, Home, UID
and user role, and the production relay rejects Firebase source tokens. That path
has complete local two-relay evidence plus one successful bounded private
control-plane probe; live relay/browser staging acceptance remains a production
gate. This is credential attenuation, not an end-to-end encryption claim.

This is not end-to-end encryption. A relay that terminates WSS can observe,
alter, replay, misroute, delay or drop application messages. A home must trust
its selected relay operator for those properties. Making the relay blind would
require a separate end-to-end key, membership, recovery and revocation design;
that work is deferred (§ 17).

---

## 5. Authentication

### 5.1 Users

The browser sends its Firebase ID token and App Check token only to RFC 0004's
HTTPS user-relay exchange. The Function verifies both source credentials, reads
the authoritative Home record and returns one atomic `{relay URL, access token,
expiry}` result. Issuance proves authenticated application context and Home
existence, not ownership, enrollment or membership.

The resulting Ed25519 Miakapp token has an exact relay audience, Home ID,
Firebase UID, `miakapp_role=user`, `scope=relay:user` and maximum five-minute
lease. It may carry the email only when Firebase marked it verified. The relay
verifies that profile locally against the control-plane JWKS cache and binds
`HELLO` to the signed Home and user. It makes no authenticated platform call,
fetches no Firebase certificate and rejects Firebase ID or App Check tokens as
relay credentials.

Before expiry, the browser repeats the HTTPS exchange and sends the new Miakapp
token over `REAUTH` when the relay URL is unchanged. If the authoritative route
changed, it closes the old transport before opening one replacement with the
already-issued credential; it never sends an audience-mismatched token to the
old relay or performs a duplicate exchange. Failure closes the session. Already
issued relay authority remains bounded by five minutes. Live Firebase account
disablement, revocation and App Check provider behavior remain staging evidence.
Home membership changes are independent: the coordinator removes or changes the
user's declarations and the relay applies the change immediately.

### 5.2 Coordinators and CLI

A refresh/access token split:

1. The coordinator calls the Function with its **Home Key** (256 bits, no
   expiry, revocable).
2. The Function verifies the key, rate-limits on the caller's IP, and returns:
   the server host to use, a signed **short-lived token** (5 min TTL, `aud` =
   that host, `sub` = homeID, exactly one resource scope), and the key's metadata.
3. The coordinator connects to the server and presents the token.
4. The server verifies it against the platform's public key (cached JWKS). It
   makes no authenticated outbound call; public key refresh is the only network
   dependency of verification.
5. Thirty seconds before the five-minute token expires by default (or halfway
   through a lease shorter than 60 seconds), the coordinator re-exchanges its
   Home Key and pushes the new token over the existing socket (`REAUTH`). Failure
   → disconnect.

Step 5 is what gives revocation a bounded effect on an already-established
connection. The maximum residual access is the reauthentication interval, not
the lifetime of the Home Key.

The CLI uses the exact same exchange with a distinct scope and normally closes
the connection after one operation batch.

**Why not a long-lived signed token**: a stateless token without expiry is
irrevocable by construction. Signature, absence of expiry and revocability are
pairwise incompatible; the refresh/access split is the only way to get all
three.

**Why not a server → Function call**: that would turn the Function into an
oracle queryable by the platform-untrusted relay, with the rate limit keyed on
the server's IP instead of the real caller's.

---

## 6. The Miakapp 4 protocol

Protocol 1.0 is defined normatively by
[`RFC 0001`](../rfcs/0001-wire-protocol.md). The RFC, shared binary fixtures and
independent Go and TypeScript codecs are the contract; this architecture
document records only its consequences.

### 6.1 Transport and negotiation

The transport is one binary WebSocket at `wss://<host>/ws`, using the constant
`miakapp` WebSocket subprotocol. One WebSocket message contains exactly one
application frame. Version `[1, 0]` is negotiated in `HELLO`, so an incompatible
peer receives a stable protocol error instead of depending on browser handshake
diagnostics.

RFC 6455 Ping/Pong control frames provide liveness. The browser answers below
JavaScript. Browser handshakes use an exact `Origin` allowlist; all roles
authenticate in their first application frame and reauthenticate before their
current token deadline.

### 6.2 Encoding

Each frame is one opcode byte followed by one canonical MessagePack array. The
earlier candidate combination of custom LEB128 fields plus MessagePack was
discarded: compact MessagePack integers already provide the relevant size
property, while a second binary grammar would duplicate validation and fuzzing
work.

The Miakapp profile permits null, booleans, JavaScript-safe integers, finite
non-integral float64 values, valid UTF-8, binary, arrays and string-keyed maps.
It fixes shortest encodings and UTF-8 byte ordering for map keys, rejects
extensions and applies exact frame, depth, node and container limits before a
generic decoder can allocate from the input.

Paths, topics and function names are still interned as integer IDs for the life
of a home epoch. The optimisation now has a deterministic byte contract but must
still be benchmarked on representative traces before its operational value is
claimed.

### 6.3 Frame families

Protocol 1.0 defines forty core opcodes:

| Range | Family | Contract |
|---|---|---|
| `0x00..0x07` | session | negotiation, errors, reauthentication, status and draining |
| `0x10..0x19` | state | complete coordinator declarations, dictionaries, snapshots, revisioned patches, mutations and ACLs |
| `0x20..0x29` | events | topic declarations, event ACLs, subscriptions and at-most-once live delivery |
| `0x30..0x39` | calls | function declarations, dispatch metadata, acceptance, credit-bounded streaming, results, errors and cancellation |
| `0x40..0x41` | presence | current authenticated user sessions and changes |

Payload arity, field types, enum values, direction, limits and error numbers are
specified only in the RFC. Core opcodes are never reassigned. Unknown optional
extensions use `0x80..0xff` and are ignored only after structural validation.

### 6.4 State, calls and failure semantics

State is convergent. An authenticated user receives a complete dictionary and
snapshot before patches. Every patch names its epoch, base revision and next
revision; a mismatch stops patch application and triggers explicit
resynchronisation.

Calls are symmetric and correlated but never automatically retried. A relay
`CALL_ACCEPTED` means authenticated, authorized and queued to the callee — not
started, applied or physically observed. If dispatch may have happened and no
terminal result exists, the outcome is **unknown**. Optional idempotency keys are
coordinator-owned application contracts, not relay exactly-once delivery.

Streaming results consume explicit receiver credit. Final results and terminal
errors bypass stream credit so they cannot remain behind unbounded data. Events
remain live and at-most-once; work needing an outcome uses a call instead.

### 6.5 Authorization metadata

The relay constructs caller metadata from the authenticated socket. A client can
never choose its own UID, verified email, session ID, home or coordinator name.
Enrollment alone grants no state path, topic or function authority. Coordinator
declarations define each surface, and the coordinator still performs the final
business authorization for a dispatched call.

### 6.6 Executable contract and remaining boundary

The shared fixtures cover every core opcode, valid Unicode and binary values,
non-canonical encodings, hostile length declarations and semantic frame errors.
Both reference implementations must encode the same bytes and reject the same
invalid corpus. Go additionally exposes a coverage-guided fuzz target.

This closes the byte-contract design gate. It does not implement a relay session
machine. Role/direction enforcement, token verification, coordinator ownership,
bounded queues and disconnect fault matrices remain acceptance requirements of
the relay/SDK vertical slice.

---

## 7. Server state

Per home, in memory, with no persistence:

- the coordinator connection(s),
- the user connections,
- the full variable state,
- the path ↔ integer dictionary,
- each user's resolved allowlist, as integer sets,
- in-flight calls,
- event subscriptions.

The server **caches the full state**, which lets it serve a connecting user's
snapshot without waking the coordinator or waiting for a round trip to the home.

A server restart loses nothing durable: everyone reconnects and the coordinators
re-push their state.

Per-home and per-connection budgets bound frame size, decoded container depth
and cardinality, dynamic dictionary entries, queued bytes, subscriptions,
in-flight calls and call duration. A slow consumer is coalesced for replaceable
state and disconnected before its queue can exhaust shared memory. Control and
terminal call frames are never allowed to sit behind an unbounded data stream.

### Allowlists

Exact paths and prefixes (`salon.*`). The coordinator declares them; the server
resolves them once into identifier sets and only re-evaluates when a new path
appears. Hot-path filtering becomes an integer set-membership test.

An entry may name a path that does not exist yet; it will apply when it appears.
Variables and allowlists are two independent namespaces.

The presence of an ACL entry enrols a user even when its pattern list is empty.
This distinguishes an enrolled user with deliberately zero visible variables
from an unknown user.

---

## 8. Multiple coordinators

A home accepts several simultaneous coordinators, each owning a domain — for
example one for users and their rights, others for distinct slices of the data.

This is namespace sharding, not active-active redundancy. Two coordinators must
not concurrently control the same physical actuator merely because the relay
accepts both sockets. Redundancy for a physical effect requires fencing at the
resource boundary and is out of scope for Miakapp 4.

**Identity**: a coordinator connects with a name. Uniqueness on (home, name).
Same name → the previous one is evicted. Different name → they coexist.

**Central rule: a coordinator's declaration fully replaces its own slice.** On
each connection it declares its complete set of variables (`SYNC`); the server
diffs against what that coordinator owned and deletes what disappeared. This is
synchronisation, not merging. An orphaned variable becomes structurally
impossible — the concept does not exist, so there is nothing to clean up.

State, state ACLs, event topics, event ACLs and function names are staged as one
fixed-order declaration transaction and activate atomically. Applying those five
slices as visible prefixes would let an old ACL expose newly declared state, so a
relay must keep the prior complete configuration active until the final slice is
validated. Final activation revalidates the full transaction under a home-scoped
lock, so two coordinators that staged a collision cannot both commit. A failed,
expired or interrupted transaction changes no active slice.

**Grace period**: on disconnect, a coordinator's variables, functions and ACL
slice are marked stale but kept. If the same named coordinator returns within
the window (30 s by default), a new connection generation replaces the old one,
it re-declares, and users receive only the real diff — which is almost always
nothing. Frames from an evicted generation are rejected. Past the window: purge
the complete slice and notify.

**Ownership regimes**

| Object | Ownership | Collision |
|---|---|---|
| Variables | exclusive | explicit rejection |
| Function names | exclusive | explicit rejection |
| Allowlist entries | owned, additive | union |
| Event topic visibility | owned, additive | union, then per-user filtering |

Explicit rejection is deliberate: two coordinators claiming
`salon.temperature` produce an immediate error rather than a silent overwrite.
The union on allowlists is what lets one coordinator declare rights over
variables owned by another.

The union establishes **no privilege boundary** between coordinators authorized
for the same home, even when they use different Home Keys. RFC 0004 defines five
exact coarse scopes: `relay:coordinator`, `relay:cli`, `relay:user`, `push:send`
and `components:publish`. Every access token is attenuated to one of them.
Fine-grained scopes restricting individual namespaces or functions are deferred.

Events from one coordinator may be received by other subscribed coordinators,
but user delivery remains targeted or ACL-filtered as defined in § 6.6.

The frontend receives the **list** of connected coordinators, not a boolean. The
React component decides what to do with it.

---

## 9. Connection lifecycle

### Coordinator

Connect → token verified → home created in memory if absent → `SYNC` +
`FN_DECLARE` + `ACL` → the server assigns identifiers and broadcasts `DICT` and
`PATCH` to the affected users. Then `REAUTH` 30 seconds before token expiry by
default, or halfway through a lease shorter than 60 seconds.

### User

Acquire one atomic `{relay URL, access token, expiry}` credential from the
control-plane HTTPS exchange → connect only to that relay → Miakapp token verified
locally → signed Home ID, `uid` and optional verified email extracted → three
cases, **none of which closes the socket**:

| Case | `WELCOME` |
|---|---|
| No coordinator | `coordinators: []`, empty dictionary |
| Coordinator present, no explicit ACL entry for user | `enrolled: false`, only `miakapp.join` callable |
| Enrolled user | filtered dictionary and snapshot |

v3 closed the socket on `NO_COORDINATOR`, which triggered a reconnection loop
every second. In Miakapp 4 each of these states is announced, and the frontend leaves
it on its own when the situation changes.

**Connected but not enrolled is a normal state**: it is the door to the
invitation flow (§ 11). `miakapp.join` is a reserved function name and may have
exactly one coordinator owner.

Before the five-minute Miakapp lease expires, the browser repeats the HTTPS
exchange. If the authoritative relay URL is unchanged, it sends only the new
Miakapp token in `REAUTH`; reauthentication cannot change the established Home,
UID or verified email. If the URL changed, it closes the old transport before
opening one replacement with the already-issued credential. It never sends a
Firebase ID or App Check token over WebSocket, reuses an audience-mismatched
token at the old relay, performs a second exchange for the handoff, or overlaps
relay transports. A stuck close fails the handoff closed after its bounded
deadline.

**No session resumption in Miakapp 4.** A reconnection costs one snapshot, on the
order of a few kilobytes. The dictionary and a state version number leave the
door open should measurement ever justify it.

---

## 10. React components

Rendered **client-side only**. The relay never carries code.

- Firestore `components/{homeID}` holds the versioned pointer defined by RFC
  0002. It binds the home, monotonic generation, release, ABI, requirements,
  artifact URL, decoded byte size and SHA-256 digest. That is what the platform
  host subscribes to, which gives live reload.
- The bundle lives privately in Firebase Storage under an immutable name
  containing its digest. A token-free control-plane endpoint serves it only
  after the release/publication marker commits.

Storage avoids Firestore's document-size limit, while the content-addressed
control-plane response makes the bundle cacheable indefinitely by digest.
Upload, delivery-path read-back verification, immutable storage and an atomic
release/publication marker precede a generation-checked pointer update. Upload
and pointer update are not a cross-service transaction, so the order is part of
the contract. Rollback republishes an old digest under a new, greater generation.

### Isolation architecture — selected by RFC 0002

The authenticated Miakapp host **does not dynamically import the home bundle
into its own realm**. Imported JavaScript would inherit the host origin and
could read application state, use ambient credentials, mutate the host DOM and
invoke authenticated APIs.

The host fetches and verifies the release, then transfers the exact bytes to a
fixed broker in a hidden iframe. The broker is hosted on a separate site, runs
under an opaque `sandbox="allow-scripts"` origin and deny-by-default response
CSP, verifies and parses the bytes again, and creates the home bundle as a
classic Dedicated Worker behind a fixed confinement prelude. Guest bytes execute
inside a separate lexical scope so their hoisted declarations cannot shadow the
prelude, and a prelude-owned heartbeat makes an active busy Worker terminable.
The Worker never receives the host `MessagePort`.

The Worker's only interface is a versioned, bounded capability bridge for:

- the filtered variable snapshot and patches;
- allowed event subscriptions and publications;
- authenticated calls and results;
- exact host-owned media presentation handles;
- a framework-neutral semantic Miakapp UI tree.

The trusted host validates the semantic tree again and maps it to native React
design-system components in its own DOM. The bundle receives no DOM, arbitrary
HTML/CSS/URL, Firebase token, Home Key, raw WebSocket, host storage or
service-worker authority. A hash proves which bytes are running, not that the
bytes are safe; the opaque frame, CSP and terminable Worker are browser-enforced
boundaries, while the two validators enforce least-authority messages.

Anything deliberately delivered through the filtered bridge is disclosed to
the home bundle. It can encode that information in an otherwise authorized home
call, so the host and relay must never send a secret the home is not allowed to
receive.

**JSX is compiled at write time**, never in the browser: Babel standalone weighs
3 MB and starts slowly on mobile. What is stored is one self-contained classic
Worker program with no module syntax, dynamic import, chunks or public source
map. The broker parses this profile again before execution because Chromium can
emit a dynamic-import request before reporting CSP rejection. React is an
authoring adapter that emits the semantic tree; React elements and DOM mutations
are not the security ABI.

**Granularity**: one bundle per home. Full semantic trees are committed
atomically in ABI 1. Separate chunks, import maps and incremental DOM mutation
protocols add supply-chain and compatibility surface without a current consumer.

**Read access**: `allow read: if request.auth != null`. The code necessarily
leaks to users — that is the fate of every SPA — but nothing requires allowing
anonymous enumeration of every home. We cannot do better: with `relations` gone,
Firestore has no way to know who belongs to which home. That is the accepted
price of moving permissions into the coordinator. The host does not load a home
release until the relay reports the user as enrolled.

The agent manages its own Git repository as it sees fit; `list_components`,
`get_component`, build, test and publish tools give it control. Publishing is a
privileged platform operation, not a direct client write to the pointer. A
candidate stages without effectful calls, and only one release may hold
effectful capability after atomic activation. Should a central Git repository
become desirable later, its release pipeline targets the same artifact and
pointer contract without changing the frontend.

---

## 11. Users and invitations

The platform no longer manages membership. The coordinator is the sole owner of
its user list, stored wherever the agent decides (SQLite, JSON, PostgreSQL).

Invitation flow:

1. The invitee opens `miakapp.com/h/<home>?invitation=<token>`.
2. They create a Miakapp account (Firebase Auth).
3. The platform-owned enrollment UI connects, receives `enrolled: false`, and
   calls the reserved `miakapp.join(token)` function. Home-authored code has not
   been loaded yet.
4. The server routes the call with a non-spoofable `uid` and the email **only if
   verified**.
5. The coordinator validates the invitation against its store and enrols the user.
6. It pushes an explicit ACL entry, which may contain zero visible paths; the
   server sends the dictionary and snapshot.
7. The user-owned frontend writes the home to its bookmark list and loads the
   sandboxed release without reconnecting.

The coordinator must be online for someone to join a home. Acceptable: if it is
offline, the home does not work anyway.

Enrolment security now rests on deployed coordinator code. The relay guarantees
the Firebase identity and never accepts a caller-supplied replacement UID. A
buggy coordinator can still mis-authorise or cause physical effects within its
own home, so enrollment and operation policies require ordinary tests and
release controls even when an agent authored them.

---

## 12. Target Firestore

| Collection | Role | Rule |
|---|---|---|
| `homes/{id}` | public directory: name, icon and selected relay URL | public `get`; control-plane writes only |
| `controlHomes/{id}` and private subcollections | owner UID, grants, uploads, releases, admission counters and audit | Functions/IAM only; client rules deny all |
| `users/{uid}.homes` | **the user's bookmarks, with no authorisation meaning** | `read, write: if request.auth.uid == userID` |
| `users/{uid}/pushDestinations/{destinationID}` | challenge-proved private FCM destinations identified by Firebase Installation ID (FID) | Functions/IAM only; client rules deny all |
| `components/{homeID}` | active release pointer | authenticated reads; publisher Function writes |
| private Home Key registry | HMAC verifier, verifier-key version, scopes, metadata and revocation | Functions/IAM only; exact minimum shape is RFC 0004 § 6.2 |
| `SERVERS/{host}` | server directory, with `version` | public `list` |

Deleted: `relations`, `homes/*/groups`, `homes/*/pages`,
`homes/*/invitations`, `homes/*/coordinators`.

No `admins` field is introduced: `owner` covers the only operations left at the
platform level, including bootstrap through authenticated Functions.
Coordinator-appointed admins are a later need, which will go through explicit
control-plane capabilities rather than a Firestore membership relation.

`users/{uid}.homes` must remain a bookmark list. Were it ever to become
authoritative, we would have recreated `relations` with two diverging sources of
truth.

---

## 13. Notifications

An FCM registration is identified by a Firebase Installation ID (FID) bound to
the Firebase app and project, not to the home — which is what makes multi-home
work today. Standard Web Push has the same property: a service worker holds a
single subscription, bound to a single application key. Sending a push therefore
requires a **platform identity**, necessarily shared, which can live neither in a
coordinator nor in a self-hosted server.

Sending therefore goes through the Firebase Function. Counter-intuitive
consequence: this extra component is what **frees** `miakapp-server`. Today,
wanting push forces `FIREBASE_CREDENTIALS` into the server — and that is what
makes self-hosting impossible.

RFC 0004 separates sender authentication from recipient consent. The Function
accepts only a short-lived `push:send` token attenuated to the push audience. The
user creates an opaque, expiring and revocable grant binding one of their private
destinations to one home, then conveys only the grant ID to the coordinator. The
Function rejects expired, revoked and cross-home grants without disclosing a UID
or destination. A bare `{homeKey, uid}` request is forbidden.

---

## 14. Errors

`FATAL` closes the connection; `CALL_ERR` affects only one call.

| Range | Origin |
|---|---|
| 1000–1999 | server: unknown function, no coordinator, not enrolled, timeout, quota |
| 2000–2999 | application: raised by the coordinator |

The split lets the agent tell immediately whether a failure comes from its own
code or from the infrastructure.

Per-connection limits: maximum frame size, in-flight call count, call timeout,
queued bytes, decoded depth/cardinality, dynamic identifiers, subscriptions and
per-IP connection rate — this time actually implemented. The protocol RFC owns
the stable numeric catalogue, retryability and safe user-facing messages.

---

## 15. Testing

Absent in v3; non-negotiable in Miakapp 4.

- **Codec — implemented in the contract harness**: canonical round-trip over
  Unicode, safe-integer boundaries, binary values and nested structures, with
  strict pre-allocation decoder limits and coverage-guided Go fuzzing.
- **Protocol conformance — implemented in the contract harness**: shared valid,
  malformed and semantically invalid fixtures cover every core opcode and are
  checked on both encode and decode by independent Go and TypeScript codecs.
- **Lifecycle**: test-driven fake coordinator and fake client, covering the three
  `WELCOME` cases, snapshot-before-patch ordering, the grace period, eviction by
  name, generation fencing and collision rejection.
- **Multiple coordinators**: slice synchronisation, allowlist union, absence of
  orphans across disconnect cycles.
- **Authentication**: expired token, wrong `aud`, revocation between two
  `REAUTH` calls, user-token refresh, unverified email, spoofed caller metadata,
  membership removal and per-operation denial.
- **Failure semantics**: disconnect before and after dispatch/result, outcome
  unknown, idempotency, duplicate/replayed requests, coordinator and relay
  restarts, mixed protocol versions and resynchronisation.
- **Backpressure and load**: slow readers, stream floods, reconnect storms,
  end-to-end latency, bounded queue/memory behavior and fairness across homes at
  a few thousand connections.
- **Component isolation — boundary subset implemented**: Chromium, Firefox and
  WebKit run valid, tampered, declaration-shadowing, egress, storage,
  invalid-tree, state/capability, lifecycle, flood and pre/post-activation
  infinite-loop bundles against the RFC 0002 broker and headers. This proves the
  architecture selection, not complete RFC conformance. The React host now has
  a production-shaped semantic renderer and an offline preview adapter; its
  broker lifecycle, delivery path and SDK integration must still pass every
  Section 18 item.
- **Migration — oracle and shared adapter contract implemented; runtime open**:
  `synthetic-home/` provides a closed, bounded fictional inventory and ten
  deterministic capsules for state, actions, notification intents, persisted
  context, lifecycle and failure behavior. `coordinator-contract/` adds the RFC
  0003 public type boundary, fourteen lifecycle/migration traces, stimulus-indexed
  readiness and error evidence, terminal declaration-promise evidence, an
  abortable replay runner, recorder-owned state evidence, lease-bound effect
  capabilities and a fail-closed effect recorder. Compiled ESM smoke tests
  exercise both exported boundaries under Node 22, and the external subject runs
  behind an authenticated, bounded process supervisor. The real MiakAPI session
  SDK now passes that contract and its Home Key provider passes a pinned local
  control-plane-to-relay `HELLO`/`REAUTH` gate. The Node-RED runtime adapter
  remains to be implemented and installed as a subject of these harnesses.

---

## 16. Migration

The official Miakapp 4 relay has no permanent v3 compatibility layer. A v3 sidecar
would read `relations` and `groups`, precisely the collections being deleted.
Keeping it alive after migration would require writing membership into two
models in parallel — the divergence problem this refactor eliminates.

That does **not** justify migrating blind. Before the final platform cutover:

1. an isolated beta stack is deployed;
2. a Miakapp 4-compatible Node-RED adapter publishes representative state to both
   systems while beta actuation is disabled or recorded;
3. synthetic and production-shaped behavior is compared;
4. backup and restore are rehearsed;
5. one home canaries the complete stack with explicit rollback criteria.

The migration adapter is temporary coordinator-side tooling, not a legacy
protocol in the new relay. The public Node-RED package may be deprecated and
redirect users to the agent-first onboarding while this private/temporary bridge
protects existing installations.

[`RFC 0003`](../rfcs/0003-coordinator-sdk-and-migration.md) makes this boundary
operationally precise. The default shadow path publishes state only; it declares
no callable user functions. Recorded-action comparison is allowed only when the
complete downstream effect path is structurally replaced by the bounded recorder.
Discarding a mirrored response or passing a conventional `dryRun` flag to
arbitrary Node-RED code is not a non-actuation guarantee.

The public oracle under `synthetic-home/` is hand-authored from behavior classes,
not anonymized from an exported installation. It fixes a fictional clock and
seed, uses only synthetic identifiers and reserved URL hosts, records device
commands without executing them, and models notification intent without embedding
the platform-specific push-delivery contract. The adapter must consume its generic
reset/dispatch/observe replay interface; it must never require production data in
CI.

At final cutover, the Function/control plane, Firestore data and rules,
`miakapp-server`, MiakAPI/coordinator, component release and web app move as one
versioned release set.

Rollback includes a full Firestore export, immutable component artifacts, the
previous rules and Functions, relay/SDK/web release identifiers, coordinator
configuration and the local automation backup. Auth accounts are independent of
the data migration and do not move.

The export must be taken on the day, stored outside the repository, and never
committed.

Final order: verified backup → deploy compatible control plane → migrate data →
deploy rules → relay → coordinator/adapter → component release → web app → run
acceptance checks → commit or roll back. A few hours of downtime is acceptable,
but accepted downtime is not a substitute for a rehearsed rollback.

---

## 17. Out of scope

Planned but not implemented in Miakapp 4:

- Coordinator-appointed admins, able to create and delete Home Keys and to talk
  to the embedded agent.
- A central Git repository for components.
- Session resumption after a drop.
- Fine component granularity with an import map.
- End-to-end encryption through a blind relay.
- Active-active control of the same physical actuator.
- A third-party component marketplace.
- Replacing every existing Node-RED flow.

Each is reachable without breaking the protocol.

---

## 18. Decisions and rationale

| Decision | Rationale |
|---|---|
| Go | simple concurrency model, static deployment artifact, mature profiling and predictable operation for a small relay; performance still has to be measured |
| WebSocket only | broad browser support and seven years without an observed incident; explicit failure UI and reconnect behavior are still required |
| Canonical MessagePack arrays, not Protobuf or custom varints | structure is invented at runtime by the agent; fixed positional frame arrays remain compact, while one constrained grammar is simpler to validate than MessagePack nested inside a second custom binary grammar |
| Path dictionary, conditional | the variable name dominates small updates, but the optimisation ships only if representative benchmarks justify its protocol cost |
| RFC 6455 control frames | the browser answers inside the network stack; the application heartbeat was negative work |
| Refresh / access token | the only construction giving absence of expiry, revocability and secret-free verification at once |
| Coordinator calls the Function | the relay is platform-untrusted; the reverse makes it an oracle and keys the rate limit to the wrong IP |
| `aud` in the short token | anyone may host a server, hence capture and replay a token |
| audience-bound user relay token before broad self-hosting | the Firebase project bearer received by the direct alpha profile is replayable outside one relay |
| Declaration replaces the slice | makes orphaned variables structurally impossible, with no cleanup pass |
| Rejection on collision | the agent sees its bug in development, not a silent overwrite in production |
| No permanent relay compatibility | v3 compatibility depended on deleted collections; migration safety comes from beta/shadow/canary tooling instead |
| Sandboxed home UI | a same-origin dynamic import would grant home-authored code the platform application's ambient authority |
| Firestore + Storage releases | immutable artifacts plus a live pointer leave room for a later Git publication source |
| Push in the Function | push identity is necessarily platform-wide; isolating it is what frees the server |
| Temporary, state-only-by-default Node-RED migration adapter | preserves the working installation as oracle and rollback target without retaining v3 in the relay or mirroring live effects |
| No offline SDK command queue | a reconnect must not turn stale intent into a delayed physical operation |

---

## 19. Implementation gates and status

The architecture direction above is stable. RFCs 0001 through 0005 close the
shared wire, component, coordinator/migration-adapter, control-plane and trusted
browser-client contract gates. Their executable corpora prove the contracts
themselves; production implementations still have to pass the corresponding
vertical-slice exit gates.

1. **Protocol RFC — closed 2026-08-30** — RFC 0001 defines exact frames, state
   and call semantics, caller metadata, ACLs, revisions, limits, errors and
   compatibility; independent Go and TypeScript codecs pass the same fixtures.
2. **Component runtime architecture — selected 2026-08-30** — RFC 0002 defines the separate-site
   opaque broker, terminable Worker, framework-neutral semantic UI ABI,
   capability bridge, immutable artifact, publication/cache/rollback lifecycle,
   limits and conformance claims. Its architectural harness exercises the
   security-critical boundary subset in Chromium, Firefox and WebKit. The
   production host and complete conformance matrix remain vertical-slice work.
3. **Platform control plane — base contract closed 2026-08-31; audience-bound
   user relay credential complete locally and in one bounded private staging
   probe, broader staging open** — RFC 0004 defines owner
   bootstrap, the private Home Key registry, exact coarse scopes, signed
   resource-specific access tokens, JWKS rotation, Firebase user-token
   verification, push grants, publisher authorization, quotas and audit. The
   shared synthetic corpus passes independent TypeScript and Go token verifiers
   plus a bounded behavioral model. As of 2026-09-01, the first Section 5–7
   owner/Home-Key/access-token path also passes isolated Auth, Functions and
   Firestore emulators; separate Firestore and Storage client contexts exercise
   its initial Rules boundary. A follow-on local slice now covers a closed FID
   proof-of-possession flow, strict synthetic App Check and push-token
   verification, bounded destination/grant registries and semantic sending through
   a recording FCM transport. A component slice covers private upload, byte
   read-back, immutable release publication, reconciliation, generation CAS,
   quarantine and rollback. A fixed-slot admission slice now covers atomic
   rate/byte budgets, bounded redacted audit and pre-effect denial. The local
   application/dependency fault matrix now consolidates transaction replay,
   ambiguous commit, push/Storage effect and reconciliation evidence. The Local
   Emulator Suite provides neither an App Check nor an FCM service emulator. A
   pinned local cross-repository gate now proves one real emulator Home Key
   exchange through the MiakAPI provider, key-changing scheduled `REAUTH`, and
   relay production verifier without reconnecting. A deterministic second
   instance of the production cache proves 32-way refresh coalescing,
   unknown-`kid` abuse bounds, conditional expiry, fail-closed JWKS outage and
   bounded recovery. The local lifecycle stops after overlap and activation; it
   does not remove the retiring key. A bounded private staging probe now proves
   Admin custom-provider App Check enforcement and KMS-backed user-relay signing
   on the deployed control plane. A separate one-shot default-system-browser
   operation now proves real Web App Check provider attestation without
   retaining its token. FCM acceptance/delivery, production Storage/KMS and
   Firebase certificates,
   trusted edge admission, browser and network faults, the rest of Section 18
   and broader staging behavior remain implementation exit gates. The
   audience-bound local path now adds Auth-emulator and signed synthetic App
   Check sources, exact
   `relay:user` signing and verification, and a serialized authoritative handoff
   across two real relays in Chromium.
4. **MiakAPI coordinator API — closed 2026-08-30; broader agent experience open**
   — RFC 0003 defines the public coordinator lifecycle, declarations, state,
   events, calls, presence, errors and compatibility boundary. CLI/MCP tools,
   home repository contract, discovery, approvals and deployment remain open.
5. **Migration adapter architecture — closed 2026-08-30; operational gate open**
   — RFC 0003 and `coordinator-contract/` define state-only shadowing, recorded
   effects, deterministic comparison and Node-RED lifecycle requirements. The
   real bridge, beta topology, backup/restore, canary metrics, cutover and rollback
   runbook remain open.
6. **Trusted browser relay client — audience-bound local path closed 2026-09-04;
   staging and host gates open** — RFC 0005 defines the isolated browser
   package, lifecycle, immutable state, named calls, reauthentication, reconnect,
   limits and cleanup. The real implementation passes deterministic tests and
   reciprocal Chromium/Go-relay gates through a successful post-lease call on one
   WebSocket and a source-to-token routing handoff across two relays with no
   overlapping transport. Its historical Firebase-direct profile is
   synthetic-only. The closed staging plan is now rebased against the private
   `control-plane-00010-vop` two-key/version-1-rehearsal-entry runtime with the
   bounded staging edge profile present in source but not selected, completed real-browser App Check
   prerequisite and zero-user/zero-fixture/zero-relay baseline; it still grants
   no deployment or public ingress. The pinned relay now has finite connection,
   attempt, tracked-peer, Home and aggregate queue budgets, and a dormant
   four-phase Terraform root freezes two scale-to-zero services with
   public-last IAM without exposing an operator entrypoint. Arbitrary
   self-hosted relay selection remains disabled until
   live relay/browser staging acceptance; the React host foundation now exists,
   while its component bridge integration and the complete fault matrix remain
   open.

Implementation work remains limited by its corresponding gate. The relay now
implements the local RFC 0001, 0004 and 0005 boundary; MiakAPI implements the
corresponding RFC 0001, 0003, 0004 and 0005 SDK boundary; and the web repository
implements the RFC 0004 Firebase Emulator slice. This repository now contains
its first owner-to-access-token increment under
`control-plane/`; its synthetic local push slice now covers FID proof, grants and
semantic sends, its component slice covers publication authority and immutable
delivery, and its admission slice covers bounded local counters and audit. Real
push/service infrastructure, trusted network attribution, staging fault rows,
session machines, queueing and disconnect behavior still have to pass
their staging or vertical-slice tests. Contract-kit, synthetic service seams or
partial-emulator self-conformance alone is not production readiness.
