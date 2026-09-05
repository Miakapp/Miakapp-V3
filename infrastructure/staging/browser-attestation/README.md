# Staging browser App Check attestation

Status: real system-browser provider token obtained; temporary Hosting retired;
all one-shot execution and recovery entrypoints permanently retired

This package closes only the real Web App Check attestation prerequisite for
`miakapp-v4-staging`. It did not expose or invoke the control plane, create a
Firebase user, enable App Check enforcement, deploy a relay, use a debug token
or exercise Home data.

## Retained history

Six live one-shot operations were safely consumed. The first three created one
Hosting version each and deleted it before any release or browser invocation.
They established the asynchronous Hosting metrics and reused-file response
shapes required by the later drivers.

The fourth operation crossed the complete Hosting boundary. Both reviewed
files and all security headers were verified from the public origin. A headed,
operator-local Playwright Chromium then failed to obtain an App Check token.
Cleanup created the expected `SITE_DISABLE` release, deleted the version and
proved the runner returned HTTP 404. That result permanently invalidated the
Playwright path.

The fifth operation proved the default-system-browser and loopback path. It
returned one challenge-bound closed provider failure before the same verified
cleanup. Review of the pinned Firebase SDK found that its client exchange uses
`content-firebaseappcheck.googleapis.com`, while the v5 CSP had allowed the
similarly named configuration API host.

The sixth operation corrected that CSP and completed the provider exchange in
the real default system browser. Firebase `getToken(appCheck, true)` resolved
with a bounded three-segment JWT string. The runner then rejected its own TTL
check because Firebase 12.18.0's public `AppCheckTokenResult` exposes only the
`token` field, not the provider-internal `expireTimeMillis` field the check had
attempted to read. The pinned SDK throws provider and dummy-token failures
before the public call resolves, so reaching the subsequent TTL stage is closed
evidence that a fresh real-provider App Check token was obtained. No token or
claim was returned to the driver or retained.

The sixth cleanup disabled Hosting, deleted the only v6-labelled version and
proved the runner returned HTTP 404 after an 8,749 ms public window. Enforcement
remained disabled, debug-token count remained zero, and Firebase Auth plus the
control plane were never invoked.

The six committed preflight files contain only hashes, timestamps, closed
semantic states and stable counts. `preflight-evidence.mjs` pins their exact
canonical SHA-256 values. All immutable claims, deleted versions and release
records remain historical evidence and cannot be reused or deleted by this
package.

## Consumed v6 boundary

The v6 planner required all five earlier claims and deleted versions, the four
exact v4/v5 release records, the registered reCAPTCHA Enterprise provider, zero
enforcement records, zero debug tokens, one Firebase Web app and no v6 claim.
It built two private digest-pinned files from Firebase JavaScript SDK 12.18.0;
the public Firebase configuration and reCAPTCHA site key were never committed.

The one-shot apply path then:

1. validated the short-lived plan, exact `origin/main` commit, dependency lock,
   operator identity and complete live baseline;
2. created one atomic non-deleted v6 GCS operation claim;
3. created and released one v6-labelled Hosting version containing only the two
   reviewed files below `/__acceptance/app-check/`;
4. verified both public files byte-for-byte and every reviewed response header;
5. opened the exact runner once in the default macOS browser and accepted one
   challenge-bound result through an ephemeral `127.0.0.1` fragment bridge;
6. obtained one fresh reCAPTCHA Enterprise-backed App Check token without
   returning its bytes; and
7. created a `SITE_DISABLE` release, deleted the version and verified the final
   HTTP 404 plus exact six-version/six-release inventory.

The callback result contained no token, JWT claim, provider message, stack or
arbitrary error value. The URL fragment was absent from the initial loopback
request and removed from the address bar before its same-origin POST. The
driver did not claim a globally observed assessment count for unrelated traffic
during the short public window.

Conductor's Browser tab was intentionally outside this boundary: it is a
localhost application preview and does not navigate to the public Firebase
origin. The successful exchange used the operator's ordinary default system
browser without a browser-control extension, persistent profile or copy/paste.

## Permanent retirement

`plan.sh`, `apply.sh`, `recovery-plan.sh` and `recovery-apply.sh` now fail before
credential, tool or cloud access. Their source remains only as immutable design
and recovery evidence. The v6 operation claim forbids retry and deletion; no v7
attestation operation is needed.

The next live browser-relay acceptance remains separately guarded. It may reuse
the proven provider configuration, but it cannot reuse these consumed drivers,
their private bundle, their callback challenge or any token from this operation.
