# Dormant browser-relay evidence session

Status: operation-local capability and common monotonic epoch implemented;
not wired to the live operation, browser automation or source adapters

This package owns the in-memory boundary between future live evidence adapters
and the existing closed page and independent-source reducers. Creating one
production session captures one `process.hrtime.bigint` function at module
initialization, uses it for a single epoch and starts Chromium at offset zero.
The production factory accepts no option or clock. The owner may then obtain
attenuated ports fixed to exactly one
browser and source. A page port accepts only the five reviewed page
projections; every independent port accepts only one reviewed observation.
The session, never the caller, adds schemas, browser and source ownership,
sequence, phase or kind, page/input/identity generation and elapsed time.

The root session and every port are fresh frozen closures with no serializable
identifier. They reject JSON serialization. Closing, aborting or failing the
session revokes every outstanding port and clears all retained facts. A source
cannot submit another source's observation, a full fact, a caller timestamp, a
sequence, a receipt or a result. Inputs are bounded snapshots before they enter
the existing validators, so later caller mutation cannot alter accepted
evidence.

The state machine begins Chromium with the common epoch. Chromium's page
receipt must close before Firefox starts; Firefox must finish before WebKit
starts; both secondary windows must finish before Chromium and before the
Chromium LIVE-11 evidence. Only the session closes page receipts, browser spans
and the final matrix. The final output is the existing closed runner result;
raw facts, receipts and capability identity remain private.

This is an offline composition primitive, not live provenance yet. It is not
bound to the durable orchestrator claim, is not passed into the operation
envelope, and this directory contains no scheduler or source adapter. The
separate `browser-relay-case-scheduler` package now composes the production
session entrypoint without granting live authority. This directory contains no
HTTP client, browser launcher, credential loader, CLI, environment reader,
cloud mutation or publication path. Importing it performs no browser, network
or cloud work. Those remaining bindings require a later reviewed integration.

Deterministic unit tests use the separate `testing.mjs` entrypoint and its
explicit injected-clock factory. That entrypoint and the shared `internal.mjs`
implementation are pinned and package-guarded. They are not authorized in a
live import graph; future wiring must enforce an allowlist containing only the
production `session.mjs` entrypoint. A test-created result is offline test
evidence only.
