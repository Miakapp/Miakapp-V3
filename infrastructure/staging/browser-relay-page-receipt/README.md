# Browser relay page receipt producer

This package is a dormant, source-only reducer for the `browser_page` receipt
owned by the independent browser-relay evidence aggregator. It does not launch
a browser, access the network, publish Hosting content, read cloud state or
authorize the acceptance operation.

The producer accepts only the canonical page facts emitted from the pinned
browser host boundary. Chromium must provide 18 facts in exact order. They
cover the initial relay A session, authoritative state and a completed call,
two scheduled credential renewals, the serialized relay A-to-B handoff, stable
failed and uncertain outcomes, one bounded reconnect, a persisted native
`pagehide`/`pageshow` cycle, sign-out, and a fresh identity generation after the
prior page has stopped. Firefox and WebKit each provide the smaller three-fact
relay B start/stop path.

Every revision-2 fact carries only the page host's already-sanitized page and
lifecycle observations, an optional state/call observation and the two
allow-listed lifecycle events. Counts and arrays must remain cumulative within
a page instance. The producer uses typed lifecycle call outcomes rather than
guessing from SDK error labels. Terminal facts require zero active sockets and
completed host sign-out/disposal; they do not require an asynchronous SDK status
callback after the host has deliberately fenced its subscriptions. Lifecycle
events are cross-checked against the host projection. Source credentials,
browser storage, network payloads, raw errors and arbitrary fields are rejected.
The first invalid, missing or out-of-order fact permanently fails the producer;
facts are never retried or retained. Successful closure emits only the existing
`miakapp.staging-browser-relay-source-receipt/1` shape and delegates final
validation to the aggregator contract.

This is intentionally not wired yet. A complete matrix needs four private page
inputs: two Chromium page instances plus Firefox and WebKit. The current fixture
allows three; the separate scenario fixture supplies the fourth. Current page
revision 3 provides the required 600-second Chromium budget, serialized native
lifecycle handling and typed call outcomes. Its complete Chromium scenario
driver remains unwired. The adjacent Playwright bridge now drives the
three-phase Firefox and WebKit paths into this real producer and owns page
cleanup before receipt closure. The real-browser smoke proves
explicit terminal cleanup before sequential replacement using offline fakes.
The later non-persisted native pagehide proves synchronous terminal fencing,
not asynchronous Firebase cleanup or persisted restoration. Pinned Playwright
1.62.1 does not support
BFCache testing, so the bridge returns a distinct pre-input Chromium blocker
and native persisted evidence remains absent; simulated
persisted unit events cannot satisfy this producer's requirement. The current
profile records the
resolved timing capacity while retaining the original fixture's input limit
and the remaining integration gaps; the producer does not turn local host
capabilities into false acceptance evidence.
