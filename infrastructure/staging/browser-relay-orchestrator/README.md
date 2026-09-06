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

This implementation does not yet satisfy `EDGE-01`. After merge, a fresh
read-only preflight must prove that the global claim is absent and that the
complete rollback target is still private and Terraform-converged. A later plan
revision may pin that sanitized result and close `EDGE-01`. No claim, edge
transition, relay invocation, Hosting publication or browser acceptance is
performed by this increment.
