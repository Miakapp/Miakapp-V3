# Dormant staging browser-relay page host

Status: closed page host, deterministic artifact builder and three-engine
dormant CI smoke implemented; not wired to the live runner, published, or
executed

This package is the browser-side foundation for the single-use relay acceptance
operation. It composes the exact MiakAPI browser SDK with Firebase Auth and
reCAPTCHA Enterprise App Check without adding a package-registry dependency on
an unpublished MiakAPI 4 prerelease. The 84 KiB vendored ESM bundle is generated
from MiakAPI commit `a798a746847ba3d5c16128a08b33353269e770a4` by Bun 1.2.23,
is pinned by SHA-256, and retains MiakAPI's ISC license.
Its provenance also pins the commit's deterministic `git archive`, package and
lock files, and the generated `dist/browser.js` entry. From that exact clean
checkout the committed bytes reproduce with:

```sh
bun install --frozen-lockfile
bun run build
bun build dist/browser.js --target browser --format esm --minify --sourcemap=none --outfile miakapi-browser-v4.mjs
```

The page accepts exactly one Firebase custom token through a private
`page.evaluate` argument. Firebase Auth uses `inMemoryPersistence`; the custom
token is not compiled into the artifact, written to storage, logged, returned,
or placed on a WebSocket. App Check uses the real staging reCAPTCHA Enterprise
provider with automatic refresh disabled. Firebase ID and App Check tokens are
requested only inside MiakAPI's HTTPS credential-provider callbacks. The page
temporarily shadows IndexedDB before App Check initialization and restores the
original browser descriptor during teardown, preventing the SDK's otherwise
automatic persistent token cache while preserving the ephemeral context.
The page
wraps the native WebSocket constructor before creating the client, counts only
bounded connection facts, detects source-token bytes without retaining frames,
and zeroes its own token byte copies during teardown.

The phased API supports initialization, start, closed observation, synthetic
state matching and calls, suspension/resumption, and idempotent cleanup. It
deliberately exposes `miakappBrowserRelayPage`, not the runner's
`miakappBrowserRelayAcceptance.run` API. This prevents the existing runner from
mistaking page-host observations for the complete 40-assertion matrix. A later
operator adapter must combine these browser facts with independent control
plane, relay, coordinator, KMS, Firestore and Hosting observations before it may
produce the runner's closed engine result.

The deterministic Vite builder emits exactly one HTML and one JavaScript file,
without source maps, under `/__acceptance/browser-relay/`. It also prepares
content-addressed gzip bytes and exact no-store/CSP headers for a future bounded
Hosting publisher. Building into an operator-private temporary directory is a
local operation; this package contains no publisher, CLI, credential loader,
cloud adapter or live authority.

The dedicated keyless GitHub workflow rebuilds those exact bytes and loads them
with every non-artifact request blocked in Chromium, Firefox and WebKit. It
checks the immutable dormant API, CSP-compatible module load and absence of the
runner result API. This is offline implementation evidence only: it supplies no
Firebase custom token, opens no relay and does not count as a live matrix run.

The execution envelope is intentionally narrower than the already-reviewed
maximums: 600 seconds for all three engines (480 + 60 + 60), followed by a
300-second callback cleanup reserve and a separate 300-second edge rollback
reserve inside the 1,200-second public ceiling. This removes the prior practical
dependence on a 60-second margin without modifying or invalidating the
preflighted edge/orchestrator source.
