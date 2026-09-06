# Browser-relay Playwright bridge

This dormant operator-local package connects Playwright page ownership to the
reviewed phased `miakappBrowserRelayPage` API. It receives the browser-page
receipt producer as an injected sink; it does not implement, replace or
self-attest that producer.

For Firefox and WebKit, the bridge lazily acquires one page and one memory-only
private input, records the exact initialize, ready and terminal facts, closes
the page, and only then closes the browser-owned source receipt. Page exceptions
and dependency errors are reduced to stable closed bridge failures. Raw facts,
tokens and Playwright diagnostics are not retained.

Chromium deliberately returns
`pinned_playwright_bfcache_unsupported` before it calls the page provider,
private-input provider or receipt-producer factory. Playwright 1.62.1 disables
BFCache and documents its navigation state as incompatible with BFCache restore
testing. The required native persisted `pagehide`/`pageshow` evidence therefore
remains strict and absent. The blocked bridge result has a different schema
from an engine result and cannot close Chromium acceptance.

This package does not produce any App Check, hosting, control-plane, relay,
coordinator, KMS or Firestore receipt. It is not connected to the independent
source aggregator, is not scheduled, performs no cloud mutation and authorizes
no live execution or public ingress.

Offline validation uses the real page runtime with synthetic dependencies in
Firefox and WebKit. A separate pinned-capability check exercises the Chromium
pre-input blocker without launching that engine. Firefox and WebKit prove page
ownership, phased transport, terminal cleanup and real browser-page receipt
closure. This is test evidence only, not cloud acceptance evidence.
