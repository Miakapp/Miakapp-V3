# Dormant staging browser-relay page host

Status: revision-3 closed scenario host, deterministic artifact builder and
three-engine dormant CI smoke implemented; not wired to the live runner,
published, or live executed

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
state matching and calls, serialized suspension/resumption and terminal cleanup.
Native `pagehide`/`pageshow` handling accepts only trusted browser events. The
separate `observeLifecycle` API exposes its schema, browser, bounded event and
state-transition projections, suspension/resumption/sign-out/disposal counts,
and typed `applied`/`failed`/`outcome_unknown` call outcomes. The existing safe
observation schema remains unchanged; neither shape contains credentials or raw
events. These are local host capabilities, not completed matrix assertions. It
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
runner result API. A separate allowlisted loopback harness uses the production
runtime with offline Firebase/MiakAPI fakes. Each pinned browser explicitly
stops the first identity, verifies sign-out/disposal, then initializes the
replacement identity. The later trusted non-persisted native `pagehide` proves
only synchronous terminal fencing: the page is terminal or `stopping`, client
stop has been invoked and active sockets are zero. IndexedDB remains blocked
while `stopping`, or is restored after `stopped`.
Browsers need not await asynchronous pagehide work, so native completion of
Firebase sign-out/disposal is not proven. An exact eight-field, sanitized,
fake-only checkpoint passes through ephemeral same-origin `sessionStorage`;
the destination immediately removes the key and verifies its absence. It
carries no credentials or raw diagnostics and exists only in the test harness.
The harness uses the production no-store headers and no real Firebase
credential or relay connection. These are offline implementation checks, not
cloud, publication or live-matrix acceptance.

Playwright 1.62.1 explicitly does not support BFCache testing. Native persisted
BFCache restoration therefore remains unproven with state
`blocked_by_pinned_playwright`; the trusted persisted unit test simulates its
events and is not native BFCache proof. The `offline_validation` profile section
keeps that distinction separate from both implemented lifecycle capabilities
and the absent live evidence. The complete page scenario and receipt bridge
remain unwired.

The execution envelope permits 720 seconds for all three engines
(600 + 60 + 60), followed by a 180-second callback cleanup reserve and a
separate 300-second edge rollback reserve inside the unchanged 900-second
callback and 1,200-second public ceilings. Chromium can therefore accommodate
two real renewal intervals plus scenario overhead. This changes no preflighted
edge/orchestrator source and grants no live execution authority.

Current revision 3 pins the existing revision-15 plan. The byte-exact
`profile-v2.json` preserves the earlier page CI input, including its revision-14
plan and original source/test digests. Plan 15 continues to pin that archived
page-2 profile and its original merged CI implementation; it is not rewritten
to claim proof for page 3. The guard verifies the archive's fixed digest without
comparing historical source pins to the current runtime. Current source and
offline smoke/helper digests are checked independently.
