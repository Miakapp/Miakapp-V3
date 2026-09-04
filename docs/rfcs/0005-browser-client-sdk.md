# RFC 0005 — Trusted browser relay client 1.0

- Status: accepted for the trusted-relay alpha; production credential gate open
- Product release: Miakapp 4
- Public SDK: `miakapi/browser` in `miakapi@4`
- Last updated: 2026-09-04

## 1. Scope

This document defines the trusted application-host client that connects a human
user to one Miakapp home over RFC 0001. It specifies the public browser package,
authentication-provider boundary, lifecycle, home availability, authoritative
state view, named calls, reconnect and reauthentication behavior, failures,
resource limits and cleanup.

The client is framework-neutral. The future React shell owns Firebase Auth,
relay selection, routing and presentation; the client owns only one fixed
`{user, home, relay}` session. Home-authored component code remains behind the
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
may hold the signed-in Firebase user in memory and may call a token provider.
It MUST NOT give any of the following to an RFC 0002 guest bundle or Worker:

- the Firebase user or ID token;
- the `BrowserClient` object;
- the WebSocket, relay URL mutation authority or raw frames;
- unfiltered state; or
- logger, lifecycle or error objects that could carry host authority.

The trusted host translates only approved state, events and calls into the
versioned semantic component ABI. A component compromise therefore does not
become a Firebase or relay-session compromise.

### 2.2 Firebase-direct alpha profile

RFC 0004 currently assigns a Firebase ID token directly to a role-1 WebSocket
`HELLO` and `REAUTH`. The client keeps that bearer out of URLs, WebSocket
subprotocols, browser persistence, logs, errors and public evidence. This does
not make the selected relay unable to read it: the relay necessarily receives
the token in the binary application frame.

A Firebase ID token is reusable against services that trust the same Firebase
project. Consequently, the Firebase-direct profile has a stronger relay trust
requirement than the audience-bound coordinator profile:

- it MAY be used by synthetic tests;
- it MAY be used with an official relay or a relay the user explicitly trusts
  as completely as the Miakapp backend;
- it MUST NOT power an arbitrary community-relay catalogue; and
- the production application MUST NOT expose unrestricted relay selection while
  this is the only user credential profile.

This restriction concerns credential replay in addition to plaintext home-data
visibility. A warning about home data alone is insufficient.

### 2.3 Required production attenuation

Before broad self-hosted relay selection is enabled, the trusted control plane
MUST exchange Firebase identity for a short-lived user relay credential with at
least these properties:

1. an exact audience naming one relay endpoint;
2. one home ID, one Firebase UID and role `user`;
3. no push, component-publication, owner or coordinator authority;
4. expiry and renewal bounds no weaker than the direct Firebase lease;
5. locally verifiable signatures and bounded public-key refresh at the relay;
6. no Home Key or other permanent secret in the browser or relay; and
7. request admission, App Check posture and audit behavior defined by an update
   to RFC 0004.

The relay URL and home in the application session MUST match the signed claims.
This change may revise the alpha provider name and wire authentication profile;
`miakapi@4` is still prerelease. No SDK-only transformation can safely attenuate
a Firebase bearer because the browser does not possess a trusted signing key.

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

export type FirebaseIdTokenReason = 'initial' | 'reauth' | 'reconnect';

export interface FirebaseIdTokenRequest {
  readonly homeId: string;
  readonly reason: FirebaseIdTokenReason;
  readonly signal: AbortSignal;
}

export interface FirebaseIdTokenProvider {
  getIdToken(request: FirebaseIdTokenRequest): Promise<string>;
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
  readonly relayUrl: string;
  readonly idTokenProvider: FirebaseIdTokenProvider;
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
```

The optional logger accepts only a closed record containing level, stable event,
optional lifecycle status and optional numeric protocol code. Provider exception
text, token text, relay payloads, state and stack traces are never logger fields.

All option, call and protocol-value objects are closed and validated before
handoff. The alpha home ID grammar is 3–63 lowercase ASCII characters, begins
with a letter, ends with a letter or digit, and otherwise contains letters,
digits or hyphens. The relay URL is at most 2,048 bytes, uses `wss:`, contains no
userinfo, query or fragment, and ends in `/ws`.

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
call aborts token acquisition, terminates the current session, marks published
views stale, settles calls conservatively, removes listeners and bounds cleanup
by `deadlineMs`. The status never leaves `stopping` except for `stopped`.

Lifecycle, home, state, error and logger callbacks are isolated from protocol
health. A thrown callback cannot disconnect the relay. A callback may call
`stop()` reentrantly; after each user callback, the client rechecks cancellation
before requesting a token, opening transport, synchronizing or reconnecting.

## 6. Authentication and readiness barrier

For the Firebase-direct alpha profile, the first connection performs:

1. request reason `initial` from `idTokenProvider`;
2. open the fixed secure relay URL with subprotocol `miakapp`;
3. send RFC 0001 role `1` `HELLO` with version range exactly 1.0, token and the
   fixed home ID;
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

Token acquisition, socket/WELCOME handshake and post-WELCOME bootstrap each have
a ten-second maximum. A provider that ignores `AbortSignal` does not extend the
public wait indefinitely. A failed phase terminates its socket before reconnect.

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
sixty seconds. It sends the fresh token in one correlated `REAUTH` on the active
socket and accepts only a matching `REAUTH_OK` whose expiry is in the future.

Token acquisition and response wait are each bounded by the smaller of ten
seconds and the remaining lease. Failure or expiry terminates the transport and
enters reconnect. The relay independently requires the renewed identity to keep
the same role, home, UID and verified principal fields.

A frozen, suspended or heavily throttled page may miss its renewal timer. This
does not extend authority: the relay lease closes. On resume, normal reconnect
requests reason `reconnect` and establishes a new session from authoritative
bootstrap. A complete Page Lifecycle/bfcache policy remains a host acceptance
gate, not an excuse to keep an expired socket.

The host MUST stop and discard the client immediately when Firebase signs out or
when user, home or relay selection changes. A new identity tuple requires a new
client instance and new token provider closure.

## 11. Reconnect and draining

Unexpected closure, retryable protocol failure or failed renewal marks state and
home views stale, settles active calls once, reacquires a token with reason
`reconnect` and opens one replacement socket. No operation queue survives the
gap.

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
and ingress MUST enforce frame/rate limits before sending, the direct profile
remains trusted-relay-only, and a Worker or process boundary SHOULD be evaluated
for a hardened browser profile. This implementation MUST NOT claim hard memory
isolation from a malicious relay.

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
only allow-listed semantic counters and outcomes. Browser traces, network HARs
and WebSocket frame inspection are forbidden in credential-bearing acceptance
runs because they may retain `HELLO`, `REAUTH` or home data.

## 14. Conformance evidence

The accepted implementation is pinned by:

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
the synthetic scalar, trace or browser diagnostic.

## 15. Limits of the evidence

The evidence in Section 14 does not prove:

- Google Firebase certificate fetching, cache rotation or token revocation;
- an attenuated audience-bound user relay credential;
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

1. RFC 0004 defines and an end-to-end gate proves the audience/home/user/role
   scoped credential in Section 2.3, or product policy intentionally limits the
   direct profile to an explicitly enumerated fully trusted relay set;
2. exact production Origins, WSS endpoints and edge frame/rate/admission limits
   are deployed and observed in isolated staging;
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
| injected identity provider | the SDK does not own Firebase state or persistence and can adopt the future attenuated exchange |
| one immutable home/relay tuple | identity changes require deterministic teardown rather than mutable cross-session state |
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
| arbitrary relay selection blocked for Firebase-direct | a platform-wide bearer cannot be made audience-bound by documentation |

## 18. References

- [RFC 0001](0001-wire-protocol.md) defines the wire protocol, user role, state,
  calls, reauthentication, error codes and limits.
- [RFC 0002](0002-component-runtime.md) defines the untrusted component and
  semantic capability boundary.
- [RFC 0003](0003-coordinator-sdk-and-migration.md) defines shared values,
  dispatch outcomes and coordinator-side lifecycle semantics.
- [RFC 0004](0004-platform-control-plane.md) defines the current Firebase user
  profile and the control plane that must own future credential attenuation.
- [Miakapp 4 design](../specs/2026-08-29-miakapp-v4-design.md) defines the
  ecosystem trust and migration boundaries.
- [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455.html) defines WebSocket.
- [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html) defines bearer-token
  handling and replay implications.
