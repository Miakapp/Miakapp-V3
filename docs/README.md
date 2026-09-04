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
  identity, push-consent and component-publication contract.
- [`roadmaps/2026-08-29-miakapp-v4-coordination.md`](roadmaps/2026-08-29-miakapp-v4-coordination.md)
  — cross-repository sequence, ownership, acceptance gates, and deferred work.
- [`operations/2026-09-01-miakapp-v4-environments.md`](operations/2026-09-01-miakapp-v4-environments.md)
  — accepted local/staging/production isolation, cost posture, migration boundary,
  and the gate before any Miakapp 4 cloud project is used.
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
the real MiakAPI and Node-RED implementations must still pass that contract. RFC
0004 is backed by deterministic signed vectors, independent TypeScript and Go
verifiers, and a bounded behavioral model under
[`../control-plane-contract/`](../control-plane-contract/). Its first
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
network, managed-service, relay-integration and staging acceptance rows remain
implementation gates. The staging manifest makes their intended resource, cost
and isolation boundary reviewable without pretending that production adapters
or a deployable cloud stack already exist.

Repository-specific implementation plans must link back to these documents and
must not redefine a shared contract locally.

## Public-repository rule

Everything under `docs/` is public. Never include production inventory,
household names, user counts, device identifiers, credentials, private hostnames,
or exports from a real home. Production characterization belongs in a local,
gitignored `.context/` directory.
