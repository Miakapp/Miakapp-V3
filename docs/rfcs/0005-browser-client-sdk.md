# RFC 0005 — Trusted browser relay client 1.0

- Status: accepted; local audience-bound implementation evidence complete,
  staging and host integration pending
- Product release: Miakapp 4
- Public SDK: `miakapi/browser` in `miakapi@4`
- Last updated: 2026-09-04

## 1. Scope

This document defines the trusted application-host client that connects a human
user to one Miakapp home over RFC 0001. It specifies the public browser package,
authentication-provider boundary, lifecycle, home availability, authoritative
state view, named calls, reconnect and reauthentication behavior, failures,
resource limits and cleanup.

The client is framework-neutral. The future React shell owns Firebase Auth, App
Check, home selection and presentation; the control plane owns relay routing,
and the client owns one `{user, home}` session whose selected relay may change
between credentials. Home-authored component code remains behind the
RFC 0002 semantic capability bridge and never receives this client, its socket
or an authentication credential.

This RFC does not define:

- the React application shell or Firebase login user experience;
- the component-host adapter from browser state and calls to RFC 0002;
- event publication or subscription in the first browser profile;
- browser-side call handlers or streamed outgoing call progress;
- server discovery, relay ranking or a public community-relay catalogue;
- a zero-trust relay or end-to-end encryption of home data;
- session resumption, offline commands or automatic effect retry;
- a complete network/disconnect fault matrix; or
- production readiness from local fixtures alone.

The words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT** and
**MAY** are interpreted as described in RFC 2119 and RFC 8174.

## 2. Trust and credential boundary

### 2.1 Trusted host

The browser client runs only in the trusted Miakapp application host. That host
may hold the signed-in Firebase user in memory and may call a credential provider.
It MUST NOT give any of the following to an RFC 0002 guest bundle or Worker:

- the Firebase user or ID token;
- the `BrowserClient` object;
- the WebSocket, relay URL mutation authority or raw frames;
- unfiltered state; or
- logger, lifecycle or error objects that could carry host authority.

The trusted host translates only approved state, events and calls into the
versioned semantic component ABI. A component compromise therefore does not
become a Firebase or relay-session compromise.

### 2.2 Legacy Firebase-direct fixture profile

The first synthetic browser fixture assigned a Firebase-shaped token directly to
role-1 WebSocket `HELLO` and `REAUTH`. That evidence remains reproducible only as
a historical loopback baseline. The current SDK and relay production paths have
removed the shape; it is not the production credential profile.

A Firebase ID token is reusable against services that trust the same Firebase
project. Consequently, the legacy profile:

- MAY be used only by explicitly synthetic tests;
- MUST NOT be used by the production application;
- MUST NOT be accepted as evidence for arbitrary relay selection; and
- MUST remain absent from the production role-1 relay path; the current
  implementation has removed it.

This restriction concerns credential replay in addition to plaintext home-data
visibility. A warning about home data alone is insufficient.

### 2.3 Audience-bound production credential

The trusted host supplies Firebase ID and App Check tokens only to RFC 0004's
HTTPS user relay exchange. The control plane returns one atomic credential
containing a canonical WSS relay URL, a Miakapp access token and its expiry. The
token has exactly these properties:

1. an exact audience naming one relay endpoint;
2. one home ID, one Firebase UID and role `user`;
3. no push, component-publication, owner or coordinator authority;
4. a maximum five-minute lease with bounded renewal;
5. locally verifiable signatures and bounded public-key refresh at the relay;
6. no Home Key or other permanent secret in the browser or relay; and
7. the exact request admission, App Check and audit behavior in RFC 0004.

The returned relay URL is authoritative for that credential and MUST match its
signed audience. The fixed Home ID in the application session MUST match the
signed `miakapp_home`. No Firebase or App Check token may enter a WebSocket frame.
No SDK-only transformation can safely attenuate a Firebase bearer because the
browser does not possess a trusted signing key.

Audience-bound user authentication prevents credential replay against another
relay. It does not hide state or calls from the selected relay. End-to-end
encryption remains a separate design requiring membership, key recovery,
revocation and filter-compatible policy evaluation.

## 3. Package boundary

The public entry point is:

```ts
import { createBrowserClient } from 'miakapi/browser';
```

It MUST remain separate from the default coordinator entry point. Importing it:

- MUST NOT import or evaluate Node's `ws`, filesystem, process or coordinator
  credential graph;
- MUST NOT import Firebase or choose an Auth persistence policy;
- MUST NOT open a socket, request a token, schedule a timer or log; and
- MUST publish compiled ESM and TypeScript declarations from an immutable
  package artifact.

The implementation uses the browser's native `WebSocket`. A build gate MUST
prove the browser export contains no Node built-in or `ws` import. Construction
validates a closed option object before acquiring a resource.

## 4. Public API 1.0

`ProtocolValue`, `DispatchOutcome`, `StartOptions`, `StopOptions` and
`Unsubscribe` retain their RFC 0003 meanings. The normative browser surface is:

```ts
export function createBrowserClient(options: BrowserClientOptions): BrowserClient;

export type BrowserClientStatus =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'synchronizing'
  | 'ready'
  | 'reconnecting'
  | 'draining'
  | 'stopping'
  | 'stopped';

export type BrowserRelayCredentialReason = 'initial' | 'reauth' | 'reconnect';

export interface BrowserRelayCredentialRequest {
  readonly homeId: string;
  readonly reason: BrowserRelayCredentialReason;
  readonly signal: AbortSignal;
}

export interface BrowserRelayCredential {
  readonly relayUrl: string;
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

export interface BrowserRelayCredentialProvider {
  getCredential(
    request: BrowserRelayCredentialRequest,
  ): Promise<BrowserRelayCredential>;
}

export interface BrowserClientLogRecord {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly event: string;
  readonly status?: BrowserClientStatus;
  readonly code?: number;
}

export interface BrowserClientLogger {
  write(record: BrowserClientLogRecord): void;
}

export interface BrowserClientOptions {
  readonly homeId: string;
  readonly credentialProvider: BrowserRelayCredentialProvider;
  readonly logger?: BrowserClientLogger;
}

export interface BrowserReadySession {
  readonly sessionId: number;
  readonly connectedAtMs: number;
  readonly enrolled: boolean;
  readonly coordinators: readonly BrowserCoordinatorStatus[];
}

export interface BrowserCoordinatorStatus {
  readonly name: string;
  readonly generation: number;
  readonly status: 'connected' | 'grace';
}

export interface BrowserHomeStatus {
  readonly enrolled: boolean;
  readonly coordinators: readonly BrowserCoordinatorStatus[];
  readonly stale: boolean;
}

export interface BrowserHome {
  snapshot(): BrowserHomeStatus | undefined;
  subscribe(listener: (status: BrowserHomeStatus) => void): Unsubscribe;
}

export interface BrowserStateSnapshot {
  readonly epoch: Uint8Array;
  readonly revision: number;
  readonly values: Readonly<Record<string, ProtocolValue>>;
  readonly stale: boolean;
}

export interface BrowserState {
  snapshot(): BrowserStateSnapshot | undefined;
  subscribe(listener: (snapshot: BrowserStateSnapshot) => void): Unsubscribe;
}

export interface BrowserCallOptions {
  readonly function: string;
  readonly arguments: ProtocolValue;
  readonly timeoutMs: number;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

export interface BrowserCallHandle {
  readonly localId: string;
  readonly accepted: Promise<void>;
  readonly result: Promise<ProtocolValue>;
  cancel(): void;
}

export interface BrowserCalls {
  start(options: BrowserCallOptions): BrowserCallHandle;
}

export interface BrowserClientFailure extends Error {
  readonly kind:
    | 'protocol'
    | 'authentication'
    | 'authorization'
    | 'conflict'
    | 'invalid_lifecycle'
    | 'unavailable'
    | 'cancelled'
    | 'internal';
  readonly code?: number;
  readonly retryable: boolean;
  readonly outcome: DispatchOutcome;
  readonly correlation?: { readonly kind: 'call'; readonly localId: string };
}

export interface BrowserLifecycleEvent {
  readonly previous: BrowserClientStatus;
  readonly current: BrowserClientStatus;
  readonly session?: BrowserReadySession;
  readonly reason?: BrowserClientFailure;
}

export interface BrowserClientErrors {
  subscribe(listener: (failure: BrowserClientFailure) => void): Unsubscribe;
}

export interface BrowserClient {
  readonly status: BrowserClientStatus;
  readonly home: BrowserHome;
  readonly state: BrowserState;
  readonly calls: BrowserCalls;
  readonly errors: BrowserClientErrors;

  start(options?: StartOptions): Promise<BrowserReadySession>;
  stop(options?: StopOptions): Promise<void>;
  subscribe(listener: (event: BrowserLifecycleEvent) => void): Unsubscribe;
}

export type BrowserClientFactory =
  (options: BrowserClientOptions) => BrowserClient;

export interface ControlPlaneBrowserRelayCredentialProviderOptions {
  readonly exchangeEndpoint: string;
  readonly getFirebaseIdToken:
    (request: BrowserRelayCredentialRequest) => Promise<string>;
  readonly getAppCheckToken:
    (request: BrowserRelayCredentialRequest) => Promise<string>;
  readonly fetch?: typeof globalThis.fetch;
}

export function createControlPlaneBrowserRelayCredentialProvider(
  options: ControlPlaneBrowserRelayCredentialProviderOptions,
): BrowserRelayCredentialProvider;
```

The optional logger accepts only a closed record containing level, stable event,
optional lifecycle status and optional numeric protocol code. Provider exception
text, token text, relay payloads, state and stack traces are never logger fields.

All option, credential, call and protocol-value objects are closed and validated
before handoff. The home ID grammar is 3–63 lowercase ASCII characters, begins
with a letter, ends with a letter or digit, and otherwise contains letters,
digits or hyphens. Every credential relay URL is at most 2,048 bytes, uses
`wss:`, contains no userinfo, query or fragment, and ends in `/ws`. Its access
token is compact printable ASCII of at most 8,192 bytes and its expiry is a
future safe-integer time.
The provider result is one indivisible value; callers cannot supply or override
the relay URL separately.

The control-plane provider validates one canonical HTTPS exchange endpoint and
uses only `POST`, `Authorization`, `X-Firebase-AppCheck` and the exact RFC 0004
JSON body. The two callbacks adapt the host's Firebase SDK without importing it
into MiakAPI. The provider rejects redirects, non-JSON or oversized responses,
unknown fields, unsafe credentials and source-token reflection. It coalesces only
identical in-flight requests, propagates cancellation and returns no source
token. Provider errors and public logs never contain a URL query, header, body or
token fragment.

## 5. Lifecycle

The ordinary lifecycle is:

```text
idle → connecting → authenticating → synchronizing → ready
                    ↑                              ↓
                    └──── reconnecting ← transport loss
                                      ↘ draining → reconnecting
any non-terminal state → stopping → stopped
```

Construction is inert. `start()` may be called exactly once and resolves only at
the synchronization barrier in Section 6. Calling it again or after `stop()` is
an `invalid_lifecycle` failure.

`stop()` is idempotent: every call returns the same terminal promise. Its first
call aborts credential acquisition, terminates the current session, marks published
views stale, settles calls conservatively, removes listeners and bounds cleanup
by `deadlineMs`. The status never leaves `stopping` except for `stopped`.

Lifecycle, home, state, error and logger callbacks are isolated from protocol
health. A thrown callback cannot disconnect the relay. A callback may call
`stop()` reentrantly; after each user callback, the client rechecks cancellation
before requesting a credential, opening transport, synchronizing or reconnecting.

## 6. Authentication and readiness barrier

The first connection performs:

1. request reason `initial` from `credentialProvider`;
2. validate the complete credential and open its secure relay URL with
   subprotocol `miakapp`;
3. send RFC 0001 role `1` `HELLO` with version range exactly 1.0, its Miakapp
   access token and the fixed home ID;
4. require `WELCOME` version exactly 1.0, a future authentication expiry, a
   16-byte epoch and limits no greater than local protocol maxima;
5. expose the initial enrollment/coordinator availability from `WELCOME`;
6. accept an epoch-matching replacement `STATE_DICT` and authoritative
   `STATE_SNAPSHOT`;
7. accept epoch-matching replacement `TOPIC_DICT` and `FUNCTION_DICT`; and
8. transition to `ready` and resolve `start()`.

State, topic and function frames may arrive immediately after `WELCOME`. The
session bounds and buffers them until its managers are installed, then delivers
them in order. It does not publish partially initialized readiness. An unenrolled
home still completes a coherent empty projection supplied by the relay.

Credential acquisition, socket/WELCOME handshake and post-WELCOME bootstrap each
have a ten-second maximum. A provider that ignores `AbortSignal` does not extend
the public wait indefinitely. A failed phase terminates its socket before
reconnect.

## 7. Home availability

`home.snapshot()` is undefined before a valid `WELCOME`. Afterwards it returns
the latest immutable enrollment and coordinator list. `HOME_STATUS` replaces
that value without requiring reconnect. Coordinator entries retain the name,
generation and `connected` or `grace` status supplied by RFC 0001.

`home.subscribe()` atomically subscribes and immediately emits the current value
when one exists. Disconnect marks the retained value `stale: true`; a new
`WELCOME` replaces it with a non-stale view. Availability is not authorization
to issue a named call: the active function dictionary remains authoritative.

## 8. Authoritative state

The client builds state only from an epoch-matching path dictionary and snapshot.
Every public snapshot is a defensive immutable copy containing epoch, revision,
values and `stale`.

`state.subscribe()` atomically subscribes and immediately emits the current
snapshot when one exists. This prevents the common race where a host reads state
after a patch but subscribes before another patch.

A patch applies only when:

- its epoch equals the active session epoch;
- its base revision equals the current revision;
- its new revision strictly increases;
- every path ID exists in the current dictionary; and
- every mutation and value satisfies RFC 0001 bounds.

An epoch, revision or dictionary mismatch never partially mutates state. The
client marks the view stale and coalesces one `STATE_RESYNC`. Only a coherent
replacement snapshot clears staleness. Relay rejection or transport failure of
the sole resynchronization request closes the session and enters the reconnect
policy. A snapshot within the same epoch that rolls revision backwards is a
protocol failure.

Disconnect retains the last view only as `stale: true` presentation context.
The host MUST NOT represent it as live state or use it to authorize an effect.

## 9. Named calls

Calls are available only in `ready` and only when the current function dictionary
contains the requested name. The SDK maps that name to the epoch-local function
ID and sends one default-target RFC 0001 `CALL` with zero progress credit.

The handle separates:

- `accepted`, proving `CALL_ACCEPTED` for this session-local ID; and
- `result`, proving one terminal non-streaming `CALL_RESULT` or failure.

The local deadline, `AbortSignal` and `cancel()` share one settlement machine.
Before synchronous transport handoff, cancellation is `not_dispatched`. Once
handoff begins, a send error, disconnect, timeout or unresolved cancellation is
`outcome_unknown` unless an explicit correlated relay terminal proves otherwise.
The SDK never replays a call, including one carrying an idempotency key.

Bounded tombstones consume correlated late terminal frames after a local
deadline without settling twice or poisoning a replacement session. Calls from
an older connection never bind to reused IDs in a new connection.

The first browser profile exposes no incoming call handler. A valid
`CALL_DISPATCH` receives stable application error `2000` and does not tear down
the connection. Correlated `CALL_CANCEL` and `CALL_CREDIT` for that rejected call
are consumed within a bounded set.

## 10. Reauthentication

The accepted `WELCOME.expiresAtMs` controls renewal. The client requests reason
`reauth` thirty seconds before expiry, or halfway through a lease shorter than
sixty seconds. If the fresh credential's relay URL equals the active socket URL,
it sends the token in one correlated `REAUTH` and accepts only a matching
`REAUTH_OK` whose expiry is in the future.

If the fresh credential names a different relay URL, the client MUST NOT send it
on the old socket because its audience cannot authorize that relay. It retains
that already-issued atomic credential, closes the old session, enters the
`reconnecting` lifecycle and immediately opens one replacement socket to the new
URL. It MUST NOT perform a second exchange for that handoff. The old view becomes
stale and the replacement session passes the complete readiness barrier.

Credential acquisition and response wait are each bounded by the smaller of ten
seconds and the remaining lease. Failure or expiry terminates the transport and
enters reconnect. The relay independently requires the renewed identity to keep
the same role, home, UID and verified principal fields.

A frozen, suspended or heavily throttled page may miss its renewal timer. This
does not extend authority: the relay lease closes. On resume, normal reconnect
requests reason `reconnect` and establishes a new session from authoritative
bootstrap. A complete Page Lifecycle/bfcache policy remains a host acceptance
gate, not an excuse to keep an expired socket.

The host MUST stop and discard the client immediately when Firebase signs out or
when user or home selection changes. A new identity tuple requires a new client
instance and new credential-provider closure. Relay selection changes do not
mutate options; they arrive only through a new control-plane credential and use
the handoff above.

## 11. Reconnect and draining

Unexpected closure, retryable protocol failure or failed renewal marks state and
home views stale, settles active calls once, reacquires a credential with reason
`reconnect` and opens one replacement socket at its authoritative URL. No
operation queue survives the gap.

Reconnect uses full jitter with ceilings 1 s, 2 s, 4 s and so on, capped at
30 s. Exactly one timer and one connection attempt exist. Accepting a valid
`WELCOME` resets the attempt counter even if later bootstrap fails.

`GOAWAY` transitions to `draining`, stops renewal and permits the client to send
only RFC 0001 terminal callee frames allowed during drain. Its `retryAfterMs` is
a minimum delay applied after the relay closes; it is not permission for
parallel sockets.

## 12. Transport and resource bounds

The native transport:

- offers only WebSocket subprotocol `miakapp`;
- sets `binaryType` to `arraybuffer`;
- rejects text, `Blob` and other non-`ArrayBuffer` messages;
- accepts one canonical RFC 0001 MessagePack frame per message;
- enforces the 262,144-byte local frame maximum and every smaller negotiated
  relay maximum;
- rejects an outbound write if native `bufferedAmount` plus the frame exceeds
  the smaller queue budget;
- admits at most 1 MiB and 256 inbound messages in each one-second accounting
  window;
- bounds frames buffered between `WELCOME` and manager activation; and
- detaches every listener and closes a transport that fails before open.

The browser has no API for inbound WebSocket backpressure and materializes a
complete message before JavaScript sees its size. The limits above prevent
continued processing but cannot prevent that first allocation. Official relays
and ingress MUST enforce frame/rate limits before sending, the legacy direct
profile remains synthetic-only, and a Worker or process boundary SHOULD be
evaluated for a hardened browser profile. This implementation MUST NOT claim
hard memory isolation from a malicious relay.

Cumulative dictionaries, in-flight calls, completed-call correlation and rejected
incoming calls remain bounded by RFC 0001/local maxima. Unknown optional opcodes
`0x80..0xff` are canonically decoded and ignored. Unknown core opcodes, wrong
directions and invalid phase transitions fail the session.

## 13. Failures, privacy and observability

Every browser failure has one stable kind, retryability, dispatch outcome and
optional numeric relay code/call correlation. Public messages are SDK-owned and
do not include provider exceptions, close reasons, token fragments, state,
arguments, relay payloads or stack traces.

`outcome_unknown` always means an effect may have happened. It is never presented
as rollback and never triggers automatic retry. `not_dispatched` is used only
when local validation/offline gating or an explicit terminal proves no handoff.

Listener and logger failures are isolated and sanitized. Evidence may include
only allow-listed semantic counters and outcomes. Browser traces, network HARs,
and recording or decoding WebSocket frame payloads are forbidden in
credential-bearing acceptance runs because they may retain `HELLO`, `REAUTH` or
home data. A synthetic-only local gate may transiently compare outbound bytes
with the source credentials it just generated, but it must retain only a boolean
presence result and bounded frame count, never a frame or credential.

Firebase ID and App Check tokens exist only inside the trusted host callbacks and
the control-plane HTTPS request. The credential provider never returns them and
the browser client never receives them. The only bearer handed to a WebSocket is
the audience-bound Miakapp access token returned beside that exact relay URL.

## 14. Conformance evidence

### 14.1 Historical trusted-relay baseline

The legacy trusted-relay implementation evidence is pinned by:

- MiakAPI merge
  [`5c26eaa`](https://github.com/Miakapp/MiakAPI/commit/5c26eaa830015d94f53bf05fbbb0f5ebda6d290f);
  and
- Miakapp-Server merge
  [`da49e8b`](https://github.com/Miakapp/Miakapp-Server/commit/da49e8bf6b1bd03acaabd225ab5e96a61dd5dd91).

MiakAPI has deterministic tests for construction, lifecycle, reentrant stop,
protocol directions, exact WELCOME version, phase deadlines, HOME_STATUS,
immutable state, mismatch/resync, snapshot rollback, call handoff/cancellation,
late terminals, no replay, inbound-call rejection, transport cleanup, inbound
budgets and secret-free failures. Its complete gate passes 115 tests and 383
assertions, strict type/build checks, browser isolation smoke, canonical SDK
conformance and package dry run.

The reciprocal relay gate builds the browser fixture from that exact SDK commit,
serves it through ephemeral loopback TLS with one exact Origin and restrictive
CSP, and executes it in headless Chromium. It proves:

1. one enrolled browser and one ready coordinator;
2. the authoritative initial value `20`;
3. one patch to `21`;
4. one accepted call and terminal result;
5. scheduled renewal of a four-second synthetic user lease;
6. a second successful call after that original lease expired; and
7. final `ready`, zero failures/reconnects and exactly one WebSocket.

The committed evidence shape is limited to:

```json
{
  "generation": 1,
  "state": 21,
  "call": "succeeded",
  "reauthenticated": true,
  "post_lease_call": "succeeded",
  "browser": "chromium",
  "websockets": 1
}
```

Literal fixture tokens are synthetic strings accepted only by the ephemeral
injected verifier. The gate records no token, frame, Origin header, state beyond
the synthetic scalar, trace or browser diagnostic. These commits predate the
Section 2.3 provider and do not satisfy its implementation gate; replacement
pins must prove the control-plane exchange and audience-bound token end to end.

### 14.2 Audience-bound local implementation

The replacement implementation is pinned by:

- Miakapp V3 contract/control-plane merge
  [`cc3bcd7`](https://github.com/Miakapp/Miakapp-V3/commit/cc3bcd70fdb4b058f990ca2607693a2043faebaf)
  and two-relay fixture merge
  [`f9509c4`](https://github.com/Miakapp/Miakapp-V3/commit/f9509c41ef1c0389623d31419372e6430a2313d9);
- MiakAPI merge
  [`a798a74`](https://github.com/Miakapp/MiakAPI/commit/a798a746847ba3d5c16128a08b33353269e770a4);
  and
- Miakapp-Server merge
  [`9a7e33d`](https://github.com/Miakapp/Miakapp-Server/commit/9a7e33de3a684b6cd9e82231db7c9af8bf41a0a1).

MiakAPI's complete gate passes 137 tests plus strict type, build, Node/browser
isolation, external coordinator-contract and package-artifact checks. Its
deterministic lifecycle corpus serializes native WebSocket replacement through a
ten-second close barrier on every routing, pre-open, handshake, protocol and
write failure path. A stuck close fails closed instead of opening an overlapping
relay connection.

The full reciprocal platform gate starts the Auth and Firestore emulators, the
real control-plane router, one real Chromium client and two real Go relays. It
proves:

1. Firebase ID and signed synthetic App Check source credentials remain on the
   HTTPS exchange boundary;
2. only an exact `relay:user` token enters `HELLO` or `REAUTH`;
3. the coordinator session survives control-plane signing-key rotation, after
   which the browser proves audience-bound renewal and route handoff with tokens
   issued by the activated key;
4. same-relay renewal uses one WebSocket and one `reauth` exchange;
5. authoritative Home routing change carries the already-issued credential to
   one replacement relay without another exchange or overlapping sockets;
6. state advances from `21` before handoff to `24` after handoff and three calls
   complete across the two relays; and
7. the relay JWKS cache retains 32-way refresh coalescing, unknown-key abuse
   bounds, conditional expiry, fail-closed outage and bounded recovery.

The closed semantic result reports two sequential browser WebSockets, one
handoff, a maximum of one active browser WebSocket, three user exchanges and
`source_credentials_on_websocket: false`. It contains no bearer, raw UID, email,
Home Key, request body, frame, trace or private Home data. This closes the local
Section 2.3 implementation gate; it is not staging or production evidence.

## 15. Limits of the evidence

The combined local evidence in Section 14 does not prove:

- live Firebase Auth and browser App Check provider behavior, revocation or
  attestation;
- live Cloud KMS signing, Secret Manager access or managed signing-key removal;
- public ingress, proxy limits, admission control or hostile-relay isolation;
- Firefox, WebKit, mobile lifecycle or bfcache support;
- every disconnect, GOAWAY, delayed-frame and network-fault interleaving;
- event APIs, inbound handlers or streamed call progress;
- production React/Firebase Auth integration or sign-out teardown;
- the RFC 0002 component bridge and filtered capabilities; or
- any staging or production behavior.

No item above may be marked complete because a fake, unit test or Chromium-only
loopback gate returned the expected value.

## 16. Production exit gates

The browser client may enter the production application only after:

1. an end-to-end gate proves the RFC 0004 audience/home/user/role-scoped
   credential, source-token confinement, relay-change handoff and local JWKS
   verification in Section 2.3 — complete locally at the Section 14.2 pins;
2. exact staging counterparts of the intended production Origin, WSS endpoint
   and edge frame/rate/admission policy are deployed and observed in isolated
   staging, then production endpoints and configuration are checked against the
   approved template at rollout;
3. live Firebase identity behavior is proven without persisting a token or trace;
4. the required disconnect, resync, reauthentication and page-lifecycle matrix
   passes;
5. the application proves immediate stop/discard on sign-out and identity tuple
   changes;
6. the RFC 0002 host passes only filtered semantic capabilities to guest code;
7. the supported browser matrix passes the relevant integration corpus; and
8. rollback removes the new shell without changing Miakapp 3 production data or
   endpoints.

## 17. Decisions and rationale

| Decision | Rationale |
|---|---|
| separate `miakapi/browser` export | prevents coordinator secrets and Node transport code from entering the web bundle |
| injected credential provider | the SDK does not own Firebase state or persistence and receives one atomic control-plane credential |
| immutable user/home with credential-owned relay | identity changes require teardown while authoritative routing can move safely between leases |
| readiness after complete bootstrap | the host never renders a partially authoritative home |
| immediate subscription snapshot | closes the snapshot-then-subscribe race |
| stale view retained read-only | allows honest degraded UI without presenting old data as live |
| coalesced fail-closed resync | no silent divergence and no resync flood |
| default-target, zero-credit calls first | proves the smallest useful effect path before streaming or target selection |
| no operation replay | physical effects cannot be made safe by transport optimism |
| explicit `outcome_unknown` | uncertainty is represented rather than converted into false rollback |
| browser call handlers omitted | unneeded ambient browser authority is not added to the first profile |
| full-jitter single reconnect loop | bounded load without parallel identity sessions |
| native WebSocket plus one-second accounting budget | broad platform support with an explicit, non-exaggerated memory limitation |
| synthetic semantic Chromium evidence | proves browser mechanics without retaining bearer frames |
| Firebase tokens confined to HTTPS exchange | a platform-wide bearer cannot be made relay-specific by SDK transformation or documentation |
| atomic relay URL and audience-bound token | prevents a cached or caller-selected destination from being paired with newly issued authority |

## 18. References

- [RFC 0001](0001-wire-protocol.md) defines the wire protocol, user role, state,
  calls, reauthentication, error codes and limits.
- [RFC 0002](0002-component-runtime.md) defines the untrusted component and
  semantic capability boundary.
- [RFC 0003](0003-coordinator-sdk-and-migration.md) defines shared values,
  dispatch outcomes and coordinator-side lifecycle semantics.
- [RFC 0004](0004-platform-control-plane.md) defines Firebase/App Check source
  verification and the audience-bound browser relay credential exchange.
- [Miakapp 4 design](../specs/2026-08-29-miakapp-v4-design.md) defines the
  ecosystem trust and migration boundaries.
- [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455.html) defines WebSocket.
- [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html) defines bearer-token
  handling and replay implications.
