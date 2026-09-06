# Dormant single-use browser-relay edge orchestrator

This package composes the already reviewed browser-relay edge state machine
with a durable, atomic single-use claim. It remains an in-process library: it
has no CLI, shell wrapper, scheduler, credential loader or automatic entrypoint.
Importing any module performs no request. The profile grants no cloud mutation,
public-ingress or live-acceptance authority.

The profile pins browser-relay plan revision 12 and all eight satisfied
prerequisites: two-key signing, real browser App Check attestation, the
rehearsal entry, two private-ready relays, the three-engine runner, monitoring
and the closed rollback preflight. It also pins every edge state-machine source
file and the exact live private-relay inventory.

The only future execution path has this order:

1. validate a separate exact authorization and all immutable pins;
2. observe that the global claim is absent;
3. observe the canonical-private control-plane baseline;
4. create one GCS object with `ifGenerationMatch=0`;
5. reobserve the byte-identical baseline after claim acquisition;
6. run one bounded edge window with one closed callback; and
7. verify a canonical-private postflight even when the callback fails.

The claim object is
`browser-relay/operations/acceptance-v1.json` in the existing private staging
state bucket. It is retained permanently, cannot be deleted or retried by this
contract, and is created before the first edge mutation. An ambiguous creation
outcome stops before the edge can open. The claim is an irreversible admission
marker, not an authorization token.

The edge state machine keeps its 1,200-second absolute public bound and
900-second callback bound. It still adds the unauthenticated control-plane
invoker last and removes it first. Ingress becomes private before the canonical
runtime is restored, and the IAM-independent emergency closure remains
available if combined inventory cannot be read.

A fresh post-merge read-only preflight completed at
`2026-09-06T08:06:38.345Z` from exact implementation commit
`6995856fc5cfd64a06176c83e9d24bc93558e05b`. It proved that the global claim
was absent, the complete rollback target remained canonical-private, both
relays remained private-ready, and the independently rendered four-resource
Terraform plan contained no changes. Its sanitized
[`preflight-result-v1.json`](preflight-result-v1.json) records zero claim
creation, mutation, public-ingress change and acceptance execution. Plan
revision 13 pins that result and marks `EDGE-01` satisfied. No edge transition,
relay invocation, Hosting publication or browser acceptance has occurred.
