# Dormant staging browser-relay evidence aggregator

Status: closed independent-source engine aggregator implemented; not wired to
the browser runner and not executed

This package closes the semantic boundary between the phased browser page and
the runner's final engine result without pretending that browser observations
can prove cloud-side behavior. It is an in-process library only. It contains no
CLI, scheduler, credential loader, cloud client, Hosting publisher or mutation
adapter, and importing it performs no work.

Each browser execution must provide one ordered, single-use set of closed
receipts. Chromium requires eight distinct sources: the browser page, Firebase
App Check, Hosting, the control plane, the two relays, the synthetic
coordinator, KMS and Firestore. Firefox and WebKit require the five sources
needed to reconcile their session, App Check, exchange, relay and signing
counts. The browser page owns no cloud assertion. Every one of the runner's 40
assertions has exactly one reviewed owner, so overlapping or missing ownership
fails closed.

Counter ownership is similarly exclusive. App Check owns assessment counts,
the control plane owns exchange counts, KMS owns signature counts, Firestore
owns write counts, the browser page owns WebSocket and persistence facts, and
the coordinator owns physical call replay observations. Only the control plane
may report published JWK IDs; only the control plane and relays may report
public revision IDs; only the browser page may report stable client outcome
classes. Non-owner values
must be zero or empty. This prevents a convenient browser-side boolean from
standing in for independent infrastructure evidence.

The state machine accepts each source once in canonical order. A malformed,
private, false, duplicated or out-of-order receipt permanently invalidates that
instance; receipts cannot be retried and are discarded rather than returned.
Successful closure emits exactly the existing runner engine schema and passes
through its independent validator. Raw receipts, arbitrary dependency errors,
credentials and diagnostics never enter the result.

The profile pins the current pending live plan, runner, page, fixture, cloud
adapter and exact MiakAPI factory binding. It records no live receipt or engine
result and grants no authority to publish Hosting, open ingress, mutate staging
or execute the matrix. A later adapter must derive each receipt from its named
source, connect this aggregator to Playwright outside the page context, and
still run inside the already reviewed single-use operation and rollback
envelope.
