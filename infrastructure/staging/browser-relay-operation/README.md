# Dormant staging browser-relay live-operation envelope

Status: complete single-use ordering and cleanup envelope; post-merge read-only
preflight succeeded, with no live execution, Hosting publication, fixture
creation or public ingress authorized

This package closes the composition gap between the already preflighted edge
orchestrator and the live browser-relay matrix. It is an in-process library
only. It has no CLI, credential loader, scheduler or cloud adapter, and
importing it performs no work.

The adjacent `preflight.mjs` composes exactly one fresh invocation of the
already closed orchestrator preflight. It accepts only an ephemeral in-memory
operator session, the exact merged implementation commit and the same
read-only observer seams. Its closed result requires the global claim absent,
the canonical-private control plane, two private-ready relays, no runner,
fixtures or temporary bindings, and a four-resource Terraform no-change plan.
It has no CLI or writer and rejects mutation adapters. Its one post-merge run
from exact commit `ae21e4922d3f70fffe9218cd975f180faca486f0`
produced [`preflight-result-v1.json`](preflight-result-v1.json), SHA-256
`e3e7e6fab86b1cd777be94b9a9d2c215698d1ab842c92bfd54b6f4ff7d15e436`.
The observation found the claim absent, the control plane canonical-private,
both relays private-ready, the runner route absent, zero application data or
temporary bindings and a four-resource Terraform no-change plan. It made zero
cloud mutations, public-ingress changes or acceptance executions and retained
no credential, raw response or Terraform plan.

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

The immutable profile pins browser-relay plan revision 13, the merged edge-orchestrator
preflight, runner, monitoring and rollback evidence, and the private-ready relay
result. Current browser-relay plan revision 14 preserves that input byte for
byte and pins the successful operation preflight. The package still grants no
live authority. A later separately reviewed adapter and
exact authorization must supply the page artifact, synthetic coordinator,
short-lived credentials and cloud clients before this envelope can execute.
