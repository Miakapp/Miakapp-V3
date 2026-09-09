# Trusted provider process and ephemeral authority boundary

This package runs one complete browser-relay owner in one dedicated Node
process. The owner artifact can contain its dependency-bearing ESM/CommonJS
package tree and constructs all providers, browser pages, operation components,
and cleanup hooks inside the child. The parent can execute once, cancel once,
and receive only a validated closed operation result or a fixed failure code.

Protocol v2 also provides one narrow path for opaque ephemeral authority bytes.
It proves only transport and consumption with synthetic data. It does not load a
real credential, wire an external source provider, contact a network or cloud
service, publish Hosting content, mutate staging, or authorize live execution.

The byte-identical process-only and dependency-bearing profiles remain archived
as `profile-v1.json` and `profile-v2.json`. Current revision 3 records the
ephemeral-authority boundary and its deliberately unchanged non-live scope.

## Process ownership

Construction is inert. The first and only `execute()` starts `worker.mjs` with
the caller's verified Node 22 runtime. Node 22.22.0 through the Node 22 line is
supported; CI pins 22.22.0. Non-Node launchers and Windows fail before spawn.

The child has:

- a new V8 heap and detached POSIX process group;
- an empty environment and no inherited Node `execArgv`;
- ignored stdin, stdout, and stderr;
- no Node IPC channel or transferred handle;
- fd3 for parent-to-child control frames;
- fd4 for child-to-parent status/result frames;
- fd5 for one parent-to-child binary authority envelope.

The parent creates and owns one canonical empty `0700` workspace. The worker
opens the non-executable owner artifact with `O_NOFOLLOW`, bounds it to 32 MiB,
reads it once, and verifies the caller-pinned SHA-256. `MIAKOWN1` contains a
canonical manifest followed by ordered raw payloads. The manifest is limited to
256 KiB and 512 exact files; each file is limited to 8 MiB, each safe relative
POSIX path to 256 UTF-8 bytes, and each segment to 255 bytes. Path, size, and
SHA-256 bind every entry. Unsafe, duplicate, case-colliding, and prefix-colliding
paths fail closed.

Verified directories are `0700`; files are created exclusively, independently
verified, and changed to `0400`. Before importing the exact entry file URL, the
worker installs Node 22 synchronous resolution hooks. Built-in `node:` modules
remain available; every other ESM, CommonJS, package-metadata, and
`createRequire()` resolution must end at a canonical `0400` file in that
workspace. The artifact is a deterministic loading boundary, not an OS sandbox.

The entry exports exactly
`createBrowserRelayTrustedProviderOwner({ authority })`. `authority` is a frozen
null-prototype object exposing only `consume(callback)`. The returned owner still
exposes exactly `execute({ signal })` and `close()`. Provider/browser handles,
the factory, and the signal never cross the process boundary.

The worker validates the closed operation result, awaits owner close and
authority settlement, and only then emits a terminal frame. The parent validates
the cloned result again, waits for all three pipes, the direct child, and its
process group, removes the workspace, and only then resolves. Failed group or
workspace cleanup becomes `cleanup_failed`.

## Ephemeral authority handoff

`execute` requires a Node `Buffer` containing 1 through 16,384 opaque bytes.
`SharedArrayBuffer` backing storage, proxies, empty/oversized input, extra fields,
and reused Buffer identity fail closed. Backing-store and length validation uses
the intrinsic TypedArray slots, so shadowing instance properties cannot disguise
shared or out-of-range storage. The call synchronously copies the bytes into
zero-filled parent-owned storage and overwrites the caller's view. This is an
ownership transfer: callers must not expect their Buffer contents to survive.

The authority handshake is exact:

1. The child verifies and imports the owner artifact, then sends `ready`.
2. The parent writes one fixed-magic/version/length binary envelope to fd5 and
   closes its endpoint. No JSON or string conversion occurs.
3. The child accepts arbitrary chunk boundaries, bounds and copies the payload,
   overwrites incoming chunks, requires exact EOF, and waits for fd5 to close.
4. The child sends the non-secret `authority_ready` frame.
5. Only after the parent has observed its own fd5 closure and that acknowledgement
   does it send `execute` on fd3.

The owner can call `consume(callback)` exactly once. The callback receives the
child-owned Buffer for its asynchronous lifetime; the worker overwrites that
Buffer in `finally`. A missing callback invocation or any second attempt observed
before worker settlement fails the operation as `authority_contract_failed`,
even if trusted owner code catches its local error. The capability also rejects a
later call, but an attempt scheduled by malicious owner code after terminal
settlement cannot retroactively revoke an emitted result; digest-pinned trusted
owner code remains part of the boundary. The current owner only validates the
Buffer and wraps its offline execution; it does not inspect, parse, stringify,
copy, persist, or turn the bytes into real authority.

Same-object claim, one process, and one callback prevent accidental replay within
this boundary. A caller that deliberately copies bearer bytes can still replay
that independent copy; preventing that globally would require an external
issuer/ledger and is not claimed here.

## Control protocol

Every JSON message contains schema
`miakapp.staging-browser-relay-trusted-provider-process-ipc/1`, protocol version
`2`, an exact type, and no extra key.

| Direction | Type | Additional fields |
|---|---|---|
| child -> parent | `ready` | `owner_bundle_sha256` |
| child -> parent | `startup_failure` | fixed `code` |
| child -> parent | `authority_ready` | none |
| parent -> child | `execute` | random 256-bit `request_id` |
| parent -> child | `cancel` | matching `request_id` |
| child -> parent | `result` | matching `request_id`, closed `result` |
| child -> parent | `failure` | matching `request_id`, fixed `code` |

Control messages use a four-byte big-endian length followed by canonical UTF-8
JSON. Each direction permits four frames of at most 128 KiB. Decoding also bounds
depth, structural tokens, string bytes, and queued writes; accepts only safe
integers and valid Unicode; and rejects duplicate keys, BOMs, alternate JSON,
malformed UTF-8, truncation, floods, and all state/order/identity drift. Writes
serialize, honor backpressure, and reject premature close. Authority bytes never
enter this JSON protocol.

## Cancellation and ambiguous outcomes

The ready deadline covers artifact import and the complete authority handshake.
The operation deadline starts only after `execute`. Abort before execute destroys
fd5 and never emits a fictitious cancel. Abort after execute sends at most one
matching `cancel` without the caller's reason and aborts only a child-local signal.

After the bounded grace period, the parent sends `SIGKILL` to the negative child
PID. It defensively repeats group termination and verifies the group is empty
even after clean child exit. Spawn failures, malformed authority, protocol drift,
disconnects, crashes, and close races converge through the same single-use
settlement path. The process never restarts or replays an ambiguous operation.
Errors contain fixed codes only—not thrown values, paths, stacks, raw frames, or
owner diagnostics.

## API

```js
import { createBrowserRelayTrustedProviderProcess } from './process.mjs';

const ownerProcess = createBrowserRelayTrustedProviderProcess({
  owner_bundle_path: '/absolute/path/to/reviewed-owner.bundle',
  owner_bundle_sha256: '0'.repeat(64),
});

const authority = Buffer.from(ephemeralBinaryMaterial);
const result = await ownerProcess.execute({ authority, signal });
// `authority` has been overwritten.
await ownerProcess.close();
```

The two construction options may be supplemented only by the complete timeout
set: `ready_timeout_milliseconds`, `operation_timeout_milliseconds`, and
`cancellation_grace_milliseconds`. The controller is frozen, exact, and
single-use. Authority is accepted only at execution, so construction does not
retain it.

## Security boundary and deliberate limits

This is process/realm and termination isolation, not an operating-system sandbox
or secure enclave. Trusted owner code runs as the same user and retains that
user's filesystem/network authority. Same-user debuggers and privileged observers
may inspect process memory or descriptors. A malicious owner can copy bytes or
attack ambient OS authority; digest pins and source review—not this process—are
the trust basis.

`Buffer.fill(0)` is best-effort memory hygiene. It overwrites the backing stores
the implementation owns and can still reach. Node does not guarantee erasure of
independent copies, immutable strings, stream/kernel buffers, swapped pages, heap
dumps, or memory reclaimed after `SIGKILL`. The code and evidence make no stronger
claim. Parent-crash workspace cleanup is likewise not guaranteed.

There is no OAuth/ADC discovery, credential command, Firebase/Google SDK,
Playwright launcher in this package, external HTTP/WebSocket path, Hosting
artifact, ingress change, IAM change, or live operation. Upstream acquisition of
a short-lived, audience-restricted real token and its attenuation into seven
external providers remain separate future gates.

## Offline validation

```sh
bash infrastructure/staging/browser-relay-trusted-provider-process/check.sh
node infrastructure/staging/validate.mjs infrastructure/staging/manifest.json
```

The synthetic suite covers binary envelope bounds and chunking, observable
Buffer overwrite, identity/single-consume rules, deterministic artifacts,
dependency loading, module escape rejection, fd3/fd4/fd5 ordering, secret error
sanitization, pre- and post-transfer abort, hostile acknowledgements, crashes,
uncooperative owners and descendants, process-group settlement, and workspace
removal. Dependency tests import `playwright-core` 1.62.1 without launching a
browser. The suite performs zero DNS, external network, cloud, or live request.

## References

- [Node.js 22.22 child processes](https://nodejs.org/download/release/v22.22.0/docs/api/child_process.html)
- [Node.js 22.22 streams](https://nodejs.org/download/release/v22.22.0/docs/api/stream.html)
- [Node.js 22.22 buffers](https://nodejs.org/download/release/v22.22.0/docs/api/buffer.html)
- [Linux `pipe(7)`](https://man7.org/linux/man-pages/man7/pipe.7.html)
- [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html)
- [OAuth 2.0 Security BCP](https://www.rfc-editor.org/rfc/rfc9700.html)
