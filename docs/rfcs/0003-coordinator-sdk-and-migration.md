# RFC 0003 — Coordinator SDK and migration adapter 1.0

- Status: accepted
- Product release: Miakapp 3.5
- Public SDK major: `miakapi@4`
- Last updated: 2026-08-30

## 1. Scope

This document defines the public coordinator API that agents and applications use
on top of RFC 0001, together with the temporary Node-RED migration boundary. It
specifies observable lifecycle, declaration, state, event, call, presence, error,
shadow, comparison and shutdown behavior. The API is deliberately higher-level
than wire frames: applications use names and values while the SDK owns request
identifiers, dictionaries, epochs, revisions, generations, reauthentication,
backpressure and reconnect scheduling.

The following remain outside this RFC:

- the HTTP shape of Home Key exchange and platform token issuance;
- the CLI command catalogue and agent-pack repository convention;
- push-recipient grants and actual platform push delivery;
- relay implementation details already owned by RFC 0001;
- durable event replay, durable call-operation resources and active-active
  physical control;
- a permanent Node-RED product or a permanent v3 compatibility path.

The words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT** and
**MAY** are interpreted as described in RFC 2119 and RFC 8174.

## 2. Design constraints

The coordinator surface has eight constraints:

1. **Desired declarations are distinct from commands.** Complete state, ACL,
   event and function slices may be reconciled after reconnect. State mutations,
   events and calls are never replayed merely because a connection failed.
2. **Wire bookkeeping is private.** An application never handles a path ID,
   topic ID, function ID, request ID, home epoch, state revision or coordinator
   generation to perform an ordinary operation.
3. **Uncertain effects stay uncertain.** Timeout, cancellation and transport
   loss do not claim rollback. A post-acceptance call without a terminal result
   is exposed as `outcome_unknown`.
4. **Cancellation is cooperative.** Every potentially waiting public operation
   accepts or carries an `AbortSignal`. Aborting work does not imply that an
   already-started physical effect was undone.
5. **Streams are pull-bounded.** Call progress is exposed through a bounded async
   iterator. Receiver demand, not an unbounded callback list, grants wire credit.
6. **Authentication is injected.** The SDK consumes short-lived access material
   from a provider. It does not define or log Home Keys and does not embed the
   still-open platform control-plane contract.
7. **Shadow means non-actuating by construction.** Mirroring an input while
   discarding its result is not a safety boundary. Shadow effects go only to an
   isolated recorder, and an unclassified effect fails closed.
8. **The working v3 installation is an oracle, not a new architecture.** Legacy
   groups, DOM element actions and push selection may be translated temporarily
   for comparison but do not enter the 3.5 product contract.

## 3. Package and runtime boundary

### 3.1 Versioning

The existing `miakapi@3` CommonJS factory is not source-compatible with this API.
The new surface therefore ships as `miakapi@4`, even though the product release is
Miakapp 3.5. The npm major follows semantic compatibility; it is not the product
version or wire major.

Released artifacts are immutable. Removing or changing an exported public type,
method, event ordering rule, retry rule or error outcome requires a new package
major. Adding an optional method or field may use a package minor only when older
consumers continue to behave correctly.

### 3.2 Runtime profile

The production package is authored in strict TypeScript and publishes compiled
JavaScript plus declarations. Bun is the primary coordinator runtime. The shared
coordinator library MUST also run under the Node version required by the migration
adapter; the first adapter baseline is Node 22.9 or newer and Node-RED 5.

The package exports an explicit ESM boundary. It does not expose source files or
undocumented subpaths. Runtime-specific filesystem, process, keychain, prompt and
HTTP behavior belongs behind injected adapters or separate entry points. Importing
the coordinator library has no network, timer, logging or process-exit side
effect.

### 3.3 Value profile

All values crossing the coordinator surface use RFC 0001 `ProtocolValue`: null,
booleans, safe integers, finite non-integral numbers, strings, `Uint8Array`, dense
arrays and string-keyed records composed from the same values. `undefined`,
`BigInt`, dates, functions, sparse arrays, cycles, non-finite numbers, negative
zero and prototype-reserved keys are rejected before an operation is queued.

## 4. Public surface

The normative TypeScript names below define API 1.0. The executable contract
package compiles the structural declarations; the future production package
supplies the `createCoordinator` implementation. Documentation may provide
additional helpers, but helpers MUST preserve these semantics.

```ts
export function createCoordinator(options: CoordinatorOptions): Coordinator;

export interface CoordinatorOptions {
  name: string;
  accessTokenProvider: AccessTokenProvider;
  logger?: CoordinatorLogger;
}

export interface CoordinatorConfiguration {
  state: Readonly<Record<string, ProtocolValue>>;
  stateAccess: readonly UserStateAccess[];
  events: readonly EventDeclaration[];
  eventAccess: readonly UserEventAccess[];
  functions: Readonly<Record<string, FunctionHandler>>;
}

export interface Coordinator {
  readonly status: CoordinatorStatus;
  readonly state: CoordinatorState;
  readonly access: CoordinatorAccess;
  readonly events: CoordinatorEvents;
  readonly functions: CoordinatorFunctions;
  readonly calls: CoordinatorCalls;
  readonly presence: CoordinatorPresence;
  readonly errors: CoordinatorErrors;

  configure(configuration: CoordinatorConfiguration): void;
  start(options?: StartOptions): Promise<ReadySession>;
  stop(options?: StopOptions): Promise<void>;
  subscribe(listener: (event: LifecycleEvent) => void): Unsubscribe;
}
```

Construction is inert. `createCoordinator` validates local options but opens no
socket. One instance represents one coordinator name and owns at most one managed
connection loop. Applications create another instance for another coordinator
name rather than mutating identity after construction.

`configure` validates, copies and synchronously stages all five complete desired
slices while the coordinator is `idle`. It performs no I/O and returns only after
the in-memory bootstrap is ready for `start`. Calling it after `start` throws
`invalid_lifecycle`. Empty slices are explicit, so the canonical bootstrap is:

```ts
const coordinator = createCoordinator(options);
coordinator.configure(configuration);
await coordinator.start();
```

This avoids awaiting an offline declaration promise before the connection needed
to settle it exists. Slice-specific declaration methods remain available for
later replacement.

Every subscription method returns an idempotent `Unsubscribe`. A listener added
during dispatch does not receive the event already being dispatched. Removing a
listener prevents later events, and `stop` removes all internal transport
listeners even if an application forgets its own unsubscribe handle.

## 5. Access-token provider

```ts
export interface AccessTokenRequest {
  coordinatorName: string;
  reason: 'initial' | 'reauth' | 'reconnect';
  relayHost?: string;
  signal: AbortSignal;
}

export interface AccessToken {
  relayUrl: string;
  token: string;
  expiresAtMs: number;
}

export interface AccessTokenProvider {
  getAccessToken(request: AccessTokenRequest): Promise<AccessToken>;
}
```

The provider is the only mandatory authentication dependency. Its future platform
implementation may exchange a Home Key, use a test emulator or obtain access
material from another approved store. RFC 0003 does not expose the Home Key to the
socket layer.

The SDK validates that `relayUrl` is a secure WebSocket URL ending in `/ws`, that
the token is a bounded non-empty string, and that expiry is in the future. It
requests fresh material for initial connection, reconnect and reauthentication.
Concurrent refresh demand is coalesced to one provider call per coordinator
instance. A failed provider call is classified before any socket operation and
contains no token in logs or public error messages.

The provider receives a child signal owned by the SDK. `stop` or parent
cancellation aborts it. The SDK MUST NOT retry the provider independently of its
managed reconnect schedule; otherwise two nested retry loops can create an
unbounded request storm.

## 6. Lifecycle

### 6.1 Public states

```ts
export type CoordinatorStatus =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'synchronizing'
  | 'ready'
  | 'reconnecting'
  | 'draining'
  | 'stopping'
  | 'stopped';

export interface ReadySession {
  sessionId: number;
  generation: number;
  connectedAtMs: number;
}

export interface LifecycleEvent {
  previous: CoordinatorStatus;
  current: CoordinatorStatus;
  session?: ReadySession;
  reason?: CoordinatorFailure;
}
```

The SDK maps RFC 0001 connection states into this application lifecycle:

```text
idle -> connecting -> authenticating -> synchronizing -> ready
                    \                        |            |
                     +----> reconnecting <---+------------+
                                  |
                                  +-> connecting

any started state -> draining -> stopping -> stopped
any started state -------------> stopping -> stopped
ready -> synchronizing -> ready
```

`start()` starts the managed loop and resolves at the first `ready` transition,
after `WELCOME` and acknowledgement of every current complete declaration. It
does not resolve at TCP/WebSocket open. A second `start` while started rejects
synchronously with `invalid_lifecycle`; it never creates another socket.

An optional `StartOptions.signal` owns the lifetime of the managed loop. If it is
already aborted, no token request or socket is created. Aborting it is equivalent
to `stop`, except that waiting application operations reject as cancelled.

After the first ready session, an abnormal disconnect does not settle `start`
again. The status becomes `reconnecting`, pending non-replayable operations are
completed according to Sections 9 through 11, and the SDK follows RFC 0001 full-
jitter exponential backoff. A successful `WELCOME` resets the attempt counter.

### 6.2 Synchronization barrier

Before each `ready` transition, the SDK sends all five latest complete desired
slices in this order:

1. state declaration;
2. state access declaration;
3. event topic declaration;
4. event access declaration;
5. function declaration.

Every slice defaults to empty and is sent even when the application never made it
non-empty. Under RFC 0001 Section 7.5, the relay stages the first four frames and
atomically activates all five only when the function slice succeeds. The SDK
waits for that final acknowledgement before entering `ready`. No client can
observe a state/ACL, topic/ACL or function prefix. A collision, invalid
declaration or permanent authorization error discards the staged transaction and
prevents `ready`; it is never hidden behind reconnect. A transient transport loss
restarts synchronization from the newest complete desired slices.

The relay performs final activation revalidation under its home-scoped lock as
defined by RFC 0001. A permanent failure during an in-session replacement rejects
every declaration promise represented by that desired snapshot, restores the
desired snapshot to the unchanged acknowledged-active snapshot, and returns the
public status from `synchronizing` to `ready`. No dictionary or handler swap is
performed. A later application declaration starts a new transaction. Failure
during initial synchronization leaves no active configuration and never resolves
`start`; the application must supply a corrected complete desired snapshot or
stop the coordinator.

During an in-session replacement, the public status is `synchronizing`. The SDK
retains separate desired and acknowledged-active snapshots. Incoming work already
routed under the active snapshot uses the handler captured at dispatch; new
outgoing mutations, events and calls reject as `unavailable/not_dispatched` until
the atomic activation is acknowledged. Ordered transport processing lets the SDK
swap to the desired dictionaries and handler snapshot while handling the final
acknowledgement, before a frame using the new active configuration is dispatched.

### 6.3 Stop and draining

`stop()` is idempotent. It stops accepting new work, aborts token and handler
work, cooperatively cancels outgoing calls, removes transport listeners, closes
the socket and waits for bounded cleanup. A second call returns the same terminal
promise. `StopOptions.deadlineMs` bounds graceful draining; expiry drops the
transport without claiming that accepted effects were undone.

`GOAWAY` produces `draining`: no new state mutation, event or call is sent. The
SDK permits terminal replies and then reconnects only when the reason allows it.

## 7. Complete declarations

Complete declaration APIs update the SDK's desired model. They are the only
application operations that may be reconciled automatically after reconnect.
Each slice-specific change causes a full five-slice declaration transaction; the
other four slices come from the latest desired snapshot.

```ts
export interface DeclarationOptions {
  signal?: AbortSignal;
}

export interface DeclarationReceipt {
  sessionId: number;
  generation: number;
}

export interface CoordinatorState {
  declare(
    entries: Readonly<Record<string, ProtocolValue>>,
    options?: DeclarationOptions,
  ): Promise<DeclarationReceipt>;

  set(
    mutations: readonly StateMutation[],
    options?: OperationOptions,
  ): Promise<StateReceipt>;
}

export type StateMutation =
  | { path: string; value: ProtocolValue }
  | { path: string; delete: true };
```

`state.declare` is RFC 0001 `STATE_SYNC`: the provided object is the complete
coordinator-owned slice, and absence deletes an earlier path. The SDK validates
and copies it before replacing the desired model; later caller mutation has no
effect. The newest declaration supersedes an older declaration that has not yet
been acknowledged. The older promise rejects as `superseded`, rather than
claiming that the older slice became active.

`CoordinatorAccess` exposes complete state and event ACL slices:

```ts
export interface UserStateAccess {
  userId: string;
  patterns: readonly string[];
}

export interface UserEventAccess {
  userId: string;
  publish: readonly string[];
  subscribe: readonly string[];
}

export interface CoordinatorAccess {
  declareState(
    entries: readonly UserStateAccess[],
    options?: DeclarationOptions,
  ): Promise<DeclarationReceipt>;

  declareEvents(
    entries: readonly UserEventAccess[],
    options?: DeclarationOptions,
  ): Promise<DeclarationReceipt>;
}
```

The SDK treats each array as a complete owned slice, rejects duplicate users and
patterns, and preserves an explicit user with an empty state pattern list. It
does not infer enrollment, groups or permissions from state path names.

An application may call declaration methods while offline, but `configure` is the
required non-racy bootstrap when several slices are known initially. A declaration
call copies and stages its slice synchronously; its promise waits for a future
atomic activation unless its signal aborts. If a newer desired snapshot replaces
it before the transaction's final frame is handed to the transport, the older
promise rejects as `superseded` and that snapshot never activates. Once the final
frame is handed off, its outcome can no longer be reclassified as superseded; a
later change is queued as a subsequent transaction. The handed-off transaction
remains current until its final acknowledgement or error. On acknowledgement,
its promises resolve and the SDK immediately starts the queued full five-slice
transaction; it does not re-enter `ready` between those transactions. Further
changes before that queued transaction is handed off may supersede the queued
snapshot, but never the already handed-off transaction. Declaration promises do
not survive `stop`.

The conformance corpus assigns monotonically distinguishable synthetic revisions
to each slice and records the revision snapshot at each transaction start. These
revision labels are test evidence, not public SDK fields: they prove that an
unchanged slice is copied from the latest desired snapshot, that a failed
activation restores the acknowledged-active desired cache, and that a later
unrelated update cannot resurrect rejected slice content.

## 8. State mutations

`state.set` is an atomic RFC 0001 `STATE_SET` using string paths. A mutation batch
must contain unique paths and may reference only the acknowledged-active state slice.
The SDK resolves dictionary IDs internally for the active home epoch.

The SDK does not queue `state.set` while offline or synchronizing. It rejects
before send as `unavailable`, which proves that this SDK instance did not dispatch
the mutation. Once the complete frame is handed to the active transport, the SDK
never retransmits it automatically. A transport loss before `STATE_SET_OK` is
reported as `outcome_unknown`, because local write completion does not prove
relay application.

```ts
export interface StateReceipt {
  outcome: 'applied';
}

export interface OperationOptions {
  signal?: AbortSignal;
}
```

An `applied` receipt means the relay acknowledged the atomic mutation and advanced
the home revision. It does not prove observation by a physical device. Aborting
before send yields `cancelled/not_dispatched`; aborting after send yields
`outcome_unknown` unless the acknowledgement already arrived.

## 9. Events

```ts
export const EventDirection = {
  acceptFromUsers: 0x01,
  publishToUsers: 0x02,
  acceptFromCoordinators: 0x04,
  publishToCoordinators: 0x08,
} as const;

export interface EventDeclaration {
  topic: string;
  directions: number;
}

export type EventTarget =
  | { kind: 'default' }
  | { kind: 'user_session'; id: number }
  | { kind: 'coordinator'; id: string };

export interface SentEvent {
  outcome: 'sent';
}

export interface EventHandle {
  readonly localId: string;
  readonly sent: Promise<SentEvent>;
}

export interface CoordinatorEvents {
  declare(
    entries: readonly EventDeclaration[],
    options?: DeclarationOptions,
  ): Promise<DeclarationReceipt>;

  publish(
    topic: string,
    value: ProtocolValue,
    options?: OperationOptions & { target?: EventTarget },
  ): EventHandle;

  subscribe(
    topic: string,
    listener: (event: IncomingEvent) => void,
  ): Unsubscribe;
}
```

`events.declare` is the complete owned topic slice. `subscribe` is a local handler
for events routed to this coordinator; it does not create a user-side RFC 0001
subscription. Multiple local listeners may observe one incoming event, and one
listener throwing does not prevent the others. Listener failures are reported to
the injected logger with payloads redacted.

`publish` validates the topic against the acknowledged-active declaration and
returns an `EventHandle` synchronously. This makes `localId` available before an
immediate relay error can be delivered. The `sent` promise rejects while no ready
session exists and resolves only after the complete frame is handed to the active
transport. `sent` is not a delivery acknowledgement. A later relay `ERROR` is
delivered through the coordinator error subscription with an event correlation
containing the same `localId`; the SDK settles `sent` before dispatching that
correlated error. It does not retroactively convert the receipt into delivery. No
event is retried, deduplicated or replayed by the SDK.

The SDK allocates each wire `eventId` once per connection, never reuses it on that
connection, and retains or can reconstruct its `eventId` to `localId` association
until disconnect. A delayed error for an earlier event therefore cannot be
attributed to a later publish. The association is released when that connection
closes because the relay cannot send another error in its old identifier
namespace. Implementations SHOULD encode the connection generation and wire ID
inside the opaque `localId` so this guarantee does not require an unbounded map.

## 10. Functions and incoming calls

```ts
export interface Principal {
  kind: 'user' | 'coordinator' | 'cli';
  id: string;
  sessionId: number;
  coordinatorName: string | null;
  verifiedEmail: string | null;
}

export interface IncomingCall {
  source: Principal;
  arguments: ProtocolValue;
  idempotencyKey: string | null;
  signal: AbortSignal;
  emit(value: ProtocolValue): Promise<void>;
}

export type FunctionHandler = (
  call: IncomingCall,
) => ProtocolValue | Promise<ProtocolValue>;

export interface CoordinatorFunctions {
  declare(
    handlers: Readonly<Record<string, FunctionHandler>>,
    options?: DeclarationOptions,
  ): Promise<DeclarationReceipt>;
}
```

The handler record is the complete function slice. The SDK snapshots the record,
rejects duplicate/reserved names and retains it as the desired handler snapshot.
The acknowledged-active snapshot continues serving already routed calls until
atomic declaration activation. While processing the final ordered acknowledgement,
the SDK swaps handler and dictionary snapshots before accepting a later frame. A
wire dispatch for a name without the handler from the same active declaration is
a fatal SDK invariant failure; it is never routed to an arbitrary fallback.

`IncomingCall.source` is constructed from relay-supplied principal metadata and
is immutable. Handler code still performs final business authorization. The SDK
does not translate verified email into authority and does not infer legacy group
membership.

`emit` produces a non-final result and waits for receiver credit. Concurrent emits
from one handler are serialized in call order. Its promise rejects if the call is
cancelled, times out, disconnects or becomes terminal. Returning from the handler
sends the one final result, which bypasses credit. A thrown public
`ApplicationCallError` becomes a sanitized 2000–2999 call error:

```ts
export class ApplicationCallError extends Error {
  readonly code: number;
  readonly retryable: boolean;
  constructor(code: number, message?: string, retryable?: boolean);
}
```

The constructor rejects codes outside the RFC 0001 application range and bounds
the explicitly caller-safe message to 256 UTF-8 bytes without control characters.
It validates `retryable` as a boolean at runtime rather than relying on TypeScript,
because JavaScript and Node-RED callers use the same constructor. Any other throw
becomes a generic internal call error; stack traces and arbitrary thrown text are
not sent to the caller.

The handler's signal aborts on cancellation, deadline, generation replacement,
disconnect or SDK stop. This requests cooperative cleanup only. The SDK sends no
late result after the route becomes terminal.

The SDK passes the optional idempotency key to the handler and performs no hidden
deduplication. The application owns atomic token/effect persistence, parameter
matching and retention. Losing that store loses its guarantee.

## 11. Outgoing calls

```ts
export type CallTarget =
  | { kind: 'default' }
  | { kind: 'user_session'; id: number }
  | { kind: 'coordinator'; id: string };

export interface StartCallOptions {
  function: string;
  arguments: ProtocolValue;
  timeoutMs: number;
  target?: CallTarget;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface CallHandle {
  readonly localId: string;
  readonly accepted: Promise<void>;
  readonly stream: AsyncIterable<ProtocolValue>;
  readonly result: Promise<ProtocolValue>;
  cancel(reason?: string): void;
}

export interface CoordinatorCalls {
  start(options: StartCallOptions): CallHandle;
}
```

`calls.start` validates the option shape synchronously and throws before creating
a handle when that shape is invalid. For a valid shape with no ready session, it
returns a handle whose `accepted` and `result` promises reject as
`unavailable/not_dispatched` and whose stream closes with the same failure. It
never waits offline and later sends a stale intent. `accepted` maps only to RFC
0001 `CALL_ACCEPTED`. It does not mean the callee started or applied work.

The SDK grants stream credit as the consumer advances `stream`, never above the
wire maximum. Abandoning iteration does not cancel the call automatically because
the final result may still matter; the caller explicitly calls `cancel` or aborts
its signal. `result` resolves only with the final result. A terminal error rejects
`accepted` if acceptance was not observed, rejects `result`, and closes `stream`.
Receipt of `CALL_ERROR` begins that single terminal settlement: no later progress
or result is exposed, and the correlated operation terminal must be recorded
before the call is considered closed.

Local failure before the complete `CALL` frame is handed to the transport, or an
explicit relay terminal response that guarantees pre-dispatch rejection, is
`not_dispatched`. Transport loss after handoff is `outcome_unknown` even when
`accepted` has not resolved, because the relay may already have dispatched the
callee. Failure after acceptance without a terminal result is likewise
`outcome_unknown`, including cancellation and deadline. The SDK never retries a
call, even when an idempotency key is present. Application code may deliberately
issue another call only after evaluating its own operation policy.

## 12. Presence

```ts
export interface PresenceEntry {
  sessionId: number;
  userId: string;
}

export interface CoordinatorPresence {
  snapshot(): readonly PresenceEntry[];
  subscribe(listener: (entries: readonly PresenceEntry[]) => void): Unsubscribe;
}
```

The SDK applies each `PRESENCE_SNAPSHOT` and `PRESENCE_CHANGE` to one immutable,
session-keyed view. `snapshot` returns a copy sorted by session ID. A subscriber
receives the current complete view immediately, then a new complete view after
each effective change. Duplicate connects, unknown disconnects and conflicting
session identities are protocol errors rather than best-effort corrections.

Presence means authenticated sockets, not human occupancy. It is cleared on
disconnect and rebuilt on the next generation.

## 13. Errors and diagnostics

```ts
export type DispatchOutcome =
  | 'not_dispatched'
  | 'sent'
  | 'accepted'
  | 'applied'
  | 'outcome_unknown';

export interface CoordinatorFailure extends Error {
  kind:
    | 'protocol'
    | 'authentication'
    | 'authorization'
    | 'conflict'
    | 'invalid_lifecycle'
    | 'unavailable'
    | 'cancelled'
    | 'superseded'
    | 'internal';
  code?: number;
  retryable: boolean;
  outcome: DispatchOutcome;
  correlation?: {
    kind: 'event' | 'call';
    localId: string;
  };
}

export interface CoordinatorErrors {
  subscribe(listener: (failure: CoordinatorFailure) => void): Unsubscribe;
}
```

Numeric codes, when present, are the RFC 0001 catalogue. Human messages are
diagnostic only and MUST NOT be parsed. A transport failure without a relay frame
has no invented numeric code. `retryable` describes infrastructure eligibility,
not permission for the SDK to repeat an effectful application operation.

The optional logger receives structured lifecycle and SDK invariant records. The
default logger is silent. Tokens, Home Keys, arguments, state values, event
payloads, notification contents, verified email and stack traces from application
handlers are redacted by default. Logging a path, topic, function or coordinator
name is allowed only after the caller explicitly enables name diagnostics.

## 14. Node-RED migration adapter

### 14.1 Product boundary

The adapter is temporary coordinator-side migration tooling. It is not a v3
protocol path in the new relay and is not the recommended way to build a new
Miakapp home. The public `node-red-contrib-miakapi` package remains on the legacy
major, receives deprecation/onboarding messaging and points users to
`https://miakapp.com/`. The bridge may live in the same source repository but is
published, enabled and removed independently from the legacy nodes.

### 14.2 Node-RED structure

The bridge uses one Node-RED configuration node per coordinator connection. The
configuration node owns the `miakapi@4` instance, connection status, desired
declarations, bounded recorder and cleanup. Functional nodes obtain it through
`RED.nodes.getNode`; no module-global home, variables object or handler registry
exists.

The Home Key or equivalent bootstrap secret is a Node-RED credential, declared in
the registration credential schema and read through `node.credentials`. It is not
an ordinary node default, flow property, status string, comparison report or
exported message field.

Every runtime node implements `close`. Closing or redeploying a configuration
node aborts in-flight evaluation and replay, removes listeners, stops the SDK and
invokes the Node-RED completion callback within its runtime deadline. Input
handlers use `(msg, send, done)` and report failures through `done(error)` so
Catch nodes can observe them.

Configured value expressions use Node-RED's typed-property evaluation utilities,
including their asynchronous context path. The adapter does not own a private
JSONata 1.x runtime and does not assume synchronous evaluation. Context reads are
copied and validated before entering the protocol value boundary.

### 14.3 Legacy translation

For the temporary comparison window only:

- a v3 full variable commit is converted into the bridge coordinator's complete
  state slice using the same path strings;
- the legacy `global.` namespace may be translated into explicit per-user ACLs;
- legacy group-name prefixes may be translated from the current legacy user list
  into explicit user ACL entries;
- an empty explicit ACL remains an enrolled user with no state visibility;
- DOM element action IDs, admin flags, notification flags and group names remain
  adapter inputs and never become general 3.5 SDK concepts;
- notification sends become notification intents in all non-live modes.

Translation is deterministic and closed: an unknown path form, duplicate user,
ambiguous action element or unsupported value rejects the current comparison
capsule. It is not silently dropped.

## 15. Migration modes and effect safety

The adapter exposes these modes with an explicit order of authority:

| Mode | State publication | Candidate input | Effect destination |
|---|---|---|---|
| `observe` | none | synthetic/local only | recorder |
| `shadow_state` | beta 3.5 relay | no user calls declared | recorder |
| `recorded_action` | isolated beta relay | declared only in isolated test | recorder |
| `canary_live` | canary relay | explicitly enabled | approved live sink |

`observe` is the default. Changing to `recorded_action` or `canary_live` requires
an explicit configuration edit and redeploy; an inbound message cannot escalate
the mode.

In every non-live mode, the only supplied effect capability is an `EffectRecorder`
with bounded methods for device commands and notification intents. There is no
live device, MQTT, GPIO, HTTP, shell, push or arbitrary Node-RED send capability
inside the conformance subject. An effect category absent from the recorder
contract throws `unclassified_effect` and fails the capsule.

`shadow_state` does not declare callable functions to beta users. Copying an
action into an ordinary Node-RED flow and discarding its response is forbidden:
the downstream flow may still actuate. `recorded_action` is permitted only when
the complete action path is structurally connected to the recorder or another
reviewed dry-run implementation. Labels, comments and a `dryRun` boolean passed
to arbitrary downstream code are not enforcement.

`canary_live` is outside automated public CI. It requires the operational
migration gate: verified backup, restore rehearsal, reviewed mapping, explicit
effect allowlist, owner approval, monitored window and rollback criteria.

## 16. Deterministic comparison

One comparison capsule has:

- a fixture and schema version;
- a fixed scenario ID, seed and clock;
- the adapter mode and configuration digest;
- one baseline observation and one candidate observation;
- a causal checkpoint identifying when both observations are complete;
- an explicit equivalence policy;
- the first divergence and bounded supporting detail.

State is compared only at a shared causal checkpoint. Comparing two live values
read at unrelated wall-clock instants is invalid. The synthetic corpus supplies
that checkpoint through ordered stimuli and final observation. Production-shaped
comparison must introduce an equivalent revision or barrier before making a
correctness claim.

Objects are compared by sorted UTF-8 keys. Arrays retain order unless one named
field has an explicit set-equivalence rule. Numbers, units, timestamps, Unicode
normalization and null/deletion semantics are never normalized implicitly.
Volatile fields are ignored only through an exact reviewed path list. A wildcard
ignore over a namespace that contains behavior is forbidden.

Before candidate comparison, the harness runs baseline against baseline to
measure nondeterminism. A noisy field is either made deterministic, assigned a
specific equivalence rule or recorded as an unresolved gate; it is not hidden by
a broad mismatch filter.

Reports contain synthetic material in public CI. Production comparison reports,
raw values, user identities and flow exports remain private and gitignored.

## 17. Synthetic-home conformance adapter

The executable coordinator contract consumes the generic `synthetic-home`
`ReplaySubject` boundary. A future MiakAPI or Node-RED implementation supplies:

```ts
reset(setup, signal)
dispatch(stimulus, signal)
observe(signal)
```

The contract wrapper provides only a deterministic clock, copied state/context,
the SDK-level stimulus surface, a bounded state publisher and a bounded effect
recorder. It never supplies a production network or device capability. In
publishing modes, `observe` takes final state from recorder-owned publication
evidence rather than the adapter's claim; it similarly replaces claimed commands
and notification intents. The existing synthetic runner compares that evidence,
context, lifecycle and operation outcomes exactly.

Recorder and state-publisher façades are fresh, lease-bound capabilities for one
scenario. The harness revokes the prior lease before reset, on cancellation or
failure, and before the observation checkpoint. A late asynchronous write rejects
with `capability_lease_expired`; it cannot mutate evidence already compared or
contaminate the next scenario.

The coordinator contract adds API-level traces for:

1. inert construction, stimulus-indexed lifecycle transitions, exact `start` and
   shared `stop` promise settlements, and a one-socket scenario high-water mark;
2. declaration ordering, all-or-nothing activation, supersession and settlement
   of every declaration promise, explicit final-frame handoff, queued
   post-handoff replacement, per-slice snapshot revisions, and fail-closed
   rollback after locked final validation;
3. safe declaration reconciliation after generation replacement;
4. rejection rather than offline queueing of state mutations, events and calls;
5. event `sent` without delivery acknowledgement and ordered late-error correlation;
6. settlement of every call handle across offline rejection, explicit pre-accept
   relay rejection or successful cancellation terminal, ordered progress, final
   result, correlated `CALL_ERROR`, disconnect and post-accept cancellation;
7. local pre-send `not_dispatched` versus post-handoff `outcome_unknown`, including
   loss before `CALL_ACCEPTED` is observed, with explicit idempotency-key evidence
   proving that keyed calls are not automatically retried;
8. presence reset and rebuild;
9. duplicate-start rejection, repeated-stop cleanup and zero residual resources;
10. shadow state publication with zero live effects;
11. fail-closed unclassified effects;
12. deterministic divergence reporting.

The in-process library runner uses deadlines and parent cancellation for every
subject hook and includes observation validation in that boundary. The public
external-subject CLI additionally imports, constructs and executes the subject in
a dedicated child process supervised by stage and total watchdogs, authenticated
completion messages and a bounded kill grace, so a synchronous infinite loop or
inherited worker pipe cannot pin the checker. This is a termination boundary, not
an OS sandbox: production-shaped comparison also structurally replaces every live
effect capability rather than invoking untrusted Node-RED or adapter code in the
orchestrator process.

## 18. Preserved and intentionally fixed behavior

| V3 behavior | 3.5 migration decision |
|---|---|
| coordinator starts locally and reconnects | preserved with explicit lifecycle and jittered backoff |
| complete variable view can initialize a client | preserved as declared state plus authoritative user snapshot |
| `global.` and group prefixes filter users | translated temporarily; fixed as explicit per-user ACLs |
| user actions contain element ID/type/name/value | translated temporarily; fixed as named calls with authenticated principal |
| callbacks append forever | fixed with idempotent unsubscribe and shutdown cleanup |
| one module-global Node-RED home | fixed with explicit configuration nodes |
| coordinator secret stored in node defaults | fixed with credential storage and Home Key token provider |
| full commit after every change | fixed with complete declaration for ownership and atomic named mutations thereafter |
| fixed one-second reconnect | fixed with RFC 0001 full-jitter exponential backoff |
| application ping every five seconds | removed; RFC 6455 control frames own liveness |
| notification code directly selects and sends to users | intent preserved; delivery waits for the control-plane push-grant contract |
| action group filtering only in a Node-RED callback | fixed; relay metadata plus final coordinator authorization are mandatory |
| manual live script as `npm test` | fixed with isolated deterministic contract tests |

## 19. Conformance

A coordinator SDK conforms to API 1.0 when it:

1. compiles the normative public type examples without undocumented imports;
2. validates the complete dynamic value and name boundary before transport use;
3. produces the required stimulus-indexed lifecycle and declaration order against
   a scripted fake relay;
4. atomically activates full five-slice transactions, settles every represented
   declaration promise, and reconciles only complete desired declarations after
   reconnect;
5. never automatically retries a mutation, event or call;
6. preserves `not_dispatched`, `sent`, `accepted`, `applied` and
   `outcome_unknown` distinctions under disconnect fault injection;
7. enforces bounded call streaming and cooperative cancellation;
8. redacts secrets and application values from default diagnostics;
9. cleans sockets, token requests, handlers, iterators, timers and listeners on
   stop;
10. passes the RFC 0001 codec fixtures and session direction tests required of its
    transport layer;
11. passes the complete coordinator-contract `sdk` profile under Bun and the
    supported Node runtime.

A migration adapter additionally conforms when it:

1. uses a Node-RED configuration node and credential store;
2. closes cleanly across full and modified redeploys;
3. evaluates typed properties asynchronously through the Node-RED runtime;
4. consumes the public synthetic-home fixture without production data;
5. publishes only state in `shadow_state`;
6. routes every non-live effect to the bounded recorder;
7. fails an unclassified effect closed;
8. distinguishes causal divergence from configured deterministic equivalence;
9. demonstrates zero live device and push invocations in the adapter harness;
10. emits deprecation/onboarding guidance without making the bridge a permanent
    product promise.

The migration adapter MUST pass the complete coordinator-contract `migration`
profile. The executable runner MAY also run `all` as a kit-integrity check, but
neither implementation is required to impersonate the other boundary. Profile
selection MUST retain the fixed coverage set for that profile; selecting an
arbitrary subset is not conformance.

The shared executable package establishes the public surface and fixture runner.
It does not prove a future MiakAPI build or Node-RED runtime conforms until that
implementation is installed as the subject and passes its complete profile.

## 20. Security and privacy acceptance matrix

| Threat | Required evidence |
|---|---|
| state or ACL prefix becomes visible during replacement | intermediate probes observe only the previous configuration until atomic activation |
| concurrent coordinators stage a colliding declaration | home-locked final revalidation activates at most one and the loser retains its previous configuration |
| a declaration is superseded, rejected or stopped | every promise represented by that desired snapshot has one causally indexed terminal settlement |
| secret exported in a Node-RED flow | credential-schema test and redacted export fixture |
| shadow action reaches a physical sink | hostile sink test observes zero calls |
| notification shadow reaches platform push | hostile push test observes zero calls |
| unknown effect bypasses the recorder | `unclassified_effect` fail-closed test |
| adapter self-attests shadow state | final comparison uses recorder-owned publication evidence |
| reconnect duplicates a physical operation | fault test observes no second mutation/event/call frame |
| caller misses `CALL_ACCEPTED` after dispatch | sent-before-ack transport loss reports `outcome_unknown` |
| relay rejects or cancels before call acceptance | acceptance, result and stream all settle as `not_dispatched` |
| cancellation is mistaken for rollback | post-acceptance test reports `outcome_unknown` |
| stale generation mutates state | session test rejects the old generation |
| listener or socket survives redeploy | repeated load/close test reaches zero owned resources |
| comparison hides real changes | exact ignore-path and baseline-vs-baseline tests |
| public fixture contains private material | both public corpora pass the synthetic-home privacy scan plus human review |
| malformed corpus or recorder exhausts memory | pre-parse file ceiling and aggregate byte/value budgets reject it |
| adapter writes after the comparison checkpoint | revoked per-scenario capability lease rejects the late write |
| external subject blocks synchronously | parent watchdog kills the isolated subject process during import, factory or any replay hook |
| external subject exits early or spoofs runner IPC | supervisor-authenticated completion is required even when the child exits zero |

## 21. Deferred control-plane hooks

The token-provider interface intentionally leaves these decisions open for the
platform-control-plane RFC:

- Home Key creation, storage, recovery, rotation and revocation;
- access-token endpoint, response and error shape;
- scope names and key metadata;
- signing algorithm and JWKS rotation;
- relay audience selection and server-directory policy;
- home-scoped push grants and consent;
- component publisher authorization;
- quotas, audit records and abuse limits.

The future provider may add implementation-specific configuration without
changing coordinator lifecycle semantics. It MUST still return only the bounded
`AccessToken` shape to the SDK core.

## 22. Decisions and rationale

| Decision | Rationale |
|---|---|
| `miakapi@4` for Miakapp 3.5 | npm compatibility and product releases are different version domains |
| strings in public APIs, IDs on wire | agents author meaningful names; the SDK owns epoch-scoped dictionaries |
| desired declaration cache | complete slices are safe and required to redeclare after reconnect |
| no offline command queue | stale physical intent is more dangerous than explicit unavailability |
| no automatic effect retry | RFC 0001 cannot prove a post-dispatch outcome |
| pull-bounded call stream | wire credit follows consumer demand and bounds memory |
| injected token provider | control-plane details remain open and secrets stay outside transport logic |
| configuration node per connection | Node-RED lifecycle and ownership become explicit and testable |
| state-only default shadow | copying a request does not suppress its side effects |
| recorder as the only non-live effect capability | safety is structural and fail-closed rather than conventional |
| legacy package deprecation | the bridge protects migration without becoming the new product |
| synthetic public CI, private production reports | repeatable evidence without publishing a real home's inventory |

## 23. References

- [RFC 0001](0001-wire-protocol.md) defines protocol 1.0 and its delivery
  semantics.
- [Miakapp 3.5 design](../specs/2026-08-29-miakapp-3.5-design.md) defines the
  ecosystem trust and migration boundary.
- [Synthetic-home fixture](../../synthetic-home/README.md) defines the public
  deterministic behavior oracle.
- [Node-RED configuration nodes](https://nodered.org/docs/creating-nodes/config-nodes),
  [credentials](https://nodered.org/docs/creating-nodes/credentials) and
  [close lifecycle](https://nodered.org/docs/creating-nodes/node-js#closing-the-node)
  define the adapter runtime obligations.
- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html) defines idempotent HTTP
  method semantics used as background for retry terminology.
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) defines deterministic
  JSON serialization; RFC 0003 additionally requires domain equivalence and a
  shared causal checkpoint.
- [W3C Web of Things Thing Description 1.1](https://www.w3.org/TR/wot-thing-description/)
  records the state/action/event interaction taxonomy.
