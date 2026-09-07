# Dormant browser-relay case scheduler

Status: exact case interleaving and closure ownership implemented offline; not
wired to the durable claim, live operation, browsers or source adapters

This package composes the production browser-relay evidence session into one
fixed execution of `LIVE-02` through `LIVE-11`. Chromium anchors the session and
runs `LIVE-02..LIVE-09`. Its page then closes while its browser span remains
active. Firefox and WebKit each run the two ordered stages of `LIVE-10`, including
page and browser closure, before Chromium resumes for `LIVE-11` and closes last.
The adapter and evidence session both close before the scheduler returns the
existing closed runner result.

One injected operation-local adapter exposes exactly `startBrowser`, `execute`,
`closePage`, `closeBrowser` and `close`. Browser, page and browser-close methods
receive the scheduler's internal `AbortSignal`; each `execute` receives it inside
a fresh frozen scope fixed to one case and browser. The same adapter may retain
future browser and observer resources across cases. The scope exposes only
`case_id`, `browser`, `signal` and `record(source, projection)`. It cannot be
serialized, is revoked when the stage settles and admits only that stage's exact
source/count partition. The profile additionally pins the exact ordered fact
kinds assigned to every case, independently of the aggregate counts. The adapter
cannot provide case order, clocks, envelopes, sequences, receipts, root session
transitions, partial evidence or a result.

The scheduler owns these projection partitions:

- `LIVE-02`: five Chromium App Check and two Hosting projections;
- `LIVE-03`: four Chromium control-plane projections;
- `LIVE-04`: five Chromium page projections;
- `LIVE-05`: one page, three control-plane and one relay projection;
- `LIVE-06`: four page, one control-plane and one Firestore projection;
- `LIVE-07`: four relay projections;
- `LIVE-08`: two page, one relay and one coordinator projection;
- `LIVE-09`: six page projections, followed by Chromium page closure;
- each `LIVE-10` browser: three page, two App Check, one control-plane, two relay
  and one KMS projection, followed by page and browser closure;
- `LIVE-11`: three Chromium control-plane, two relay, two KMS and one Firestore
  projection, followed by Chromium browser closure.

Source observations may naturally interleave within a stage. The existing page
and independent reducers retain ownership of per-source order, elapsed time and
cross-source constraints. A callback must resolve to `undefined` after filling
its exact partition. Physical lifecycle is represented separately: the scheduler
awaits the adapter's browser start and page, browser and global close methods
before advancing the matching evidence-session boundary. In particular, each
secondary browser starts after the preceding logical close, which crosses the
session's strict monotonic boundary. Callback resolution alone is not claimed as
independent proof that an arbitrary external resource closed.

External abort is cooperative and accepts only a genuine `AbortSignal`. A
protected Node abort subscription propagates cancellation to the internal signal
even if another listener stops immediate propagation. The scheduler waits for
the currently invoked adapter method to settle before it calls the adapter's
global close exactly once as a final drain barrier. It never treats a losing
Promise as cancelled and never returns partial evidence. A concrete adapter that
ignores the internal signal can therefore prevent completion and must later be
bounded and reviewed at its own resource boundary.

The production entrypoint imports only `browser-relay-evidence-session/session.mjs`.
Deterministic tests use the separate `testing.mjs` entrypoint to inject a test
session factory. That entrypoint and `internal.mjs` are not authorized in a
future live import graph.

This directory contains no browser launcher, network or cloud client, credential
source, environment reader, CLI, durable-claim binding, operation adapter,
publication or mutation path. Importing it performs no live work. Genuine source
adapters, operation/claim binding, complete Chromium automation and native
BFCache proof remain required before the single live matrix can be authorized.
