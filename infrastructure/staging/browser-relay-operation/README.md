# Dormant staging browser-relay live-operation envelope

Status: complete single-use ordering and cleanup envelope implemented; no live
execution, Hosting publication, fixture creation or public ingress authorized

This package closes the composition gap between the already preflighted edge
orchestrator and the live browser-relay matrix. It is an in-process library
only. It has no CLI, credential loader, scheduler or cloud adapter, and
importing it performs no work.

The outer orchestrator retains ownership of exact authorization, the atomic
generation-zero claim and the control-plane edge. Inside its one callback, this
envelope requires a pristine public-edge/private-relay baseline, creates only a
synthetic fixture, publishes and verifies the temporary Hosting runner, samples
the allowlisted monitoring boundary and opens both relays only as the last step
before the matrix. Exactly one three-engine result is accepted.

Cleanup is split across the edge dependency on purpose. The public-window
finally block removes the Hosting runner first, stops browser and coordinator
sessions, restores both relays to `private_ready`, and verifies that window
boundary. The existing orchestrator then restores the control plane to its
canonical private profile. A second unconditional cleanup removes synthetic
fixtures and temporary bindings only after that edge rollback, then verifies
the complete private target. Failures are collapsed to fixed errors, but never
reported as safe unless the final verifier succeeds.

All mutating component methods must resolve to the exact boolean `true`; raw
cloud responses cannot cross the adapter boundary. Monitoring samples are
evaluated by the existing bounded monitoring contract. Matrix and operation
results accept only closed semantic aggregates, reject credential-shaped
material and preserve no browser diagnostics.

The profile pins browser-relay plan revision 13, the merged edge-orchestrator
preflight, runner, monitoring and rollback evidence, and the private-ready relay
result. It grants no live authority. A later separately reviewed adapter and
exact authorization must supply the page artifact, synthetic coordinator,
short-lived credentials and cloud clients before this envelope can execute.
