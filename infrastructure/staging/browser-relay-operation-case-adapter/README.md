# Browser-relay operation case adapter

This dormant composition root connects the existing single-use operation
envelope to the complete browser-relay case schedule. Its production entrypoint
accepts separate exact `operation` and `matrix` component objects; callers cannot
provide or replace `executeBrowserMatrix`, the clock or either timer. Timing
injection exists only behind the separate testing entrypoint.

## Claim-bound execution

The adapter intercepts one claim acquisition inside the unchanged operation. It
accepts only the canonical direct receipt already defined by the orchestrator,
then validates one immutable descriptor snapshot and retains its generation,
SHA-256, attempt and expiry inside one private
non-serializable capability. The capability is neither returned nor passed to an
injected component.

The first window callback operation validates and binds the frozen context before
the application fixture, runner or relays can be mutated. The same context
identity must reach the matrix entry. It contains only the genuine edge abort
signal and the three reviewed time bounds; the public and callback deadlines must
begin no earlier than the claim attempt and finish no later than its expiry.
Exactly one matrix may then enter. The adapter calls the complete independent case
schedule with only `{ signal }`. The scheduler creates the evidence session
beneath that post-claim gate; page and source providers do not receive claim
lineage.

The existing evidence session remains the sole owner of fact envelopes, the
monotonic epoch, receipts and runner result. The existing operation remains the
sole owner of the public-window aggregate, rollback and final cleanup result.
This adapter returns that unchanged closed operation result and clears the
in-memory claim lineage on every terminal path.

Early, duplicate, concurrent, replayed, expired, malformed or already-aborted
entries permanently poison the composition even if their local error is caught.
The exact edge signal propagates cooperative cancellation into the scheduler and
layered adapters. All operation and matrix components remain trusted and must
settle cooperatively after abort. The edge intentionally prioritizes its absolute
rollback deadline over a callback that ignores cancellation, so a hostile or
non-cooperating promise can outlive that rollback. This package does not claim
hard termination; dedicated-process browser ownership and validated narrow IPC
remain required before untrusted or live wiring.

## Authority

This directory contains no transport, browser launcher, credential loader,
environment reader, CLI, cloud mutation, Hosting publication, public-ingress
change or execution command. Its tests use injected runners and synthetic
receipts entirely offline. A production-entry failure smoke traverses the real
operation and schedule imports and proves both cleanup levels; the successful
closed-result smoke uses the separate testing entrypoint. The production
entrypoint hard-imports only the reviewed operation and complete schedule;
testing injection is not part of that graph.

The code-level durable-claim/operation/matrix binding is now present, but genuine
source transports, trusted live page/browser providers, dedicated-process IPC,
publication and the separately authorized single staging execution remain open.
The profile grants none of those authorities and records zero live evidence.
