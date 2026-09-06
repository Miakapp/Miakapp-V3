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
current plan pins that merged implementation and leaves only edge, monitoring
and rollback preconditions open. The staging manifest retains the byte-exact
earlier zero-relay plan used by the image build and revision 9 used by the runner,
pins the serial-4 private-ready result and rebases the current acceptance plan on
a matching fresh live inventory. The state transition, intended cost, exposure
and rollback boundary remain reviewable without pretending that a public edge
or live browser matrix already exists.

Repository-specific implementation plans must link back to these documents and
must not redefine a shared contract locally.

## Public-repository rule

Everything under `docs/` is public. Never include production inventory,
household names, user counts, device identifiers, credentials, private hostnames,
or exports from a real home. Production characterization belongs in a local,
gitignored `.context/` directory.
