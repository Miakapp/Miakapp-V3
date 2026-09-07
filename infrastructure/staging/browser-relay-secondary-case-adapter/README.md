# Browser-relay secondary case adapter

This dormant source-only package inserts the existing Firefox and WebKit
Playwright bridge into the fixed browser-relay case schedule. It layers between
the Chromium case adapter and the independent case adapter, so the
complete production import graph is:

`case scheduler → Chromium case adapter → secondary case adapter → independent case adapter`.

The caller supplies one shared ready scenario fixture, the reviewed Chromium
page and phase providers, one trusted secondary page provider and the downstream
five-method adapter. The same fixture instance supplies Chromium generations one
and two, followed by Firefox generation one and WebKit generation one. Fixture
creation, removal and final absence still belong to the future operation layer;
this package receives only the four ready-phase methods.

## Projection ownership

The unchanged Playwright bridge still requires an injected receipt producer and
returns a typed closed bridge receipt. For each secondary `LIVE-10` stage, this
adapter supplies a producer that first feeds every complete bridge fact through
the actual browser-page receipt reducer. After that validation succeeds, it
extracts only the five safe page projection fields and synchronously records them
through the active scheduler scope. Exact `true` acknowledgement provides
backpressure. Neither a caller nor the bridge supplies the authoritative fact
sequence, phase, generation or elapsed time: the evidence session derives those
from its operation-local capability and clock, then closes its own authoritative
receipt at the later scheduler `closePage` boundary.

The bridge receipt is therefore an ephemeral proof that its page and local
producer closed in the reviewed order. It is validated and discarded; it is not
inserted into the final result. No fact or projection is retained after its
synchronous record call.

The downstream scope rejects `browser_page` for every browser. Chromium page
facts remain exclusively owned by the native Chromium adapter, Firefox/WebKit
page facts by this adapter, and App Check, Hosting, control-plane, relay,
coordinator, KMS and Firestore facts by the downstream adapter. The current
independent case adapter fills that slot with seven source-owned observer
capabilities in deterministic offline composition.

## Lifecycle and failure boundary

The fixed scheduler starts Chromium, closes the Chromium page after `LIVE-09`,
runs and completely closes Firefox, runs and completely closes WebKit, resumes
Chromium for `LIVE-11`, then closes the adapter and evidence session. This layer
validates that complete order. Each secondary bridge runs concurrently with its
independent-source stage; the bridge must finish all three projected facts and
physically close its page before this layer acknowledges `closePage`. Browser
start and browser close remain delegated so a future trusted provider can own
its context and process.

Cancellation is propagated through one internal abort controller. Every bridge
and downstream callback is tracked, as are the page and private-input
acquisitions that the bridge can outlive after an abort. A page that arrives
after cancellation is closed by this layer before the dependency drain settles.
Scopes are revoked after their stage, and global close aborts and drains all
invoked work before closing the remaining adapter exactly once. Boundary errors
are collapsed and partial results, private inputs, receipts and browser
diagnostics are never exposed.

## Authority

Offline tests close all 18 receipts and 40 runner assertions. A separate smoke
uses real pinned Firefox and WebKit engines with every request locally
intercepted. These proofs do not provide live browser providers, genuine cloud
observers, published Hosting, credentials, durable operation/claim binding or
execution authority.

The injected fixture, page providers, Chromium phase preparer and remaining
adapter are trusted same-process dependencies. This is not a confidentiality
sandbox. Dedicated browser-process ownership and a narrow validated IPC contract
remain mandatory before untrusted or shared live wiring. Cloud mutation, IAM,
Hosting publication, public ingress and live execution authority all remain
closed.
