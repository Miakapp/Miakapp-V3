# Staging browser-relay Chromium scenario

This dormant package closes the standalone Chromium page-scenario gap without
granting any deployment or live-execution authority. It drives the existing
browser-relay page host and the existing page-receipt producer; it does not
replace either contract.

The driver owns two pages and requests exactly two private inputs. Identity
generation 1 completes the initial connection, authoritative and patched state,
an applied call, same-relay reauthentication, relay-A-to-relay-B handoff,
failed and uncertain calls, recovery, native lifecycle suspension/restoration,
and terminal sign-out. That page and its CDP session are closed before identity
generation 2 may initialize, reach relay B, stop, and close. Only then may the
existing 18-fact Chromium receipt producer close.

The legacy standalone entry point still returns only that closed receipt. A
second explicit entry point additionally projects the five already-reviewed
browser-page observation fields after each internally constructed fact. Its
non-serializable `{ record, toJSON }` capability is trusted, receives no token,
identity, timestamp, sequence, assertion or raw CDP material, and must return
exactly `true`. Every call is awaited before the next browser action, so a case
scheduler can apply real backpressure instead of buffering facts across physical
stage boundaries. Rejection, cancellation or any other acknowledgement fails the
scenario closed and runs the same terminal cleanup.

The injected controller has exactly eleven ordered steps:
`authoritative_state`, `patched_state`, `initial_call`,
`same_relay_reauthenticated`, `relay_handoff_stale`, `relay_b_ready`,
`relay_b_state`, `relay_b_call`, `failed_call`, `uncertain_call`, and
`relay_b_recovered`. It may return only a bounded state expectation, a bounded
call target, or `undefined` as declared in `profile.json`. Controller completion
is preparation, never evidence: observations, lifecycle checkpoints, facts,
timestamps, assertions, receipts, and results are constructed inside the driver
from the page API.

## Trust boundary

This package is not a same-process security sandbox. `openPage`,
`privateInputProvider`, `controlPhase`, the page navigation, all installed page
content and init scripts, and the process that launches Playwright are trusted
parts of this dormant acceptance harness. The pinned in-process Playwright
connection must be exclusively owned by one scenario run; unrelated context,
page, CDP, tracing, routing or listener activity is not supported while the run
is active. In particular, code retaining these mutable Playwright objects in the
same JavaScript realm could replace restorable descriptors or preinstall page
code that observes an input. The leases below are defense in depth against
accidental diagnostics, public-API observer transitions and wrapper drift; they
do not make a hostile injected provider confidential.

`private_inputs_exposed: false` is deliberately limited to this package's
result, explicit page-projection port and retained diagnostics. The projection
port is part of the same trusted realm; it is not an IPC or confidentiality
boundary. Before any untrusted or shared live wiring, browser ownership must
move to a dedicated process with a narrow, validated IPC boundary. Until then
this source-only package remains offline and dormant.

Playwright 1.62.1 still explicitly does not support BFCache through its
high-level navigation abstraction, so the adjacent Playwright bridge correctly
continues to block Chromium. This dedicated path filters only Playwright's
`--disable-back-forward-cache` launch default in its offline smoke and uses the
pinned Chromium CDP surface. The smoke serves the same `no-store` cache policy
and security headers as the reviewed Hosting artifact. It navigates outbound
through `page.goto`, restores
the exact prior entry with `Page.navigateToHistoryEntry`, and reads the restored
page only through `Runtime.evaluate`. The same native smoke now uses the
projection entry point, withholds fact 12's acknowledgement, and proves the
first page remains on the target entry with no replacement page before releasing
the BFCache path; all 18 projections then close.

A restore is accepted only when two independent positive witnesses agree:

- the trusted page sequence is one persisted `pagehide` dispatched while
  visible, the subsequent trusted transition to hidden, and one persisted
  `pageshow` dispatched and completed while visible, with completed host
  suspend/resume checkpoints; and
- the main-frame CDP navigation is exactly one
  `BackForwardCacheRestore` to the reviewed target URL, with no
  `Page.backForwardCacheNotUsed` event.

Current and import-time-latched Playwright diagnostic modes are rejected before
any page or private-input dependency is invoked. Each pinned Playwright context
must also prove that tracing, HAR, video and API logging are inactive before the
private input is requested, after it is returned and synchronously before it is
serialized into the page call. A scenario-owned protocol lease also blocks and
latches new trace or HAR transitions until every token-bearing page is closed,
while pending capture operations are rejected before input acquisition. The
real-browser smoke proves both an already-active trace and an unawaited
`startChunk()` attempt cannot reach a token-bearing page action. Ordinary
Playwright instrumentation listeners are suppressed behind a second lease, and
token-bearing evaluations bypass caller-owned page wrappers through the pinned
main-frame implementation within the trusted boundary above. The production boundary observes the pinned
Playwright factories while each page is created, retains the exact page, frame
and channel identities, rejects pre-created or substituted objects, and locks
the trusted `evaluateExpression` channel path, its `_wrapApiCall` and
`_validatorToWireContext` dependencies, and the connection `onmessage`
transport callback for the token-bearing call. Factory validation faults are
latched without throwing through Playwright's connection dispatch; the
controlled acquisition continuation rejects them and owns every observed page
for cleanup. A dedicated child-process smoke proves that a page created from a
pre-existing context exits normally, requests no private input and is closed.
Cleanup bypasses caller-owned
`page.close`, invokes the captured native Page-channel close and
requires both native closed state and Page/Frame removal from the connection.
The real-browser smoke proves that forged frame prototypes, substituted
channels, injected channel methods, helper/transport shadows and no-op close methods all
fail before private-input acquisition while the real page still closes.
External cancellation is protected against hostile
listeners. Every injected dependency is raced against the internal abort
signal and then passes through a bounded drain barrier. A page or CDP session
that arrives after cancellation has
terminal cleanup attached, retained and retried. Owned browser operations are
interrupted by CDP detachment and page closure; any dependency that still does
not settle or resource that remains open makes cleanup fail closed after the
reviewed bound and remains one reason this package cannot be wired live yet.

The inert `away.html` file is test input only. `profile-v1.json` preserves the
exact pre-projection contract. The adjacent Chromium case adapter now composes
this projection port, the ready scenario-fixture interface and the scheduler
offline; this package itself remains independently reusable and grants no such
authority. Hosting publication, genuine source adapters, secondary live-browser
drivers, durable claim/operation binding, dedicated-process IPC, and live
execution remain absent. The profile authorizes no cloud, Hosting, IAM,
public-ingress, or live mutation.
