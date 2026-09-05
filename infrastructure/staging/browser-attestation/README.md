# Staging browser App Check attestation

Status: v4 safely retired; reviewed system-browser v5 operation not yet planned or executed

This package closes only the real Web App Check attestation prerequisite for
`miakapp-v4-staging`. It does not expose or invoke the control plane, create a
Firebase user, enable App Check enforcement, deploy a relay, use a debug token
or exercise Home data.

## Retained history

Four live one-shot operations have been safely consumed. The first three
created one Hosting version each and deleted it before any release or browser
invocation. They established the asynchronous Hosting metrics and reused-file
response shapes required by the current driver.

The fourth operation crossed the complete Hosting boundary. Both reviewed
files and all security headers were verified from the public origin. A headed,
operator-local Playwright Chromium then failed to obtain a valid App Check
attestation. Cleanup created the expected `SITE_DISABLE` release, deleted the
version and proved the runner returned HTTP 404. No token was retained. That
result invalidates the Playwright execution path; v5 cannot launch or import
Playwright.

The four committed preflight result files contain only hashes, timestamps and
stable counts. `preflight-evidence.mjs` pins their exact canonical SHA-256
values. All immutable claims, deleted versions and release records remain as
historical evidence and cannot be reused or deleted by this package.

## System-browser v5 boundary

The v5 planner requires all four exact historical claims and deleted versions,
the two exact v4 release records, the registered reCAPTCHA Enterprise provider,
zero enforcement records, zero debug tokens, one active Firebase Web app and
no v5 claim. It builds two private, digest-pinned files from Firebase JavaScript
SDK 12.18.0. The public Firebase configuration and reCAPTCHA site key are
injected only into that private build; neither value is committed.

The apply path is one-shot and requires a local macOS session with
`/usr/bin/open` available:

1. validate the short-lived plan, clean `origin/main` commit, dependency lock,
   operator identity and complete live baseline;
2. create one atomic, non-deleted v5 GCS operation claim;
3. create and release one v5-labelled Hosting version containing only the two
   reviewed files below `/__acceptance/app-check/`;
4. verify both public files byte-for-byte by SHA-256 and verify every reviewed
   response header;
5. bind an ephemeral HTTP listener to a random port on `127.0.0.1`, generate
   independent 256-bit challenge and callback-path values, and invoke the exact
   runner URL once through the default macOS browser without a shell;
6. receive exactly one bounded semantic result through a callback fragment and
   same-origin loopback POST, bound to the challenge; and
7. create a `SITE_DISABLE` release, delete the served version and prove the
   runner returns HTTP 404 before validating the final inventory.

The page calls the production reCAPTCHA Enterprise provider at most once. Its
window promise returns only success/failure state, token shape, TTL and duration
counters plus the non-secret challenge. The App Check token and raw provider
errors never leave the page. The callback result crosses from the public runner
to loopback in a URL fragment, which is not sent with the initial HTTP request;
the local bridge removes it from the address bar before a same-origin POST. The
driver hashes and removes the challenge before writing private result evidence.
The one-attempt bound applies to the operator-launched page. The operation does
not claim a globally observed assessment count for arbitrary public-origin
traffic during the short Hosting window.

Conductor's Browser tab is intentionally not part of this boundary: it is a
localhost application preview and does not navigate to the public Firebase
origin. The reviewed path uses the operator's real default system browser and
needs no browser-control extension, persistent profile or manual copy/paste.

The public window is capped at five minutes. The observation deadline is two
minutes from the beginning of release, leaving three minutes of cleanup margin.
Normal failure, a closed provider failure, timeout, `SIGINT` and `SIGTERM` all
enter the same cleanup path. An abrupt machine or process loss remains covered
by the separately authorized recovery flow.

## Guarded commands

From the exact merged `origin/main` commit, create a private plan outside the
repository:

```sh
MIAKAPP_STAGING_BROWSER_ATTESTATION_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/browser-attestation/plan.sh /absolute/private/parent
```

The planner prints an exact v5 authorization bound to the canonical metadata
and repository commit. Apply the bundle once from the local macOS session:

```sh
MIAKAPP_STAGING_BROWSER_ATTESTATION_APPLY_AUTHORIZATION='run-interactive-browser-app-check-attestation-v5:...' \
  ./infrastructure/staging/browser-attestation/apply.sh /absolute/private/bundle
```

The apply process prints `SYSTEM_BROWSER_ATTESTATION_READY`, starts the private
loopback listener and opens the exact public runner itself. The browser returns
only the reviewed semantic object and displays a completion message; no terminal
input is accepted. Do not inspect, copy or return any App Check token. Do not
retry a bundle after its atomic operation claim is created.

If the process is interrupted, create a fresh read-only recovery plan from the
source bundle:

```sh
MIAKAPP_STAGING_BROWSER_ATTESTATION_RECOVERY_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/browser-attestation/recovery-plan.sh \
  /absolute/private/attestation-bundle
```

The planner prints a separate exact v5 recovery authorization. Its apply path
creates at most one required `SITE_DISABLE` release, deletes at most the one
exact v5-labelled version and proves the runner is HTTP 404. Each recovery
bundle is one-shot and bound to the immutable operation claim plus the complete
pre-recovery Hosting inventory. It never deletes the default Hosting site, any
operation claim, any retained historical version or release, or the App Check
provider.

Ordinary v5 failure evidence contains only a closed stage, cleanup booleans and
non-sensitive counters. API keys, reCAPTCHA site keys, access tokens, App Check
tokens, challenges, raw browser errors and network traces must remain absent
from committed evidence.
