# Dormant trusted source session producers

This package is the closed bridge between seven explicit, already-authorized
source clients and the seven ephemeral sessions consumed by
`browser-relay-source-authority-adapters`. It is a library only. Importing it
performs only local immutable audit-profile reads, and construction performs no
source, network, browser, cloud, process, or filesystem-mutation I/O.

The caller must provide an exact frozen map with the canonical seven source
keys. Every value must be a distinct frozen client exposing only `observe` and
`close`. A client identity can be claimed for only one producer lifetime. The
package never discovers a client, credential, endpoint, account, browser, or
ambient process authority.

```js
import {
  createBrowserRelaySourceSessions,
} from './producers.mjs';

const sessions = createBrowserRelaySourceSessions(clients, {
  signal: operationAbortController.signal,
  expires_at_milliseconds: expiresAt,
});
```

The result is an exact frozen map of seven distinct frozen sessions. Every
session contains its producer-owned source, the fixed audited staging scope, the
same absolute expiry, and only `read` plus `close`. The maximum lifetime is 30
minutes. The output is accepted directly by the adjacent source-authority
adapter; neither clients nor testing controls cross this boundary.

## Observation boundary

Reads are lazy and accepted only in the canonical 22-stage / 43-observation
order. A source call is reserved before awaiting and calls cannot overlap for
the same source. Immediately before invoking the matching client, the producer
rechecks root, source, request, and expiry state. A timer aborts the linked
client signal and poisons all sessions at the absolute expiry without racing
away the raw callback settlement. Request cancellation poisons the shared
lifecycle immediately. The client receives a fresh frozen, null-prototype,
JSON-rejecting descriptor containing only:

- `source`
- the fixed `scope`
- `browser`
- `case_id`
- `kind`
- a package-owned linked `AbortSignal`

The descriptor contains no operation capability, credential, arbitrary target,
request headers, receipt, or raw source material. A client returns one already
projected candidate observation. The producer copies and independently applies
the existing source-and-kind semantic validator before the value can enter a
session. Semantic validation proves the shape and expected synthetic facts; it
does not authenticate provenance. The injected client remains a trusted
dependency of the caller.

Cancellation, expiry, identity, ordering, client, semantic, and cleanup
failures permanently poison all seven sessions and collapse to one fixed error.
Package-created abort signals also carry only that fixed error, so a
secret-bearing caller abort reason never crosses into a client. No arbitrary
client error is propagated.

Client callbacks and their foreign-thenable assimilation jobs cannot invoke any
session `read` or `close`. Such reentrancy poisons the complete session set; the
callback context cannot consume a peer source cursor or wait on its own close.

## Drain and terminal release

Source close rejects callback-reentrant or duplicate use, aborts outstanding
producer signals, and waits for every started observation callback to settle.
An already-aborted cleanup signal rejects without consuming the close, leaving
a later cleanup attempt possible. Once close starts, it invokes that source
client's `close` exactly once after the drain even if the cleanup deadline aborts
before dispatch. The close signal is fresh and linked solely to the
adapter-provided cleanup deadline; it is independent from operation cancellation
and shared poison. Captured client, cursor, runtime, descriptor, and signal
references are cleared only after real terminal settlement. A testing-only
release probe can observe that boundary.

This layer deliberately has no timeout race of its own. The adjacent
source-authority adapter owns the public 30-second read and close wrappers. If a
trusted same-process client ignores cancellation, the public adapter can fail
within its bound while this producer stays quarantined in `closing`: it neither
overlaps client close with the unfinished callback nor falsely reports the
client released. JavaScript cannot forcibly terminate such a callback without
a later dedicated-process IPC boundary.

## Deliberately absent

No Firebase, Google Cloud, HTTP, WebSocket, OAuth, browser, ledger, or
credential-acquisition client is implemented here. The adjacent
`browser-relay-source-clients` package now supplies compatible dormant clients
over explicit ephemeral authorities and fixed staging targets while preserving
these scopes and lifecycle guarantees. Live authority providers, operation-case
and transport wiring, trusted live-page providers, process IPC, deployment,
public ingress, scheduled execution, cloud requests and live evidence remain
absent.

Validate the package offline with:

```sh
node infrastructure/staging/browser-relay-source-session-producers/guard.mjs \
  infrastructure/staging/browser-relay-source-session-producers
node --test \
  infrastructure/staging/test/browser-relay-source-session-producers.test.mjs
```
