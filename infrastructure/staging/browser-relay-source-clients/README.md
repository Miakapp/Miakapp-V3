# Dormant fixed-target browser-relay source clients

This package is the closed acquisition boundary between seven explicit ephemeral
source authorities and the seven trusted `{ observe, close }` clients consumed by
[`browser-relay-source-session-producers`](../browser-relay-source-session-producers/).
It is a library only. Importing it performs only local immutable audit-profile
reads, and construction performs no authority, source, network, browser, cloud,
process or filesystem-mutation I/O.

The caller supplies an exact frozen map of seven distinct frozen authorities for
App Check, Hosting, the control plane, relays, the local synthetic coordinator,
KMS and Firestore. Every authority contains only:

- its fixed `source`;
- the canonical fixed staging `scope` exported by the contract;
- one common absolute `expires_at_milliseconds`, at most 30 minutes away;
- `acquire(descriptor)`; and
- `close(signal)`.

Credentials, HTTP transports, Firebase/browser objects, WebSocket handles and
operation ledgers stay inside those authority closures. This package accepts no
credential string, generic request method, URL override, header map, ADC loader
or ambient process authority.

```js
import {
  createBrowserRelaySourceClients,
} from './clients.mjs';
import {
  createBrowserRelaySourceSessions,
} from '../browser-relay-source-session-producers/producers.mjs';

const clients = createBrowserRelaySourceClients(authorities, {
  signal: operationAbortController.signal,
});
const sessions = createBrowserRelaySourceSessions(clients, {
  signal: operationAbortController.signal,
  expires_at_milliseconds: expiresAt,
});
```

`expiresAt` must be the same absolute expiry carried by every authority. The
client boundary independently enforces that authority expiry, so a downstream
session configured with a later value cannot extend authority use.

The result is the exact frozen seven-client map accepted by the adjacent session
producer. Construction validates every authority and claims its identity once,
but calls no `acquire` or `close` method.

## Fixed acquisition protocol

An `observe` call is accepted only in the canonical 22-stage / 43-observation
order. Immediately before invoking the matching authority, the client rechecks
root, request and authority lifetime, reserves the source cursor and creates one
fresh frozen, null-prototype, JSON-rejecting descriptor. It contains only:

- the fixed source and canonical scope;
- the reviewed browser, case and kind;
- that kind's immutable target from `targets_by_source_and_kind`;
- a package-owned linked `AbortSignal`; and
- a fresh frozen callable `request_capability` with a null prototype.

The fixed targets distinguish direct management/serving observations from
operation-local ledgers. In particular, App Check valid verification names the
non-consuming Firebase Admin verifier; it never names the consuming
`projects.verifyAppCheckToken` REST method. Exact assessment, exchange, relay,
coordinator, KMS-signing and Firestore-write facts name operation-scoped ledgers.
Delayed aggregate metrics, absent log entries and Cloud Run management metadata
cannot substitute for those sources.

An authority must return a frozen, null-prototype, JSON-rejecting receipt with
exactly the matching source, scope, browser, case, kind, target and request
capability plus one already-sanitized `observation`. Scope, target and capability
must be the same object identities received in the descriptor. A receipt identity
can be consumed only once. The client strips the complete envelope, copies and
semantically validates the observation, and returns only that projection to the
session producer. No target, capability, authority identity or raw source material
crosses the client boundary.

Proxy-backed authority, option, runtime, descriptor and receipt records are
rejected before their traps are inspected. The complete authority-controlled
receipt and nested observation are then validated inside the descendant callback
context before any projection may cross the boundary.

The authority remains a trusted dependency. Capability echo proves that its
receipt belongs to this same-process request; it does not prove that the
authority's claim is true. Live authority creation must bind the named browser,
Firebase, protocol and ledger sources to the single operation. Untrusted or
shared producers require the later dedicated-process boundary and validated IPC.

## Failure and release

Per-source acquisitions cannot overlap, while distinct sources may run
concurrently. Calls are reserved before awaiting. Descriptor, target, capability,
receipt, identity, ordering, semantic, cancellation, expiry or authority failures
permanently poison all seven clients and collapse to one fixed error. Caller and
authority errors and secret-bearing abort reasons never propagate.

Authority callback descendants, abort listeners, receipt-validation traps and
foreign-thenable jobs cannot reenter an `observe` or `close` method. Such
reentrancy poisons the shared operation before a peer cursor can be consumed.
This cooperative protection does not cover an async resource registered before
authority invocation: JavaScript same-process context propagation is not a
sandbox. Authorities therefore remain explicit trusted dependencies; hard
isolation for shared or untrusted providers requires the later process/IPC
boundary.

Close rejects duplicate use and an already-aborted cleanup signal without
consuming the first close attempt. Once close begins, it aborts outstanding
client-owned signals, waits for every started authority callback to settle, then
invokes that authority's `close` exactly once with a signal linked only to the
producer's isolated cleanup signal. Strong authority and runtime references are
cleared only after real terminal settlement. All shared signal, expiry and
callback state is cleared after the seventh terminal release.

Every active acquisition owns a timer for the shared absolute authority expiry.
At expiry it poisons all clients and aborts their package-owned signals
immediately. It does not settle the authority promise or release its references:
terminal close still drains the real callback and invokes authority cleanup once.

This layer intentionally has no timeout race. The adjacent source-authority
adapter owns the public 30-second read and close deadlines. If a trusted
same-process authority ignores cancellation, the public caller can fail within
that deadline while this client remains quarantined in `closing`; JavaScript
cannot forcibly terminate the callback, and the authority is not falsely reported
released.

## Deliberately absent

This package does not create or discover OAuth, Firebase, browser, relay,
coordinator, KMS or Firestore authority. It performs no built-in HTTP or WebSocket
request, does not wire the source transports into the case adapter, does not own
a browser process and does not expose a CLI or execution command. No Hosting
publication, ingress change, cloud mutation or live matrix execution occurred.

Validate the package offline with:

```sh
node infrastructure/staging/browser-relay-source-clients/guard.mjs \
  infrastructure/staging/browser-relay-source-clients
node --test infrastructure/staging/test/browser-relay-source-clients.test.mjs
```
