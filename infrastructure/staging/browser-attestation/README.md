# Staging browser App Check attestation

Status: v1 preflight safely consumed; reviewed v2 operation not yet planned or executed

This package closes only the real Web App Check attestation prerequisite for
`miakapp-v4-staging`. It does not expose or invoke the control plane, create a
Firebase user, enable App Check enforcement, deploy a relay, use a debug token or
exercise Home data.

The first live preflight atomically claimed its operation and finalized one
Hosting version, then the bounded cleanup deleted it before any release or
browser invocation. The committed `preflight-result.json` records only hashes,
timestamps and stable counts; `preflight-evidence.mjs` pins its exact canonical
SHA-256. The immutable v1 claim and deleted version are retained as historical
evidence and cannot be reused.

The v2 planner requires that exact historical claim and deleted version, the
exact registered reCAPTCHA Enterprise provider, zero enforcement records, zero
debug tokens, one active Firebase Web app, zero Hosting releases and no v2
claim. It builds two
private, digest-pinned files from Firebase JavaScript SDK 12.18.0. The public
Firebase configuration and reCAPTCHA site key are injected only into that
private build; neither value is committed.

The apply path is intentionally one-shot:

1. validate the exact short-lived plan, clean `origin/main` commit, dependency
   lock, operator and live baseline;
2. create one new atomic, non-deleted v2 GCS operation claim;
3. create and release one v2-labelled Hosting version containing only the
   reviewed HTML and JavaScript under `/__acceptance/app-check/`;
4. launch one headed Playwright Chromium context and call the production
   reCAPTCHA Enterprise provider exactly once;
5. verify both public files byte-for-byte by their reviewed SHA-256 and security
   headers, then return only token shape, TTL and duration counters from the
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

The planner prints an exact v2 authorization bound to the canonical metadata and
repository commit. Apply that bundle once:

```sh
MIAKAPP_STAGING_BROWSER_ATTESTATION_APPLY_AUTHORIZATION='run-browser-app-check-attestation-v2:...' \
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

The planner prints a separate exact v2 authorization. Its apply path creates at
most one `SITE_DISABLE` release, deletes at most the one exact labelled version
and proves the runner is HTTP 404. Every recovery bundle is one-shot and is
bound to the immutable operation claim plus the complete pre-recovery Hosting
inventory. It never deletes the default Hosting site, either operation claim,
the retained historical version or the App Check provider.

The successful private result may later be reduced to a committed sanitized
artifact containing only stable counts, durations and hashes of Hosting
revision identifiers. API keys, reCAPTCHA site keys, access tokens, App Check
tokens, raw browser errors and network traces must remain absent.
