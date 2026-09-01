# RFC 0001 — Miakapp wire protocol 1.0

- Status: accepted
- Product release: Miakapp 4
- Protocol version: 1.0
- Last updated: 2026-08-30

## 1. Scope

This document defines the application protocol shared by the browser host, CLI,
coordinators and relay. It specifies the bytes on the wire, structural limits,
connection state machines and observable delivery semantics.

It does not define Firebase token issuance, Home Key exchange, component
sandboxing, coordinator business logic, persistent event delivery or
active-active control of one physical actuator.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT** and
**MAY** are to be interpreted as described in RFC 2119 and RFC 8174.

## 2. Design constraints

Protocol 1.0 has five constraints:

1. WebSocket supplies an ordered message channel only. Application outcomes,
   revisions and correlation are explicit in this protocol.
2. Every accepted byte sequence has one canonical encoding. Go and TypeScript
   encoders therefore produce identical bytes.
3. A peer validates sizes and container declarations before a MessagePack
   library may allocate from them.
4. Reconnection creates a new session. Version 1.0 has no session resumption or
   durable replay.
5. State converges by snapshot and revisioned patch. Calls and events do not
   inherit state-delivery semantics.

## 3. WebSocket transport

### 3.1 Handshake

- Endpoint: `wss://<relay-host>/ws`
- WebSocket subprotocol: `miakapp`
- One WebSocket binary message contains exactly one Miakapp frame.
- Text messages are invalid.
- The maximum complete Miakapp frame is 262,144 bytes.
- The client MUST send `HELLO` within five seconds of the WebSocket opening.
- No other application frame is valid before `WELCOME`.

The constant WebSocket subprotocol identifies the Miakapp protocol family. The
application major and minor versions are negotiated in `HELLO`, allowing the
relay to return a useful `FATAL` frame for an unsupported version.

Browser handshakes carry an HTTP `Origin`; a relay MUST compare it with its
configured exact allowlist. It MUST NOT use substring or suffix matching.
Non-browser clients use the same application authentication but are not assigned
an origin by this specification.

### 3.2 Liveness

The relay uses RFC 6455 Ping control frames. A peer that does not answer Pong
within the relay's advertised operational timeout is closed. Browser JavaScript
does not send application heartbeat frames.

After an abnormal closure, clients reconnect with exponential backoff and full
jitter. The first delay is uniformly distributed between 0 and 1,000 ms; each
subsequent ceiling doubles up to 30,000 ms. A successful `WELCOME` resets the
attempt counter.

### 3.3 Frame envelope

```text
+------------+-------------------------------------------+
| opcode u8  | one canonical MessagePack array payload   |
+------------+-------------------------------------------+
```

The WebSocket message boundary is the frame boundary; no application length is
encoded. Empty frames, an absent payload, a non-array payload and trailing bytes
are malformed.

Opcodes `0x00` through `0x7f` are core. An unknown core opcode is fatal. Opcodes
`0x80` through `0xff` are optional extensions: a peer that does not implement one
MUST validate its envelope and limits, then ignore it.

## 4. Canonical MessagePack profile

MessagePack defines multiple valid byte representations for some values. This
section narrows it to one Miakapp representation.

### 4.1 Values

The allowed dynamic value model is:

```text
Value = null
      | boolean
      | safe integer
      | finite non-integral float64
      | UTF-8 string
      | binary
      | Value[]
      | { UTF-8 string: Value }
```

The following are not protocol values: JavaScript `undefined`, `BigInt`, dates,
MessagePack extensions, timestamps, non-string map keys, duplicate map keys,
NaN, infinities and negative zero.

Integers are limited to `[-9007199254740991, 9007199254740991]`, the JavaScript
safe-integer range. An integral value MUST use an integer representation, not a
float representation. A non-integral number MUST use MessagePack float64;
float32 is forbidden.

### 4.2 Canonical encoding

- Integers MUST use the shortest applicable MessagePack integer form.
- Strings, binary values, arrays and maps MUST use the shortest applicable
  length prefix.
- Strings MUST contain valid UTF-8. Unicode normalization is not performed.
- Map keys MUST be strings and MUST appear in strictly increasing lexicographic
  order of their UTF-8 bytes.
- A map key MUST NOT appear twice.
- The map key `__proto__` is reserved and MUST be rejected, matching the safe
  object-decoding boundary used by the TypeScript implementation.
- Extension and reserved MessagePack markers are forbidden.

A decoder MUST reject a semantically valid but non-canonical representation.
Decoding and then encoding an accepted payload MUST reproduce the original bytes
exactly.

### 4.3 Decoder limits

These maxima apply before opcode-specific limits:

| Resource | Maximum |
|---|---:|
| complete frame | 262,144 bytes |
| nesting depth, including the root payload | 16 |
| total values in one payload | 16,384 |
| one UTF-8 string | 65,536 bytes |
| one binary value | 131,072 bytes |
| one array | 4,096 elements |
| one map | 4,096 entries |
| one map key | 256 UTF-8 bytes |

The preflight scanner MUST reject an advertised length or depth above these
limits before constructing the corresponding container. The enclosing
WebSocket implementation MUST enforce the frame byte limit independently.

The protocol 1.0 conformance implementations pin `@msgpack/msgpack` 3.1.3 in
TypeScript and `github.com/vmihailenco/msgpack/v5` 5.4.1 in Go. Their generic
decoders run only after the independent preflight scanner accepts the payload;
their default allocation limits are not the protocol's security boundary.

### 4.4 Semantic limits

The following limits apply in addition to the generic frame limits. A lower
negotiated connection limit always wins.

| Resource | Maximum |
|---|---:|
| coordinators reported for one home | 64 |
| state paths declared by one coordinator | 4,096 |
| state paths in one home | 16,384 |
| event, function or ACL declarations in one coordinator slice | 1,024 |
| topic or function dictionary entries in one home | 16,384 each |
| patterns in one ACL declaration | 4,096 |
| active subscriptions on one connection | 256 |
| calls in flight on one connection | 128 |
| outstanding stream-result credit on one call | 32 |
| relative call timeout | 300,000 ms |
| presence entries in one snapshot | 4,096 |
| queued outbound bytes on one connection | 1,048,576 |

Cardinality ceilings do not override the byte, depth or total-value limits. A
complete declaration or authorized state snapshot MUST fit one frame in 1.0.
The relay MUST atomically reject with `LIMIT_EXCEEDED` an update or ACL change
that would make a required complete frame unencodable; it MUST NOT commit a
state that clients cannot resynchronize.

## 5. Common types

### 5.1 Identifiers

All numeric identifiers and revisions are positive safe integers. Zero is
reserved unless a frame explicitly assigns it a meaning.

| Name | Scope | Rules |
|---|---|---|
| `requestId` | originating connection | 1..MAX_SAFE_INTEGER; unique while in flight |
| `callId` | one connection | same allocation rule as `requestId` |
| `eventId` | originating connection | 1..MAX_SAFE_INTEGER; never reused during that connection lifetime |
| `sessionId` | relay process epoch | 1..MAX_SAFE_INTEGER; immutable |
| dictionary ID | home epoch and dictionary kind | positive; never reused inside the epoch |
| `revision` | home state | positive, monotonically increasing |
| `policyRevision` | home authorization declarations | positive, monotonically increasing |
| `generation` | `(home, coordinator name)` | positive, monotonically increasing |

Reusing an in-flight request identifier, call identifier or any earlier event
identifier is an error even when the bytes are identical. Event identifiers have
connection-lifetime uniqueness because a successful event has no terminal
acknowledgement after which reuse would be safe. Version 1.0 does not deduplicate
requests across connections.

### 5.2 Names

- Home and user IDs: 1..128 UTF-8 bytes, with no control characters.
- Coordinator names: 1..64 ASCII bytes matching
  `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`.
- State paths, event topics and function names: 1..256 UTF-8 bytes, no control
  characters or `*`, no leading/trailing dot and no empty dotted segment. `*` is
  reserved for the ACL suffix `.*`.
- Idempotency keys: 1..128 UTF-8 bytes.
- Tokens: opaque non-empty strings of at most 16,384 bytes.

State paths, topics and function names are compared as exact UTF-8 byte strings.
They are not case-folded or Unicode-normalized.

### 5.3 Epoch

An epoch is a 16-byte random binary value generated when the relay creates new
in-memory state for a home. A relay restart therefore creates a new epoch.
Frames referring to another epoch are stale and MUST NOT mutate state.

### 5.4 Principal metadata

The relay constructs, and clients can only receive, this tuple:

```text
Principal = [kind, id, sessionId, coordinatorNameOrNull, verifiedEmailOrNull]
```

Kinds are `1` user, `2` coordinator and `3` CLI. For users, `id` is the Firebase
UID and `coordinatorNameOrNull` is null. For coordinators, `id` is the home ID,
the coordinator name is present and email is null. The relay includes an email
only when the verified identity assertion marks it verified.

## 6. Negotiation and connection states

The protocol version is `[major, minor]`. This RFC defines `[1, 0]`.

`HELLO` contains `[major, minimumMinor, maximumMinor, role, token, context]`.
Roles are `1` user, `2` coordinator and `3` CLI.

Role contexts are:

| Role | Context |
|---|---|
| user | `[homeId]` |
| coordinator | `[coordinatorName]` |
| CLI | `[]` |

The relay chooses the highest minor it supports in the inclusive client range.
No overlap produces `UNSUPPORTED_VERSION`. Authentication is complete only after
`WELCOME`.

`WELCOME` contains:

```text
[major, minor, sessionId, epoch, enrolled, coordinators, limits, expiresAtMs]
```

`coordinators` is an array of `[name, generation, status]`, where status `1` is
connected and `2` is in the disconnect grace period. `limits` is
`[maxFrameBytes, maxInflightCalls, maxSubscriptions, maxQueuedBytes]`. A relay
may advertise lower values than the protocol maxima, never higher ones.

`enrolled` is meaningful for users. An unenrolled user remains connected but may
call only `miakapp.join`. Coordinators and CLI clients receive `true`.

The connection state machine is:

```text
OPEN -> AWAIT_HELLO -> AUTHENTICATED -> DRAINING -> CLOSED
              |              |              |
              +----FATAL-----+------FATAL---+
```

An authenticated user receives `STATE_DICT` followed by `STATE_SNAPSHOT` before
any `STATE_PATCH`. Coordinator and CLI roles do not receive user snapshots unless
a later capability explicitly requests them.

## 7. Frame registry

Every payload has exact arity in protocol 1.0. A future minor version may define
a different arity only after negotiation; 1.0 decoders do not silently accept
trailing fields.

### 7.1 Session frames

| Opcode | Name | Direction | Payload |
|---:|---|---|---|
| `0x00` | `HELLO` | client -> relay | `[major, minMinor, maxMinor, role, token, context]` |
| `0x01` | `WELCOME` | relay -> client | `[major, minor, sessionId, epoch, enrolled, coordinators, limits, expiresAtMs]` |
| `0x02` | `ERROR` | relay -> client | `[correlationIdOrZero, sourceOpcode, code, retryable, message]` |
| `0x03` | `FATAL` | relay -> client | `[sourceOpcodeOrZero, code, retryable, message]` |
| `0x04` | `REAUTH` | client -> relay | `[requestId, token]` |
| `0x05` | `REAUTH_OK` | relay -> client | `[requestId, expiresAtMs]` |
| `0x06` | `HOME_STATUS` | relay -> user | `[enrolled, coordinators]` |
| `0x07` | `GOAWAY` | relay -> client | `[retryAfterMs, reasonCode]` |

`REAUTH` replaces only authentication material. It cannot change the home,
principal, role, session ID or coordinator name. The relay MUST finish
verification before the previous token deadline. Failure is fatal.

`HOME_STATUS` announces enrollment or coordinator availability without forcing a
reconnect. `GOAWAY` starts draining: the client sends no new request and closes
after terminal replies or the relay deadline.

For `ERROR`, `sourceOpcode` selects the correlation namespace. The first field is
the originating `eventId` when `sourceOpcode` is `EVENT`, the originating
`callId` for a call frame, the originating `requestId` for another request frame,
and zero only when no originating frame exists. A receiver MUST NOT look up an
event correlation in its request-ID table. A relay emits an event error, if any,
before closing the originating connection; reconnect starts a new identifier
namespace.

### 7.2 State frames

| Opcode | Name | Direction | Payload |
|---:|---|---|---|
| `0x10` | `STATE_SYNC` | coordinator -> relay | `[requestId, entries]` |
| `0x11` | `STATE_SYNC_OK` | relay -> coordinator | `[requestId, epoch, revision, dictionary]` |
| `0x12` | `STATE_DICT` | relay -> client | `[epoch, replace, dictionary]` |
| `0x13` | `STATE_SNAPSHOT` | relay -> user | `[epoch, revision, entries]` |
| `0x14` | `STATE_PATCH` | relay -> user | `[epoch, baseRevision, revision, mutations]` |
| `0x15` | `STATE_SET` | coordinator -> relay | `[requestId, epoch, mutations]` |
| `0x16` | `STATE_SET_OK` | relay -> coordinator | `[requestId, epoch, revision]` |
| `0x17` | `STATE_ACL_SYNC` | coordinator -> relay | `[requestId, declarations]` |
| `0x18` | `STATE_ACL_OK` | relay -> coordinator | `[requestId, policyRevision]` |
| `0x19` | `STATE_RESYNC` | user or CLI -> relay | `[requestId]` |

Shapes:

```text
STATE_SYNC entry       = [path, value]
dictionary entry       = [pathId, path]
STATE_SNAPSHOT entry   = [pathId, value]
set mutation           = [pathId, 0, value]
delete mutation        = [pathId, 1]
ACL declaration        = [userId, patterns]
patterns               = [pattern, ...]
```

One coordinator may declare at most 4,096 paths. `STATE_SYNC` is its complete
owned slice, not a merge. Paths absent from the new declaration are deleted.
The relay validates ownership and collisions, then stages the declaration inside
the atomic coordinator declaration transaction defined in Section 7.5.
`STATE_SYNC_OK` returns the staged IDs for all paths owned by that coordinator;
those IDs MUST NOT be used until the transaction activates.

The home dictionary contains at most 16,384 paths. IDs are never reused inside
an epoch. `STATE_DICT` with `replace=true` replaces the receiving client's
dictionary; `replace=false` adds entries. The relay sends dictionary additions
before a frame that uses them.

`STATE_SNAPSHOT` replaces the user's complete authorized view. It is valid on
initial authentication, explicit resynchronization and authorization changes.

For `STATE_PATCH`, `baseRevision` MUST equal the last state revision applied by
that connection. `revision` MUST be greater. A mismatch causes the client to stop
applying patches and send `STATE_RESYNC`. Revisions can skip values because a
user may not see changes outside its authorized view.

`STATE_SET` is atomic, may refer only to the sending coordinator's owned IDs and
does not auto-retry. A successful batch increments the home revision once.

`STATE_ACL_SYNC` is the sending coordinator's complete ACL slice. A pattern is
either an exact state path or a dotted prefix ending in `.*`. An empty patterns
array creates an enrolled user with no visible state. ACL slices from trusted
coordinators are unioned. Activation of an ACL change that alters a user's view
causes a fresh snapshot.

### 7.3 Event frames

| Opcode | Name | Direction | Payload |
|---:|---|---|---|
| `0x20` | `EVENT_SYNC` | coordinator -> relay | `[requestId, declarations]` |
| `0x21` | `EVENT_SYNC_OK` | relay -> coordinator | `[requestId, dictionary]` |
| `0x22` | `TOPIC_DICT` | relay -> client | `[epoch, replace, dictionary]` |
| `0x23` | `EVENT_ACL_SYNC` | coordinator -> relay | `[requestId, declarations]` |
| `0x24` | `EVENT_ACL_OK` | relay -> coordinator | `[requestId, policyRevision]` |
| `0x25` | `SUBSCRIBE` | client -> relay | `[requestId, topicIds]` |
| `0x26` | `SUBSCRIBE_OK` | relay -> client | `[requestId, topicIds]` |
| `0x27` | `UNSUBSCRIBE` | client -> relay | `[requestId, topicIds]` |
| `0x28` | `UNSUBSCRIBE_OK` | relay -> client | `[requestId, topicIds]` |
| `0x29` | `EVENT` | both directions | direction-specific, below |

Shapes:

```text
event declaration      = [topic, flags]
event dictionary entry = [topicId, topic]
event ACL declaration  = [userId, publishPatterns, subscribePatterns]
client EVENT            = [eventId, topicId, targetKind, targetOrNull, payload]
forwarded EVENT         = [eventId, topicId, targetKind, targetOrNull, source, payload]
```

Declaration flag bits are `0x01` accepts events from users, `0x02` publishes to
users, `0x04` accepts from coordinators and `0x08` publishes to coordinators. All
other bits are zero in 1.0, and at least one bit MUST be set. Topic ownership is
exclusive; a collision rejects the complete declaration.

Targets are `0` the declared/default route, `1` a user session and `2` a
coordinator name. Users MUST use target `0`. The relay inserts `source` and
rejects any client frame with the forwarded arity.

Events are live and at-most-once. Success has no acknowledgement. A routing or
authorization failure produces `ERROR` correlated with `eventId`. Event IDs do
not imply replay or deduplication.

A connection has at most 256 active subscriptions. Subscription authorization is
checked both when subscribing and when delivering. An ACL change removes invalid
subscriptions as part of atomic declaration activation.

### 7.4 Call frames

| Opcode | Name | Direction | Payload |
|---:|---|---|---|
| `0x30` | `FUNCTION_SYNC` | coordinator -> relay | `[requestId, names]` |
| `0x31` | `FUNCTION_SYNC_OK` | relay -> coordinator | `[requestId, dictionary]` |
| `0x32` | `FUNCTION_DICT` | relay -> client | `[epoch, replace, dictionary]` |
| `0x33` | `CALL` | caller -> relay | `[callId, targetKind, targetOrNull, functionId, timeoutMs, idempotencyKeyOrNull, initialCredit, arguments]` |
| `0x34` | `CALL_DISPATCH` | relay -> callee | `[callId, source, targetKind, targetOrNull, functionId, timeoutMs, idempotencyKeyOrNull, initialCredit, arguments]` |
| `0x35` | `CALL_ACCEPTED` | relay -> caller | `[callId]` |
| `0x36` | `CALL_RESULT` | callee -> relay -> caller | `[callId, final, value]` |
| `0x37` | `CALL_ERROR` | callee or relay -> caller | `[callId, code, retryable, message, details]` |
| `0x38` | `CALL_CANCEL` | caller -> relay -> callee | `[callId, reasonCode]` |
| `0x39` | `CALL_CREDIT` | caller -> relay -> callee | `[callId, additionalCredit]` |

Function dictionary entries are `[functionId, name]`. A coordinator's
`FUNCTION_SYNC` completely replaces its owned names. Function ownership is
exclusive. `miakapp.join` is reserved and may have one owner.

Targets are `0` the owning home coordinator, `1` a user session and `2` a named
coordinator. Users and CLI use target `0`; coordinators may target a user session
or another named coordinator. The relay rewrites connection-scoped call IDs when
routing and restores the caller's ID on replies.

`CALL_ACCEPTED` means that the relay authenticated, authorized and queued
`CALL_DISPATCH` to the callee. It does not mean that the callee began work or that
a physical effect occurred.

Timeout is relative, from 1 through 300,000 ms. The relay tracks a monotonic
deadline and forwards only the remaining duration. Expiry before dispatch is
`DEADLINE_EXCEEDED`; expiry after dispatch is `OUTCOME_UNKNOWN` unless the callee
already supplied a terminal result.

The protocol never retries a call. An optional idempotency key is interpreted by
the owning coordinator and scoped to `(source principal, function, key)`. The
coordinator defines its retention period; losing that store removes the
deduplication guarantee.

A connection may have at most 128 in-flight calls. `initialCredit` is 0..32 and
permits that many non-final `CALL_RESULT` frames. Each non-final result consumes
one credit. `CALL_CREDIT` grants 1..32 more without allowing outstanding credit
above 32. A final result and `CALL_ERROR` do not consume credit and cannot be
blocked behind stream data.

Cancellation is cooperative. Before `CALL_ACCEPTED`, a successful cancellation
returns `CALL_ERROR/CANCELLED` and proves the call was not dispatched. After
acceptance, the relay forwards cancellation and returns
`CALL_ERROR/OUTCOME_UNKNOWN`; it does not claim that a side effect was undone.
Late results are discarded after the route is terminal.

### 7.5 Atomic coordinator declaration activation

The five complete coordinator slices form one declaration transaction in this
fixed order:

1. `STATE_SYNC`;
2. `STATE_ACL_SYNC`;
3. `EVENT_SYNC`;
4. `EVENT_ACL_SYNC`;
5. `FUNCTION_SYNC`.

Every coordinator starts with an empty desired value for every slice. Initial
synchronization, reconnect and an in-session declaration replacement therefore
send all five frames, including empty slices. Only one transaction may be staged
per coordinator connection. `STATE_SYNC` starts a new transaction and discards
an incomplete staged transaction; any later declaration frame without the
required predecessor is `UNEXPECTED_FRAME`. Staging reserves no ownership and
MUST NOT hold a home lock across frames. The relay discards an incomplete stage
on connection close, replacement by a new `STATE_SYNC`, or after 30 seconds and
releases all temporary memory; expiry returns `DEADLINE_EXCEEDED` when the
connection is still usable.

The relay validates and stages each slice without changing the active state,
ACLs, topics, event ACLs, function routes, dictionaries, subscriptions or user
views. The first four success frames acknowledge staging only. When the fifth
slice arrives, the relay acquires the home-scoped activation lock and revalidates
the complete staged transaction against the current epoch, authorization policy,
ownership tables, aggregate limits and the full post-activation user views. This
final validation is mandatory even when every slice was valid when first staged:
another coordinator may have activated a colliding name in the meantime.

If final validation succeeds, the relay atomically replaces all five active
slices while holding that lock and enqueues `FUNCTION_SYNC_OK` on the coordinator
connection before the new routes become dispatchable. No client can observe a
prefix of the transaction, and the coordinator processes the final
acknowledgement before any dispatch that uses the new dictionaries or handler
slice. Dictionary and user-view frames caused by activation follow that final
success frame in the relay's ordered processing. Two colliding concurrent
transactions can both stage, but at most one can pass locked final validation.

An error, final-validation failure, expiry or disconnect before activation
discards the staged transaction and leaves the previous active configuration
unchanged until its ordinary generation grace expires. A final-validation error
is correlated with the `FUNCTION_SYNC` request that attempted activation. A
collision or permanent authorization failure therefore cannot partially publish
a new policy. Grants from different trusted coordinators remain unioned; changing
several coordinators is not one transaction and requires an explicit higher-level
rollout.

### 7.6 Presence frames

| Opcode | Name | Direction | Payload |
|---:|---|---|---|
| `0x40` | `PRESENCE_SNAPSHOT` | relay -> coordinator | `[entries]` |
| `0x41` | `PRESENCE_CHANGE` | relay -> coordinator | `[sessionId, userId, event]` |

A presence entry is `[sessionId, userId]`. Events are `1` connected and `2`
disconnected. Presence describes authenticated sockets, not human occupancy. It
is ephemeral and is rebuilt after relay restart.

## 8. Delivery and failure semantics

### 8.1 State

State is convergent. A fresh snapshot is authoritative for one user's visible
view; ordered patches advance it while their base revision matches. The relay
may coalesce queued state changes for a slow consumer into a later snapshot.

### 8.2 Events

Events are at-most-once and live-only. Disconnecting either endpoint can lose an
event. Applications requiring a result, persistence or retry use a call or an
application-specific journal instead.

### 8.3 Calls

A caller observes these states:

```text
created -> sent -> accepted -> streaming -> succeeded
                   |             |
                   +-------------+-> failed
                   +-------------+-> outcome_unknown
```

Only local rejection before the complete `CALL` frame is handed to the transport,
or an explicit relay terminal response that guarantees pre-dispatch failure, can
prove that a call was not dispatched. Transport loss after handoff is
`OUTCOME_UNKNOWN` even when the caller never observed `CALL_ACCEPTED`: the relay
may already have queued `CALL_DISPATCH`. After acceptance, any failure without a
terminal result is likewise unknown.

Request and call identifiers provide correlation only. They do not create
exactly-once delivery.

## 9. Coordinator generations

A coordinator name is unique within a home. Authenticating the same name creates
a larger generation and evicts the previous connection. Frames from an evicted
generation are rejected.

On disconnect, the coordinator's active state, ACL, event and function slices
enter a 30-second grace period by default. Reconnection with the same name stages
all five complete slices; the prior active configuration remains visible until
the new declaration transaction activates or its grace expires. After grace
expiry, all active slices are purged atomically and affected users receive status,
dictionary and state updates as applicable.

Multiple names provide namespace sharding, not concurrent authority over the
same actuator. This wire protocol does not provide physical fencing.

## 10. Backpressure and fairness

The maximum queued outbound data is 1,048,576 bytes per connection unless the
relay advertises a lower limit. The relay:

1. coalesces replaceable state patches into a snapshot;
2. drops non-critical live events when their application policy permits it;
3. preserves terminal call frames and session errors ahead of stream data;
4. closes a peer as `SLOW_CONSUMER` before its queue exceeds the limit.

Limits are also enforced per home for dictionary cardinality, declarations,
subscriptions and in-flight calls. One home cannot borrow another home's budget.

## 11. Error catalogue

| Code | Name | Default retryability |
|---:|---|---|
| `1000` | `MALFORMED_FRAME` | no |
| `1001` | `UNSUPPORTED_VERSION` | no |
| `1002` | `UNEXPECTED_FRAME` | no |
| `1003` | `FRAME_TOO_LARGE` | no |
| `1004` | `LIMIT_EXCEEDED` | no |
| `1005` | `INVALID_VALUE` | no |
| `1100` | `UNAUTHENTICATED` | no |
| `1101` | `TOKEN_EXPIRED` | yes |
| `1102` | `INVALID_AUDIENCE` | no |
| `1200` | `FORBIDDEN` | no |
| `1201` | `NOT_ENROLLED` | no |
| `1202` | `NOT_DECLARED` | no |
| `1203` | `WRONG_DIRECTION` | no |
| `1300` | `CONFLICT` | no |
| `1301` | `DUPLICATE_REQUEST` | no |
| `1302` | `OWNERSHIP_COLLISION` | no |
| `1303` | `STALE_EPOCH` | yes, after resync |
| `1304` | `REVISION_MISMATCH` | yes, after resync |
| `1305` | `GENERATION_REPLACED` | yes, on a new connection |
| `1400` | `UNAVAILABLE` | yes before dispatch |
| `1401` | `NO_COORDINATOR` | yes |
| `1402` | `SLOW_CONSUMER` | yes |
| `1403` | `DEADLINE_EXCEEDED` | no |
| `1404` | `OUTCOME_UNKNOWN` | no automatic retry |
| `1405` | `CANCELLED` | no |
| `1500` | `INTERNAL` | yes when explicitly marked |

Codes `2000` through `2999` are reserved for sanitized application call errors.
They are valid only in callee-originated `CALL_ERROR` frames, are never valid in
`ERROR` or `FATAL`, and do not extend the relay error catalogue. The relay still
validates the bounded message and details value before forwarding them.

The frame's `retryable` field is authoritative for that occurrence. Human error
messages are diagnostic, at most 256 UTF-8 bytes, and MUST NOT be parsed by a
client.

## 12. Closing

When possible, the relay sends `FATAL` or `GOAWAY` before closing. Custom close
codes are:

| Close code | Meaning |
|---:|---|
| `4400` | protocol or malformed input |
| `4401` | authentication failed or expired |
| `4403` | authorization policy violation |
| `4408` | handshake, reauthentication or liveness timeout |
| `4409` | ownership or generation conflict |
| `4429` | rate or resource limit |
| `4500` | relay internal failure |
| `4503` | relay temporarily unavailable |

`1000` is a normal close and `1012` is a service restart. Close reasons are short
ASCII identifiers and never contain tokens, user data or stack traces. A browser
may expose an abnormal transport failure only as `1006`; clients must therefore
represent unknown transport failure without inventing a server error.

## 13. Compatibility rules

- Major versions are incompatible and require an explicit implementation.
- Minor versions are negotiated; a peer implements the exact selected schema.
- Core opcodes and error numbers are never reassigned.
- Dictionary IDs are never reassigned within an epoch.
- New optional experiments use `0x80..0xff` until promoted by a later RFC.
- A 1.0 implementation rejects unknown enum values, non-zero reserved flag bits,
  wrong payload arity and frames sent by the wrong role or in the wrong state.

Rolling deployment tests cover clients and relays at `N-1`, `N` and `N+1` minor
versions. A peer must fail explicitly when no compatible minor exists.

## 14. Conformance

An implementation conforms to protocol 1.0 when it:

1. encodes every valid shared fixture to the exact expected bytes;
2. decodes those bytes to the expected semantic frame;
3. rejects every invalid shared fixture with the expected error class;
4. applies the preflight limits before MessagePack container allocation;
5. passes malformed-input fuzzing without panic, hang or unbounded allocation;
6. enforces direction and connection-state rules in its session layer;
7. produces the documented state/call outcomes under disconnect fault tests.

The shared codec harness covers items 1 through 5. Relay and SDK integration
tests cover items 6 and 7.

## 15. Deferred extensions

Protocol 1.0 deliberately does not include durable event replay, relay-to-relay
state, end-to-end encryption, same-actuator active-active coordination, binary
media streaming or resumable user sessions. None is implied by a current ID,
revision or epoch field.

## 16. References

- [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and
  [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) define requirement words.
- [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455) defines WebSocket framing,
  control frames and closing.
- The [MessagePack specification](https://github.com/msgpack/msgpack/blob/master/spec.md)
  defines the underlying value encodings narrowed by section 4.
- The pinned reference libraries are
  [`@msgpack/msgpack` 3.1.3](https://github.com/msgpack/msgpack-javascript/tree/v3.1.3)
  and
  [`vmihailenco/msgpack` 5.4.1](https://pkg.go.dev/github.com/vmihailenco/msgpack/v5@v5.4.1).
