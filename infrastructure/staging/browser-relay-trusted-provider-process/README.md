# Dormant trusted provider process boundary

This package gives one complete browser-relay owner a dedicated Node process and
one narrow, validated IPC exchange. The future owner bundle will construct the
Playwright connection, browser pages, seven trusted source providers and the
existing trusted source composition entirely inside that child. The parent can
start one operation, cancel it and receive only its closed operation result or a
fixed failure code.

The implementation and its tests are offline. No live owner bundle exists yet,
no browser or source is contacted, and this package schedules no staging work.

## Ownership boundary

Construction is inert. The first and only `execute()` call starts
`worker.mjs` with the caller's verified Node 22 runtime. Versions from 22.22.0
through the Node 22 line are supported; CI pins exactly 22.22.0 as the reviewed
evidence runtime. Non-Node launchers are rejected before process creation. The
child has:

- a new V8 heap;
- an empty environment and no inherited Node `execArgv`;
- ignored stdin, stdout and stderr;
- no Node IPC channel and no transferable socket/server handle;
- one read-only fd 3 and one write-only fd 4 for this protocol;
- a detached POSIX process group that also contains normally spawned browser
  descendants.

The worker first requires the bundle path to equal its native canonical real
path, then opens one non-executable regular owner bundle with `O_NOFOLLOW`,
bounds it to 1 MiB, reads it once, verifies its caller-pinned SHA-256, and
imports those exact bytes through a data URL. Consequently, no symlinked path
component is admitted and the owner must be a deterministic self-contained ESM
bundle; relative imports are not allowed.
It exports exactly `createBrowserRelayTrustedProviderOwner()`, whose returned
object exposes exactly `execute({ signal })` and `close()`.

The owner factory, provider/browser graph, AbortSignal and cleanup hooks never
cross the process boundary. The worker validates the final closed
browser-relay-operation result, awaits `owner.close()`, then frames a cloned
result. The parent parses and validates that clone again and waits for the child
and both pipes to close before resolving.

## Exact protocol

Every message contains the schema
`miakapp.staging-browser-relay-trusted-provider-process-ipc/1`, protocol version
`1`, an exact type and no additional key.

| Direction | Type | Additional fields |
|---|---|---|
| child -> parent | `ready` | `owner_bundle_sha256` |
| child -> parent | `startup_failure` | fixed `code` |
| parent -> child | `execute` | random 256-bit `request_id` |
| parent -> child | `cancel` | matching `request_id` |
| child -> parent | `result` | matching `request_id`, closed `result` |
| child -> parent | `failure` | matching `request_id`, fixed `code` |

Messages use a four-byte big-endian length followed by canonical UTF-8 JSON.
Each direction permits four frames, each at most 128 KiB. The decoder also caps
depth, structural tokens, string bytes and queued writes; requires safe integer
numbers and valid Unicode; and rejects duplicate keys, alternate/noncanonical
JSON, malformed UTF-8, truncation, floods and all state/order/identity drift.
UTF-8 BOMs are not canonical. Writes serialize, honor stream backpressure and
reject premature close; a channel failure waits for any already accepted
message handler to settle before teardown continues. Transport delivery is
never treated as proof that the operation did or did not run.

## Cancellation and ambiguous outcomes

Ready and operation deadlines are independent. Abort sends one matching
`cancel` without serializing the caller's reason. The owner receives an aborted
child-local signal and a bounded grace period. If it does not settle, the parent
sends `SIGKILL` to the negative child PID, terminating the detached POSIX process
group. Before any success or failure becomes public, the parent closes both pipe
ends, sends the group kill defensively even after a clean direct-child exit, and
verifies that the process group is empty within a fixed bound. A surviving or
unverifiable descendant becomes `cleanup_failed`.

Spawn errors, protocol violations, disconnects, crashes and close races converge
through the same idempotent path. A missing result is ambiguous: source-side
effects may have occurred. This runner never restarts the child or replays an
operation. Error messages expose only reviewed codes; thrown values, stack
traces, paths, raw frames and owner diagnostics remain private.

## API

```js
import { createBrowserRelayTrustedProviderProcess } from './process.mjs';

const ownerProcess = createBrowserRelayTrustedProviderProcess({
  owner_bundle_path: '/absolute/path/to/reviewed-owner-bundle.mjs',
  owner_bundle_sha256: '0'.repeat(64),
});

const result = await ownerProcess.execute({ signal });
await ownerProcess.close();
```

The two required options may be supplemented only by the complete reviewed
timing set: `ready_timeout_milliseconds`, `operation_timeout_milliseconds` and
`cancellation_grace_milliseconds`. The controller is frozen, exact and
single-use.

## Security boundary and deliberate limits

This is process/realm and termination isolation, not an operating-system
sandbox. The trusted owner still runs as the same user and can ordinarily reach
that user's filesystem and network. A malicious owner could attack its own
process or ambient OS authority; this package does not claim to contain one.
Provider code therefore remains trusted, while hangs, crashes, retained JS
references and ordinary descendant cleanup are bounded away from the parent
realm.

The runner accepts no URL, target, header, credential, browser handle, generic
method or cloud client. There is no OAuth/ADC discovery, Playwright launcher,
Firebase/Google SDK, HTTP/WebSocket implementation, Hosting artifact, ingress or
IAM change. Concrete source truth, credential acquisition and the single bounded
live matrix remain separate future gates.

## Offline validation

```sh
bash infrastructure/staging/browser-relay-trusted-provider-process/check.sh
node infrastructure/staging/validate.mjs infrastructure/staging/manifest.json
```

The synthetic suite covers strict framing, digest and export failures, secret
sanitization, cancellation races, crashes, disconnects, an owner that ignores
cooperative cancellation, descendants left behind after both success and
failure, receiver identity, premature stream close and close-before-terminal
ordering. It performs zero browser, DNS or cloud request.

## References

- [Node.js 22.22 child processes](https://nodejs.org/download/release/v22.22.0/docs/api/child_process.html)
- [Chromium Mojo security guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/mojo.md)
- [Electron context-isolation guidance](https://www.electronjs.org/docs/latest/tutorial/context-isolation#security-considerations)
- [Chrome Native Messaging framing](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-protocol)
- [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259.html)
- [POSIX `exec`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/exec.html)
