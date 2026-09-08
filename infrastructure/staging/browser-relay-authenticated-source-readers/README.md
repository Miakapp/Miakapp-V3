# Dormant authenticated source readers

This package is the closed capability boundary between trusted, source-specific
staging authorities and the generic browser-relay source transports. It is a
library only. Importing performs only local immutable audit-profile reads;
constructing it performs no I/O. Neither path performs source, network, browser,
cloud, or process I/O.

The factory accepts exactly seven distinct authority objects. Each authority has
only the methods matching that source's canonical fact kinds plus `close`.
There is no arbitrary request method, URL field, header map, or credential
string. A future concrete adapter may close over short-lived authentication or
an operation-local ledger, but this package never receives, retains, serializes,
or returns that material.

```js
import {
  createBrowserRelayAuthenticatedSourceReaders,
} from './readers.mjs';

const providers = createBrowserRelayAuthenticatedSourceReaders(authorities, {
  signal: operationAbortController.signal,
  // Absolute Unix epoch milliseconds, never a duration; at most 30 minutes away.
  expires_at_milliseconds: Date.now() + 10 * 60 * 1_000,
});
```

`providers` has the exact seven-source `{ openStage, close }` surface consumed
by `browser-relay-source-transports`. The first canonical stage binds all seven
providers to the generic transport's same opaque operation capability. A fresh
single-stage `{ next, close }` reader then calls exactly one kind-specific
authority method per requested observation. Calls are lazy, ordered,
non-overlapping, reserved before awaiting, and terminated by one explicit EOF.

Every authority receives one frozen, null-prototype, non-serializable context
containing only `source`, `browser`, `case_id`, `kind`, a linked `AbortSignal`,
and the opaque operation capability. Every returned observation is copied,
screened for private material, and semantically checked by the existing
independent-observer contract before it crosses the provider boundary.

The linked signal is owned by this package. Root and stage cancellation are
forwarded using only the package's fixed branded error, so a caller-owned abort
reason—including a secret-bearing object—cannot cross into an authority.

The root signal and the absolute expiry are checked before and after every
authority call. Any descriptor, order, identity, cancellation, expiry,
authority, semantic, EOF, or cleanup failure permanently poisons the shared
seven-provider operation and collapses to the package's single branded error.
Provider close invokes every captured authority's `close` exactly once. The
terminal close clears the operation capability, root signal, controllers, and
all strong authority references.

This is not yet a live reader implementation. Same-process closures can lie or
ignore cancellation; JavaScript cannot forcibly terminate them. Concrete
OAuth, Firebase, Cloud Run, relay-protocol, coordinator-ledger, KMS, and
Firestore adapters remain absent, as do case-adapter wiring, trusted browser
providers, validated process IPC, Hosting publication, and live execution.
Those boundaries must be implemented and isolated before the acceptance matrix
can run.

The deterministic clock and authority-release probe exist only in
`testing.mjs`. Production captures the intrinsic wall clock, uses a no-op
release probe, and offers no runtime injection.

Validate the package offline with:

```sh
node infrastructure/staging/browser-relay-authenticated-source-readers/guard.mjs \
  infrastructure/staging/browser-relay-authenticated-source-readers
node --test \
  infrastructure/staging/test/browser-relay-authenticated-source-readers.test.mjs
```
