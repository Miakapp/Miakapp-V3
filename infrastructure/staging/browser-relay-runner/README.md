# Dormant staging browser-relay runner

Status: three-engine closed-output runner implemented; no live execution,
Hosting publication or cloud mutation authorized

This package implements the operator-local browser boundary required by
`RUNNER-01`. It launches Chromium, Firefox and WebKit exactly once, in that
order, with one ephemeral context per engine. It has no CLI, scheduler,
credential loader, Hosting publisher or cloud adapter. Importing it performs no
work.

Private page input is requested once per engine and passed directly from
process memory to `page.evaluate`. The driver never logs, returns or persists
that input. It collects no browser console, request, response, WebSocket frame,
trace, HAR, video, screenshot, download, storage state or persistent profile.
Playwright protocol/API diagnostics and its inspector are rejected before any
private input exists. Every raw browser error is collapsed to a fixed local
error class.

The hosted page must expose the closed
`globalThis.miakappBrowserRelayAcceptance.run(input)` function. Its response is
rejected unless it contains exactly the assertion booleans assigned to that
engine, bounded counters, bounded duration, public key IDs, public Cloud Run
revision IDs and stable outcome classes. All assertions must be true. The final
driver result removes the assertion map and retains only per-engine counts plus
the allow-listed aggregate observations from the browser-relay plan.

The runner reserves 60 seconds inside the edge callback ceiling: its complete
three-engine sequence is bounded to 840 seconds, while each engine is bounded
to 720 seconds for Chromium and 60 seconds for each secondary engine; navigation
is bounded to 30 seconds. The Chromium allowance includes the 330-second key
retention observation. It runs sequentially, creates no cloud compute and can
invoke at most three browser engines. Aggregate App Check,
control-plane, KMS and Firestore counters are checked against the exact live
plan budgets. Source credentials on WebSocket, credential persistence and
physical-call replay counters must remain zero.

The profile pins browser-relay plan revision 9, the merged V3 and MiakAPI
commits, Playwright 1.62.1, Node 22.22.0 and Bun 1.2.23. It records no result and
grants no authority to expose the currently private services. A dedicated CI
smoke test intercepts the exact target URL locally and proves the same driver
launches all three real engines while keeping a private marker out of its closed
output. That is implementation evidence, not live staging evidence.

The next browser-relay plan rebase may mark `RUNNER-01` satisfied only after
this package and its real three-engine CI gate are merged. A later separately
claimed orchestrator must provide fresh in-memory credentials, publish the
reviewed page bundle, open and close the bounded edge, persist only the closed
result and remove the runner route before session drain.
