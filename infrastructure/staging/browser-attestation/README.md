# Staging browser App Check attestation

Status: three preflights safely consumed; reviewed v4 operation not yet planned or executed

This package closes only the real Web App Check attestation prerequisite for
`miakapp-v4-staging`. It does not expose or invoke the control plane, create a
Firebase user, enable App Check enforcement, deploy a relay, use a debug token or
exercise Home data.

The first three live preflights each atomically claimed their operation and
created one Hosting version. Their bounded cleanup deleted all three versions
before any release or browser invocation. The first finalization succeeded but
exposed that Firebase's stored-byte metric is not a local artifact checksum.
The second stopped before release without finer stage evidence. The third
proved that `populateFiles` omits empty protobuf fields when both content hashes
already exist, while the driver had required an explicit empty array and upload
URL. The committed preflight result files record only hashes, timestamps and
stable counts; `preflight-evidence.mjs` pins their exact canonical SHA-256
values. All immutable claims and deleted versions are retained as historical
evidence and cannot be reused.

The v4 planner requires all three exact historical claims and deleted versions, the
exact registered reCAPTCHA Enterprise provider, zero enforcement records, zero
debug tokens, one active Firebase Web app, zero Hosting releases and no v4
claim. It builds two private, digest-pinned files from Firebase JavaScript SDK
12.18.0. The public
Firebase configuration and reCAPTCHA site key are injected only into that
private build; neither value is committed.

The apply path is intentionally one-shot:

1. validate the exact short-lived plan, clean `origin/main` commit, dependency
   lock, operator and live baseline;
2. create one new atomic, non-deleted v4 GCS operation claim;
3. create and release one v4-labelled Hosting version containing only the
   reviewed HTML and JavaScript under `/__acceptance/app-check/`;
4. launch one headed Playwright Chromium context and call the production
   reCAPTCHA Enterprise provider exactly once;
5. treat Firebase's asynchronously calculated file/byte counters as bounded
   diagnostics only, and verify both public files byte-for-byte by their
   reviewed SHA-256 and security headers, then return only token shape, TTL and
   duration counters from the
   page, never the token; and
6. create a `SITE_DISABLE` release, delete the served version, close the
   ephemeral browser context and verify the runner returns HTTP 404.

Cleanup runs after both success and ordinary failure. The reviewed maximum
public window is five minutes, though the expected window is seconds. The page
uses `no-store`, a restrictive CSP, no external application subresources, no
Firebase Auth and no telemetry capture. Playwright tracing, HAR, video,
screenshots and persistent contexts are disabled.

## Guarded commands

From the exact merged `origin/main` commit, create a private plan outside the
repository:

```sh
MIAKAPP_STAGING_BROWSER_ATTESTATION_PLAN_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/browser-attestation/plan.sh /absolute/private/parent
```

The planner prints an exact v4 authorization bound to the canonical metadata and
repository commit. Apply that bundle once:

```sh
MIAKAPP_STAGING_BROWSER_ATTESTATION_APPLY_AUTHORIZATION='run-browser-app-check-attestation-v4:...' \
  ./infrastructure/staging/browser-attestation/apply.sh /absolute/private/bundle
```

Do not retry a bundle after its atomic operation claim is created. If the
process is interrupted, create a fresh read-only recovery plan from the source
bundle:

```sh
MIAKAPP_STAGING_BROWSER_ATTESTATION_RECOVERY_CONFIRMATION=miakapp-v4-staging \
  ./infrastructure/staging/browser-attestation/recovery-plan.sh \
  /absolute/private/attestation-bundle
```

The planner prints a separate exact v4 authorization. Its apply path creates at
most one `SITE_DISABLE` release, deletes at most the one exact labelled version
and proves the runner is HTTP 404. Every recovery bundle is one-shot and is
bound to the immutable operation claim plus the complete pre-recovery Hosting
inventory. It never deletes the default Hosting site, any operation claim, the
retained historical versions or the App Check provider.

An ordinary v4 failure writes only its closed stage and cleanup booleans to a
private `failure.json`; raw browser, Firebase and network errors remain absent.

The successful private result may later be reduced to a committed sanitized
artifact containing only stable counts, durations and hashes of Hosting
revision identifiers. API keys, reCAPTCHA site keys, access tokens, App Check
tokens, raw browser errors and network traces must remain absent.
