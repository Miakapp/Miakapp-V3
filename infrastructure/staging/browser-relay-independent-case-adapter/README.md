# Browser-relay independent case adapter

This dormant source-only package fills the final `remainingAdapter` slot beneath
the existing Chromium and secondary-page case adapters. The complete production
import graph is now:

`case scheduler → Chromium case adapter → secondary case adapter → independent case adapter`.

The caller supplies the existing ready fixture and trusted page/phase providers,
seven independent source observers and one browser-lifecycle owner. Each source
observer exposes only `execute(scope)` and `close()`. The browser lifecycle
exposes only `startBrowser`, `closeBrowser` and `close`; page closure stays owned
by the upper page adapters.

## Observation ownership

The seven observer objects are fixed to App Check, Hosting, control plane,
relay, coordinator, KMS and Firestore by their position in an exact source map.
For each active stage, this adapter issues a fresh frozen, non-serializable scope
fixed to one source, browser and case. It contains only `browser`, `case_id`, the
operation abort signal and `record(observation)`. It does not reveal a scheduler
scope or accept a source, fact kind, sequence, timestamp, receipt or result.

Every record is matched to the next canonical kind and source sequence by this
adapter, validated with the independent-observer contract and immediately
projected as exactly `{ observation }`. The evidence session still derives the
authoritative fact envelope and monotonic time, owns all receipts and emits the
only final runner result. Temporary full facts exist only during synchronous
validation and are discarded before acknowledgement.

Source observers assigned to the same case execute concurrently, so this layer
does not manufacture a cross-source total order. Each observer's record call is
synchronous and must receive exact `true` acknowledgement. Its returned Promise
is the stage-level completion barrier and must resolve to `undefined` only after
the exact number of observations has been recorded.

## Lifecycle and failure boundary

This layer validates all eleven stages, the Chromium/Firefox/WebKit start order
and the Firefox/WebKit/Chromium close order. It receives no page-close call in
the reviewed composition. Non-close adapter transitions cannot overlap, and
per-browser started/closed state prevents lifecycle cursors from hiding a
duplicate or skipped browser. A protected abort listener propagates
cancellation to one internal signal. A first failure aborts sibling observers,
later synchronous observer invocations do not begin, all invoked source and
lifecycle tasks are awaited to settlement, every observer closes exactly once,
and only then does the browser-lifecycle fallback close exactly once. A result
requires successful cleanup convergence. Underlying errors and partial evidence
never escape.

Each observer scope is revoked as soon as that observer's own `execute` call
settles, even while a sibling observer for the same stage remains active. As
with the adjacent adapters, this is capability attenuation between trusted
same-process components, not a confidentiality sandbox. A retained observer can
learn the public case/browser labels it was given, and a non-cooperating
dependency can prevent settlement. Shared or untrusted live implementations
require dedicated process ownership and a validated narrow IPC protocol.

## Authority

Offline tests supply deterministic source observers and close all 43 independent
observations, 18 receipts and 40 runner assertions. A separate smoke composes the
same source scopes with real pinned Firefox and WebKit engines while intercepting
every request locally.

Those tests do not provide genuine App Check, Hosting, control-plane, relay,
coordinator, KMS or Firestore acquisition. This directory contains no transport,
credential loader, environment reader, browser launcher, CLI, cloud mutation,
Hosting publication, public-ingress change, durable-claim binding or execution
command. Live source provenance, trusted live page/browser providers, process
isolation and operation binding remain mandatory before the single staging
matrix may run.
