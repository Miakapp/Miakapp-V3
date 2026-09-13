# Miakapp relay conformance

An executable corpus for the **server** side of
[RFC 0001](../docs/rfcs/0001-wire-protocol.md), so a second implementation can
be certified rather than trusted.

## Why this exists

RFC 0001 §14 lists seven conformance items and says where each is covered:

> The shared codec harness covers items 1 through 5. **Relay and SDK
> integration tests cover items 6 and 7.**

`protocol/` does items 1–5 well and portably. Items 6 and 7 — "enforces
direction and connection-state rules in its session layer" and "produces the
documented state/call outcomes under disconnect fault tests" — were delegated to
each implementation's own tests. This kit makes them shared.

It is a contract kit, not a relay, a client or an SDK. Passing its self-tests
proves the corpus and runner are internally consistent. An implementation
conforms only after it is installed as the subject and passes the complete
corpus.

## Running it

```sh
bun run check                          # self-tests only, no subject
bun run src/main.ts -- <subject cmd>   # drive an implementation
```

For the Go relay:

```sh
go build -o /tmp/conformance-subject ./test/conformance-subject   # in Miakapp-Server
bun run src/main.ts -- /tmp/conformance-subject
```

`MIAKAPP_RELAY_SCENARIO=<substring>` narrows the run to matching scenarios.

## The subject contract

A subject is any command that:

1. prints exactly one line `LISTENING <ws url>` on stdout, before serving and
   before anything else on that stream;
2. serves RFC 0001 at that URL, under the `miakapp` WebSocket subprotocol;
3. accepts the fixture credentials below and rejects every other token;
4. applies the configuration profile named by `MIAKAPP_CONFORMANCE_PROFILE`;
5. exits cleanly on `SIGINT` or `SIGTERM`.

The runner starts a fresh subject per scenario, so no scenario can be
contaminated by the state of another.

### Fixture credentials

Every credential belongs to `conformance-home` unless its name says otherwise.

| Token | Role | Identity |
| --- | --- | --- |
| `conformance.user.a` | user | `user-a`, verified email |
| `conformance.user.b` | user | `user-b`, no email |
| `conformance.user.c` | user | `user-c`, no email |
| `conformance.user.a.renewed` | user | `user-a`, for reauthentication |
| `conformance.user.a.expiring` | user | `user-a`, sub-second lease |
| `conformance.user.a.other` | user | `user-a` in `conformance-home-other` |
| `conformance.coordinator.primary` | coordinator | name `primary` |
| `conformance.coordinator.primary.other-client` | coordinator | name `primary`, a different client binding |
| `conformance.coordinator.secondary` | coordinator | name `secondary` |
| `conformance.cli` | CLI | — |

The fixture verifier must reproduce two rules the relay enforces and that are
easy to get wrong, because both produce an opaque authentication failure:

- a **user** identity carries no Home Key client binding;
- a **coordinator** or CLI identity carries no verified email, and must carry a
  client binding.

A fixture verifier belongs in a separate binary, never in the production one.

### Configuration profiles

| Profile | Purpose |
| --- | --- |
| `default` | 30-second disconnect grace; everything else at the implementation's defaults |
| `fast-grace` | 250 ms disconnect grace, for scenarios that must observe grace expiry |
| `drain-on-cli` | the subject starts a graceful drain when a CLI credential authenticates |

A scenario declares the profile it assumes, so the corpus never depends on one
implementation's configuration type.

`drain-on-cli` exists because draining is the one behaviour no peer can ask for
on the wire: the relay decides it. A subject under this profile begins its drain
window once `conformance.cli` authenticates, which gives the corpus an ordered
trigger — no other scenario uses that credential — rather than a race against
process start. The window must outlast a terminal call reply and still expire
within a test run; the Go subject uses 500 ms.

## The corpus

`fixtures/v1/scenarios.json` holds ordered steps against named peers. Each
scenario cites the clause it holds the subject to.

| Action | Meaning |
| --- | --- |
| `connect` | open a socket for a named peer |
| `send` | encode and send one frame |
| `expect` | receive one frame, assert its opcode, optionally `match` payload positions and `capture` values |
| `expectClosed` | the subject closed this connection |
| `expectSilence` | nothing arrived within `ms` |
| `close` | close this peer |
| `wait` | pause for `ms` |

`match` and `capture` address payloads by dotted index path, so `"3.0.0"` is
`payload[3][0][0]`. Epochs and dictionary IDs are assigned by the subject, so a
`send` payload may contain `{"$": "name"}` placeholders resolved from an earlier
`capture`. A `match` resolves them the same way, which is how a scenario asserts
that an identifier the relay assigned came back where it belongs — that a
cancellation was rewritten to the callee's call ID, or that a recreated state
path reused its dictionary entry rather than allocating a new one.

Bringing a home up to a declared, enrolled state takes twenty frames, so a
scenario may name a **prelude** instead of repeating them. `preludes` holds the
shared sequences and a scenario's own `steps` are appended to the one it names,
which keeps each scenario's file entry to the behaviour it actually pins down.

| Prelude | Leaves the home |
| --- | --- |
| `declared-home` | one coordinator, five slices activated, no user |
| `enrolled-home` → `enrolled-user` | the same plus an enrolled, granted user |

Frames are encoded and decoded with `protocol/typescript`, the same codec
already certified byte-for-byte against the Go implementation. The runner
therefore adds no second opinion about the wire format.

## Status

Thirty-seven scenarios. The Go relay passes all thirty-seven.

They cover the handshake for both roles; credential, version and home-change
refusals; version-range negotiation and an unsupported major; direction and
connection-state enforcement; the five-slice declaration transaction and a
colliding one; state disclosure to a granted and an ungranted user; a declared
path surviving deletion; the call round trip with its relay-constructed
principal, cancellation, late results and calls with no coordinator; event
delivery in both directions with subscription enforcement; reauthentication,
its three immutability rules and lease expiry; coordinator presence, generation
replacement and the atomic purge at grace expiry; and the drain window from
`GOAWAY` to the relay deadline.

Several assert the security property rather than the happy path: the principal
on a dispatched call and on a forwarded event is constructed by the relay from
verified identity, never echoed from the sender; an unsubscribed user receives
nothing; a colliding declaration never publishes its staged prefix; a
replacement coordinator cannot publish before it redeclares; and a call
interrupted by replacement or cancellation resolves as `OUTCOME_UNKNOWN` rather
than claiming a physical effect did or did not happen.

### What the corpus still does not hold

`Miakapp-Server` holds 35 black-box and white-box relay tests. What remains
there is deliberate, not pending:

- **Concurrency.** Colliding activations resolving to exactly one winner, and
  bootstrap never preceding `WELCOME`, need the corpus to gain a way to express
  concurrent steps. The ordered form here would test a different property.
- **Process limits.** Connection admission, per-source rate and memory bounds,
  the aggregate outbound queue budget and home capacity are deployment policy,
  not RFC 0001 behaviour. A relay may choose different numbers and still
  conform.
- **Internal invariants.** Queue accounting, request identifiers held until a
  terminal write, and unencodable snapshots rejected atomically are white-box
  tests against structures no wire peer can observe.
- **The identifier-reuse window.** That a very late result is still discarded
  after 260 intervening calls needs a loop primitive with per-iteration
  identifiers; expressing it as 260 literal entries would be unreadable.
- **Pre-upgrade rejection.** Origin and subprotocol refusals happen before the
  WebSocket exists, so the runner — which always dials correctly — cannot reach
  them.
