# Browser-to-relay integration gate

Date: 2026-09-04

Status: current narrow browser-transport regression; historical trusted-relay
alpha baseline retained

## Purpose

This runbook reproduces the real-browser boundary between the public
`miakapi/browser` client and the Go relay. It builds the exact SDK under test,
serves its browser fixture from an ephemeral loopback TLS origin, and drives it
in headless Chromium against the relay's production session machinery.

The gate proves initial synchronization, an authoritative state patch, one
call/result exchange, completed renewal of a four-second synthetic user lease,
and a second call after the original lease has expired. Both calls use the same
WebSocket; the second call therefore proves that `REAUTH_OK` completed before
the old authority ended, rather than merely proving that a renewal frame was
sent.

The current fixture injects literal synthetic Miakapp access credentials on both
sides of the boundary. It does not run the control-plane exchange and therefore
is not evidence for source-token confinement, audience derivation, live Firebase
Auth or App Check, public ingress, the complete disconnect matrix, a malicious
relay, or staging acceptance. The complete audience-bound local gate is in the
[`user-relay-credentials` runbook](../runbooks/user-relay-credentials.md).

## Immutable inputs

The reciprocal CI gate uses these exact public merge commits:

- MiakAPI: `a798a746847ba3d5c16128a08b33353269e770a4`;
- Miakapp-Server production relay source:
  `df10674e034f30eec80760f5ec94bc108cff026f`; and
- Miakapp-Server test harness:
  `140e6517add101a243f92760334c7e6c3a0398e1`.

The harness commit is a test-only descendant whose sole diff from `df10674` is
`test/integration/platform-auth.mjs`. It ignores a Chromium `requestfailed`
event only when the same Request already produced an HTTP response, and adds
exact ordered POST/200 assertions. It changes no relay production file or
deployed image input.

Use detached worktrees at those revisions for release evidence. A developer may
run the same commands against clean local checkouts while iterating, but must
record the resulting commit IDs and must not describe that result as the pinned
gate.

The original Firebase-direct trusted-relay alpha evidence remains reproducible
at MiakAPI
[`5c26eaa`](https://github.com/Miakapp/MiakAPI/commit/5c26eaa830015d94f53bf05fbbb0f5ebda6d290f)
and Miakapp-Server
[`da49e8b`](https://github.com/Miakapp/Miakapp-Server/commit/da49e8bf6b1bd03acaabd225ab5e96a61dd5dd91).
Those commits are historical inputs, not the current reciprocal pins, and their
Firebase-direct credential shape must never return to a production relay path.

## Requirements

- Go 1.26.6;
- Bun 1.2.23;
- Node.js 22.22.0;
- Playwright 1.62.1 from the MiakAPI lockfile; and
- the matching Playwright Chromium runtime.

No cloud credentials, Firebase project, public listener or production data is
required.

## Run

Build the pinned MiakAPI checkout and install its pinned browser runtime:

```sh
cd /absolute/path/to/MiakAPI
bun install --frozen-lockfile
bun run build
./node_modules/.bin/playwright install chromium
```

Then run the relay-owned integration from the pinned Miakapp-Server checkout:

```sh
cd /absolute/path/to/Miakapp-Server
./scripts/check-miakapi-integration.sh /absolute/path/to/MiakAPI
```

The command must terminate successfully and print exactly this semantic evidence
shape, apart from JSON whitespace and object-key formatting:

```json
{
  "generation": 1,
  "state": 21,
  "call": "succeeded",
  "reauthenticated": true,
  "post_lease_call": "succeeded",
  "browser": "chromium",
  "websockets": 1
}
```

`websockets: 1` is required. A successful post-lease call after a reconnect does
not satisfy this gate.

## Safety and cleanup

The fixture creates temporary loopback TLS material and a browser bundle, and
uses only literal synthetic Miakapp bearer values. It serves one exact Origin
with `Cache-Control: no-store`, a restrictive Content Security Policy and no
external subresources. The relay enforces that exact Origin and the `miakapp`
WebSocket subprotocol.

The runner does not enable Playwright tracing, video, screenshots, HAR capture
or WebSocket frame inspection. Do not add those facilities to a run carrying
real credentials: `HELLO`, `REAUTH` and home state may be retained by such
artifacts. The script stops the browser, coordinator and relay fixture and
removes both its private working directory and separately generated CA file on
success or failure.

## Troubleshooting

- If Playwright reports a missing executable, run the pinned Chromium install
  from the MiakAPI checkout. On CI, use `playwright install --with-deps chromium`.
- If MiakAPI is reported as unbuilt, run its frozen install and build before the
  relay script.
- If the fixture cannot bind a port, inspect local loopback restrictions and
  rerun. It chooses ephemeral ports and must never be changed to a public bind.
- If TLS or Origin validation fails, repair the generated certificate/origin
  path. Do not disable TLS, `ignoreHTTPSErrors` outside the isolated browser
  context, the exact Origin allow-list, or subprotocol validation.
- If the semantic output differs, treat the gate as failed. Do not weaken the
  expected state, lease timing, post-lease call or single-socket assertion.

The authoritative contract and remaining production gates are in
[RFC 0005](../rfcs/0005-browser-client-sdk.md). The consolidated local and
staging evidence boundaries are in the
[control-plane fault matrix](../../control-plane/FAULT-MATRIX.md).
