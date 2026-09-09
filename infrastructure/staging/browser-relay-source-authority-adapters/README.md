# Dormant concrete source authority adapters

This package is the closed bridge between explicit ephemeral source sessions
and the seven kind-specific authority objects consumed by
`browser-relay-authenticated-source-readers`. It is a library only. Importing
performs only local immutable audit-profile reads, and construction performs no
source, network, browser, cloud, process, or filesystem-mutation I/O.

Each source session is an exact frozen record containing its source, the fixed
staging scope for that source, one absolute expiry, and only `read` plus
`close`. All seven sessions must be distinct, must carry the same expiry, and
can be claimed for only one adapter set. Their maximum lifetime is 30 minutes.
The session record contains no operation capability: the adapter binds the
opaque capability from the first authenticated-reader context and requires the
same identity for every later call without forwarding it to a session.

```js
import {
  createBrowserRelaySourceAuthorityAdapters,
} from './adapters.mjs';

const authorities = createBrowserRelaySourceAuthorityAdapters(sessions, {
  signal: operationAbortController.signal,
  expires_at_milliseconds: expiresAt,
});
```

`authorities` has exactly the seven source keys and the exact 32 kind methods
plus source-local `close` methods required by the authenticated readers. The
first canonical call binds the transport-created opaque operation capability
across all seven adapters. A kind call is accepted only in the canonical
22-stage / 43-observation order. The adapter revalidates the authenticated
reader's frozen context and bound capability, then passes the session a new
frozen, null-prototype, JSON-rejecting descriptor containing only:

- `source`
- `browser`
- `case_id`
- `kind`
- a package-owned linked `AbortSignal`

The descriptor contains no capability, credential, target override, URL,
header, claim receipt, or raw source material. The fixed source scope was
validated when the session was captured. A session must return one already
projected candidate observation. The adapter copies, sanitizes, and applies the
existing source-and-kind semantic validator before that observation can cross
the authority boundary.

Read wrappers are bounded to 75 seconds. This admits the reviewed 60-second JWK
publication observation window with finite scheduling headroom while remaining
below the transport's 120-second bound. The public `close()` wrapper remains
bounded to 30 seconds. Calls are reserved before awaiting, ordered, and
non-overlapping per source.
Root/session expiry and cancellation are checked before dispatch and after every
read. Package-owned aborts carry only the fixed adapter error, so caller-owned
secret-bearing abort reasons do not cross the boundary. Descriptor, order,
identity, timeout, cancellation, expiry, session, semantic, or cleanup failures
poison all seven adapters and collapse to the same fixed error.

Source close aborts outstanding package work and waits for every started read
callback to settle before invoking the captured session close at most once with
a fresh, package-owned 30-second deadline signal. That cleanup signal is not
linked to root, request, source, or shared-poison cancellation. Only after every
started callback has settled does terminal cleanup clear the captured session,
operational signals, cursor, and runtime references and notify the testing
release probe. Closing all seven sources additionally clears the shared
operation capability, callback token, root signal, expiry, and controllers.

If a trusted same-process callback ignores its abort signal, public `close()`
still fails within its own bound, but the authority remains quarantined in
`closing`; it is not reported released and it cannot overlap that callback with
session close. Cleanup converges if the callback later settles. JavaScript
cannot forcibly terminate an uncooperative same-process callback, which is one
reason validated process IPC remains a later boundary.

“Concrete” here describes the implemented session-to-authority adapter and its
complete canonical dispatch/lifecycle behavior. The sibling
`browser-relay-source-session-producers` package can now create these sessions
from seven explicit trusted client closures. OAuth/Firebase/Cloud Run
acquisition, HTTP or WebSocket clients,
control-plane/relay/coordinator/KMS/Firestore ledgers, transport-to-case wiring,
trusted browser ownership, validated process IPC, Hosting publication, and live
matrix execution remain absent. Same-process sessions and clients are trusted
dependencies until the later IPC boundary can forcibly isolate uncooperative
implementations.

Validate the package offline with:

```sh
node infrastructure/staging/browser-relay-source-authority-adapters/guard.mjs \
  infrastructure/staging/browser-relay-source-authority-adapters
node --test \
  infrastructure/staging/test/browser-relay-source-authority-adapters.test.mjs
```
