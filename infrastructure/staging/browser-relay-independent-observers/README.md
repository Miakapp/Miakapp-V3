# Dormant browser-relay independent source observers

Status: closed source-fact producers implemented; no transport adapter, live
wiring or execution

This package closes the semantic input boundary for the seven non-page owners
already assigned by the browser-relay aggregator. It produces the remaining 15
source receipts required by one three-browser matrix: seven for Chromium and
four each for Firefox and WebKit. Together with the existing three browser-page
receipts, the aggregator can now be exercised with all 18 receipt classes.

Each observer is an in-process, single-use state machine for one exact browser
and source pair. It accepts only its reviewed ordered fact kinds. Facts contain
bounded counts, elapsed durations, public key or revision identifiers and
stable enum outcomes; they cannot contain assertion maps, credentials, user or
Home identifiers, raw documents, log entries, requests, responses or
WebSocket frames. Invalid, repeated, missing or out-of-order input permanently
fails that observer and discards its partial state.

The facts deliberately distinguish what a later adapter must actually prove.
App Check combines isolated reCAPTCHA assessment and verification projections;
Hosting combines its management record with the public reserved SDK
configuration; control-plane and relay facts describe direct HTTP and protocol
observations; coordinator evidence counts physical call dispatches; KMS
evidence binds distinct signatures to its public key and inspects version 1;
and Firestore evidence projects only the exact synthetic route transition from
strong reads. Delayed aggregate metrics alone are not treated as proof of
route-specific behavior or exact run attribution.

Only the full closed runner-result producer is exported. It requires each
browser's local elapsed times plus explicit browser-start and page-receipt-close
offsets on the shared operation clock, and keeps all 15
independent receipts private, combines them with the three supplied page
receipts through the pinned aggregator, and then emits only the reviewed
runner result. Before that reduction it reconciles the
operation-scoped control-plane and KMS ledgers and verifies cross-source
rotation ordering. Control-plane
milestones bind the exact baseline and the two reviewed next revision
generations to the deployed source digest and deterministic signing-state
projection digests. The projection has an exported versioned schema name, two
exact ordered fields and canonical compact-JSON hash function; relay receipts pin the two
currently deployed revisions. The canonical LIVE case order is structurally
bracketed: Firefox and WebKit share Chromium's activation revision and each
secondary browser window must fall after the Chromium page receipt closes
LIVE-09 but before Chromium begins LIVE-11. The current
runner's whole-engine Chromium-then-Firefox-then-WebKit loop cannot express
that ordering and is explicitly incompatible; the result boundary now accepts
reviewed overlapping engine spans when their exact operation offsets are
provided, while its two-argument legacy mode retains the sequential duration
invariant. The offset-aware path rejects reversed or overlapping secondary
engine spans and requires WebKit to finish before Chromium begins LIVE-11.
Live orchestration must still interleave the global cases and close engine
aggregates afterward.

These pure producers do not yet authenticate source provenance. A later live
adapter must acquire every fact, browser-start offset and page-receipt-close
offset behind a single non-exportable, operation-local capability, derive them
from one common monotonic epoch, and reject
persisted, replayed or cross-operation evidence. Structural reconciliation in
this package is an additional consistency boundary, not a substitute for that
live provenance guarantee.

This directory contains no HTTP client, credential loader, CLI, scheduler,
browser automation, cloud mutation or publication path. Importing it initiates
no network, browser or cloud work. A later adapter must acquire the reviewed
facts from their named live sources, discard private material before crossing
this boundary, supply the three closed page receipts outside the page context,
and call this one runner-result boundary inside the existing single-use
operation and rollback envelope.
