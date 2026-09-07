# Dormant Chromium case adapter

Status: native Chromium scenario and fixed case scheduler composed offline; no
live source adapter, secondary browser driver, operation, deployment or
execution authority

This package is the narrow source-only bridge between the existing fixed
`LIVE-02..LIVE-11` scheduler and the complete native Chromium scenario. Its
production entry point imports both production entry points directly. The
separate testing entry point is the only place where runners can be injected.

The caller supplies four exact components: a four-method ready-only fixture
facade, an `openChromiumPage` provider, a no-evidence `prepareChromiumPhase`
hook, and a five-method remaining adapter. Fixture creation, terminal stop,
removal and verified absence remain exclusively on the future operation
envelope; those lifecycle methods are not granted to this package.

## Physical and evidence ordering

The wrapper starts the native scenario only when Chromium `LIVE-04` becomes
active. It maps the driver's 18 projection acknowledgements to the scheduler's
fixed 5/1/4/2/6 page partition across `LIVE-04`, `LIVE-05`, `LIVE-06`, `LIVE-08`
and `LIVE-09`. Controls and both page/private-input acquisitions independently
wait for their owning case. Each projection is written directly into the active
scope and must return exactly `true`.

Fact 12 is recorded in `LIVE-08`, but its acknowledgement remains pending until
`LIVE-09` activates. Consequently the native driver cannot begin BFCache,
terminal sign-out or replacement-page work while `LIVE-08` is still the active
physical case. The successful, validated native scenario result proves that its
two pages and CDP lifecycle closed; Chromium `closePage` therefore does not ask
the remaining adapter to manufacture a second closure proof.

The eleven fixture/control mappings are fixed:

- current fixture state, then temperature 21 and call target 21 in `LIVE-04`;
- same-relay preparation in `LIVE-05`;
- relay-B preparation and the single fixture route rotation, current state and
  call target 22 in `LIVE-06`;
- failed/uncertain targets 23/24 and recovery to temperature 23 in `LIVE-08`.

`prepareChromiumPhase` always runs before the corresponding fixture action and
must return `undefined`; it is synchronization, never evidence.

## Attenuation and cleanup

Every scheduler scope passed to the remaining adapter is separately frozen,
non-serializable and revoked after that stage. For Chromium it rejects
`browser_page`, so only the native scenario can fill that source. All independent
Chromium sources, all secondary page sources and the Firefox/WebKit lifecycle
remain delegated. The adjacent secondary case adapter now fills both secondary
page paths offline while preserving this boundary. Browser start/close remains
delegated, including the outer Chromium browser span.

The adapter owns one protected cancellation controller. Global `close()` wakes
all stage gates, aborts and drains the native scenario and every delegated stage
callback, then closes the remaining adapter exactly once. Failures are collapsed
at the composition boundary; no
private input, fixture identity, raw projection, browser/CDP diagnostic or
underlying error is returned.

This is still a trusted same-realm composition, not a sandbox. The ready fixture,
page provider, phase hook and remaining adapter are trusted and must cooperate
with cancellation. A dedicated browser process with validated IPC is still
required before shared or untrusted live wiring. Genuine independent-source
adapters, trusted live page providers, durable claim and operation binding,
Hosting publication and live execution remain absent. The profile authorizes
no cloud, IAM, ingress, publication or live mutation.
