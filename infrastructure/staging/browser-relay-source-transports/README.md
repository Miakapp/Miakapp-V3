# Browser relay source transports

This dormant package fills the transport slot between seven trusted
source-specific readers and the existing
[`browser-relay-independent-case-adapter`](../browser-relay-independent-case-adapter/).
It replaces the shape of the deterministic source harness with production code;
it does not implement or authenticate a live reader.

The production factory accepts exactly seven distinct providers:

1. `firebase_app_check`;
2. `hosting`;
3. `control_plane`;
4. `relay`;
5. `coordinator`;
6. `kms`; and
7. `firestore`.

Each provider exposes only `openStage(request)` and `close()`. A stage request
contains the reviewed source, browser and case, the frozen expected fact kinds,
their exact count, an operation-bounded `AbortSignal` and one opaque callable
capability. That frozen, prototype-free capability is identity-only and cannot
be extended, cloned or serialized;
claim receipts and execution identifiers never reach a provider.

`openStage` returns a fresh `{ next, close }` reader. The transport pulls exactly
one `{ done: false, observation }` value for every expected kind, awaits the
downstream `record(observation)` backpressure after each value, and then requires
one exact `{ done: true }` result. The existing case adapter still derives source,
kind and sequence, while the evidence session remains the only clock and envelope
owner. Providers cannot submit those fields.

Provider and reader identities are claimed once for the process lifetime. Per
source, stage calls cannot overlap and must follow the reviewed browser/case
order. A descriptor, ordering, stream, callback, timeout or cleanup violation
permanently poisons the operation. Provider errors are replaced with the package's
fixed failure class. Before a projection reaches the existing record capability,
the independent-observer sanitizer rejects credentials, identifiers, raw
requests/responses, documents, log entries, WebSocket frames and other private
material.

The factory signal, source signal and case scope signal are folded into hidden
composites through the captured intrinsic `AbortSignal.any` before a request is
exposed. Persistent cancellation subscriptions use captured `EventTarget`
methods, so later instance-property shadows cannot mask an abort; every
transport-owned event listener is removed deterministically. Cancellation
suppresses later records, wakes the caller, retains finite late
settlements for draining, closes any reader returned after cancellation, closes
each acquired reader once, terminates every stage signal and finally closes each
provider once. A callback cannot reenter its own transport's close path. Source
close drains every finite late settlement before returning and clears its strong
provider/runtime references; the shared capability and abort state are cleared
after all seven sources close. Production timeouts use intrinsic runtime
functions; the supported controlled-timer surface is the separate testing
entrypoint.

This is still a cooperative in-process boundary. JavaScript cannot terminate a
provider that ignores cancellation and never settles, and the opaque capability
does not prove that a provider's semantic claims are true. Authenticated readers
for App Check, Hosting, the control plane, relays, the coordinator, KMS and
Firestore remain absent. Untrusted or shared readers require the planned
dedicated process and validated IPC before live execution.

Import performs only the repository's local immutable audit-profile reads; it
does no source, network, browser or cloud I/O. Construction also performs no such
I/O, but it permanently claims the seven provider identities and owns one root
abort subscription. A caller that constructs this boundary must therefore close
all seven returned observers, even after failure. The package contains no URL,
HTTP or WebSocket client, Firebase or Google SDK, credential discovery,
subprocess, persistent credential, public-ingress change or cloud mutation. Its
profile grants no authority and records zero live facts, requests, mutations,
executions and incremental cost.

Validate the package with:

```sh
node infrastructure/staging/browser-relay-source-transports/guard.mjs \
  infrastructure/staging/browser-relay-source-transports
```
