# Miakapp 4 documentation

Miakapp 4 is an ecosystem-wide rebuild. This repository is the canonical
home for the shared architecture and delivery roadmap even though the work is
implemented across several repositories.

## Documents

- [`specs/2026-08-29-miakapp-v4-design.md`](specs/2026-08-29-miakapp-v4-design.md)
  — approved product and architecture direction. The operational migration
  procedure retains an explicit gate before cutover.
- [`rfcs/0001-wire-protocol.md`](rfcs/0001-wire-protocol.md) — accepted protocol
  1.0 byte contract, state and call semantics, limits and compatibility rules.
- [`rfcs/0002-component-runtime.md`](rfcs/0002-component-runtime.md) — accepted
  browser boundary, immutable artifact, capability bridge, semantic UI ABI, and
  release lifecycle.
- [`rfcs/0003-coordinator-sdk-and-migration.md`](rfcs/0003-coordinator-sdk-and-migration.md)
  — accepted public coordinator API, retry and lifecycle semantics, temporary
  Node-RED boundary, fail-closed shadow modes, and comparison contract.
- [`rfcs/0004-platform-control-plane.md`](rfcs/0004-platform-control-plane.md)
  — accepted owner bootstrap, Home Key, resource-specific token, JWKS, Firebase
  source identity, audience-bound browser exchange, push-consent and
  component-publication contract.
- [`rfcs/0005-browser-client-sdk.md`](rfcs/0005-browser-client-sdk.md) — accepted
  trusted-host browser lifecycle, immutable state, calls, reauthentication and
  cleanup contract; its audience-bound SDK/relay path now has pinned local
  two-relay evidence and a bounded control-plane staging probe while live relay
  and host integration remain gated.
- [`roadmaps/2026-08-29-miakapp-v4-coordination.md`](roadmaps/2026-08-29-miakapp-v4-coordination.md)
  — cross-repository sequence, ownership, acceptance gates, and deferred work.
- [`operations/2026-09-01-miakapp-v4-environments.md`](operations/2026-09-01-miakapp-v4-environments.md)
  — accepted local/staging/production isolation, cost posture, migration boundary,
  the historical staging-activation decision, and current gates before broader
  staging or any production use.
- [`operations/2026-09-04-browser-relay-integration.md`](operations/2026-09-04-browser-relay-integration.md)
  — pinned, synthetic real-Chromium reproduction and privacy-safe evidence
  procedure for the public browser client and Go relay.
- [`runbooks/user-relay-credentials.md`](runbooks/user-relay-credentials.md)
  — dependency order, privacy-safe validation, staging cost gate, monitoring and
  rollback for audience-bound browser relay credentials.
- [`../infrastructure/staging/browser-relay/`](../infrastructure/staging/browser-relay/)
  — digest-pinned closed plan for the live browser, two-relay, signing-key and
  rollback matrix; rebased against the current private two-key/App Check and
  private-ready two-relay state but not deployed, with every live case pending.
- [`../infrastructure/staging/browser-relay-runner/`](../infrastructure/staging/browser-relay-runner/)
  — dormant operator-local Chromium, Firefox and WebKit driver with ephemeral
  contexts, in-memory private input and a strictly closed counter-only result;
  its real three-engine offline CI smoke is implementation evidence only.
- [`../infrastructure/staging/browser-relay-page/`](../infrastructure/staging/browser-relay-page/)
  — dormant memory-only Firebase Auth, real App Check and digest-pinned MiakAPI
  page host with a deterministic two-file artifact loaded in all three browser
  engines by an offline CI gate; deliberately not wired to the runner until
  independent fixture and cloud observations can be combined.
- [`../infrastructure/staging/browser-relay-fixture/`](../infrastructure/staging/browser-relay-fixture/)
  — dormant single-fixture lifecycle controller with absence-gated creation and
  deletion, an exact synthetic MiakAPI coordinator, one fresh in-memory custom
  token per browser, guarded relay rotation and verified coordinator-first
  cleanup; its cloud adapter and live execution remain separate.
- [`../infrastructure/staging/browser-relay-monitoring/`](../infrastructure/staging/browser-relay-monitoring/)
  — allow-listed read-only monitoring contract whose post-merge preflight pins
  six metric surfaces, the existing EUR 10 budget and the private boundary.
- [`../infrastructure/staging/browser-relay-rollback/`](../infrastructure/staging/browser-relay-rollback/)
  — dormant six-step rollback and closed-target preflight contract whose
  post-merge read-only evidence verifies the private converged target.
- [`../infrastructure/staging/browser-relay-orchestrator/`](../infrastructure/staging/browser-relay-orchestrator/)
  — dormant single-use composition boundary with a retained generation-zero
  claim, post-claim baseline check, bounded edge window and mandatory private
  postflight; preflighted but not executed live.
- [`../infrastructure/staging/browser-relay-operation/`](../infrastructure/staging/browser-relay-operation/)
  — dormant full-operation envelope fixing the public-last relay transition and
  two-level cleanup order around the edge orchestrator; its post-merge
  read-only preflight succeeded, but no live adapter or execution authority is
  present.
- [`../infrastructure/staging/browser-relay-services/`](../infrastructure/staging/browser-relay-services/)
  — applied four-phase Terraform model holding two private-ready, scale-to-zero
  relays with immutable image selection, finite process admission and public-last
  IAM; all consumed operator entrypoints are retired.
- [`../infrastructure/staging/`](../infrastructure/staging/)
  — closed staging intent, digest-pinned live evidence, credential-free policy
  validator and teardown rehearsal. Cloud mutation remains behind separate
  explicit gates; reading the documents grants no deployment authority.

RFC 0001 is backed by independent Go and TypeScript implementations and shared
binary fixtures under [`../protocol/`](../protocol/). RFC 0002's architecture
selection is backed by a deliberately bounded, three-engine hostile browser
corpus under [`../component-runtime/`](../component-runtime/); complete
production conformance remains an exit gate for the component-platform vertical
slice. RFC 0003 is backed by the API-level corpus, bounded replay runner,
synthetic-home adapter and effect recorder under [`../coordinator-contract/`](../coordinator-contract/);
the real MiakAPI implementation now passes that contract while the Node-RED
runtime adapter remains open. RFC 0004 is backed by deterministic signed
vectors, independent TypeScript and Go verifiers, and a bounded behavioral model
under [`../control-plane-contract/`](../control-plane-contract/). Its first
owner-to-access-token implementation slice runs through Auth, Functions and
Firestore under [`../control-plane/`](../control-plane/). The same isolated
package now contains synthetic push and local component-publication vertical
slices; the latter drives private staging, server read-back, marker-gated public
delivery and pointer CAS through the Functions, Storage and Firestore emulators.
Structural adapter tests separately prove create-only generation-precondition
wiring because the Storage Emulator does not enforce that production
precondition. Separate client contexts prove the public-pointer and private
Storage/private-record Rules boundaries. Bounded admission and the deterministic
application/dependency fault matrix are now local gates under
[`../control-plane/FAULT-MATRIX.md`](../control-plane/FAULT-MATRIX.md). Live
network and managed-service rows remain implementation gates. A pinned local
cross-repository path now proves real Home Key exchange, SDK `HELLO` and
scheduled key-changing `REAUTH`, and relay production verification without
reconnecting. Its deterministic cache probe covers 32-way refresh coalescing,
unknown-`kid` abuse bounds, conditional expiry, fail-closed JWKS outage and
bounded recovery. It covers signing-key overlap and activation, not managed
retiring-key removal. A narrow reciprocal gate runs the public
`miakapi/browser` client in real Chromium against the Go relay and proves
snapshot, patch, call/result and completed post-lease reauthentication on one
WebSocket. The complete pinned platform gate additionally drives an
Auth-emulator identity and signed synthetic App Check token through the real
HTTPS exchange, exact `relay:user` verification, signing-key rotation and a
no-overlap authoritative handoff across two real relays. It uses synthetic
credentials and exact loopback Origins. One bounded private staging probe now
also proves live Firebase Auth/App Check enforcement, KMS-backed user-relay signing,
audience rotation and cleanup on the deployed control plane. The complete
standalone provider-attestation prerequisite was later closed when the default
system browser obtained one real reCAPTCHA Enterprise-backed App Check token
and the temporary Hosting route was retired. Two digest-pinned, scale-to-zero
relay services are now private-ready with exact assigned audiences and no
public IAM member. The complete disconnect matrix, authenticated browser-relay
flow, public ingress and broader staging acceptance remain open. A separately
pinned runner implementation now launches all three planned engines in an
offline CI smoke while collecting no browser diagnostics or credentials. The
current plan pins that merged implementation. A dormant monitoring contract
strictly allow-lists six read-only metric surfaces, the existing staging budget
shape and every runtime stop counter. One closed preflight from the merged
implementation observed those surfaces at the exact private boundary without a
cloud mutation, public-ingress change or acceptance execution. Plan revision 11
pins its result and closes `MONITORING-01`. The separate rollback package pins
the complete six-step reverse transition, ten closed-target observations and a
strict Terraform no-change shape. Its post-merge preflight observed the exact
private target without mutation or acceptance execution. Plan revision 12 pins
that sanitized result and closes `ROLLBACK-01`. A new dormant orchestrator now
implements the remaining edge composition boundary: separate exact
authorization precedes a globally serialized claim, the private baseline is
checked on both sides of claim acquisition, and one bounded edge window must
finish with a canonical-private postflight. Its profile authorizes nothing. A
post-merge read-only preflight proved the claim absent and the full rollback
target private and Terraform-converged without creating a claim or making a
cloud mutation. Plan revision 13 pins that sanitized result and closes
`EDGE-01`. The complete operation envelope then passed its own exact-commit
read-only preflight: the operation claim was absent, the edge and both relays
were private, the temporary route and application data were absent, and
Terraform had no change. Plan revision 14 pins that closed result; every
`LIVE-*` row remains pending. Plan revision 15 preserves revision 14
byte-for-byte and pins the merged page profile plus its independent three-engine
offline CI proof. The staging manifest retains the byte-exact earlier zero-relay plan used
by the image build, revision 9 used by the runner, revision 10 used by
monitoring, revision 11 used by rollback and revision 12 used by the
orchestrator preflight, revision 13 used by the operation preflight and revision
14 used by the page-host proof. It
pins the serial-4 private-ready result and rebases the current acceptance plan
on matching fresh live inventories. The state transition,
intended cost, exposure and rollback boundary remain reviewable without
pretending that a public edge or live browser matrix already exists.
The separate page-host foundation now builds locally and returns only bounded
browser observations. It grants no Hosting publication or live authority; the
next adapter must drive fixtures and independently aggregate the remaining
control-plane, relay, KMS, Firestore and lifecycle assertions.

Repository-specific implementation plans must link back to these documents and
must not redefine a shared contract locally.

## Public-repository rule

Everything under `docs/` is public. Never include production inventory,
household names, user counts, device identifiers, credentials, private hostnames,
or exports from a real home. Production characterization belongs in a local,
gitignored `.context/` directory.
